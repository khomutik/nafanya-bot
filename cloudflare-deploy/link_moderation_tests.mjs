import test from "node:test";
import assert from "node:assert/strict";
import { handleLinkModeration, hasMessageUrl } from "./link_moderation.js";

const GROUP_ID = -1003547823625;

function fixture({ enabled = true, memberStatus = "member", botCanDelete = true, memberError = null } = {}) {
  const calls = [];
  const state = { enabled };
  const deps = {
    CHAT_GROUP_ID: GROUP_ID,
    BOT_USERNAME: "nafanya_bot",
    callAnnouncementState: async (_env, action, payload) => {
      calls.push(["state", action, payload]);
      if (action === "get") return { messageId: state.enabled === true };
      if (action === "set_message_id") {
        state.enabled = payload.messageId === true;
        return { ok: true };
      }
      throw new Error(`unexpected state action: ${action}`);
    },
    callTelegram: async (_env, method, payload) => {
      calls.push(["telegram", method, payload]);
      if (memberError) throw memberError;
      if (method === "getMe") return { result: { id: 9001 } };
      if (payload.user_id === 9001) {
        return { result: { status: botCanDelete ? "administrator" : "member", can_delete_messages: botCanDelete } };
      }
      return { result: { status: memberStatus, is_member: memberStatus === "restricted" } };
    },
    sendMessage: async (_env, chatId, text, _threadId, replyToMessageId) => {
      calls.push(["send", chatId, text, replyToMessageId]);
      return { ok: true };
    },
    deleteMessageSafe: async (_env, chatId, messageId) => {
      calls.push(["delete", chatId, messageId]);
      return true;
    }
  };
  const env = { OWNER_USER_ID: "77" };
  return { calls, state, deps, env };
}

function linkMessage(overrides = {}) {
  return {
    chat: { id: GROUP_ID, type: "supergroup" },
    message_id: 42,
    from: { id: 100, is_bot: false },
    text: "Look here",
    entities: [{ type: "text_link", offset: 0, length: 4, url: "https://example.org" }],
    ...overrides
  };
}

test("detects visible and hidden links in text and media captions", () => {
  assert.equal(hasMessageUrl({ text: "https://example.org", entities: [{ type: "url" }] }), true);
  assert.equal(hasMessageUrl({ text: "click", entities: [{ type: "text_link", url: "https://example.org" }] }), true);
  assert.equal(hasMessageUrl({ caption: "photo", caption_entities: [{ type: "text_link", url: "https://example.org" }] }), true);
  assert.equal(hasMessageUrl({ text: "visit www.example.org" }), true);
  assert.equal(hasMessageUrl({ text: "just ordinary words", entities: [] }), false);
});

test("deletes an ordinary member's linked message when enabled", async () => {
  const f = fixture();
  const result = await handleLinkModeration(f.env, linkMessage(), f.deps);
  assert.equal(result.status, 200);
  assert.deepEqual(f.calls.filter(([kind]) => kind === "send"), [["send", GROUP_ID, "https://t.me/c/3835668674/440/6155", 42]]);
  assert.deepEqual(f.calls.filter(([kind]) => kind === "delete"), [["delete", GROUP_ID, 42]]);
  assert.ok(f.calls.findIndex(([kind]) => kind === "send") < f.calls.findIndex(([kind]) => kind === "delete"));
});

test("keeps the linked message if its reference reply cannot be sent", async () => {
  const f = fixture();
  f.deps.sendMessage = async () => { throw new Error("Telegram send failed"); };
  const originalError = console.error;
  console.error = () => {};
  try {
    await handleLinkModeration(f.env, linkMessage(), f.deps);
  } finally {
    console.error = originalError;
  }
  assert.equal(f.calls.some(([kind]) => kind === "delete"), false);
});

