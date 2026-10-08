import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { PlaywrightZoomSender } from '../src/adapters/playwright-zoom-sender.mjs';
import { publicationTextHash } from '../src/publication-delivery.mjs';
const browser=await chromium.launch({headless:true,...(process.env.PN_CHROME_PATH?{executablePath:process.env.PN_CHROME_PATH}:{})});
try {
  const page=await browser.newPage();
  const ref='0-{11111111-2222-3333-4444-555555555555}';
  const other='0-{aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee}';
  await page.setContent(`<div class="new-chat-message" data-id="${ref}" id="chat-message-content-own" aria-label="You to Everyone"><div id="${ref}" class="new-chat-message__text-box--self">Own queue</div><button aria-label="More" onclick="document.getElementById('menu').hidden=false">…</button></div><div class="new-chat-message" data-id="${other}" id="chat-message-content-other" aria-label="Participant to Everyone"><div id="${other}">Own queue</div><button aria-label="More">…</button></div><div id="menu" hidden><button onclick="document.getElementById('${ref}').textContent='You deleted a message';document.getElementById('menu').hidden=true">Delete</button></div>`);
  const adapter=new PlaywrightZoomSender({});adapter.page=page;
  assert.ok(await adapter.locateOwnMessage(ref));
  assert.equal(await adapter.locateOwnMessage(other),null);
  assert.equal((await adapter.deleteOwnMessage(other,publicationTextHash('Own queue'))).deleted,false);
  assert.equal((await adapter.deleteOwnMessage(ref,publicationTextHash('Different content'))).deleted,false);
  assert.equal(await page.locator(`[id="${other}"]`).innerText(),'Own queue');
  assert.equal((await adapter.deleteOwnMessage(ref,publicationTextHash('Own queue'))).deleted,true);
  assert.equal(await page.locator(`[id="${ref}"]`).innerText(),'You deleted a message');
  assert.equal((await adapter.deleteOwnMessage(ref,publicationTextHash('Own queue'))).deleted,true,'A retained deletion marker is an idempotent success');
  assert.equal(await page.locator(`[id="${other}"]`).innerText(),'Own queue');
  console.log('Browser deletion checks passed: UUID/ownership/content guards, deletion marker, unchanged participant message.');
}finally{await browser.close();}
