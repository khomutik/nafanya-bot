// Explicit test launcher, not a production sender entrypoint.
import {execFileSync} from 'node:child_process';
import {readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const cwd=fileURLToPath(new URL('../',import.meta.url));
const files=readdirSync(new URL('./',import.meta.url)).filter(f=>f.endsWith('.test.mjs')).map(f=>`test/${f}`);
execFileSync(process.execPath,['--test',...files],{cwd,stdio:'inherit'});
