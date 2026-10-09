// Read-only production verification. Credentials stay in the server's env file.
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const filename=process.argv[2];
const env=filename?{}:process.env;
for(const line of (filename?await readFile(filename,'utf8'):'').split(/\r?\n/)) {
  const m=line.match(/^([A-Z0-9_]+)=(.*)$/);if(!m)continue;
  env[m[1]]=m[2].trim().replace(/^(["'])(.*)\1$/,'$2');
}
if(!env.WORKER_BASE_URL||!env.ZOOM_PANEL_TOKEN)throw new Error('Worker URL or panel access missing');
const request=async pathname=>{
  const response=await fetch(env.WORKER_BASE_URL.replace(/\/+$/,'')+pathname,{headers:{'x-nafanya-zoom-panel-token':env.ZOOM_PANEL_TOKEN},signal:AbortSignal.timeout(15000)});
  assert.equal(response.status,200,`Unexpected status for ${pathname}`);return response;
};
const html=await (await request('/zoom-only/app')).text();
assert.equal([...html.matchAll(/data-message-group="start"/g)].length,6);
assert.equal([...html.matchAll(/data-message-key="group_sponsors"/g)].length,6);
assert.ok(html.includes('meeting_board_edit_entry')&&html.includes('speaker_questions_mark_spoken'));
for(const script of [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)])new Function(script[1]);
const status=await (await request('/zoom-only/status')).json();
const boards=status.meetingBoards||status.meetingBoard?.boards||{};
const speaker=status.speakerQuestions||{};
const testRows=speaker.entries?.filter(item=>item.text.includes('\u0416\u043e\u0440\u0438\u043a')&&item.text.includes('08.10'))||[];
assert.equal(testRows.length,0,'A test speaker row is still present');
console.log(JSON.stringify({ok:true,panels:6,scriptSyntax:'ok',outboxSize:status.outboxSize,boards:Object.fromEntries(Object.entries(boards).map(([day,b])=>[day,{queue:b.entries?.length||0,topics:b.additionalTopics?.length||0}])),speakerEntries:speaker.entries?.length||0,testRows:0}));