test("does not delete administrator or owner messages", async (t) => {
  for (const memberStatus of ["administrator", "creator"]) {
    await t.test(memberStatus, async () => {
      const f = fixture({ memberStatus });
      await handleLinkModeration(f.env, linkMessage(), f.deps);
      assert.equal(f.calls.some(([kind]) => kind === "delete"), false);
    });
  }
  const owner = fixture();
  await handleLinkModeration(owner.env, linkMessage({ from: { id: 77, is_bot: false } }), owner.deps);
  assert.equal(owner.calls.some(([kind]) => kind === "delete"), false);
});

test("does not delete anonymous admin messages", async () => {
  const f = fixture();
  await handleLinkModeration(f.env, linkMessage({ from: { id: 100, is_bot: false }, sender_chat: { id: GROUP_ID, type: "supergroup" } }), f.deps);
  assert.equal(f.calls.some(([kind]) => kind === "delete"), false);
});

test("fails closed when sender role cannot be verified and records an error", async () => {
  const f = fixture({ memberError: new Error("lookup unavailable") });
  const originalError = console.error;
  const logs = [];
  console.error = (...args) => logs.push(args);
  try {
    await handleLinkModeration(f.env, linkMessage(), f.deps);
  } finally {
    console.error = originalError;
  }
  assert.equal(f.calls.some(([kind]) => kind === "delete"), false);
  assert.equal(logs[0]?.[0], "link_moderation_error");
});

test("fails closed when Telegram returns an unknown sender status", async () => {
  const f = fixture({ memberStatus: "missing" });
  const originalError = console.error;
  console.error = () => {};
  try {
    await handleLinkModeration(f.env, linkMessage(), f.deps);
  } finally {
    console.error = originalError;
  }
  assert.equal(f.calls.some(([kind]) => kind === "delete"), false);
});

test("does not delete links while the mode is off", async () => {
  const f = fixture({ enabled: false });
  await handleLinkModeration(f.env, linkMessage(), f.deps);
  assert.equal(f.calls.some(([kind]) => kind === "delete"), false);
});

test("enables only after confirming the bot has delete-message rights", async () => {
  const f = fixture({ enabled: false });
  const command = { chat: { id: GROUP_ID }, message_id: 9, from: { id: 77 }, text: "/linkmod@nafanya_bot on" };
  await handleLinkModeration(f.env, command, f.deps);
  assert.equal(f.state.enabled, true);
  assert.ok(f.calls.some(([, method]) => method === "getMe"));
  assert.ok(f.calls.some(([kind, method, payload]) => kind === "telegram" && method === "getChatMember" && payload.user_id === 9001));
});

test("keeps the mode off when bot deletion permission is missing", async () => {
  const f = fixture({ enabled: false, botCanDelete: false });
  const command = { chat: { id: GROUP_ID }, message_id: 9, from: { id: 77 }, text: "/linkmod on" };
  await handleLinkModeration(f.env, command, f.deps);
  assert.equal(f.state.enabled, false);
  assert.equal(f.calls.some(([kind, action]) => kind === "state" && action === "set_message_id"), false);
});

test("only admins can switch the mode and admins can turn it off", async () => {
  const denied = fixture({ enabled: false, memberStatus: "member" });
  await handleLinkModeration(denied.env, { chat: { id: GROUP_ID }, message_id: 10, from: { id: 101 }, text: "/linkmod on" }, denied.deps);
  assert.equal(denied.state.enabled, false);
  assert.equal(denied.calls.some(([kind, action]) => kind === "state" && action === "set_message_id"), false);

  const admin = fixture({ enabled: true, memberStatus: "administrator" });
  await handleLinkModeration(admin.env, { chat: { id: GROUP_ID }, message_id: 11, from: { id: 102 }, text: "/linkmod off" }, admin.deps);
  assert.equal(admin.state.enabled, false);
});

test("limits the command to the configured group", async () => {
  const f = fixture();
  const result = await handleLinkModeration(f.env, linkMessage({ chat: { id: -1001 } }), f.deps);
  assert.equal(result, null);
  assert.equal(f.calls.length, 0);
});
