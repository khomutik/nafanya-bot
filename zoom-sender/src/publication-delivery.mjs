import { mkdir, open, readFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export const publicationTextHash = text => createHash('sha256').update(String(text || '').replace(/\s+/gu,' ').trim()).digest('hex');
const ordinal = id => Number(String(id).split(':').at(-1)) || 0;
export function isManagedPublication(item) {
  const p=item?.publication;
  return ['meeting_board','speaker_questions'].includes(p?.key) && /^\d{4}-\d{2}-\d{2}:\d+$/u.test(p.id)
    && Number.isInteger(p.partCount) && p.partCount>0 && p.partCount<=300 && Number.isInteger(p.partIndex) && p.partIndex>=0 && p.partIndex<p.partCount;
}

export class PublicationDelivery {
  constructor({ filePath, meetingScope, adapter, health, now=()=>Date.now(), retryMs=10000 }) {
    Object.assign(this,{filePath,meetingScope,adapter,health,now,retryMs});
    this.state=null;
    this.warning=null;
  }
  async load() {
    if(this.state)return;
    try {this.state=JSON.parse(await readFile(this.filePath,'utf8'));}
    catch(error){if(error.code!=='ENOENT')throw new Error('publication_state_unreadable');this.state={schema:1,streams:{}};}
    if(this.state.schema!==1||!this.state.streams||typeof this.state.streams!=='object')throw new Error('publication_state_invalid');
  }
  async save() {
    await mkdir(path.dirname(this.filePath),{recursive:true,mode:0o700});
    const temporary=this.filePath+'.'+randomUUID()+'.tmp';
    const file=await open(temporary,'wx',0o600);
    try {await file.writeFile(JSON.stringify(this.state));await file.sync();}finally{await file.close();}
    await rename(temporary,this.filePath);
  }
  report(code=null) {
    const pendingDeletes=Object.values(this.state?.streams||{}).reduce((n,s)=>n+(s.cleanup?.length||0),0);
    const pendingSends=Object.values(this.state?.streams||{}).some(s=>Object.values(s.groups||{}).some(g=>Object.keys(g.pending||{}).length));
    this.warning=code||(pendingSends?'publication_send_uncertain':pendingDeletes?'publication_cleanup_pending':null);
    this.health?.updatePublication?.({warning:this.warning,pendingDeletes});
  }
  async recoverPending(stream) {
    for(const group of Object.values(stream.groups))for(const [index,pending] of Object.entries(group.pending||{})) {
      const result=await this.adapter.findOwnSentMessage(pending.text,pending.beforeRefs);
      if(!result?.messageRef){this.report('publication_send_uncertain');return false;}
      group.parts[index]={ref:result.messageRef,hash:publicationTextHash(pending.text),outboxId:pending.outboxId};
      delete group.pending[index];await this.save();
    }
    return true;
  }
  serial(operation) {
    const result=(this.serialTail||Promise.resolve()).then(operation);
    this.serialTail=result.catch(()=>{});return result;
  }
  deliver(items) {return this.serial(()=>this.deliverCore(items));}
  async deliverCore(items) {
    if(!items.length)return {ackIds:[]};
    await this.load();
    const p=items[0].publication;
    if(!items.every(item=>isManagedPublication(item)&&item.publication.id===p.id&&item.publication.key===p.key&&item.publication.partCount===p.partCount))throw new Error('publication_batch_invalid');
    const scope=`${this.meetingScope}:${p.sessionDate}:${p.key}`;
    const stream=this.state.streams[scope] ||= {active:null,groups:{},cleanup:[]};
    if(!await this.recoverPending(stream))return {ackIds:[]};
    if(stream.active&&ordinal(p.id)<ordinal(stream.active))return {ackIds:items.map(item=>item.id)};
    const group=stream.groups[p.id] ||= {partCount:p.partCount,parts:{},pending:{}};
    if(group.partCount!==p.partCount)throw new Error('publication_parts_changed');
    const ackIds=[];
    for(const item of [...items].sort((a,b)=>a.publication.partIndex-b.publication.partIndex)) {
      const index=String(item.publication.partIndex),hash=publicationTextHash(item.text);
      if(group.parts[index]) {
        if(group.parts[index].hash!==hash)throw new Error('publication_content_changed');
        ackIds.push(item.id);continue;
      }
      const beforeRefs=await this.adapter.ownMessageRefs(item.text);
      group.pending[index]={text:item.text,beforeRefs,outboxId:item.id};await this.save();
      let result;
      try {result=await this.adapter.sendMessage(item.text,{verifyOwn:true,beforeRefs});}
      catch {this.report('publication_send_uncertain');return {ackIds};}
      if(!result?.sent){delete group.pending[index];await this.save();this.report('publication_send_waiting');return {ackIds};}
      if(!result.ack||!result.messageRef){this.report('publication_send_uncertain');return {ackIds};}
      group.parts[index]={ref:result.messageRef,hash,outboxId:item.id};delete group.pending[index];await this.save();ackIds.push(item.id);
    }
    if(Object.keys(group.parts).length!==group.partCount){this.report('publication_incomplete');return {ackIds};}
    stream.active=p.id;
    const tracked=new Set(stream.cleanup.map(item=>item.ref));
    for(const [id,oldGroup] of Object.entries(stream.groups))if(id!==p.id) {
      for(const receipt of Object.values(oldGroup.parts))if(!tracked.has(receipt.ref)) {
        stream.cleanup.push({...receipt,nextAttemptAt:0});tracked.add(receipt.ref);
      }
      if(!Object.keys(oldGroup.pending||{}).length)delete stream.groups[id];
    }
    await this.save();this.report();
    await this.cleanupStream(stream);
    return {ackIds,complete:true};
  }
  async cleanupStream(stream) {
    const protectedRefs=new Set(Object.values(stream.groups[stream.active]?.parts||{}).map(p=>p.ref));
    let attempts=0;
    const due=[...stream.cleanup].sort((a,b)=>Number(a.nextAttemptAt!==0)-Number(b.nextAttemptAt!==0)
      || Number(a.lastReason==='message_not_found_or_not_own')-Number(b.lastReason==='message_not_found_or_not_own')
      || a.nextAttemptAt-b.nextAttemptAt);
    for(const receipt of due) {
      if(receipt.nextAttemptAt>this.now()||attempts>=4)continue;
      if(protectedRefs.has(receipt.ref))throw new Error('publication_cleanup_targets_current');
      attempts++;
      const result=await this.adapter.deleteOwnMessage(receipt.ref,receipt.hash,{evidence:receipt.deleteEvidence,onBeforeDelete:async evidence=>{receipt.deleteEvidence=evidence;await this.save();}}).catch(error=>({deleted:false,reason:'delete_failed',detail:String(error?.message||error).split('\n')[0].slice(0,250)}));
      if(result?.deleted)stream.cleanup=stream.cleanup.filter(item=>item.ref!==receipt.ref);
      else {receipt.nextAttemptAt=this.now()+this.retryMs;receipt.lastReason=result?.reason||'delete_failed';receipt.lastError=result?.detail||null;this.report('publication_cleanup_pending');}
      await this.save();
    }
    this.report(stream.cleanup.length?'publication_cleanup_pending':null);
  }
  retryCleanup() {return this.serial(()=>this.retryCleanupCore());}
  async retryCleanupCore() {
    await this.load();
    for(const [scope,stream] of Object.entries(this.state.streams))if(scope.startsWith(this.meetingScope+':'))await this.cleanupStream(stream);
  }
  inspect() {return this.serial(()=>this.inspectCore());}
  async inspectCore() {
    await this.load();
    const publications=[];
    for(const [scope,stream] of Object.entries(this.state.streams)) {
      const current=[];
      for(const part of Object.values(stream.groups[stream.active]?.parts||{})) {
        const found=await this.adapter.locateOwnMessage(part.ref).catch(()=>null);
        current.push({ref:part.ref,expectedHash:part.hash,found:!!found,actualHash:found?publicationTextHash(found.record.text):null});
      }
      let controls=null;
      for(const receipt of stream.cleanup){controls=await this.adapter.inspectOwnControls(receipt.ref).catch(()=>null);if(controls)break;}
      publications.push({key:scope.split(':').at(-1),activeId:stream.active,current,pendingDeletes:stream.cleanup.length,reasons:stream.cleanup.map(item=>({reason:item.lastReason||null,error:item.lastError||null})),controls});
    }
    return {publications,warning:this.warning};
  }
}
