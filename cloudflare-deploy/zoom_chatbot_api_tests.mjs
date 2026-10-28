import test from "node:test";
import assert from "node:assert/strict";
import {
  buildZoomChatbotImageContent,
  buildZoomChatbotTextContent,
  resetZoomChatbotTokenCacheForTests,
  sendZoomChatbotMessage
} from "./zoom_chatbot_api.js";
import nafanyaWorker from "./worker.mjs";

const env = {
  ZOOM_CHATBOT_CLIENT_ID: "bridge-client-id",
  ZOOM_CHATBOT_CLIENT_SECRET: "bridge-client-secret",
  ZOOM_CHATBOT_BOT_JID: "bot@xmpp.zoom.us",
  ZOOM_CHATBOT_ACCOUNT_ID: "zoom-account-id"
};
const channelId = "12345678-1234-1234-1234-123456789abc";

test("Chatbot sender requests a bearer token and posts to the meeting chat JID", async () => {
  resetZoomChatbotTokenCacheForTests();
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (String(url).startsWith("https://zoom.us/oauth/token")) {
      return Response.json({ access_token: "test-bearer", expires_in: 3600 });
    }
    return Response.json({ message_id: "message-1", sent_time: "2026-10-28 12:00:00" });
  };
  const result = await sendZoomChatbotMessage(env, {
    channelId,
    userId: "user-123",
    content: buildZoomChatbotTextContent("\u041f\u0438\u043b\u043e\u0442\u043d\u043e\u0435 \u0441\u043e\u043e\u0431\u0449\u0435\u043d\u0438\u0435")
  }, { fetchImpl, now: 1_000_000 });

  assert.equal(result.ok, true);
  assert.equal(result.messageId, "message-1");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "https://zoom.us/oauth/token?grant_type=client_credentials");
  assert.equal(calls[1].url, "https://api.zoom.us/v2/im/chat/messages");
  assert.equal(calls[1].init.headers.authorization, "Bearer test-bearer");
  assert.deepEqual(JSON.parse(calls[1].init.body), {
    robot_jid: env.ZOOM_CHATBOT_BOT_JID,
    account_id: env.ZOOM_CHATBOT_ACCOUNT_ID,
    to_jid: `${channelId}@conference.xmpp.zoom.us`,
    user_jid: "user-123@xmpp.zoom.us",
    content: { head: { text: "\u041f\u0438\u043b\u043e\u0442\u043d\u043e\u0435 \u0441\u043e\u043e\u0431\u0449\u0435\u043d\u0438\u0435" } }
  });
});

test("Chatbot sender caches the token across button-triggered messages", async () => {
  resetZoomChatbotTokenCacheForTests();
  let tokenRequests = 0;
  const fetchImpl = async (url) => {
    if (String(url).startsWith("https://zoom.us/oauth/token")) {
      tokenRequests += 1;
      return Response.json({ access_token: "cached-bearer", expires_in: 3600 });
    }
    return Response.json({ message_id: `message-${tokenRequests}` });
  };
  await sendZoomChatbotMessage(env, { channelId, userId: "user-123", content: { head: { text: "one" } } }, { fetchImpl, now: 5_000_000 });
  await sendZoomChatbotMessage(env, { channelId, userId: "user-123", content: { head: { text: "two" } } }, { fetchImpl, now: 5_001_000 });
  assert.equal(tokenRequests, 1);
});

test("Chatbot payload builders keep text within the existing Zoom safety limit", () => {
  assert.equal(buildZoomChatbotTextContent("а".repeat(950)).head.text.length, 950);
  assert.throws(() => buildZoomChatbotTextContent("а".repeat(951)), /message_length/u);
  assert.throws(() => buildZoomChatbotTextContent("  "), /message_length/u);
});

