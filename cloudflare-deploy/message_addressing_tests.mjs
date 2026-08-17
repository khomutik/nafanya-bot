import test from "node:test";
import assert from "node:assert/strict";
import { classifyMessageAddressing } from "./message_addressing.js";
import { handleConversationMessage } from "./message_handlers.js";

const GROUP = -1001;
const BOT = { id: 777, is_bot: true, first_name: "\u041D\u0430\u0444\u0430\u043D\u044F", username: "nafanya_test_bot" };
const ANNA = { id: 42, first_name: "\u0410\u043D\u043D\u0430", username: "anna" };
const MASHA = { id: 43, first_name: "\u041C\u0430\u0448\u0430", username: "masha" };

function message(text, { replyFrom = null, replyText = "" } = {}) {
  return {
    chat: { id: GROUP, type: "supergroup" },
    from: ANNA,
    message_id: 100,
    text,
    ...(replyFrom ? { reply_to_message: { from: replyFrom, text: replyText, message_id: 99 } } : {})
  };
}

function classify(text, options = {}) {
  const update = message(text, options);
  return classifyMessageAddressing(update, text, {
    chatType: "supergroup",
    botUsername: "nafanya_test_bot"
  });
}

test("A: reply \u0431\u043E\u0442\u0443 \u043D\u0435 \u043F\u0435\u0440\u0435\u0432\u0435\u0448\u0438\u0432\u0430\u0435\u0442 \u044F\u0432\u043D\u043E\u0433\u043E \u0430\u0434\u0440\u0435\u0441\u0430\u0442\u0430 \u041C\u0430\u043D\u044E", () => {
  const result = classify("\u041C\u0430\u043D\u044F, \u044F \u0440\u0430\u0434\u0430, \u0447\u0442\u043E \u0443 \u0442\u0435\u0431\u044F \u0432\u0441\u0451 \u0445\u043E\u0440\u043E\u0448\u043E. \u041D\u0430\u0444\u0430\u043D\u044F \u0447\u0451\u0442 \u043F\u043E\u043F\u0443\u0442\u0430\u043B?", { replyFrom: BOT });
  assert.equal(result.author, "\u0410\u043D\u043D\u0430");
  assert.equal(result.reply_target_author, "\u041D\u0430\u0444\u0430\u043D\u044F");
  assert.equal(result.explicit_addressee, "\u041C\u0430\u0448\u0430");
  assert.equal(result.bot_mentioned, true);
  assert.equal(result.bot_mentioned_as_addressee, false);
  assert.equal(result.bot_mentioned_in_third_person, true);
  assert.equal(result.question_to_bot, false);
  assert.equal(result.should_bot_reply, false);
});

test("B: \u044F\u0432\u043D\u043E\u0435 \u043E\u0431\u0440\u0430\u0449\u0435\u043D\u0438\u0435 \u0432 reply \u0430\u0434\u0440\u0435\u0441\u043E\u0432\u0430\u043D\u043E \u0431\u043E\u0442\u0443", () => {
  const result = classify("\u041D\u0430\u0444\u0430\u043D\u044F, \u0442\u044B \u0447\u0435\u0433\u043E \u0441\u0435\u0433\u043E\u0434\u043D\u044F \u0447\u0443\u0434\u0438\u0448\u044C?", { replyFrom: BOT });
  assert.equal(result.explicit_addressee, "\u041D\u0430\u0444\u0430\u043D\u044F");
  assert.equal(result.bot_mentioned_as_addressee, true);
  assert.equal(result.question_to_bot, true);
  assert.equal(result.should_bot_reply, true);
});

test("C: \u0443\u0447\u0430\u0441\u0442\u043D\u0438\u043A\u0438 \u0433\u043E\u0432\u043E\u0440\u044F\u0442 \u043C\u0435\u0436\u0434\u0443 \u0441\u043E\u0431\u043E\u0439", () => {
  const result = classify("\u041C\u0430\u0448\u0430, \u0441\u043E\u0433\u043B\u0430\u0441\u0435\u043D \u0441 \u0442\u043E\u0431\u043E\u0439", { replyFrom: MASHA });
  assert.equal(result.explicit_addressee, "\u041C\u0430\u0448\u0430");
  assert.equal(result.bot_mentioned, false);
  assert.equal(result.should_bot_reply, false);
});

