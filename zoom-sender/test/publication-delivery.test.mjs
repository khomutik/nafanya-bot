import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PublicationDelivery, publicationTextHash } from '../src/publication-delivery.mjs';

const messages=(id,texts,key='meeting_board')=>texts.map((text,partIndex)=>({id:Number(id)+partIndex,text,publication:{key,id:`2026-10-08:${id}`,sessionDate:'2026-10-08',partIndex,partCount:texts.length}}));
class MockZoom {
  constructor(){this.messages=new Map([['historic','Old history'],['participant','Participant message']]);this.deleted=[];this.events=[];this.next=1;this.deleteFails=false;this.failSendAt=0;this.calls=0;this.uncertain=false;}
  async ownMessageRefs(text){return [...this.messages].filter(([id,t])=>id.startsWith('own-')&&t===text).map(([id])=>id);}
  async findOwnSentMessage(text,excluded){const refs=(await this.ownMessageRefs(text)).filter(id=>!excluded.includes(id));return refs.length===1?{messageRef:refs[0]}:null;}
  async sendMessage(text){this.calls++;if(this.calls===this.failSendAt)return {sent:false,ack:false};const ref=`own-${this.next++}`;this.messages.set(ref,text);this.events.push(`send:${ref}`);if(this.uncertain)return {sent:true,ack:false};return {sent:true,ack:true,messageRef:ref};}
  async deleteOwnMessage(ref,hash){this.events.push(`delete:${ref}`);if(this.deleteFails)return {deleted:false};if(!ref.startsWith('own-')||publicationTextHash(this.messages.get(ref))!==hash)return {deleted:false};this.messages.delete(ref);this.deleted.push(ref);return {deleted:true};}
}
async function fixture(){const directory=await mkdtemp(path.join(os.tmpdir(),'nafanya-publication-test-'));const adapter=new MockZoom();let now=1000;const settings={filePath:path.join(directory,'state.json'),meetingScope:'test-meeting',adapter,now:()=>now};return {adapter,settings,delivery:new PublicationDelivery(settings),advance:()=>now+=11000};}

test('new snapshot is verified before deletion; history and other streams survive',async()=>{
  const f=await fixture();await f.delivery.deliver(messages(1,['Queue v1']));await f.delivery.deliver(messages(2,['Speaker v1'],'speaker_questions'));
  await f.delivery.deliver(messages(3,['Queue v2']));
  assert.equal(f.adapter.messages.get('historic'),'Old history');assert.equal(f.adapter.messages.get('participant'),'Participant message');assert.ok([...f.adapter.messages.values()].includes('Speaker v1'));
  assert.ok(![...f.adapter.messages.values()].includes('Queue v1'));assert.ok(f.adapter.events.indexOf('send:own-3')<f.adapter.events.indexOf('delete:own-1'));
});
test('all parts must arrive before old publication is removed, including after restart',async()=>{
  const f=await fixture();await f.delivery.deliver(messages(1,['Old']));f.adapter.failSendAt=3;
  let result=await f.delivery.deliver(messages(2,['Part one','Part two']));assert.equal(result.complete,undefined);assert.ok([...f.adapter.messages.values()].includes('Old'));assert.deepEqual(result.ackIds,[2]);
  f.adapter.failSendAt=0;const restarted=new PublicationDelivery(f.settings);result=await restarted.deliver(messages(2,['Part one','Part two']));assert.equal(result.complete,true);assert.equal(f.adapter.calls,4);assert.ok(![...f.adapter.messages.values()].includes('Old'));
});
test('cleanup failure leaves new content, retries independently, never resends publication',async()=>{
  const f=await fixture();await f.delivery.deliver(messages(1,['Old']));f.adapter.deleteFails=true;await f.delivery.deliver(messages(2,['New']));
  assert.equal(f.delivery.warning,'publication_cleanup_pending');assert.equal(f.adapter.messages.size,4);
  f.adapter.deleteFails=false;f.advance();await new PublicationDelivery(f.settings).retryCleanup();assert.equal(f.adapter.calls,2);assert.ok(![...f.adapter.messages.values()].includes('Old'));
});
test('uncertain send is reconciled by exact own evidence after restart instead of duplicated',async()=>{
  const f=await fixture();f.adapter.uncertain=true;let result=await f.delivery.deliver(messages(1,['Uncertain']));assert.deepEqual(result.ackIds,[]);
  f.adapter.uncertain=false;result=await new PublicationDelivery(f.settings).deliver(messages(1,['Uncertain']));assert.deepEqual(result.ackIds,[1]);assert.equal(f.adapter.calls,1);
});
test('ambiguous send does not delete the old publication or repeat the send blindly',async()=>{
  const f=await fixture();await f.delivery.deliver(messages(1,['Old']));f.adapter.sendMessage=async()=>({sent:true,ack:false});await f.delivery.deliver(messages(2,['Not confirmed']));
  const calls=f.adapter.calls;const result=await f.delivery.deliver(messages(2,['Not confirmed']));assert.deepEqual(result.ackIds,[]);assert.equal(f.adapter.calls,calls);assert.ok([...f.adapter.messages.values()].includes('Old'));assert.equal(f.delivery.warning,'publication_send_uncertain');
});
test('superseded partial snapshots are cleaned only after a complete newer version',async()=>{
  const f=await fixture();await f.delivery.deliver(messages(1,['Old']));f.adapter.failSendAt=3;await f.delivery.deliver(messages(2,['Abandoned part','Missing part']));
  f.adapter.failSendAt=0;await f.delivery.deliver(messages(4,['Newest']));assert.deepEqual([...f.adapter.messages.values()],['Old history','Participant message','Newest']);
  await f.delivery.deliver(messages(2,['Abandoned part','Missing part']));assert.equal(f.adapter.calls,4,'Late old batches must not republish obsolete content');
});
test('persisted acknowledgements make replay idempotent and retain receipts',async()=>{
  const f=await fixture();const batch=messages(1,['Same']);await f.delivery.deliver(batch);await new PublicationDelivery(f.settings).deliver(batch);assert.equal(f.adapter.calls,1);
  const state=JSON.parse(await readFile(f.settings.filePath,'utf8'));assert.equal(state.streams['test-meeting:2026-10-08:meeting_board'].active,'2026-10-08:1');
});
test('changed content in an existing publication is rejected without deletion',async()=>{
  const f=await fixture();await f.delivery.deliver(messages(1,['Original']));await assert.rejects(()=>f.delivery.deliver(messages(1,['Different'])),/publication_content_changed/);assert.deepEqual(f.adapter.deleted,[]);
});
