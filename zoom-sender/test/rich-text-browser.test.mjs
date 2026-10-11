import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { chromium } from "playwright";
import { sendChatText } from "../src/adapters/playwright-zoom-sender.mjs";

test("Zoom rich clipboard paste preserves bold, sends once, and falls back safely", async (t) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(`<!doctype html><form><div id="chat" contenteditable="true" aria-label="chat"></div></form><script>
      window.sent = [];
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
  await page.context().grantPermissions(["clipboard-write"], { origin: `http://127.0.0.1:${address.port}` });

  const rich = await sendChatText(page, "**Bold heading**\n\nNormal text");
  assert.equal(rich.sent, true);
  assert.equal(rich.formattingApplied, true);
  assert.deepEqual(await page.evaluate(() => window.sent[0]), {
    text: "Bold heading\n\nNormal text",
    html: "<strong>Bold heading</strong><br><br>Normal text"
  });

  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { async write() { throw new Error("clipboard unavailable"); } }
    });
  });
  const fallback = await sendChatText(page, "**Bold fallback**");
  assert.equal(fallback.sent, true);
  assert.equal(fallback.formattingApplied, false);
  assert.equal(await page.evaluate(() => window.sent.length), 2, "Fallback must not send twice");
  assert.deepEqual(await page.evaluate(() => window.sent[1]), {
    text: "Bold fallback",
    html: "Bold fallback"
  });

  const clipboardWritesBeforePlain = await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { async write() { window.clipboardWriteCalls = (window.clipboardWriteCalls || 0) + 1; } }
    });
    return window.clipboardWriteCalls || 0;
  });
  const plain = await sendChatText(page, "Ordinary queue update");
  assert.equal(plain.sent, true);
  assert.equal(plain.formattingApplied, false);
  assert.equal(await page.evaluate(() => window.sent.length), 3, "Plain messages must still send once");
  assert.equal(await page.evaluate(() => window.clipboardWriteCalls || 0), clipboardWritesBeforePlain, "Plain messages must bypass clipboard work");
});