test("Chatbot image content uses Zoom's supported section and image structure", () => {
  assert.deepEqual(buildZoomChatbotImageContent({
    text: "\u041c\u0435\u0434\u0430\u043b\u044c",
    imageUrl: "https://example.test/medal.png",
    altText: "Годовщина"
  }), {
    body: [{
      type: "section",
      layout: "horizontal",
      sections: [
        { type: "message", text: "\u041c\u0435\u0434\u0430\u043b\u044c" },
        { type: "image", images: [{ image_url: "https://example.test/medal.png", alt_text: "Годовщина", image_index: 0 }] }
      ]
    }]
  });
  assert.throws(() => buildZoomChatbotImageContent({ text: "\u041c\u0435\u0434\u0430\u043b\u044c", imageUrl: "http://example.test/medal.png" }), /image_content_invalid/u);
});

test("Worker protects pilot delivery and returns only successful Chatbot message IDs", async () => {
  resetZoomChatbotTokenCacheForTests();
  const previousFetch = globalThis.fetch;
  let nextId = 0;
  const zoomRequests = [];
  globalThis.fetch = async (url, init = {}) => String(url).startsWith("https://zoom.us/oauth/token")
    ? Response.json({ access_token: "route-test-bearer", expires_in: 3600 })
    : (zoomRequests.push({ url: String(url), body: JSON.parse(init.body) }), Response.json({ message_id: `route-message-${++nextId}` }));
  try {
    const request = new Request("https://worker.example/zoom-only/chatbot/pilot-send", {
      method: "POST",
      headers: { "content-type": "application/json", "x-nafanya-zoom-panel-token": "panel-token" },
      body: JSON.stringify({ action: "pilot_text", channelId, userId: "user-123", accountId: "attacker-value", text: "test" })
    });
    const response = await nafanyaWorker.fetch(request, {
      ZOOM_PANEL_TOKEN: "panel-token",
      ...env
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, requestId: "", sentCount: 1, messageIds: ["route-message-1"] });
    assert.deepEqual(zoomRequests, [{
      url: "https://api.zoom.us/v2/im/chat/messages",
      body: {
        robot_jid: env.ZOOM_CHATBOT_BOT_JID,
        account_id: env.ZOOM_CHATBOT_ACCOUNT_ID,
        to_jid: `${channelId}@conference.xmpp.zoom.us`,
        user_jid: "user-123@xmpp.zoom.us",
        content: { head: { text: "test" } }
      }
    }]);

    const unauthorized = await nafanyaWorker.fetch(new Request("https://worker.example/zoom-only/chatbot/pilot-send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "pilot_text", channelId, userId: "user-123", accountId: "attacker-value", text: "test" })
    }), { ZOOM_PANEL_TOKEN: "panel-token", ...env });
    assert.equal(unauthorized.status, 401);

    resetZoomChatbotTokenCacheForTests();
    globalThis.fetch = async () => Response.json({ reason: "invalid_client" }, { status: 401 });
    const tokenFailure = await nafanyaWorker.fetch(new Request("https://worker.example/zoom-only/chatbot/pilot-send", {
      method: "POST",
      headers: { "content-type": "application/json", "x-nafanya-zoom-panel-token": "panel-token" },
      body: JSON.stringify({ action: "pilot_text", channelId, userId: "user-123", text: "test" })
    }), { ZOOM_PANEL_TOKEN: "panel-token", ...env });
    assert.equal(tokenFailure.status, 502);
    assert.deepEqual(await tokenFailure.json(), { ok: false, error: "zoom_chatbot_token_request_failed:401" });
  } finally {
    globalThis.fetch = previousFetch;
    resetZoomChatbotTokenCacheForTests();
  }
});

test("Chatbot sender rejects missing account, malformed channel and untrusted content", async () => {
  const fetchImpl = async () => { throw new Error("must_not_send"); };
  await assert.rejects(sendZoomChatbotMessage({ ...env, ZOOM_CHATBOT_ACCOUNT_ID: "" }, { channelId, userId: "user-123", content: { head: { text: "x" } } }, { fetchImpl }), /account_id_invalid/u);
  await assert.rejects(sendZoomChatbotMessage(env, { channelId: "arbitrary", userId: "user-123", content: { head: { text: "x" } } }, { fetchImpl }), /channel_id_invalid/u);
  await assert.rejects(sendZoomChatbotMessage(env, { channelId, userId: "user-123", content: "raw" }, { fetchImpl }), /content_invalid/u);
});