test("D: \u0443\u043F\u043E\u043C\u0438\u043D\u0430\u043D\u0438\u0435 \u041D\u0430\u0444\u0430\u043D\u0438 \u0432 \u0442\u0440\u0435\u0442\u044C\u0435\u043C \u043B\u0438\u0446\u0435 \u043D\u0435 \u0442\u0440\u0435\u0431\u0443\u0435\u0442 \u043E\u0442\u0432\u0435\u0442\u0430", () => {
  const result = classify("\u041D\u0430\u0444\u0430\u043D\u044F \u043E\u043F\u044F\u0442\u044C \u0447\u0442\u043E-\u0442\u043E \u043D\u0430\u043F\u0443\u0442\u0430\u043B \uD83D\uDE02");
  assert.equal(result.bot_mentioned_in_third_person, true);
  assert.equal(result.bot_mentioned_as_addressee, false);
  assert.equal(result.should_bot_reply, false);
});

test("E: \u0444\u0430\u043A\u0442\u0438\u0447\u0435\u0441\u043A\u0438\u0439 \u0432\u043E\u043F\u0440\u043E\u0441 \u044F\u0432\u043D\u043E \u0430\u0434\u0440\u0435\u0441\u043E\u0432\u0430\u043D \u0431\u043E\u0442\u0443", () => {
  const result = classify("\u041D\u0430\u0444\u0430\u043D\u044F, \u043A\u0442\u043E \u0441\u0435\u0433\u043E\u0434\u043D\u044F \u0442\u0435\u0445\u0432\u0435\u0434?");
  assert.equal(result.question_to_bot, true);
  assert.equal(result.should_bot_reply, true);
});

test("F: \u0434\u0440\u0443\u0436\u0435\u0441\u043A\u0430\u044F \u0448\u0443\u0442\u043A\u0430 \u044F\u0432\u043D\u043E \u0430\u0434\u0440\u0435\u0441\u043E\u0432\u0430\u043D\u0430 \u0431\u043E\u0442\u0443", () => {
  const result = classify("\u041D\u0430\u0444\u0430\u043D\u044F, \u0442\u044B \u0445\u043E\u0440\u043E\u0448\u043E \u043F\u043E\u0441\u043F\u0430\u043B \u0441\u0435\u0433\u043E\u0434\u043D\u044F? \uD83D\uDE02\uD83D\uDE02\uD83D\uDE02");
  assert.equal(result.should_bot_reply, true);
});

test("@username \u0431\u043E\u0442\u0430 \u0440\u0430\u0441\u043F\u043E\u0437\u043D\u0430\u0451\u0442\u0441\u044F \u0438\u0437 \u043D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438", () => {
  const result = classify("@nafanya_test_bot, \u0442\u044B \u0442\u0443\u0442?");
  assert.equal(result.bot_mentioned_as_addressee, true);
  assert.equal(result.should_bot_reply, true);
});

test("\u043A\u043E\u0440\u043E\u0442\u043A\u0438\u0439 \u044F\u0432\u043D\u044B\u0439 \u0432\u043E\u043F\u0440\u043E\u0441 \u0432 reply \u0441\u0447\u0438\u0442\u0430\u0435\u0442\u0441\u044F \u043E\u0431\u0440\u0430\u0449\u0435\u043D\u0438\u0435\u043C", () => {
  assert.equal(classify("\u0410 \u043F\u043E\u0447\u0435\u043C\u0443?", { replyFrom: BOT }).should_bot_reply, true);
  assert.equal(classify("\u0410\u0433\u0430, \u0441\u043F\u0430\u0441\u0438\u0431\u043E", { replyFrom: BOT }).should_bot_reply, false);
});

