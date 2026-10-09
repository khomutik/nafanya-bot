import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const dir=fileURLToPath(new URL('../',import.meta.url));
const git=(...args)=>execFileSync('git',args,{cwd:dir,encoding:'utf8'}).trim();
assert.equal(git('branch','--show-current'),'main','Production must use the unified main branch');
for(const baseline of ['3d24c5616af770980218cd297a8bb594976d3360','30e1c5e']) {
  git('merge-base','--is-ancestor',baseline,'HEAD');
}
const source=readFileSync(new URL('../worker.mjs',import.meta.url),'utf8');
for(const feature of ['group_sponsors','completePublications','meeting_board_edit_entry','meeting_board_edit_topic','speaker_questions_edit','speaker_questions_mark_spoken','data-message-group','canonicalPeople','DAILY_22_50_ANNOUNCEMENT_ID']) {
  assert.ok(source.includes(feature),`Production capability missing: ${feature}`);
}
const config=JSON.parse(readFileSync(new URL('../wrangler.jsonc',import.meta.url),'utf8'));
assert.equal(config.name,'pochti-normalnye-bot');
assert.ok(config.durable_objects.bindings.some(b=>b.name==='ZOOM_MEETING_STATE'));
assert.ok(config.durable_objects.bindings.some(b=>b.name==='ZOOM_SHARED_TIMER_STATE'));
console.log('Deployment preflight passed: unified history, Telegram and Zoom capabilities retained.');
