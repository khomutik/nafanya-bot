import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { chromium } from "playwright";
import { sendChatText } from "../src/adapters/playwright-zoom-sender.mjs";

async function createEditor(t) {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(`<!doctype html><form>
      <button id="format" type="button" aria-label="Format">T</button>
      <button id="bold" type="button" aria-label="Bold">B</button>
      <div id="chat" contenteditable="true" aria-label="chat"></div>
      </form><script>
        window.sent = [];
        window.formatClicks = 0;
        window.boldClicks = 0;
        document.querySelector('#format').addEventListener('click', () => window.formatClicks++);
        document.querySelector('#bold').addEventListener('click', () => window.boldClicks++);
        document.addEventListener('keydown', event => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          const editor = document.querySelector('#chat');
          window.sent.push(editor.innerText);
          editor.innerHTML = '';
        });
      </script>`);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const address = server.address();
  await page.goto(`http://127.0.0.1:${address.port}`);
  return page;
}

test("Zoom sender sends normal chat text once without touching formatting controls", async (t) => {
  const page = await createEditor(t);

  const result = await sendChatText(page, "**Ordinary title**");
  assert.deepEqual(result, { sent: true, ack: true });
  assert.deepEqual(await page.evaluate(() => window.sent), ["Ordinary title"]);

  const ordinary = await sendChatText(page, "Ordinary queue update");
  assert.deepEqual(ordinary, { sent: true, ack: true });
  assert.deepEqual(await page.evaluate(() => window.sent), ["Ordinary title", "Ordinary queue update"]);
  assert.equal(await page.evaluate(() => window.formatClicks + window.boldClicks), 0);
});