function conversationDeps({ aiAnswer = "\u041F\u043E\u0445\u043E\u0436\u0435, \u0434\u043E\u043C\u043E\u0432\u043E\u0439 \u0441\u0435\u0433\u043E\u0434\u043D\u044F \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u043B\u0441\u044F \u043A\u0440\u0438\u0432\u043E \uD83D\uDE04" } = {}) {
  const calls = { ai: 0, sent: [] };
  return {
    calls,
    deps: {
      callLightTalkState: async () => ({ state: { history: [] } }),
      getLightTalkKey: () => "test",
      isMainMeetingWindow: () => false,
      looksLikeBlockedProgramQuestion: () => false,
      looksLikeGroupQuestion: () => false,
      normalizeLightText: (value) => String(value || "").toLowerCase(),
      answerFixedMeetingQuestion: () => null,
      answerKnowledgeQuestion: async () => null,
      findKnowledgeAnswer: async () => null,
      findKnowledgeAnswerDetailed: async () => ({ answer: null, searchFailed: false }),
      answerLightConversation: async () => {
        calls.ai += 1;
        return aiAnswer;
      },
      copyTechMessageToGroup: async () => {},
      TECH_MESSAGES: {},
      sendMessage: async (_env, chatId, text) => calls.sent.push({ chatId, text }),
      isPrivateChat: (type) => type === "private",
      parseNafanyaQuestion: (value) => {
        const match = String(value || "").match(/^\s*\u043D\u0430\u0444\u0430\u043D\u044F\s*,\s*(.*)$/iu);
        return match ? match[1] : null;
      },
      isChatGroup: () => true,
      callQueueState: async () => ({ state: { isOpen: false } }),
      callAnnouncementState: async () => ({}),
      callTelegram: async () => ({}),
      notifyOwnerTechError: async () => {},
      CHAT_GROUP_ID: GROUP,
      INFO_CHAT_ID: -1002,
      ADMIN_THREAD_ID: 1
    }
  };
}

test("integration: \u0447\u0443\u0436\u043E\u0439 \u0430\u0434\u0440\u0435\u0441\u0430\u0442 \u043E\u0441\u0442\u0430\u043D\u0430\u0432\u043B\u0438\u0432\u0430\u0435\u0442 \u0432\u044B\u0437\u043E\u0432 LLM \u0438 \u043E\u0442\u043F\u0440\u0430\u0432\u043A\u0443", async () => {
  const text = "\u041C\u0430\u043D\u044F, \u044F \u0440\u0430\u0434\u0430. \u041D\u0430\u0444\u0430\u043D\u044F \u0447\u0451\u0442 \u043F\u043E\u043F\u0443\u0442\u0430\u043B?";
  const update = message(text, { replyFrom: BOT });
  const { calls, deps } = conversationDeps();
  deps.answerFixedMeetingQuestion = () => ({ answer: "\u0441\u043B\u0443\u0436\u0435\u0431\u043D\u044B\u0439 \u043E\u0442\u0432\u0435\u0442" });
  const result = await handleConversationMessage({ BOT_USERNAME: "nafanya_test_bot" }, update, text, GROUP, null, "supergroup", deps);
  assert.equal(result, null);
  assert.equal(calls.ai, 0);
  assert.equal(calls.sent.length, 0);
});

test("integration: \u044F\u0432\u043D\u043E\u0435 \u043E\u0431\u0440\u0430\u0449\u0435\u043D\u0438\u0435 \u0434\u043E\u0445\u043E\u0434\u0438\u0442 \u0434\u043E LLM \u0438 \u043E\u0442\u043F\u0440\u0430\u0432\u043A\u0438", async () => {
  const text = "\u041D\u0430\u0444\u0430\u043D\u044F, \u0442\u044B \u0447\u0435\u0433\u043E \u0441\u0435\u0433\u043E\u0434\u043D\u044F \u0447\u0443\u0434\u0438\u0448\u044C?";
  const update = message(text, { replyFrom: BOT });
  const { calls, deps } = conversationDeps();
  const result = await handleConversationMessage({ BOT_USERNAME: "nafanya_test_bot" }, update, text, GROUP, null, "supergroup", deps);
  assert.equal(result.status, 200);
  assert.equal(calls.ai, 1);
  assert.equal(calls.sent.length, 1);
});
