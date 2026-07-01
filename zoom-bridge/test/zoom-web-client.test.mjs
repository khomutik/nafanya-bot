import test from "node:test";
import assert from "node:assert/strict";
import {
  buildZoomChatPayload,
  buildZoomSeenKey,
  buildZoomWebClientUrl,
  hasRecentSentText,
  looksLikeOwnZoomOutput,
  normalizeZoomChatFingerprint,
  parseZoomChatMessageText,
  rememberSentText,
  shouldIgnoreZoomMessage
} from "../src/adapters/zoom-web-client.mjs";

test("zoom web client ignores messages from the bot itself", () => {
  assert.equal(
    shouldIgnoreZoomMessage({ sender: "\u041d\u0430\u0444\u0430\u043d\u044f (\u0434\u043e\u043c\u043e\u0432\u043e\u0439 \u0431\u043e\u0442)" }, "\u041d\u0430\u0444\u0430\u043d\u044f (\u0434\u043e\u043c\u043e\u0432\u043e\u0439 \u0431\u043e\u0442)"),
    true
  );
  assert.equal(
    shouldIgnoreZoomMessage({ sender: "\u041d\u0430\u0444\u0430\u043d\u044f (\u0434\u043e\u043c\u043e" }, "\u041d\u0430\u0444\u0430\u043d\u044f (\u0434\u043e\u043c\u043e\u0432\u043e\u0439 \u0431\u043e\u0442)"),
    true
  );
  assert.equal(shouldIgnoreZoomMessage({ sender: "\u041c\u0430\u0448\u0430" }, "\u041d\u0430\u0444\u0430\u043d\u044f"), false);
});

test("zoom web client recognizes its own visible output even when Zoom drops sender", () => {
  assert.equal(looksLikeOwnZoomOutput("\u041E\u0447\u0435\u0440\u0435\u0434\u044C\n\n\u041E\u0427\u0415\u0420\u0415\u0414\u042C \u041E\u0422\u041A\u0420\u042B\u0422\u0410\n\n\u041F\u043E\u043A\u0430 \u043F\u0443\u0441\u0442\u043E."), true);
  assert.equal(looksLikeOwnZoomOutput("\u0401\u0436\u0438\u043A+\u0411\u0438\u043B\u043B+\u0438\u0433\u0440\u0430 \u041F\u0438\u0448\u0438\u0442\u0435 \u0432 \u0447\u0430\u0442 \"111\" \u0434\u043B\u044F \u0432\u044B\u0441\u043A\u0430\u0437\u044B\u0432\u0430\u043D\u0438\u044F"), true);
  assert.equal(looksLikeOwnZoomOutput("\u0427\u0430\u0441\u0442\u044C 2/3 \u0414\u043B\u0438\u043D\u043D\u044B\u0439 \u0442\u0435\u043A\u0441\u0442"), true);
  assert.equal(looksLikeOwnZoomOutput("\u042D\u0442\u0430 \u043A\u043E\u043C\u0430\u043D\u0434\u0430 \u0442\u043E\u043B\u044C\u043A\u043E \u0434\u043B\u044F \u043E\u0440\u0433\u0430\u043D\u0438\u0437\u0430\u0442\u043E\u0440\u0430 \u0438 \u0441\u043E\u043E\u0440\u0433\u0430\u043D\u0438\u0437\u0430\u0442\u043E\u0440\u043E\u0432."), true);
  assert.equal(looksLikeOwnZoomOutput("\u043E\u0447\u0435\u0440\u0435\u0434\u044C"), false);
  assert.equal(looksLikeOwnZoomOutput("111"), false);
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

test("zoom web client extracts sender and body from Zoom chat text", () => {
  assert.deepEqual(
    parseZoomChatMessageText("\u041c\u0430\u043d\u044f \u0425. 13:09 \u043e\u0442\u043a\u0440\u044b\u0442\u044c \u0431\u0438\u043b\u043b"),
    {
      sender: "\u041c\u0430\u043d\u044f \u0425.",
      text: "\u043e\u0442\u043a\u0440\u044b\u0442\u044c \u0431\u0438\u043b\u043b"
    }
  );
  assert.deepEqual(
    parseZoomChatMessageText("\u041c\u0430\u043d\u044f \u0425. 13:09\n\u043c\u043e\u043b\u0438\u0442\u0432\u0430"),
    {
      sender: "\u041c\u0430\u043d\u044f \u0425.",
      text: "\u043c\u043e\u043b\u0438\u0442\u0432\u0430"
    }
  );
  assert.deepEqual(
    parseZoomChatMessageText("111", "111"),
    {
      sender: "",
      text: "111"
    }
  );
  assert.deepEqual(
    parseZoomChatMessageText("111", "\u0410\u0410 \u041F\u043E\u0447\u0442\u0438 \u043D\u043E\u0440\u043C\u0430\u043B\u044C\u043D\u044B\u0435 \u041A\u043E\u043C\u0443 \u0412\u0441\u043520:01"),
    {
      sender: "\u0410\u0410 \u041F\u043E\u0447\u0442\u0438 \u043D\u043E\u0440\u043C\u0430\u043B\u044C\u043D\u044B\u0435",
      text: "111"
    }
  );
});

test("zoom web client dedupe keys allow repeated short commands", () => {
  assert.equal(normalizeZoomChatFingerprint("  \u041E\u0447\u0435\u0440\u0435\u0434\u044C\n\n\u041F\u043E\u043A\u0430   \u043F\u0443\u0441\u0442\u043E. "), "\u043e\u0447\u0435\u0440\u0435\u0434\u044c \u043f\u043e\u043a\u0430 \u043f\u0443\u0441\u0442\u043e.");
  assert.equal(
    buildZoomSeenKey({ id: "1:\u0430", sender: "\u041c\u0430\u0448\u0430", text: "111" }),
    buildZoomSeenKey({ id: "1:\u0430", sender: "\u041c\u0430\u0448\u0430", text: " 111 " })
  );
  assert.notEqual(
    buildZoomSeenKey({ id: "1:\u0430", sender: "\u041c\u0430\u0448\u0430", text: "111" }),
    buildZoomSeenKey({ id: "9:\u0431", sender: "\u041c\u0430\u0448\u0430", text: " 111 " })
  );
});

test("zoom web client suppresses recently sent bot fragments", () => {
  const sentTexts = new Map();
  rememberSentText(sentTexts, [
    "\u0427\u0442\u0435\u043d\u0438\u0435 \u043A\u043D\u0438\u0433\u0438",
    "\u041F\u0438\u0448\u0438\u0442\u0435 \u0432 \u0447\u0430\u0442 \"111 \u0447\u0438\u0442\u0430\u0442\u044C\" \u0438\u043B\u0438 \"111 \u0432\u044B\u0441\u043A\u0430\u0437\u0430\u0442\u044C\u0441\u044F\"",
    "",
    "\u041E\u0427\u0415\u0420\u0415\u0414\u042C \u041E\u0422\u041A\u0420\u042B\u0422\u0410",
    "",
    "\u25B6 1. Vladimir \u2014 111"
  ].join("\n"), 300000);
  assert.equal(
    hasRecentSentText(sentTexts, "\u0427\u0442\u0435\u043D\u0438\u0435 \u043A\u043D\u0438\u0433\u0438 \u041F\u0438\u0448\u0438\u0442\u0435 \u0432 \u0447\u0430\u0442 \"111 \u0447\u0438\u0442\u0430\u0442\u044C\""),
    true
  );
  assert.equal(hasRecentSentText(sentTexts, "111"), false);
});
