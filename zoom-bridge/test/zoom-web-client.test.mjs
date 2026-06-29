import test from "node:test";
import assert from "node:assert/strict";
import { buildZoomChatPayload, shouldIgnoreZoomMessage } from "../src/adapters/zoom-web-client.mjs";

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
