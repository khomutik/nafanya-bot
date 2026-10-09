import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const cwd=fileURLToPath(new URL('../',import.meta.url));
const git=(...args)=>execFileSync('git',args,{cwd,encoding:'utf8'}).trim();
const run=(...args)=>execFileSync(process.execPath,args,{cwd,stdio:'inherit'});
assert.equal(git('status','--porcelain'),'','Commit all source changes before production deployment');
git('fetch','origin','main');
git('merge-base','--is-ancestor','origin/main','HEAD');
run('scripts/deploy-preflight.mjs');
for(const test of ['regression_tests.mjs','zoom_panel_tests.mjs','queue_engine_tests.mjs','zoom_library_tests.mjs']) {
  run(test,...(test==='regression_tests.mjs'?['--skip-live-knowledge']:[]));
}
run('--test','message_addressing_tests.mjs','response_quality_tests.mjs','telegram_api_tests.mjs');
run('../zoom-sender/test/release-tests.mjs');
const commit=git('rev-parse','HEAD');
run('node_modules/wrangler/bin/wrangler.js','deploy','--keep-vars','--message',`Unified Telegram + Zoom; git ${commit}`);
