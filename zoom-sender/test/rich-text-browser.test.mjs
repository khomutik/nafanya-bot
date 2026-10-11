import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { chromium } from "playwright";
import { sendChatText } from "../src/adapters/playwright-zoom-sender.mjs";

async function createEditor(t, { toolbar = true } = {}) {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    const toolbarMarkup = toolbar
      ? '<button id="bold" type="button" aria-label="Bold" hidden>B</button>'
      : '';
    response.end(`<!doctype html><form>
      <button id="format" type="button" aria-label="Format">T</button>
      ${toolbarMarkup}
      <div id="chat" contenteditable="true" aria-label="chat"></div>
      </form><script>
        window.sent = [];
        window.nativeBoldClicks = 0;
        window.clipboardWrites = 0;
        window.shortcutBoldEvents = 0;
        Object.defineProperty(navigator, 'clipboard', {
          configurable: true,
          value: { async write() { window.clipboardWrites += 1; } }
        });
        document.addEventListener('keydown', event => {
          if (event.ctrlKey && event.key.toLowerCase() === 'b') window.shortcutBoldEvents += 1;
        });
        document.querySelector('#format').addEventListener('click', () => {
          const bold = document.querySelector('#bold');
          if (bold) bold.hidden = !bold.hidden;
        });
        document.querySelector('#bold')?.addEventListener('click', () => {
          window.nativeBoldClicks += 1;
          document.querySelector('#chat').focus();
          document.execCommand('bold');
        });
        document.addEventListener('keydown', event => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          const editor = document.querySelector('#chat');
          window.sent.push({ text: editor.innerText, html: editor.innerHTML });
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

test("Zoom formats bold with its native editor toolbar and sends once", async (t) => {
  const page = await createEditor(t);

  const rich = await sendChatText(page, "**Bold heading**\n\nNormal text");
  assert.equal(rich.sent, true, JSON.stringify(rich));
  assert.equal(rich.ack, true);
  assert.equal(rich.formattingApplied, true);
  assert.ok(await page.evaluate(() => window.nativeBoldClicks >= 2), "Use Zoom's Bold toolbar control for on/off transitions");
  assert.equal(await page.evaluate(() => window.clipboardWrites), 0, "Do not use clipboard formatting as a second path");
  assert.equal(await page.evaluate(() => window.shortcutBoldEvents), 0, "Do not synthesize Ctrl+B as a fallback");
  assert.deepEqual(await page.evaluate(() => window.sent[0]), {
    text: "Bold heading\n\n\nNormal text",
    html: "<b>Bold heading</b><div><b><br></b></div><div>Normal text</div>"
  });

  const mixed = await sendChatText(page, "**Bold one** normal **bold two**");
  assert.equal(mixed.sent, true);
  assert.equal(mixed.formattingApplied, true);
  assert.deepEqual(await page.evaluate(() => window.sent[1]), {
    text: "Bold one normal bold two",
    html: "<b>Bold one</b> normal <b>bold two</b>"
  });
  assert.equal(await page.evaluate(() => window.sent.length), 2, "Each message must be sent exactly once");
});

test("formatted text is not sent as plain text when Zoom's native toolbar is missing", async (t) => {
  const page = await createEditor(t, { toolbar: false });

  const result = await sendChatText(page, "**Must remain bold**");
  assert.deepEqual(result, { sent: false, ack: false, reason: "zoom_format_toolbar_unavailable" });
  assert.equal(await page.evaluate(() => window.sent.length), 0, "Do not send unformatted fallback text");
  assert.equal(await page.locator("#chat").innerText(), "", "Clear the draft so a retry starts cleanly");
});

test("plain chat messages bypass formatting controls and still send once", async (t) => {
  const page = await createEditor(t);

  const plain = await sendChatText(page, "Ordinary queue update");
  assert.equal(plain.sent, true);
  assert.equal(plain.ack, true);
  assert.equal(plain.formattingApplied, false);
  assert.deepEqual(await page.evaluate(() => window.sent[0]), {
    text: "Ordinary queue update",
    html: "Ordinary queue update"
  });
});
