import test from "node:test";
import assert from "node:assert/strict";
import {
  buildZoomChatPayload,
  buildZoomSeenKey,
  buildZoomWebClientUrl,
  normalizeZoomChatFingerprint,
  shouldIgnoreZoomMessage
} from "../src/adapters/zoom-web-client.mjs";

test("zoom web client ignores messages from the bot itself", () => {
  assert.equal(
    shouldIgnoreZoomMessage({ sender: "\u041d\u0430\u0444\u0430\u043d\u044f (\u0434\u043e\u043c\u043e\u0432\u043e\u0439 \u0431\u043e\u0442)" }, "\u041d\u0430\u0444\u0430\u043d\u044f (\u0434\u043e\u043c\u043e\u0432\u043e\u0439 \u0431\u043e\u0442)"),
    true
  );
  assert.equal(shouldIgnoreZoomMessage({ sender: "\u041c\u0430\u0448\u0430" }, "\u041d\u0430\u0444\u0430\u043d\u044f"), false);
});

test("zoom web client builds worker payloads without secrets", () => {
  const payload = buildZoomChatPayload({
    id: "m1",
    sender: "\u0410\u043d\u043d\u0430",
    text: "111",
    role: "cohost",
    isCoHost: true
  });
  assert.deepEqual(payload, {
    id: "m1",
    text: "111",
    user: {
      displayName: "\u0410\u043d\u043d\u0430",
      role: "cohost",
      isHost: false,
      isCoHost: true
    },
    source: "zoom_web_client"
  });
});

test("zoom web client uses direct browser join URL", () => {
  const url = buildZoomWebClientUrl("https://us06web.zoom.us/j/5487249245?pwd=abc");
  assert.equal(url, "https://us06web.zoom.us/wc/join/5487249245?pwd=abc");
});

test("zoom web client dedupe keys survive chat DOM reshuffles", () => {
  assert.equal(normalizeZoomChatFingerprint("  \u041E\u0447\u0435\u0440\u0435\u0434\u044C\n\n\u041F\u043E\u043A\u0430   \u043F\u0443\u0441\u0442\u043E. "), "\u043e\u0447\u0435\u0440\u0435\u0434\u044c \u043f\u043e\u043a\u0430 \u043f\u0443\u0441\u0442\u043e.");
  assert.equal(
    buildZoomSeenKey({ id: "1:\u0430", sender: "\u041c\u0430\u0448\u0430", text: "111" }),
    buildZoomSeenKey({ id: "9:\u0431", sender: "\u041c\u0430\u0448\u0430", text: " 111 " })
  );
});
