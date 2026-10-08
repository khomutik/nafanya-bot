// Explicit operator test helper. `status` is read-only; `action` posts the supplied panel action.
const workerBase=process.env.WORKER_BASE_URL?.replace(/\/+$/,'');
const secret=process.env.ZOOM_ONLY_SECRET||process.env.ZOOM_BRIDGE_SECRET;
const panelToken=process.env.ZOOM_PANEL_TOKEN;
if(!workerBase||!secret||!panelToken)throw new Error('Live probe credentials missing');
const command=process.argv[2]||'status';
if(command==='action') {
  const body=JSON.parse(Buffer.from(process.argv[3]||'','base64').toString('utf8'));
  body.requestId ||= crypto.randomUUID();
  const response=await fetch(workerBase+'/zoom-only/app/action',{method:'POST',headers:{'content-type':'application/json','x-nafanya-zoom-panel-token':panelToken},body:JSON.stringify(body)});
  const data=await response.json();
  if(!response.ok||!data.ok)throw new Error(data.error||`HTTP ${response.status}`);
  console.log(JSON.stringify({ok:true,version:data.state?.version,lastEntryId:data.state?.entries?.at(-1)?.id,lastTopicId:data.state?.additionalTopics?.at(-1)?.id,queue:data.state?.entries?.length,topics:data.state?.additionalTopics?.length}));
}else if(command==='status') {
  const health=await (await fetch('http://127.0.0.1:3097/health')).json();
  const response=await fetch('http://127.0.0.1:3097/publication-status',{headers:{'x-nafanya-zoom-secret':secret}});
  const delivery=response.ok?await response.json():{httpStatus:response.status};
  const status=await (await fetch(workerBase+'/zoom-only/status',{headers:{'x-nafanya-zoom-panel-token':panelToken}})).json();
  const ourTests=items=>(items||[]).filter(item=>item.text.startsWith('\u0416\u043e\u0440\u0438\u043a:')&&item.text.includes('08.10')).map(item=>({id:item.id,text:item.text,status:item.status}));
  console.log(JSON.stringify({health,delivery,outboxSize:status.outboxSize,queues:Object.fromEntries(Object.entries(status.meetingBoards||{}).map(([key,b])=>[key,{queue:b.entries?.length,topics:b.additionalTopics?.length,testEntries:ourTests(b.entries),testTopics:ourTests(b.additionalTopics)}])),speaker:status.speakerQuestions?.entries?.length,testSpeaker:ourTests(status.speakerQuestions?.entries)}));
}else throw new Error('Unknown live probe command');
