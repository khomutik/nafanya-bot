const TOKEN_URL = "https://zoom.us/oauth/token?grant_type=client_credentials";
const MESSAGE_URL = "https://api.zoom.us/v2/im/chat/messages";
let cachedToken = null;

function cleanZoomIdentifier(value, name, maxLength = 160) {
  const result = String(value || "").trim();
  if (!result || result.length > maxLength || /[\s\r\n]/u.test(result)) {
    throw new Error(`zoom_chatbot_${name}_invalid`);
  }
  return result;
}

function meetingChannelJid(channelId) {
  const value = cleanZoomIdentifier(channelId, "channel_id", 192);
  const channelJid = /^([a-z\d._-]{1,128})@conference\.xmpp\.zoom\.us$/iu.exec(value);
  if (channelJid) return value;
  // Zoom Apps SDK returns chatChannelUUID without guaranteeing UUID punctuation.
  // Accept both canonical UUIDs and their 32-character hexadecimal form.
  if (!/^(?:[a-f\d]{32}|[a-f\d-]{36})$/iu.test(value)) {
    const diagnostic = [
      `len_${value.length}`,
      `uuid36_${/^[a-f\d-]{36}$/iu.test(value) ? 1 : 0}`,
      `hex32_${/^[a-f\d]{32}$/iu.test(value) ? 1 : 0}`,
      `jid_${value.endsWith("@conference.xmpp.zoom.us") ? 1 : 0}`,
      `ascii_${/^[\x20-\x7e]+$/u.test(value) ? 1 : 0}`
    ].join(":");
    throw new Error(`zoom_chatbot_channel_id_invalid:${diagnostic}`);
  }
  return `${value}@conference.xmpp.zoom.us`;
}

function userJid(userId) {
  const value = cleanZoomIdentifier(userId, "user_id", 128);
  if (!/^[a-z\d._-]+$/iu.test(value)) throw new Error("zoom_chatbot_user_id_invalid");
  return `${value}@xmpp.zoom.us`;
}

function requiredCredentials(env) {
  return {
    clientId: cleanZoomIdentifier(env?.ZOOM_CHATBOT_CLIENT_ID, "client_id"),
    clientSecret: cleanZoomIdentifier(env?.ZOOM_CHATBOT_CLIENT_SECRET, "client_secret"),
    botJid: cleanZoomIdentifier(env?.ZOOM_CHATBOT_BOT_JID, "bot_jid"),
    accountId: cleanZoomIdentifier(env?.ZOOM_CHATBOT_ACCOUNT_ID, "account_id")
  };
}

async function requestChatbotToken(env, fetchImpl = fetch, now = Date.now()) {
  const credentials = requiredCredentials(env);
  if (cachedToken && cachedToken.expiresAt > now + 60_000) return cachedToken.value;
  const authorization = `Basic ${btoa(`${credentials.clientId}:${credentials.clientSecret}`)}`;
  const response = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: { authorization }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.access_token) {
    const code = String(body.reason || body.error || "").toLowerCase().replace(/[^a-z0-9_]/gu, "").slice(0, 64);
    throw new Error(`zoom_chatbot_token_request_failed:${response.status}:${code || "unknown"}`);
  }
  const expiresIn = Math.max(60, Math.min(3600, Number(body.expires_in) || 3600));
  cachedToken = { value: String(body.access_token), expiresAt: now + (expiresIn * 1000) };
  return cachedToken.value;
}

export async function sendZoomChatbotMessage(env, {
  channelId,
  userId,
  content
} = {}, { fetchImpl = fetch, now = Date.now() } = {}) {
  const credentials = requiredCredentials(env);
  const toJid = meetingChannelJid(channelId);
  const authorJid = userJid(userId);
  if (!content || typeof content !== "object" || Array.isArray(content)) {
    throw new Error("zoom_chatbot_content_invalid");
  }
  const token = await requestChatbotToken(env, fetchImpl, now);
  const response = await fetchImpl(MESSAGE_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      robot_jid: credentials.botJid,
      account_id: credentials.accountId,
      to_jid: toJid,
      user_jid: authorJid,
      content
    })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.message_id) {
    const code = String(result.code || "unknown").toLowerCase().replace(/[^a-z0-9_]/gu, "").slice(0, 32);
    const detail = String(result.message || result.reason || "").toLowerCase().replace(/[^a-z0-9]+/gu, "_").replace(/^_+|_+$/gu, "").slice(0, 64);
    throw new Error(`zoom_chatbot_send_failed:${response.status}:code_${code}:msg_${detail || "unknown"}`);
  }
  return {
    ok: true,
    messageId: String(result.message_id),
    sentTime: String(result.sent_time || ""),
    toJid
  };
}

export function buildZoomChatbotTextContent(text) {
  const message = String(text || "").trim();
  if (!message || Array.from(message).length > 950) throw new Error("zoom_chatbot_message_length_invalid");
  return { head: { text: message } };
}

export function buildZoomChatbotImageContent({ text, imageUrl, altText = "" } = {}) {
  const message = String(text || "").trim();
  const url = String(imageUrl || "").trim();
  if (!message || Array.from(message).length > 950 || !/^https:\/\//iu.test(url)) {
    throw new Error("zoom_chatbot_image_content_invalid");
  }
  return {
    body: [{
      type: "section",
      layout: "horizontal",
      sections: [
        { type: "message", text: message },
        { type: "image", images: [{ image_url: url, alt_text: String(altText || "").slice(0, 120), image_index: 0 }] }
      ]
    }]
  };
}

export function resetZoomChatbotTokenCacheForTests() {
  cachedToken = null;
}
