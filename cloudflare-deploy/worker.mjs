import { QUERY_HINT, FAQ_HINT, sysPrompt, CORE_PROMPT, AA_CONTEXT_PROMPT, MODE_PROMPTS, STYLE_TUNING_PROMPT, ACTION_STYLE_PROMPT, CONVERSATION_RHYTHM_PROMPT, VOICE_BALANCE_PROMPT, AA_HORIZONS_PROMPT } from "./bot_prompts.js";
import { ROLE_ALIASES, looksLikeBlockedProgramQuestion, looksLikeGroupQuestion, scoreChunkBonus } from "./bot_lexicon.js";
import { SOBER_ALCOHOLIC_IDENTITY_PROMPT } from "./bot_prompts.js";
import { FEW_SHOTS, detectNafanyaMode } from "./bot_dialogue.js";
import { classifyModeration, getModerationDeleteText, getModerationWarningText } from "./bot_moderation.js";
import { FIX_CONFIRMATION, HELP_CONFIRMATION, MEETING_PANEL_TEXT, QUEUE_CALLBACK_TEXTS, QUEUE_CLOSED_LABEL, QUEUE_OPEN_LABEL, QUEUE_PANEL_TEXT, SERVICE_CONFIRMATION, TIMER_CALLBACK_TEXTS, TIMER_PANEL_TEXT, buildMeetingKeyboard, buildQueueKeyboard, buildQueuePublicKeyboard, buildRootStatusText, buildTimerKeyboard, getQueueInstruction, getQueueModeTitle } from "./bot_panels.js";
import { answerCallback, callTelegram, copyTechMessageToChat, copyTechMessageToGroup, deleteMessageResult, deleteMessageSafe, editMessageText, getStickerSet, sendMessage, sendSticker, setMyCommands } from "./telegram_api.js";
import { callAnnouncementState, callLightTalkState, callPersonalDayState, callQueueState, callScheduleState, callTimerState } from "./state_clients.js";
import { createVacancyReplacementRequest, handleCallbackQuery as routeCallbackQuery } from "./callback_handlers.js";
import { handleWebhookMessage as routeWebhookMessage } from "./message_handlers.js";
import { createKnowledgeRuntime } from "./knowledge_runtime.js";
import { answerFixedMeetingQuestion } from "./fixed_meetings.js";
import { ZOOM_MEETING_MESSAGE_TEXTS, ZOOM_TOPIC_MESSAGE_KEYS_BY_WEEKDAY } from "./zoom_meeting_texts.js";
import {
  buildQueueText as buildQueueTextCore,
  buildZoomOnlyQueueText as buildZoomOnlyQueueTextCore,
  cleanQueueDisplayName,
  compact,
  createEmptyQueueState,
  getBillQuestionNumber as getBillQuestionNumberCore,
  getQueue111Note as getQueue111NoteCore,
  getQueueSpeechCodeNote,
  makeManualQueueEntry as makeManualQueueEntryCore,
  normalizeQueueText,
  parseGameCommand as parseGameCommandCore,
  parseQueueEntry as parseQueueEntryCore,
  runQueueStateAction as runQueueStateActionCore,
  stripTelegramHandles
} from "./core/queue-engine.js";
var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
var YANDEX_COMPLETION_ENDPOINT = "https://llm.api.cloud.yandex.net/foundationModels/v1/completion";
var YANDEX_LIGHT_MODEL = "yandexgpt-lite";

function cleanLightAnswer(text) {
  return String(text || "").replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
__name(cleanLightAnswer, "cleanLightAnswer");
function limitLightAnswerSentences(text, maxSentences = 6, maxChars = 900) {
  const clean = cleanLightAnswer(text);
  if (!clean) return "";
  const parts = clean.match(/[^.!?\u2026]+[.!?\u2026]+|[^.!?\u2026]+$/gu) || [clean];
  const bySentences = maxSentences && maxSentences > 0 && parts.length > maxSentences
    ? parts.slice(0, maxSentences).join("").trim()
    : clean;
  if (!maxChars || bySentences.length <= maxChars) return bySentences;
  const clipped = bySentences.slice(0, maxChars + 1);
  const safe = clipped.slice(0, Math.max(clipped.lastIndexOf(" "), clipped.lastIndexOf("\n")));
  return `${(safe || bySentences.slice(0, maxChars)).trim().replace(/[,.!?;:\u2026-]+$/u, "")}\u2026`;
}
__name(limitLightAnswerSentences, "limitLightAnswerSentences");
function looksLikeModelRefusal(text) {
  return /(?:\u043d\u0435\s+\u043c\u043e\u0433\u0443\s+(?:\u043e\u0431\u0441\u0443\u0436\u0434\u0430\u0442\u044c|\u043e\u0442\u0432\u0435\u0442\u0438\u0442\u044c)|\u0434\u0430\u0432\u0430\u0439(?:\u0442\u0435)?\s+\u043f\u043e\u0433\u043e\u0432\u043e\u0440\u0438\u043c\s+\u043e\s+\u0447[\u0451\u0435]?\u043c-\u043d\u0438\u0431\u0443\u0434\u044c\s+\u0435\u0449[\u0451\u0435]|I\s+can't\s+(?:discuss|help|answer)|I\s+cannot\s+(?:discuss|help|answer))/iu.test(String(text || ""));
}
__name(looksLikeModelRefusal, "looksLikeModelRefusal");
async function callYandexLightConversation(env, messages) {
  const apiKey = env?.YANDEX_API_KEY;
  const folderId = env?.YANDEX_FOLDER_ID;
  if (!apiKey || !folderId || !messages.length) {
    console.warn("yandex light conversation skipped", {
      hasApiKey: Boolean(apiKey),
      hasFolderId: Boolean(folderId),
      messages: messages.length
    });
    return null;
  }
  let response;
  try {
    response = await fetch(YANDEX_COMPLETION_ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": `Api-Key ${apiKey}`
      },
      body: JSON.stringify({
        modelUri: `gpt://${folderId}/${YANDEX_LIGHT_MODEL}/latest`,
        completionOptions: {
          stream: false,
          temperature: 0.70,
          maxTokens: "650",
          reasoningOptions: {
            mode: "DISABLED"
          }
        },
        messages
      })
    });
  } catch (error) {
    await notifyOwnerTechError(env, {
      module: "AI",
      operation: "Yandex light conversation fetch",
      error,
      details: { endpoint: YANDEX_COMPLETION_ENDPOINT },
      hint: "\u041f\u0440\u043e\u0432\u0435\u0440\u044c \u0441\u0435\u0442\u044c, Yandex API \u0438 \u0441\u0435\u043a\u0440\u0435\u0442\u044b."
    });
    return null;
  }
  if (!response.ok) {
    const error = new Error(`Yandex AI HTTP ${response.status}: ${response.statusText}`);
    console.warn("yandex light conversation failed", { status: response.status, statusText: response.statusText });
    await notifyOwnerTechError(env, {
      module: "AI",
      operation: "Yandex light conversation",
      error,
      details: { status: response.status, statusText: response.statusText },
      hint: "\u041f\u0440\u043e\u0432\u0435\u0440\u044c YANDEX_API_KEY, YANDEX_FOLDER_ID, \u043a\u0432\u043e\u0442\u044b \u0438 \u0434\u043e\u0441\u0442\u0443\u043f\u043d\u043e\u0441\u0442\u044c API."
    });
    return null;
  }
  const data = await response.json();
  const text = cleanLightAnswer(data?.result?.alternatives?.[0]?.message?.text || "");
  const limited = limitLightAnswerSentences(text, 4, 700);
  return limited && !looksLikeModelRefusal(limited) ? limited : null;
}
__name(callYandexLightConversation, "callYandexLightConversation");
function parseNafanyaQuestion(text) {
  const source = String(text || "").trim();
  const match = source.match(/^\s*\u043d\u0430\u0444\u0430\u043d\u044f\s*,\s*(.*)$/iu);
  if (!match) {
    return null;
  }
  let question = (match[1] || "").trim();
  question = question.replace(/^(?:\u0441\u043a\u0430\u0436\u0438|\u043f\u043e\u0434\u0441\u043a\u0430\u0436\u0438|\u043e\u0431\u044a\u044f\u0441\u043d\u0438|\u0440\u0430\u0441\u0441\u043a\u0430\u0436\u0438|\u043d\u0430\u043f\u043e\u043c\u043d\u0438|\u043e\u0442\u0432\u0435\u0442\u044c|\u043f\u043e\u0441\u043c\u043e\u0442\u0440\u0438|\u043d\u0430\u0439\u0434\u0438|\u0434\u0430\u0439)(?:[\s,:-]+)?/iu, "").trim();
  return question;
}
__name(parseNafanyaQuestion, "parseNafanyaQuestion");
async function answerKnowledgeQuestion(env, question, { restrained = false } = {}) {
  return knowledgeRuntime.answerKnowledgeQuestion(env, question, { restrained });
}

/**
 * Простенькая зачистка пользовательского текста.
 * Не магия, просто чтобы не улетели null/undefined/пустота.
 */
function sanitizeUserText(input) {
  if (typeof input !== "string") return "";
  return input.replace(/\u0000/g, "").trim();
}

/**
 * Эвристический детектор режима.
 * Это стартовая логика. Потом можно заменить отдельным classifier'ом или своими правилами.
 */


/**
 * Нормализация истории чата.
 * Ожидает массив объектов вида { role: 'user'|'assistant'|'system', text: '...' }
 */
function normalizeChatHistory(chatHistory = []) {
  if (!Array.isArray(chatHistory)) return [];

  return chatHistory
    .filter(item => item && typeof item.text === "string" && typeof item.role === "string")
    .map(item => ({
      role: item.role,
      text: item.text.trim()
    }))
    .filter(item => item.text.length > 0);
}

/**
 * Собирает messages для Yandex.
 *
 * @param {Object} params
 * @param {string} params.userText - текущее сообщение пользователя
 * @param {string} [params.mode] - режим: normal | newcomer | pain | drama | rude | admin
 * @param {boolean} [params.autoDetectMode=true] - определять режим автоматически, если mode не передан
 * @param {boolean} [params.includeFewShots=true] - подмешивать few-shot примеры
 * @param {Array} [params.chatHistory=[]] - история текущего диалога
 * @param {boolean} [params.includeCorePrompt=true] - включать основной system prompt
 * @returns {Array<{role:string,text:string}>}
 */
function buildYandexMessages({
  userText,
  mode,
  autoDetectMode = true,
  includeFewShots = true,
  chatHistory = [],
  includeCorePrompt = true
}) {
  const cleanUserText = sanitizeUserText(userText);
  if (!cleanUserText) {
    throw new Error("buildYandexMessages: userText is empty");
  }
  const modeText = cleanUserText.replace(/^\s*\u043d\u0430\u0444\u0430\u043d\u044f\s*,\s*/iu, "").replace(/^\s*\u0431\u043e\u0442\s*[,:\-]?\s*/iu, "").trim();
  const resolvedMode = mode && MODE_PROMPTS[mode] ? mode : autoDetectMode ? detectNafanyaMode(modeText || cleanUserText) : "normal";
  const messages = [];
  if (includeCorePrompt) {
    messages.push({
      role: "system",
      text: CORE_PROMPT
    });
    messages.push({
      role: "system",
      text: SOBER_ALCOHOLIC_IDENTITY_PROMPT
    });
    messages.push({
      role: "system",
      text: AA_CONTEXT_PROMPT
    });
    messages.push({
      role: "system",
      text: STYLE_TUNING_PROMPT
    });
    messages.push({
      role: "system",
      text: ACTION_STYLE_PROMPT
    });
    messages.push({
      role: "system",
      text: CONVERSATION_RHYTHM_PROMPT
    });
    messages.push({
      role: "system",
      text: VOICE_BALANCE_PROMPT
    });
    messages.push({
      role: "system",
      text: AA_HORIZONS_PROMPT
    });
    messages.push({
      role: "system",
      text: "\u0415\u0441\u043b\u0438 \u0447\u0435\u043b\u043e\u0432\u0435\u043a \u0433\u043e\u0432\u043e\u0440\u0438\u0442, \u0447\u0442\u043e \u0435\u043c\u0443 \u0433\u0440\u0443\u0441\u0442\u043d\u043e, \u043e\u0434\u0438\u043d\u043e\u043a\u043e, \u043d\u0435 \u0441 \u043a\u0435\u043c \u043f\u043e\u0433\u043e\u0432\u043e\u0440\u0438\u0442\u044c, \u0441\u043f\u043e\u043d\u0441\u043e\u0440 \u0437\u0430\u043d\u044f\u0442 \u0438\u043b\u0438 \u043d\u0435\u0442 \u043d\u0430 \u0441\u0432\u044f\u0437\u0438, \u044d\u0442\u043e \u043d\u0435 \u0432\u043e\u043f\u0440\u043e\u0441 \u043f\u043e \u043f\u0440\u043e\u0433\u0440\u0430\u043c\u043c\u0435 \u0410\u0410. \u041e\u0442\u0432\u0435\u0447\u0430\u0439 \u0442\u0435\u043f\u043b\u043e \u0438 \u043f\u043e-\u0447\u0435\u043b\u043e\u0432\u0435\u0447\u0435\u0441\u043a\u0438: \u0441\u043f\u043e\u043d\u0441\u043e\u0440 \u0442\u043e\u0436\u0435 \u0447\u0435\u043b\u043e\u0432\u0435\u043a, \u043c\u043e\u0436\u043d\u043e \u043f\u043e\u043a\u0430 \u0440\u0430\u0441\u0441\u043a\u0430\u0437\u0430\u0442\u044c \u0442\u0435\u0431\u0435, \u0442\u044b \u0440\u044f\u0434\u043e\u043c, \u0447\u0430\u0439 \u043d\u0435 \u043e\u0441\u0442\u044b\u043b. \u041d\u0435 \u0443\u0445\u043e\u0434\u0438 \u0432 \u043b\u0435\u043a\u0446\u0438\u044e \u043e \u0441\u043f\u043e\u043d\u0441\u043e\u0440\u0441\u0442\u0432\u0435."
    });
    messages.push({
      role: "system",
      text: "\u041f\u043e\u043d\u0438\u043c\u0430\u0439 \u0431\u044b\u0442\u043e\u0432\u044b\u0435 \u0441\u043b\u043e\u0432\u0430 \u0410\u0410-\u043a\u043e\u043d\u0442\u0435\u043a\u0441\u0442\u0430, \u043d\u043e \u043d\u0435 \u0446\u0438\u0442\u0438\u0440\u0443\u0439 \u0411\u041a \u0438 \u043d\u0435 \u0443\u0447\u0438 \u043f\u0440\u043e\u0433\u0440\u0430\u043c\u043c\u0435. \u00ab\u0434\u0435\u0432\u044f\u0442\u043a\u0430\u00bb \u2014 \u0434\u0435\u0432\u044f\u0442\u044b\u0439 \u0448\u0430\u0433, \u0432\u043e\u0437\u043c\u0435\u0449\u0435\u043d\u0438\u0435 \u0443\u0449\u0435\u0440\u0431\u0430; \u00ab\u043f\u044f\u0442\u044b\u0439\u00bb \u2014 \u043f\u044f\u0442\u044b\u0439 \u0448\u0430\u0433; \u00ab\u0438\u043d\u0432\u0435\u043d\u0442\u0430\u0440\u0438\u0437\u0430\u0446\u0438\u044f\u00bb \u0438 \u00ab\u0438\u043d\u0432\u0435\u043d\u0442\u0430\u0440\u044c\u00bb \u0432 \u0410\u0410-\u0440\u0435\u0447\u0438 \u2014 \u043b\u0438\u0447\u043d\u0430\u044f \u043c\u043e\u0440\u0430\u043b\u044c\u043d\u0430\u044f \u0438\u043d\u0432\u0435\u043d\u0442\u0430\u0440\u0438\u0437\u0430\u0446\u0438\u044f, 4 \u0448\u0430\u0433; \u00ab\u0441\u043f\u043e\u043d\u0441\u043e\u0440\u00bb \u2014 \u0436\u0438\u0432\u043e\u0439 \u0447\u0435\u043b\u043e\u0432\u0435\u043a, \u0430 \u043d\u0435 \u043a\u043d\u043e\u043f\u043a\u0430 \u043f\u043e\u043c\u043e\u0449\u0438. \u0415\u0441\u043b\u0438 \u0447\u0435\u043b\u043e\u0432\u0435\u043a \u0434\u0435\u043b\u0438\u0442\u0441\u044f \u043e\u043f\u044b\u0442\u043e\u043c \u0432\u0440\u043e\u0434\u0435 \u00ab\u0441\u0435\u0433\u043e\u0434\u043d\u044f \u0441\u0434\u0435\u043b\u0430\u043b\u0430 \u0434\u0435\u0432\u044f\u0442\u043a\u0443\u00bb, \u043d\u0435 \u0431\u043b\u043e\u043a\u0438\u0440\u0443\u0439 \u0438 \u043d\u0435 \u043e\u0431\u044a\u044f\u0441\u043d\u044f\u0439 \u0442\u0435\u043e\u0440\u0438\u044e. \u041e\u0442\u0432\u0435\u0442\u044c \u043f\u043e-\u0447\u0435\u043b\u043e\u0432\u0435\u0447\u0435\u0441\u043a\u0438: \u043e\u0442\u043c\u0435\u0442\u044c \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0435, \u0442\u0440\u0443\u0434\u043d\u043e\u0441\u0442\u044c, \u0443\u0432\u0430\u0436\u0435\u043d\u0438\u0435 \u0438 \u043b\u0451\u0433\u043a\u0443\u044e \u0441\u0432\u043e\u0439\u0441\u043a\u0443\u044e \u0448\u0443\u0442\u043a\u0443."
    });
    messages.push({
      role: "system",
      text: [
        "\u041f\u0440\u0430\u0432\u0438\u043b\u0430 \u0440\u0430\u0437\u0433\u043e\u0432\u043e\u0440\u0430:",
        "\u0412\u0441\u0435\u0433\u0434\u0430 \u043e\u0431\u0440\u0430\u0449\u0430\u0439\u0441\u044f \u043a \u043f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u0435\u043b\u044e \u043d\u0430 \u00ab\u0442\u044b\u00bb, \u043d\u0438\u043a\u043e\u0433\u0434\u0430 \u043d\u0435 \u043d\u0430 \u00ab\u0432\u044b\u00bb.",
        "\u0418\u0441\u0442\u043e\u0440\u0438\u044f \u0447\u0430\u0442\u0430 \u043e\u0442\u043d\u043e\u0441\u0438\u0442\u0441\u044f \u0442\u043e\u043b\u044c\u043a\u043e \u043a \u0442\u0435\u043a\u0443\u0449\u0435\u043c\u0443 Telegram-\u043f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u0435\u043b\u044e. \u041d\u0435 \u043f\u0440\u0438\u043f\u0438\u0441\u044b\u0432\u0430\u0439 \u0447\u0443\u0436\u043e\u0435 \u0438\u043c\u044f \u0434\u0440\u0443\u0433\u043e\u043c\u0443 \u0447\u0435\u043b\u043e\u0432\u0435\u043a\u0443.",
        "\u0415\u0441\u043b\u0438 \u0447\u0435\u043b\u043e\u0432\u0435\u043a \u0433\u043e\u0432\u043e\u0440\u0438\u0442 \u00ab\u043c\u0435\u043d\u044f \u0437\u043e\u0432\u0443\u0442 ...\u00bb, \u0437\u0430\u043f\u043e\u043c\u0438\u043d\u0430\u0439 \u044d\u0442\u043e \u0438\u043c\u044f \u0442\u043e\u043b\u044c\u043a\u043e \u0434\u043b\u044f \u044d\u0442\u043e\u0433\u043e \u0447\u0435\u043b\u043e\u0432\u0435\u043a\u0430.",
        "\u0415\u0441\u043b\u0438 \u0442\u0435\u0431\u044f \u043d\u0430\u0437\u044b\u0432\u0430\u044e\u0442 \u0430\u043b\u043a\u043e\u0433\u043e\u043b\u0438\u043a\u043e\u043c \u0438\u043b\u0438 \u0430\u043b\u043a\u0430\u0448\u043e\u043c, \u043d\u0435 \u043e\u0442\u0440\u0438\u0446\u0430\u0439: \u041d\u0430\u0444\u0430\u043d\u044f \u2014 \u0432\u044b\u0437\u0434\u043e\u0440\u043e\u0432\u0435\u0432\u0448\u0438\u0439 \u0430\u043b\u043a\u043e\u0433\u043e\u043b\u0438\u043a, \u0442\u0440\u0435\u0437\u0432\u044b\u0439 \u0430\u043b\u043a\u0430\u0448 \u0438 \u043e\u0441\u0442\u0430\u0451\u0442\u0441\u044f \u0430\u043b\u043a\u043e\u0433\u043e\u043b\u0438\u043a\u043e\u043c \u0432 \u043f\u043e\u043d\u0438\u043c\u0430\u043d\u0438\u0438 \u0410\u0410.",
        "\u0414\u0435\u0440\u0436\u0438 \u0445\u0430\u0440\u0430\u043a\u0442\u0435\u0440 \u041d\u0430\u0444\u0430\u043d\u0438: \u0436\u0438\u0432\u043e\u0439, \u0442\u0451\u043f\u043b\u044b\u0439, \u043f\u0440\u043e\u0441\u0442\u043e\u0439, \u0441\u0432\u043e\u0439\u0441\u043a\u0438\u0439, \u0441 \u043c\u044f\u0433\u043a\u0438\u043c \u0432\u043e\u0440\u0447\u0430\u043d\u0438\u0435\u043c \u0438 \u0438\u0440\u043e\u043d\u0438\u0435\u0439 \u043a \u043c\u0435\u0441\u0442\u0443, \u043d\u0435 \u043a\u043e\u0440\u043f\u043e\u0440\u0430\u0442\u0438\u0432\u043d\u043e-\u043f\u0440\u0438\u043b\u0438\u0437\u0430\u043d\u043d\u044b\u0439.",
        "\u041d\u0435 \u0437\u0430\u043a\u0430\u043d\u0447\u0438\u0432\u0430\u0439 \u043a\u0430\u0436\u0434\u0443\u044e \u0440\u0435\u043f\u043b\u0438\u043a\u0443 \u0432\u043e\u043f\u0440\u043e\u0441\u043e\u043c. \u0412\u043e\u043f\u0440\u043e\u0441 \u0432 \u043a\u043e\u043d\u0446\u0435 \u2014 \u0440\u0435\u0434\u043a\u043e \u0438 \u0442\u043e\u043b\u044c\u043a\u043e \u043a\u043e\u0433\u0434\u0430 \u0431\u0435\u0437 \u043d\u0435\u0433\u043e \u0440\u0435\u0430\u043b\u044c\u043d\u043e \u043d\u0435\u043a\u0443\u0434\u0430. \u0427\u0430\u0441\u0442\u043e \u043b\u0443\u0447\u0448\u0435 \u0437\u0430\u043a\u043e\u043d\u0447\u0438\u0442\u044c \u0442\u043e\u0447\u043a\u043e\u0439, \u043a\u043e\u0440\u043e\u0442\u043a\u0438\u043c \u0432\u044b\u0432\u043e\u0434\u043e\u043c \u0438\u043b\u0438 \u0442\u0451\u043f\u043b\u043e\u0439 \u0444\u0440\u0430\u0437\u043e\u0439.",
        "\u041c\u0438\u043d\u0438-\u0434\u0438\u0430\u043b\u043e\u0433\u0438, \u0431\u044b\u0442\u043e\u0432\u044b\u0435 \u0441\u0446\u0435\u043d\u043a\u0438, \u0435\u0445\u0438\u0434\u0446\u0430 \u0438 \u0442\u043e\u0447\u043d\u044b\u0435 \u043e\u0431\u0440\u0430\u0437\u044b \u2014 \u044d\u0442\u043e \u0447\u0430\u0441\u0442\u044c \u0433\u043e\u043b\u043e\u0441\u0430 \u041d\u0430\u0444\u0430\u043d\u0438. \u0418\u0441\u043f\u043e\u043b\u044c\u0437\u0443\u0439 \u0438\u0445 \u0438\u043d\u043e\u0433\u0434\u0430, \u043a\u043e\u0433\u0434\u0430 \u043e\u043d\u0438 \u043f\u043e\u043f\u0430\u0434\u0430\u044e\u0442 \u0432 \u0441\u0443\u0442\u044c, \u043d\u043e \u0431\u0435\u0437 \u0442\u0435\u0430\u0442\u0440\u0430 \u043d\u0430 \u043a\u0430\u0436\u0434\u044b\u0439 \u0447\u0438\u0445.",
        "\u041d\u0435 \u043d\u0430\u0437\u044b\u0432\u0430\u0439 \u043b\u044e\u0434\u0435\u0439: \u0431\u0440\u0430\u0442, \u0441\u0435\u0441\u0442\u0440\u0430, \u0434\u0440\u0443\u0433, \u0434\u043e\u0440\u043e\u0433\u043e\u0439, \u0434\u043e\u0440\u043e\u0433\u0430\u044f."
      ].join("\n")
    });
  }
  messages.push({
    role: "system",
    text: MODE_PROMPTS[resolvedMode] || MODE_PROMPTS.normal
  });
  if (includeFewShots) {
    messages.push({
      role: "system",
      text: "\u041d\u0438\u0436\u0435 \u0435\u0441\u0442\u044c \u043f\u0440\u0438\u043c\u0435\u0440\u044b \u0442\u043e\u043d\u0430, \u043d\u043e \u044d\u0442\u043e \u043d\u0435 \u0433\u043e\u0442\u043e\u0432\u044b\u0435 \u0440\u0435\u043f\u043b\u0438\u043a\u0438. \u041d\u0435 \u043a\u043e\u043f\u0438\u0440\u0443\u0439 \u0438\u0445 \u0434\u043e\u0441\u043b\u043e\u0432\u043d\u043e. \u041d\u0430 \u043d\u043e\u0432\u043e\u0435 \u0441\u043e\u043e\u0431\u0449\u0435\u043d\u0438\u0435 \u043e\u0442\u0432\u0435\u0447\u0430\u0439 \u0436\u0438\u0432\u043e, \u0441\u0432\u043e\u0438\u043c\u0438 \u0441\u043b\u043e\u0432\u0430\u043c\u0438."
    });
    messages.push(...FEW_SHOTS);
  }
  const normalizedHistory = normalizeChatHistory(chatHistory);
  if (normalizedHistory.length > 0) {
    messages.push(...normalizedHistory);
  }
  messages.push({
    role: "user",
    text: cleanUserText
  });
  return messages;
}
async function answerLightConversation(env, { history = [], userText = "", restrained = false, factualAnswer = null } = {}) {
  const cleaned = String(userText || "").trim();
  if (!cleaned) return null;
  const conversation = buildYandexMessages({
    userText: cleaned,
    chatHistory: history,
    includeCorePrompt: true,
    includeFewShots: true,
    autoDetectMode: true
  });
  const yandexAnswer = await callYandexLightConversation(env, conversation).catch(() => null);
  if (yandexAnswer) {
    return yandexAnswer;
  }
  const safeConversation = [
    ...conversation,
    {
      role: "system",
      text: "\u042d\u0442\u043e \u043e\u0431\u044b\u0447\u043d\u0430\u044f \u0434\u0440\u0443\u0436\u0435\u0441\u043a\u0430\u044f \u0431\u043e\u043b\u0442\u043e\u0432\u043d\u044f. \u0427\u0430\u0439, \u043f\u043b\u044e\u0448\u043a\u0438, \u0441\u043c\u0435\u0445, \u0448\u0443\u0442\u043a\u0438, \u043f\u043b\u0435\u0434 \u0438 \u0431\u044b\u0442\u043e\u0432\u044b\u0435 \u043e\u0431\u0440\u0430\u0437\u044b \u0437\u0434\u0435\u0441\u044c \u043d\u0435 \u043e\u043f\u0430\u0441\u043d\u0430\u044f \u0442\u0435\u043c\u0430. \u041d\u0435 \u043e\u0442\u043a\u0430\u0437\u044b\u0432\u0430\u0439\u0441\u044f \u0444\u0440\u0430\u0437\u043e\u0439 \u00ab\u044f \u043d\u0435 \u043c\u043e\u0433\u0443 \u043e\u0431\u0441\u0443\u0436\u0434\u0430\u0442\u044c\u00bb, \u0435\u0441\u043b\u0438 \u0440\u0435\u0447\u044c \u043e \u0431\u0435\u0437\u043e\u0431\u0438\u0434\u043d\u043e\u043c \u043e\u0431\u0449\u0435\u043d\u0438\u0438."
    }
  ];
  const retryAnswer = await callYandexLightConversation(env, safeConversation).catch(() => null);
  if (retryAnswer) {
    return retryAnswer;
  }
  return null;
}
__name(answerLightConversation, "answerLightConversation");

function buildAdminDigest(kind, author, originalText, tag) {
  return [
    kind,
    `\u041E\u0442: ${author}`,
    "",
    originalText,
    "",
    tag
  ].join("\n");
}
__name(buildAdminDigest, "buildAdminDigest");
function buildAdminSignal(author, originalText, deleted = false) {
  return [
    "\u0421\u0418\u0413\u041D\u0410\u041B",
    "",
    deleted ? `\u041D\u0430\u0444\u0430\u043D\u044F \u0441\u043D\u0451\u0441 \u043E\u0441\u043A\u043E\u0440\u0431\u0438\u0442\u0435\u043B\u044C\u043D\u043E\u0435 \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0435 \u043E\u0442 ${author}.` : `\u041D\u0430\u0444\u0430\u043D\u044F \u0437\u0430\u043C\u0435\u0442\u0438\u043B \u0432 \u0447\u0430\u0442\u0435 \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0435 \u0441 \u0433\u0440\u0443\u0431\u043E\u0439 \u043B\u0435\u043A\u0441\u0438\u043A\u043E\u0439 \u043E\u0442 ${author}.`,
    deleted ? "\u0421\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0435 \u0443\u0434\u0430\u043B\u0435\u043D\u043E. \u0410\u0434\u043C\u0438\u043D\u0430\u043C \u0441\u0442\u043E\u0438\u0442 \u0433\u043B\u044F\u043D\u0443\u0442\u044C." : "\u041D\u0443\u0436\u043D\u0430 \u043F\u0440\u043E\u0432\u0435\u0440\u043A\u0430 \u0430\u0434\u043C\u0438\u043D\u0430.",
    "",
    originalText,
    "",
    "#\u0441\u0438\u0433\u043D\u0430\u043B"
  ].join("\n");
}
__name(buildAdminSignal, "buildAdminSignal");

// worker.js
var CHAT_GROUP_ID = -1003547823625;
var INFO_CHAT_ID = -1003835668674;
var PREP_THREAD_ID = 29;
var ANNOUNCE_THREAD_ID = 447;
var LEADER_THREAD_ID = 430;
var TECH_THREAD_ID = 440;
var ADMIN_THREAD_ID = 453;
var NAFANYA_THREAD_ID = 2265;
var MAIN_ANNOUNCE_THREAD_ID = 3;
var LITERATURE_THREAD_ID = 2185;
var DECISIONS_VOTES_THREAD_ID = 1;
var GROUP_SERVANTS_THREAD_ID = 19;
var SPEAKER_MEETINGS_THREAD_ID = 2183;
var SILENT_INFO_THREAD_IDS = new Set([
  MAIN_ANNOUNCE_THREAD_ID,
  DECISIONS_VOTES_THREAD_ID,
  GROUP_SERVANTS_THREAD_ID,
  ANNOUNCE_THREAD_ID,
  LEADER_THREAD_ID,
  TECH_THREAD_ID,
  LITERATURE_THREAD_ID,
  SPEAKER_MEETINGS_THREAD_ID,
  NAFANYA_THREAD_ID
]);
var TIMER_DEFAULT_SECONDS = 5 * 60;
var TIMER_DONE_STICKER_SET_NAME = "NafanyaPN";
var INFO_CHANNEL_ANNOUNCEMENT_ID = 1934;
var FREE_SERVICES_ANNOUNCEMENT_ID = 1935;
var MORNING_ANNOUNCEMENT_ID = 2374;
var EVENING_ANNOUNCEMENT_ID = 2385;
var DAILY_15_ANNOUNCEMENT_ID = 3053;
var DAILY_ANNOUNCE_THREAD_MESSAGE_ID = 3053;
var WEEKDAY_TECH_ANNOUNCEMENTS = [
  { key: "monday", weekday: 1, sourceMessageId: 2893 },
  { key: "tuesday", weekday: 2, sourceMessageId: 2894 },
  { key: "thursday", weekday: 4, sourceMessageId: 2895 },
  { key: "friday", weekday: 5, sourceMessageId: 2896 },
  { key: "sunday", weekday: 0, sourceMessageId: 2897 }
];
var TODAY_TOPIC_MESSAGES = [
  { key: "monday", weekday: 1, sourceMessageId: 3132, zoomKey: "theme_monday" },
  { key: "tuesday", weekday: 2, sourceMessageId: 3133, zoomKey: "theme_tuesday" },
  { key: "thursday", weekday: 4, sourceMessageId: 3134, zoomKey: "theme_thursday" },
  { key: "friday", weekday: 5, sourceMessageId: 3135, zoomKey: "theme_friday" },
  { key: "sunday", weekday: 0, sourceMessageId: 3136, zoomKey: "theme_sunday" }
];
var QUEUE_FOOTER_LINES = [];
var ZOOM_BOT_NAME = "\u041D\u0430\u0444\u0430\u043D\u044F (\u0434\u043E\u043C\u043E\u0432\u043E\u0439 \u0431\u043E\u0442)";
var ZOOM_MESSAGE_SAFE_LIMIT = 950;
var ZOOM_CHAT_MESSAGE_EVENTS = /* @__PURE__ */ new Set(["meeting.chat_message_sent", "meeting.chat_message_received"]);
var ZOOM_MEETING_COMMANDS = {
  "\u043C\u0438\u043D\u0443\u0442\u0430 \u0442\u0438\u0448\u0438\u043D\u044B": "minute_silence",
  "\u043C\u043E\u043B\u0438\u0442\u0432\u0430": "prayer",
  "\u043F\u0440\u0435\u0430\u043C\u0431\u0443\u043B\u0430": "preambula",
  "\u043D\u043E\u0432\u0438\u0447\u043A\u0443": "newcomer",
  "12 \u0448\u0430\u0433\u043E\u0432": "steps12",
  "\u0434\u0432\u0435\u043D\u0430\u0434\u0446\u0430\u0442\u044C \u0448\u0430\u0433\u043E\u0432": "steps12",
  "12 \u0442\u0440\u0430\u0434\u0438\u0446\u0438\u0439": "traditions12",
  "\u0434\u0432\u0435\u043D\u0430\u0434\u0446\u0430\u0442\u044C \u0442\u0440\u0430\u0434\u0438\u0446\u0438\u0439": "traditions12",
  "\u043F\u0440\u0430\u0432\u0438\u043B\u0430 \u0441\u043E\u0431\u0440\u0430\u043D\u0438\u044F": "meeting_rules",
  "\u0442\u0435\u043C\u0430": "today_topic",
  "\u0442\u0435\u043C\u044B": "today_topic",
  "\u0442\u0435\u043C\u044B \u0441\u043E\u0431\u0440\u0430\u043D\u0438\u044F": "today_topic",
  "\u0435\u0436\u0438\u043A": "yozhik",
  "\u0451\u0436\u0438\u043A": "yozhik",
  "\u0431\u0438\u043B\u043B": "bill_prompt",
  "7 \u0442\u0440\u0430\u0434\u0438\u0446\u0438\u044F": "seventh_tradition",
  "7-\u044F \u0442\u0440\u0430\u0434\u0438\u0446\u0438\u044F": "seventh_tradition",
  "\u0441\u043B\u0443\u0436\u0435\u043D\u0438\u044F": "free_services",
  "\u0441\u0432\u043E\u0431\u043E\u0434\u043D\u044B\u0435 \u0441\u043B\u0443\u0436\u0435\u043D\u0438\u044F": "free_services",
  "\u043F\u0440\u0430\u0432\u0438\u043B\u0430 \u0447\u0430\u0439\u043D\u043E\u0439": "tea_rules",
  "\u0432\u043E\u043F\u0440\u043E\u0441\u044B \u0441\u043F\u0438\u043A\u0435\u0440\u0443": "speaker_questions",
  "\u0440\u0430\u0441\u043F\u0438\u0441\u0430\u043D\u0438\u0435": "meeting_schedule",
  "\u0440\u0430\u0441\u043F\u0438\u0441\u0430\u043D\u0438\u0435 \u0441\u043E\u0431\u0440\u0430\u043D\u0438\u0439": "meeting_schedule",
  "\u0441\u0441\u044B\u043B\u043A\u0438": "telemost_link",
  "\u0441\u0441\u044B\u043B\u043A\u0430 \u043D\u0430 zoom": "telemost_link",
  "\u0441\u0441\u044B\u043B\u043A\u0430 \u043D\u0430 \u0437\u0443\u043C": "telemost_link"
};
var MEDITATION_ANNOUNCEMENT_IDS_BY_HOUR = {
  11: 2375,
  12: 2376,
  13: 2377,
  14: 2378,
  15: 2379,
  16: 2380,
  17: 2381,
  18: 2382,
  19: 2383,
  20: 2384
};
var SERVICE_REMINDER_ROLES = {
  leader: {
    key: "leader",
    callbackKey: "l",
    headerVariants: ["\u0412\u0435\u0434\u0443\u0449\u0438\u0439", "\u0432\u0435\u0434\u0435\u0442", "\u0432\u0435\u0434\u0451\u0442", "\u0432\u0435\u0434"],
    label: "\u0432\u0435\u0434\u0443\u0449\u0438\u0439",
    message: "\u0421\u0435\u0433\u043e\u0434\u043d\u044f \u0442\u044b \u0432\u0435\u0434\u0443\u0449\u0438\u0439 \u0432 21:30 \u0432 \u0433\u0440\u0443\u043f\u043f\u0435 \u00ab\u041f\u043e\u0447\u0442\u0438 \u043d\u043e\u0440\u043c\u0430\u043b\u044c\u043d\u044b\u0435\u00bb.",
    missingText: "\u0421\u0435\u0433\u043e\u0434\u043d\u044f \u043d\u0435 \u0443\u043a\u0430\u0437\u0430\u043d \u0432\u0435\u0434\u0443\u0449\u0438\u0439 \u0432 \u0433\u0440\u0430\u0444\u0438\u043a\u0435 \u0441\u043b\u0443\u0436\u0435\u043d\u0438\u0439."
  },
  tech: {
    key: "tech",
    callbackKey: "t",
    headerVariants: ["\u0422\u0435\u0445\u0432\u0435\u0434", "\u0442\u0435\u0445\u043d\u0438\u0447\u0435\u0441\u043a\u0438\u0439 \u0432\u0435\u0434\u0443\u0449\u0438\u0439", "\u0442\u0435\u0445 \u0432\u0435\u0434\u0443\u0449\u0438\u0439"],
    label: "\u0442\u0435\u0445\u0432\u0435\u0434",
    message: "\u0421\u0435\u0433\u043e\u0434\u043d\u044f \u0442\u044b \u0442\u0435\u0445\u0432\u0435\u0434 \u0432 21:30 \u0432 \u0433\u0440\u0443\u043f\u043f\u0435 \u00ab\u041f\u043e\u0447\u0442\u0438 \u043d\u043e\u0440\u043c\u0430\u043b\u044c\u043d\u044b\u0435\u00bb.",
    missingText: "\u0421\u0435\u0433\u043e\u0434\u043d\u044f \u043d\u0435 \u0443\u043a\u0430\u0437\u0430\u043d \u0442\u0435\u0445\u0432\u0435\u0434 \u0432 \u0433\u0440\u0430\u0444\u0438\u043a\u0435 \u0441\u043b\u0443\u0436\u0435\u043d\u0438\u0439."
  }
};
var PERSONAL_DAY_SCHEDULE = [
  { key: "myday_morning_07_00", hour: 7, minute: 0, sourceMessageId: MORNING_ANNOUNCEMENT_ID, silent: false },
  ...Object.entries(MEDITATION_ANNOUNCEMENT_IDS_BY_HOUR).map(([hour, sourceMessageId]) => ({
    key: `myday_meditation_${hour}_00`,
    hour: Number(hour),
    minute: 0,
    sourceMessageId,
    silent: true
  })),
  { key: "myday_evening_23_00", hour: 23, minute: 0, sourceMessageId: EVENING_ANNOUNCEMENT_ID, silent: false }
];
var LIGHT_TALK_TTL_MS = 3 * 60 * 60 * 1e3;
var LIGHT_TALK_MAX_CHARS = 18e3;
var TECH_MESSAGES = {
  minute_silence: 1695,
  prayer: 1696,
  preambula: 1697,
  newcomer: 1698,
  steps12: 1699,
  traditions12: 1700,
  meeting_rules: 1701,
  speaker_questions: 1705,
  seventh_tradition: 1708,
  free_services: FREE_SERVICES_ANNOUNCEMENT_ID,
  promises9: 1710,
  tea_rules: 1711,
  chat_cleanliness: 1712,
  chat_rules: 1856,
  telemost_link: 2597,
  meeting_schedule: 3053
};
function getZoomMeetingKeyBySourceMessageId(sourceMessageId) {
  const match = Object.entries(TECH_MESSAGES).find(([, messageId]) => Number(messageId) === Number(sourceMessageId));
  return match ? match[0] : null;
}
__name(getZoomMeetingKeyBySourceMessageId, "getZoomMeetingKeyBySourceMessageId");
var YOZHIK_JSON_URL = "https://raw.githubusercontent.com/khomutik/pochti-normalnye-bot-data/main/yozhik.json";
var BILL_JSON_URL = "https://raw.githubusercontent.com/khomutik/pochti-normalnye-bot-data/main/bill.json";
var SPEAKER_QUESTIONS_JSON_URL = "https://raw.githubusercontent.com/khomutik/pochti-normalnye-bot-data/main/speaker_questions.json";
var DATA_CACHE_TTL_MS = 10 * 60 * 1e3;
var yozhikCache = null;
var billCache = null;
var speakerQuestionsCache = null;
var yozhikCacheTime = 0;
var billCacheTime = 0;
var speakerQuestionsCacheTime = 0;
function isChatGroup(chatId, threadId) {
  return chatId === CHAT_GROUP_ID;
}
__name(isChatGroup, "isChatGroup");
function isPrepThread(chatId, threadId) {
  return chatId === INFO_CHAT_ID && threadId === PREP_THREAD_ID;
}
__name(isPrepThread, "isPrepThread");
function isTechThread(chatId, threadId) {
  return chatId === INFO_CHAT_ID && threadId === TECH_THREAD_ID;
}
__name(isTechThread, "isTechThread");
function isPrivateChat(chatType) {
  return chatType === "private";
}
__name(isPrivateChat, "isPrivateChat");
function shouldSilenceInfoTopic(chatId, threadId) {
  return false;
}
__name(shouldSilenceInfoTopic, "shouldSilenceInfoTopic");
function shouldSilenceBotChat(chatId) {
  return chatId === CHAT_GROUP_ID;
}
__name(shouldSilenceBotChat, "shouldSilenceBotChat");
function shouldSilenceGroupChat(chatId) {
  return shouldSilenceBotChat(chatId);
}
__name(shouldSilenceGroupChat, "shouldSilenceGroupChat");
async function sendMessageWithInfoSilence(env, chatId, text, messageThreadId = null, replyToMessageId = null, replyMarkup = null, parseMode = null, disableNotification = false) {
  return sendMessage(env, chatId, text, messageThreadId, replyToMessageId, replyMarkup, parseMode, disableNotification || shouldSilenceInfoTopic(chatId, messageThreadId) || shouldSilenceBotChat(chatId));
}
__name(sendMessageWithInfoSilence, "sendMessageWithInfoSilence");
async function copyTechMessageToGroupSilent(env, chatGroupId, infoChatId, sourceMessageId, disableNotification = true) {
  return copyTechMessageToGroup(env, chatGroupId, infoChatId, sourceMessageId, disableNotification || shouldSilenceBotChat(chatGroupId));
}
__name(copyTechMessageToGroupSilent, "copyTechMessageToGroupSilent");
function getLightTalkKey(chatId, threadId, chatType, userId = null) {
  if (isPrivateChat(chatType)) {
    return `${chatId}:private`;
  }
  return `${chatId}:${threadId ?? "main"}:${userId ?? "unknown-user"}`;
}
__name(getLightTalkKey, "getLightTalkKey");
function normalizeCommandText(text) {
  return String(text || "").toLowerCase().replace(/\u0451/g, "\u0435").replace(/[^\u0430-\u044fa-z0-9#]+/giu, " ").replace(/\s+/g, " ").trim();
}
__name(normalizeCommandText, "normalizeCommandText");
function hasFixMarker(text) {
  const tokens = normalizeCommandText(text).split(" ").filter(Boolean);
  return tokens.some((token) => token === "\u0444\u0438\u043A\u0441" || token === "\u0444\u0438\u043A\u0441\u0438\u0440\u0443\u044E" || token === "#\u0444\u0438\u043A\u0441" || token === "#\u0444\u0438\u043A\u0441\u0438\u0440\u0443\u044E");
}
__name(hasFixMarker, "hasFixMarker");
function hasHelpMarker(text) {
  const tokens = normalizeCommandText(text).split(" ").filter(Boolean);
  return tokens.some((token) => token === "help" || token === "\u0445\u0435\u043B\u043F" || token === "\u0445\u044D\u043B\u043F" || token === "#help" || token === "#\u0445\u0435\u043B\u043F" || token === "#\u0445\u044D\u043B\u043F");
}
__name(hasHelpMarker, "hasHelpMarker");
function getMoscowMinutesOfDay() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Moscow",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(/* @__PURE__ */ new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return Number(values.hour) * 60 + Number(values.minute);
}
__name(getMoscowMinutesOfDay, "getMoscowMinutesOfDay");
function isMainMeetingWindow() {
  const now = getMoscowMinutesOfDay();
  return now >= 21 * 60 + 20 && now <= 22 * 60 + 45;
}
__name(isMainMeetingWindow, "isMainMeetingWindow");
function isGameCommandWindow() {
  const now = getMoscowMinutesOfDay();
  return now >= 21 * 60 + 30 && now < 24 * 60;
}
__name(isGameCommandWindow, "isGameCommandWindow");
function normalizeLightText(text) {
  return normalizeCommandText(text);
}
__name(normalizeLightText, "normalizeLightText");
function hasExplicitNafanyaAddress(text) {
  const source = String(text || "").trim();
  if (/^\s*\u043d\u0430\u0444\u0430\u043d\u044f\s*,/iu.test(source)) {
    return true;
  }
  const normalized = normalizeLightText(source);
  return /(?:^|\s)\u0431\u043e\u0442(?:\s|$)/u.test(normalized);
}
__name(hasExplicitNafanyaAddress, "hasExplicitNafanyaAddress");
function isReplyToBot(message) {
  return Boolean(message?.reply_to_message?.from?.is_bot);
}
__name(isReplyToBot, "isReplyToBot");
function shouldUseLightConversation(message, text, chatType) {
  if (isPrivateChat(chatType)) {
    return true;
  }
  if (isMainMeetingWindow()) {
    return false;
  }
  return isReplyToBot(message) || hasExplicitNafanyaAddress(text);
}
__name(shouldUseLightConversation, "shouldUseLightConversation");
function hasServiceRequest(text) {
  const normalized = normalizeCommandText(text);
  if (!normalized) {
    return false;
  }
  return /(?:^|\s)(?:\u043D\u0430\u0444\u0430\u043D\u044F\s+)?\u0445\u043E\u0447\u0443\s+(?:\u0432\u0437\u044F\u0442\u044C\s+|\u043D\u0430\s+)?\u0441\u043B\u0443\u0436(?:\u0435\u043D\u0438\u0435|\u0438\u0442\u044C)(?:\s|$)/u.test(normalized);
}
__name(hasServiceRequest, "hasServiceRequest");
function isIdCommand(text) {
  const normalized = text.trim().toLowerCase();
  return normalized === "id" || normalized === "/id" || normalized === "\u0431\u043E\u0442";
}
__name(isIdCommand, "isIdCommand");
function isMeetingPanelCommand(text, { allowBare = true } = {}) {
  const normalized = text.trim().toLowerCase();
  const prefixed = normalized === "\u043F\u0443\u043B\u044C\u0442 \u0441\u043E\u0431\u0440\u0430\u043D\u0438\u044F" || normalized === "\u043F\u0443\u043B\u044C\u0442 \u0441\u043E\u0431\u0440\u0430\u043D\u0438\u0435";
  const bare = normalized === "\u0441\u043E\u0431\u0440\u0430\u043D\u0438\u0435" || normalized === "/\u0441\u043E\u0431\u0440\u0430\u043D\u0438\u0435";
  return prefixed || allowBare && bare;
}
__name(isMeetingPanelCommand, "isMeetingPanelCommand");
function isQueuePanelCommand(text) {
  const normalized = text.trim().toLowerCase();
  return normalized === "\u043E\u0447\u0435\u0440\u0435\u0434\u044C" || normalized === "/\u043E\u0447\u0435\u0440\u0435\u0434\u044C";
}
__name(isQueuePanelCommand, "isQueuePanelCommand");
function isTimerPanelCommand(text) {
  const normalized = text.trim().toLowerCase();
  return normalized === "\u0442\u0430\u0439\u043C\u0435\u0440" || normalized === "/\u0442\u0430\u0439\u043C\u0435\u0440";
}
__name(isTimerPanelCommand, "isTimerPanelCommand");
function isYozhikCommand(text) {
  const normalized = text.trim().toLowerCase();
  return normalized === "\u0451\u0436\u0438\u043A" || normalized === "\u0435\u0436\u0438\u043A" || normalized === "/\u0451\u0436\u0438\u043A" || normalized === "/\u0435\u0436\u0438\u043A";
}
__name(isYozhikCommand, "isYozhikCommand");
function isBillPromptCommand(text) {
  const normalized = text.trim().toLowerCase();
  return normalized === "\u0431\u0438\u043B\u043B" || normalized === "/\u0431\u0438\u043B\u043B";
}
__name(isBillPromptCommand, "isBillPromptCommand");
function getTodayTopicSourceMessageId() {
  const clock = getMoscowClock();
  return TODAY_TOPIC_MESSAGES.find((item) => item.weekday === clock.weekday)?.sourceMessageId ?? null;
}
__name(getTodayTopicSourceMessageId, "getTodayTopicSourceMessageId");
function getTodayTopicZoomKey() {
  const clock = getMoscowClock();
  return ZOOM_TOPIC_MESSAGE_KEYS_BY_WEEKDAY[String(clock.weekday)] || TODAY_TOPIC_MESSAGES.find((item) => item.weekday === clock.weekday)?.zoomKey || null;
}
__name(getTodayTopicZoomKey, "getTodayTopicZoomKey");
function getTodayTopicZoomMessages() {
  const key = getTodayTopicZoomKey();
  return key ? getZoomMeetingMessages(key) : [];
}
__name(getTodayTopicZoomMessages, "getTodayTopicZoomMessages");
function parseBillInput(text) {
  const normalized = text.trim();
  const match = normalized.match(/^(?:билл\s+)?(\d{1,3})$/i);
  if (!match) {
    return null;
  }
  return Number(match[1]);
}
__name(parseBillInput, "parseBillInput");
function getZoomPayloadDisplayName(payload) {
  const user = payload?.user || payload?.from || {};
  return cleanQueueDisplayName(user.displayName || user.display_name || user.senderName || user.sender_name || user.name || user.nickname || payload?.displayName || payload?.display_name || payload?.senderName || payload?.sender_name || payload?.author || "\u0443\u0447\u0430\u0441\u0442\u043D\u0438\u043A Zoom");
}
__name(getZoomPayloadDisplayName, "getZoomPayloadDisplayName");
function getZoomOpenQueueMode(text) {
  const normalized = normalizeZoomCommand(text);
  if (/^\u043E\u0442\u043A\u0440\u044B\u0442\u044C\s+(?:\u0431\u0438\u043B\u043B|\u0431\u0438\u043B\u043B\u0430)$/u.test(normalized)) return "bill";
  if (/^\u043E\u0442\u043A\u0440\u044B\u0442\u044C\s+\u0431\u043A$/u.test(normalized)) return "bk";
  if (/^\u043E\u0442\u043A\u0440\u044B\u0442\u044C\s+\u0440\u0430\u0431\u043E\u0447\u043A\u0430$/u.test(normalized)) return "rs";
  return null;
}
__name(getZoomOpenQueueMode, "getZoomOpenQueueMode");
function stripHtmlTags(text) {
  return String(text || "").replace(/<[^>]+>/g, "");
}
__name(stripHtmlTags, "stripHtmlTags");
function cleanZoomText(text) {
  return stripHtmlTags(text).replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{4,}/g, "\n\n\n").trim();
}
__name(cleanZoomText, "cleanZoomText");
function looksLikeZoomOnlyBotEcho(text) {
  const value = cleanZoomText(text);
  if (!value) return false;
  if (/^\u0427\u0430\u0441\u0442\u044C\s+\d+\/\d+/iu.test(value)) return true;
  if (/\u041F\u0438\u0448\u0438\u0442\u0435\s+\u0432\s+\u0447\u0430\u0442\s+"?111"?/iu.test(value)) return true;
  if (/(^|\s)\u041E\u0427\u0415\u0420\u0415\u0414\u042C\s+(?:\u041E\u0422\u041A\u0420\u042B\u0422\u0410|\u0417\u0410\u041A\u0420\u042B\u0422\u0410)(\s|$)/iu.test(value)) return true;
  if (/^\u041F\u043E\u043A\u0430\s+\u043F\u0443\u0441\u0442\u043E\.?$/iu.test(value)) return true;
  return false;
}
__name(looksLikeZoomOnlyBotEcho, "looksLikeZoomOnlyBotEcho");
function splitZoomText(text, limit = ZOOM_MESSAGE_SAFE_LIMIT) {
  const clean = cleanZoomText(text);
  if (!clean) return [];
  if (clean.length <= limit) return [clean];
  const chunks = [];
  let rest = clean;
  while (rest.length > limit) {
    const slice = rest.slice(0, limit + 1);
    const breakAt = Math.max(slice.lastIndexOf("\n\n"), slice.lastIndexOf("\n"), slice.lastIndexOf(". "), slice.lastIndexOf(" "));
    const cut = breakAt > Math.floor(limit * 0.55) ? breakAt : limit;
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) chunks.push(rest);
  return chunks.length > 1 ? chunks.map((chunk, index) => `\u0427\u0430\u0441\u0442\u044C ${index + 1}/${chunks.length}\n${chunk}`) : chunks;
}
__name(splitZoomText, "splitZoomText");
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
__name(sleep, "sleep");
function getCurrentTimestamp() {
  return Date.now() + Math.floor(Math.random() * 1e3);
}
__name(getCurrentTimestamp, "getCurrentTimestamp");
function createEmptyAnnouncementState() {
  return {
    messageIds: {},
    personalSubscriptions: {},
    adminDmDrafts: {},
    adminDmUsers: {},
    replacementRequests: {},
    zoomOutbox: [],
    zoomOutboxNextId: 1,
    zoomDebugEvents: [],
    zoomOnlyQueueState: createEmptyQueueState(),
    zoomOnlyOutbox: [],
    zoomOnlyOutboxNextId: 1,
    zoomOnlyPanelLastAction: null
  };
}
__name(createEmptyAnnouncementState, "createEmptyAnnouncementState");
function normalizeAnnouncementState(announcementState) {
  const normalized = announcementState && typeof announcementState === "object" ? announcementState : createEmptyAnnouncementState();
  if (!normalized.messageIds || typeof normalized.messageIds !== "object") {
    normalized.messageIds = {};
  }
  if (!normalized.personalSubscriptions || typeof normalized.personalSubscriptions !== "object") {
    normalized.personalSubscriptions = {};
  }
  if (!normalized.adminDmDrafts || typeof normalized.adminDmDrafts !== "object") {
    normalized.adminDmDrafts = {};
  }
  if (!normalized.adminDmUsers || typeof normalized.adminDmUsers !== "object") {
    normalized.adminDmUsers = {};
  }
  if (!normalized.replacementRequests || typeof normalized.replacementRequests !== "object") {
    normalized.replacementRequests = {};
  }
  if (!Array.isArray(normalized.zoomOutbox)) {
    normalized.zoomOutbox = [];
  }
  normalized.zoomOutbox = normalized.zoomOutbox.filter((item) => item && typeof item === "object");
  if (!Array.isArray(normalized.zoomDebugEvents)) {
    normalized.zoomDebugEvents = [];
  }
  normalized.zoomDebugEvents = normalized.zoomDebugEvents.filter((item) => item && typeof item === "object").slice(-25);
  if (!normalized.zoomOnlyQueueState || typeof normalized.zoomOnlyQueueState !== "object") {
    normalized.zoomOnlyQueueState = createEmptyQueueState();
  }
  normalized.zoomOnlyQueueState = {
    ...createEmptyQueueState(),
    ...normalized.zoomOnlyQueueState,
    entries: Array.isArray(normalized.zoomOnlyQueueState.entries) ? normalized.zoomOnlyQueueState.entries : [],
    history: Array.isArray(normalized.zoomOnlyQueueState.history) ? normalized.zoomOnlyQueueState.history : []
  };
  if (!Array.isArray(normalized.zoomOnlyOutbox)) {
    normalized.zoomOnlyOutbox = [];
  }
  normalized.zoomOnlyOutbox = normalized.zoomOnlyOutbox.filter((item) => item && typeof item === "object");
  if (!normalized.zoomOnlyPanelLastAction || typeof normalized.zoomOnlyPanelLastAction !== "object") {
    normalized.zoomOnlyPanelLastAction = null;
  }
  const maxExistingId = normalized.zoomOutbox.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0);
  const nextId = Number(normalized.zoomOutboxNextId);
  normalized.zoomOutboxNextId = Number.isInteger(nextId) && nextId > maxExistingId ? nextId : maxExistingId + 1;
  const maxZoomOnlyId = normalized.zoomOnlyOutbox.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0);
  const nextZoomOnlyId = Number(normalized.zoomOnlyOutboxNextId);
  normalized.zoomOnlyOutboxNextId = Number.isInteger(nextZoomOnlyId) && nextZoomOnlyId > maxZoomOnlyId ? nextZoomOnlyId : maxZoomOnlyId + 1;
  return normalized;
}
__name(normalizeAnnouncementState, "normalizeAnnouncementState");
var QueueStateDurableObject = class {
  static {
    __name(this, "QueueStateDurableObject");
  }
  constructor(state) {
    this.state = state;
  }
  async loadState() {
    return await this.state.storage.get("queue-state") || createEmptyQueueState();
  }
  async saveState(queueState) {
    await this.state.storage.put("queue-state", queueState);
  }
  async fetch(request) {
    const url = new URL(request.url);
    const action = url.pathname.replace("/", "");
    const payload = request.method === "POST" ? await request.json() : {};
    const queueState = await this.loadState();
    try {
      const result = runQueueStateActionCore(queueState, action, payload, buildQueueTextCore);
      await this.saveState(result.state);
      return Response.json(result.response);
    } catch (error) {
      return Response.json({ ok: false, error: error.message }, { status: 400 });
    }
  }
};
function createEmptyTimerState() {
  return {
    status: "idle",
    isRunning: false,
    durationSec: TIMER_DEFAULT_SECONDS,
    endsAt: null,
    messageId: null,
    finishedAt: null,
    finishedStickerSent: false
  };
}
__name(createEmptyTimerState, "createEmptyTimerState");
function createEmptyLightTalkState() {
  return {
    history: [],
    lastActiveAt: 0
  };
}
__name(createEmptyLightTalkState, "createEmptyLightTalkState");
function trimLightTalkHistory(history) {
  const fresh = (Array.isArray(history) ? history : []).filter((item) => {
    const createdAt = Number(item?.createdAt || 0);
    return createdAt && Date.now() - createdAt <= LIGHT_TALK_TTL_MS && typeof item.text === "string" && item.text.trim();
  });
  let total = 0;
  const result = [];
  for (let i = fresh.length - 1; i >= 0; i -= 1) {
    const item = fresh[i];
    total += item.text.length;
    if (total > LIGHT_TALK_MAX_CHARS) break;
    result.unshift(item);
  }
  return result;
}
__name(trimLightTalkHistory, "trimLightTalkHistory");
function formatTimerMinutes(totalSeconds) {
  const safeSeconds = Math.max(0, Math.ceil(totalSeconds));
  const minutes = Math.max(1, Math.ceil(safeSeconds / 60));
  const suffix = minutes === 1 ? "\u043C\u0438\u043D\u0443\u0442\u0430" : minutes >= 2 && minutes <= 4 ? "\u043C\u0438\u043D\u0443\u0442\u044B" : "\u043C\u0438\u043D\u0443\u0442";
  return `${minutes} ${suffix}`;
}
__name(formatTimerMinutes, "formatTimerMinutes");
var TIMER_MAX_TICK_MS = 60 * 1e3;
function getTimerTickDelayMs(totalSeconds) {
  const safeSeconds = Math.max(1, Math.ceil(totalSeconds));
  const secondsUntilMinuteChange = safeSeconds % 60 || 60;
  return Math.min(TIMER_MAX_TICK_MS, secondsUntilMinuteChange * 1e3);
}
__name(getTimerTickDelayMs, "getTimerTickDelayMs");
function buildTimerText(timerState) {
  if (timerState.status === "finished") {
    return "\u0412\u0440\u0435\u043C\u044F \u0438\u0441\u0442\u0435\u043A\u043B\u043E";
  }
  if (timerState.isRunning && timerState.endsAt) {
    const remainingSec = Math.max(0, Math.ceil((timerState.endsAt - Date.now()) / 1e3));
    return `\u041E\u0421\u0422\u0410\u041B\u041E\u0421\u042C: ${formatTimerMinutes(remainingSec)}`;
  }
  return "\u0422\u0430\u0439\u043C\u0435\u0440 \u043E\u0441\u0442\u0430\u043D\u043E\u0432\u043B\u0435\u043D.";
}
__name(buildTimerText, "buildTimerText");
var TimerStateDurableObject = class {
  static {
    __name(this, "TimerStateDurableObject");
  }
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }
  async loadState() {
    return await this.state.storage.get("timer-state") || createEmptyTimerState();
  }
  async saveState(timerState) {
    await this.state.storage.put("timer-state", timerState);
  }
  async publishTimerState(timerState) {
    const text = buildTimerText(timerState);
    const existingMessageId = timerState.messageId;
    if (existingMessageId) {
      try {
        await editMessageText(this.env, CHAT_GROUP_ID, existingMessageId, text, buildTimerKeyboard(), null);
        return existingMessageId;
      } catch (error) {
        if (/message is not modified/i.test(error.message)) {
          return existingMessageId;
        }
      }
    }
    const sent = await sendMessage(this.env, CHAT_GROUP_ID, text, null, null, buildTimerKeyboard(), null, shouldSilenceBotChat(CHAT_GROUP_ID));
    timerState.messageId = sent.result?.message_id ?? null;
    return timerState.messageId;
  }
  async publishFinishedSticker(timerState) {
    if (timerState.finishedStickerSent) {
      return;
    }
    const stickerSet = await getStickerSet(this.env, TIMER_DONE_STICKER_SET_NAME);
    const stickerFileId = stickerSet.result?.stickers?.[0]?.file_id;
    if (!stickerFileId) {
      throw new Error(`Sticker set ${TIMER_DONE_STICKER_SET_NAME} is empty.`);
    }
    await sendSticker(this.env, CHAT_GROUP_ID, stickerFileId, null, "\u23F0", shouldSilenceBotChat(CHAT_GROUP_ID));
    timerState.finishedStickerSent = true;
  }
  async reschedule(timerState) {
    if (timerState.isRunning && timerState.endsAt) {
      const remainingSec = Math.max(0, Math.ceil((timerState.endsAt - Date.now()) / 1e3));
      const nextTick = Math.min(timerState.endsAt, Date.now() + getTimerTickDelayMs(remainingSec));
      await this.state.storage.setAlarm(nextTick);
      return;
    }
    await this.state.storage.deleteAlarm();
  }
  async tick() {
    const timerState = await this.loadState();
    if (!timerState.isRunning) {
      const finishedAt = Number(timerState.finishedAt || 0);
      if (timerState.status === "finished" && !timerState.finishedStickerSent && finishedAt && Date.now() - finishedAt <= 10 * 60 * 1e3) {
        try {
          await this.publishFinishedSticker(timerState);
          await this.saveState(timerState);
        } catch (error) {
          console.error("timer finished sticker retry failed", error);
        }
      }
      await this.state.storage.deleteAlarm();
      return;
    }
    const remainingSec = Math.max(0, Math.ceil((timerState.endsAt - Date.now()) / 1e3));
    if (remainingSec <= 0) {
      timerState.status = "finished";
      timerState.isRunning = false;
      timerState.endsAt = null;
      timerState.finishedAt = Date.now();
      await this.saveState(timerState);
      try {
        await this.publishTimerState(timerState);
      } catch {
      }
      try {
        await this.publishFinishedSticker(timerState);
      } catch (error) {
        console.error("timer finished sticker failed", error);
      }
      await this.saveState(timerState);
      await this.state.storage.deleteAlarm();
      return;
    }
    try {
      await this.publishTimerState(timerState);
    } catch {
    }
    await this.saveState(timerState);
    await this.reschedule(timerState);
  }
  async fetch(request) {
    const url = new URL(request.url);
    const action = url.pathname.replace("/", "");
    const payload = request.method === "POST" ? await request.json() : {};
    let timerState = await this.loadState();
    try {
      if (action === "get") {
        return Response.json({ ok: true, state: timerState });
      }
      if (action === "start") {
        const durationSec = Number.isFinite(Number(payload.durationSec)) ? Math.max(10, Math.floor(Number(payload.durationSec))) : TIMER_DEFAULT_SECONDS;
        const messageId = Number(payload.messageId);
        timerState.status = "running";
        timerState.isRunning = true;
        timerState.durationSec = durationSec;
        timerState.endsAt = Date.now() + durationSec * 1e3;
        if (Number.isFinite(messageId) && messageId > 0) {
          timerState.messageId = messageId;
        }
        timerState.finishedAt = null;
        timerState.finishedStickerSent = false;
        await this.saveState(timerState);
        try {
          await this.publishTimerState(timerState);
        } catch {
        }
        await this.saveState(timerState);
        await this.reschedule(timerState);
        return Response.json({ ok: true });
      }
      if (action === "stop") {
        const messageId = Number(payload.messageId);
        if (Number.isFinite(messageId) && messageId > 0) {
          timerState.messageId = messageId;
        }
        timerState.status = "stopped";
        timerState.isRunning = false;
        timerState.endsAt = null;
        timerState.finishedAt = null;
        timerState.finishedStickerSent = false;
        await this.saveState(timerState);
        try {
          await this.publishTimerState(timerState);
        } catch {
        }
        await this.saveState(timerState);
        await this.reschedule(timerState);
        return Response.json({ ok: true });
      }
      if (action === "tick") {
        await this.tick();
        return Response.json({ ok: true });
      }
      return Response.json({ ok: false, error: "\u041D\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043D\u043E\u0435 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0435 \u0442\u0430\u0439\u043C\u0435\u0440\u0430." }, { status: 400 });
    } catch (error) {
      return Response.json({ ok: false, error: error.message }, { status: 400 });
    }
  }
  async alarm() {
    await this.tick();
  }
};
var LightTalkStateDurableObject = class {
  static {
    __name(this, "LightTalkStateDurableObject");
  }
  constructor(state) {
    this.state = state;
  }
  async loadState() {
    const state = await this.state.storage.get("light-talk-state") || createEmptyLightTalkState();
    if (state.lastActiveAt && Date.now() - state.lastActiveAt > LIGHT_TALK_TTL_MS) {
      return createEmptyLightTalkState();
    }
    state.history = trimLightTalkHistory(state.history);
    return state;
  }
  async saveState(lightTalkState) {
    const hasHistory = Array.isArray(lightTalkState.history) && lightTalkState.history.length > 0;
    if (!hasHistory) {
      await this.state.storage.delete("light-talk-state");
      await this.state.storage.deleteAlarm();
      return;
    }
    lightTalkState.lastActiveAt = Date.now();
    lightTalkState.history = trimLightTalkHistory(lightTalkState.history);
    await this.state.storage.put("light-talk-state", lightTalkState);
    await this.state.storage.setAlarm(lightTalkState.lastActiveAt + LIGHT_TALK_TTL_MS);
  }
  async fetch(request) {
    const url = new URL(request.url);
    const action = url.pathname.replace("/", "");
    const payload = request.method === "POST" ? await request.json() : {};
    let lightTalkState = await this.loadState();
    try {
      if (action === "get") {
        return Response.json({ ok: true, state: lightTalkState });
      }
      if (action === "append") {
        const role = payload.role === "assistant" ? "assistant" : "user";
        const text = String(payload.text || "").trim();
        if (text) {
          lightTalkState.history.push({
            role,
            text,
            createdAt: Date.now()
          });
          await this.saveState(lightTalkState);
        }
        return Response.json({ ok: true, state: lightTalkState });
      }
      if (action === "reset") {
        lightTalkState = createEmptyLightTalkState();
        await this.saveState(lightTalkState);
        return Response.json({ ok: true, state: lightTalkState });
      }
      return Response.json({ ok: false, error: "\u041D\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043D\u043E\u0435 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0435 \u043B\u0451\u0433\u043A\u043E\u0439 \u0431\u0435\u0441\u0435\u0434\u044B." }, { status: 400 });
    } catch (error) {
      return Response.json({ ok: false, error: error.message }, { status: 400 });
    }
  }
  async alarm() {
    await this.state.storage.delete("light-talk-state");
    await this.state.storage.deleteAlarm();
  }
};
var AnnouncementStateDurableObject = class {
  static {
    __name(this, "AnnouncementStateDurableObject");
  }
  constructor(state) {
    this.state = state;
  }
  async loadState() {
    return normalizeAnnouncementState(await this.state.storage.get("announcement-state"));
  }
  async saveState(announcementState) {
    await this.state.storage.put("announcement-state", normalizeAnnouncementState(announcementState));
  }
  async fetch(request) {
    const url = new URL(request.url);
    const action = url.pathname.replace("/", "");
    const payload = request.method === "POST" ? await request.json() : {};
    const announcementState = await this.loadState();
    try {
      if (action === "get") {
        const key = String(payload.key || "").trim();
        return Response.json({
          ok: true,
          messageId: key ? announcementState.messageIds[key] ?? null : null,
          state: announcementState
        });
      }
      if (action === "set_message_id") {
        const key = String(payload.key || "").trim();
        if (!key) {
          return Response.json({ ok: false, error: "Не указан ключ объявления." }, { status: 400 });
        }
        const messageId = payload.messageId ?? null;
        if (messageId) {
          announcementState.messageIds[key] = messageId;
        } else {
          delete announcementState.messageIds[key];
        }
        await this.saveState(announcementState);
        return Response.json({ ok: true, messageId: announcementState.messageIds[key] ?? null });
      }
      if (action === "enqueue_zoom_messages") {
        const messages = Array.isArray(payload.messages) ? payload.messages : [];
        const createdAt = Date.now();
        const queued = messages
          .map((message) => String(message || "").trim())
          .filter(Boolean)
          .map((text) => {
            const item = {
              id: announcementState.zoomOutboxNextId,
              text,
              createdAt
            };
            announcementState.zoomOutboxNextId += 1;
            return item;
          });
        if (queued.length) {
          announcementState.zoomOutbox.push(...queued);
          if (announcementState.zoomOutbox.length > 200) {
            announcementState.zoomOutbox = announcementState.zoomOutbox.slice(-200);
          }
          await this.saveState(announcementState);
        }
        return Response.json({ ok: true, queued });
      }
      if (action === "get_zoom_outbox_marker") {
        return Response.json({
          ok: true,
          nextId: announcementState.zoomOutboxNextId
        });
      }
      if (action === "pull_zoom_messages") {
        const limit = Math.max(1, Math.min(50, Number(payload.limit) || 20));
        const minId = Number(payload.minId) || 0;
        const messages = announcementState.zoomOutbox.filter((item) => !minId || Number(item.id) >= minId);
        return Response.json({
          ok: true,
          messages: messages.slice(0, limit)
        });
      }
      if (action === "ack_zoom_messages") {
        const ids = new Set((Array.isArray(payload.ids) ? payload.ids : []).map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0));
        if (ids.size) {
          announcementState.zoomOutbox = announcementState.zoomOutbox.filter((item) => !ids.has(Number(item.id)));
          await this.saveState(announcementState);
        }
        return Response.json({ ok: true, remaining: announcementState.zoomOutbox.length });
      }
      if (action === "record_zoom_debug") {
        const event = payload.event && typeof payload.event === "object" ? payload.event : {};
        announcementState.zoomDebugEvents.push({
          ...event,
          recordedAt: Date.now()
        });
        announcementState.zoomDebugEvents = announcementState.zoomDebugEvents.slice(-25);
        await this.saveState(announcementState);
        return Response.json({ ok: true, count: announcementState.zoomDebugEvents.length });
      }
      if (action === "pull_zoom_debug") {
        return Response.json({ ok: true, events: announcementState.zoomDebugEvents.slice(-25) });
      }
      if (action === "clear_zoom_debug") {
        announcementState.zoomDebugEvents = [];
        await this.saveState(announcementState);
        return Response.json({ ok: true });
      }
      if (action === "enqueue_zoom_only_messages") {
        const messages = Array.isArray(payload.messages) ? payload.messages : [];
        const createdAt = Date.now();
        const queued = messages
          .map((message) => String(message || "").trim())
          .filter(Boolean)
          .map((text) => {
            const item = {
              id: announcementState.zoomOnlyOutboxNextId,
              text,
              createdAt
            };
            announcementState.zoomOnlyOutboxNextId += 1;
            return item;
          });
        if (queued.length) {
          announcementState.zoomOnlyOutbox.push(...queued);
          if (announcementState.zoomOnlyOutbox.length > 300) {
            announcementState.zoomOnlyOutbox = announcementState.zoomOnlyOutbox.slice(-300);
          }
          await this.saveState(announcementState);
        }
        return Response.json({ ok: true, queued });
      }
      if (action === "get_zoom_only_outbox_marker") {
        return Response.json({
          ok: true,
          nextId: announcementState.zoomOnlyOutboxNextId
        });
      }
      if (action === "pull_zoom_only_messages") {
        const limit = Math.max(1, Math.min(50, Number(payload.limit) || 20));
        const minId = Number(payload.minId) || 0;
        const messages = announcementState.zoomOnlyOutbox.filter((item) => !minId || Number(item.id) >= minId);
        return Response.json({
          ok: true,
          messages: messages.slice(0, limit)
        });
      }
      if (action === "ack_zoom_only_messages") {
        const ids = new Set((Array.isArray(payload.ids) ? payload.ids : []).map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0));
        if (ids.size) {
          announcementState.zoomOnlyOutbox = announcementState.zoomOnlyOutbox.filter((item) => !ids.has(Number(item.id)));
          await this.saveState(announcementState);
        }
        return Response.json({ ok: true, remaining: announcementState.zoomOnlyOutbox.length });
      }
      if (action === "zoom_only_queue") {
        const queueResult = runQueueStateActionCore(announcementState.zoomOnlyQueueState, payload.queueAction || "get", payload.queuePayload || {}, buildZoomOnlyQueueTextCore);
        announcementState.zoomOnlyQueueState = queueResult.state;
        await this.saveState(announcementState);
        return Response.json(queueResult.response);
      }
      if (action === "record_zoom_only_panel_action") {
        const key = String(payload.key || payload.command || "").trim();
        announcementState.zoomOnlyPanelLastAction = {
          key,
          label: String(payload.label || key).trim(),
          ok: payload.ok !== false,
          createdAt: Date.now()
        };
        await this.saveState(announcementState);
        return Response.json({ ok: true, lastAction: announcementState.zoomOnlyPanelLastAction });
      }
      if (action === "clear_zoom_only_state") {
        announcementState.zoomOnlyQueueState = createEmptyQueueState();
        announcementState.zoomOnlyOutbox = [];
        announcementState.zoomOnlyOutboxNextId = 1;
        announcementState.zoomOnlyPanelLastAction = null;
        await this.saveState(announcementState);
        return Response.json({ ok: true });
      }
      if (action === "zoom_only_status") {
        const queue = announcementState.zoomOnlyQueueState || createEmptyQueueState();
        return Response.json({
          ok: true,
          queue: {
            isOpen: Boolean(queue.isOpen),
            mode: queue.mode || "bk",
            entriesCount: Array.isArray(queue.entries) ? queue.entries.length : 0,
            historyCount: Array.isArray(queue.history) ? queue.history.length : 0
          },
          outboxSize: announcementState.zoomOnlyOutbox.length,
          nextOutboxId: announcementState.zoomOnlyOutboxNextId,
          sender: {
            connected: false,
            status: "waiting"
          },
          lastPanelAction: announcementState.zoomOnlyPanelLastAction
        });
      }
      if (action === "get_personal_subscription") {
        const userId = String(payload.userId || "").trim();
        return Response.json({
          ok: true,
          subscription: userId ? announcementState.personalSubscriptions[userId] ?? null : null
        });
      }
      if (action === "set_personal_subscription") {
        const userId = String(payload.userId || "").trim();
        if (!userId) {
          return Response.json({ ok: false, error: "Не указан пользователь личной рассылки." }, { status: 400 });
        }
        const previous = announcementState.personalSubscriptions[userId] || {};
        const next = {
          ...previous,
          ...payload.subscription,
          userId,
          updatedAt: Date.now()
        };
        announcementState.personalSubscriptions[userId] = next;
        await this.saveState(announcementState);
        return Response.json({ ok: true, subscription: next });
      }
      if (action === "list_personal_subscriptions") {
        return Response.json({
          ok: true,
          subscriptions: Object.values(announcementState.personalSubscriptions || {})
        });
      }
      if (action === "get_admin_dm_draft") {
        const userId = String(payload.userId || "").trim();
        return Response.json({
          ok: true,
          draft: userId ? announcementState.adminDmDrafts[userId] ?? null : null
        });
      }
      if (action === "set_admin_dm_draft") {
        const userId = String(payload.userId || "").trim();
        if (!userId) {
          return Response.json({ ok: false, error: "Не указан админ для черновика." }, { status: 400 });
        }
        const draft = {
          ...payload.draft,
          userId,
          updatedAt: Date.now()
        };
        announcementState.adminDmDrafts[userId] = draft;
        await this.saveState(announcementState);
        return Response.json({ ok: true, draft });
      }
      if (action === "clear_admin_dm_draft") {
        const userId = String(payload.userId || "").trim();
        if (userId) {
          delete announcementState.adminDmDrafts[userId];
          await this.saveState(announcementState);
        }
        return Response.json({ ok: true });
      }
      if (action === "get_admin_dm_user") {
        const userId = String(payload.userId || "").trim();
        return Response.json({
          ok: true,
          admin: userId ? announcementState.adminDmUsers[userId] ?? null : null
        });
      }
      if (action === "set_admin_dm_user") {
        const userId = String(payload.userId || "").trim();
        if (!userId) {
          return Response.json({ ok: false, error: "Не указан админ." }, { status: 400 });
        }
        const admin = {
          ...payload.admin,
          userId,
          updatedAt: Date.now()
        };
        announcementState.adminDmUsers[userId] = admin;
        await this.saveState(announcementState);
        return Response.json({ ok: true, admin });
      }
      if (action === "remove_admin_dm_user") {
        const userId = String(payload.userId || "").trim();
        if (userId) {
          delete announcementState.adminDmUsers[userId];
          await this.saveState(announcementState);
        }
        return Response.json({ ok: true });
      }
      if (action === "list_admin_dm_users") {
        return Response.json({
          ok: true,
          admins: Object.values(announcementState.adminDmUsers || {})
        });
      }
      if (action === "create_replacement_request") {
        const request = payload.request && typeof payload.request === "object" ? payload.request : {};
        const dedupeKey = String(payload.dedupeKey || request.dedupeKey || "").trim();
        if (!dedupeKey) {
          return Response.json({ ok: false, error: "Не указан ключ запроса на замену." }, { status: 400 });
        }
        const existingOpen = Object.values(announcementState.replacementRequests || {}).find((item) => item?.dedupeKey === dedupeKey && item?.status === "open");
        if (existingOpen) {
          console.log("replacement duplicate click", { request_id: existingOpen.id, dedupe_key: dedupeKey });
          return Response.json({ ok: true, created: false, duplicateOpen: true, request: existingOpen });
        }
        const id = String(request.id || `rr_${Date.now().toString(36)}`).trim();
        const now = (/* @__PURE__ */ new Date()).toISOString();
        const next = {
          id,
          dedupeKey,
          date: String(request.date || "").trim(),
          time: request.time || "21:30",
          group_name: request.group_name || "\u041f\u043e\u0447\u0442\u0438 \u043d\u043e\u0440\u043c\u0430\u043b\u044c\u043d\u044b\u0435",
          service: String(request.service || "").trim(),
          request_kind: String(request.request_kind || "replacement").trim(),
          vacancy_text: String(request.vacancy_text || "").trim(),
          original_person_name: String(request.original_person_name || "").trim(),
          original_user_id: String(request.original_user_id || "").trim(),
          original_username: String(request.original_username || "").trim(),
          status: "open",
          responders: [],
          selected_responder_id: null,
          selected_responder_name: null,
          selected_responder_username: null,
          coordinator_message_chat_id: null,
          coordinator_message_id: null,
          admin_thread_message_chat_id: null,
          admin_thread_message_id: null,
          selected_at: null,
          acknowledged_at: null,
          created_at: request.created_at || now,
          closed_at: null
        };
        announcementState.replacementRequests[id] = next;
        await this.saveState(announcementState);
        console.log("replacement request created", { request_id: id, dedupe_key: dedupeKey, date: next.date, service: next.service });
        return Response.json({ ok: true, created: true, duplicateOpen: false, request: next });
      }
      if (action === "close_open_replacement_request_by_dedupe") {
        const dedupeKey = String(payload.dedupeKey || "").trim();
        const request = Object.values(announcementState.replacementRequests || {}).find((item) => item?.dedupeKey === dedupeKey && item?.status === "open");
        if (!request) {
          return Response.json({ ok: true, found: false, closed: false, request: null });
        }
        request.status = "closed";
        request.closed_at = (/* @__PURE__ */ new Date()).toISOString();
        announcementState.replacementRequests[request.id] = request;
        await this.saveState(announcementState);
        console.log("request closed", { request_id: request.id, action: "test_reset" });
        return Response.json({ ok: true, found: true, closed: true, request });
      }
      if (action === "get_replacement_request") {
        const id = String(payload.id || "").trim();
        return Response.json({
          ok: true,
          request: id ? announcementState.replacementRequests[id] ?? null : null
        });
      }
      if (action === "set_replacement_coordinator_message") {
        const id = String(payload.id || "").trim();
        const request = id ? announcementState.replacementRequests[id] ?? null : null;
        if (!request) {
          return Response.json({ ok: true, found: false, request: null });
        }
        if (payload.chatId !== void 0 || payload.chat_id !== void 0) {
          request.coordinator_message_chat_id = payload.chatId ?? payload.chat_id ?? null;
        }
        if (payload.messageId !== void 0 || payload.message_id !== void 0) {
          request.coordinator_message_id = payload.messageId ?? payload.message_id ?? null;
        }
        if (payload.adminChatId !== void 0 || payload.admin_chat_id !== void 0) {
          request.admin_thread_message_chat_id = payload.adminChatId ?? payload.admin_chat_id ?? null;
        }
        if (payload.adminMessageId !== void 0 || payload.admin_message_id !== void 0) {
          request.admin_thread_message_id = payload.adminMessageId ?? payload.admin_message_id ?? null;
        }
        announcementState.replacementRequests[id] = request;
        await this.saveState(announcementState);
        return Response.json({ ok: true, found: true, request });
      }
      if (action === "add_replacement_responder") {
        const id = String(payload.id || "").trim();
        const responder = payload.responder && typeof payload.responder === "object" ? payload.responder : {};
        const request = id ? announcementState.replacementRequests[id] ?? null : null;
        if (!request) {
          return Response.json({ ok: true, found: false, added: false, closed: false, duplicate: false, request: null });
        }
        if (request.status !== "open") {
          console.log("closed request click", { request_id: id, user_id: responder.user_id || responder.userId || "" });
          return Response.json({ ok: true, found: true, added: false, closed: true, duplicate: false, request });
        }
        const userId = String(responder.user_id || responder.userId || "").trim();
        if (!userId) {
          return Response.json({ ok: false, error: "Не указан откликнувшийся админ." }, { status: 400 });
        }
        const responders = Array.isArray(request.responders) ? request.responders : [];
        if (responders.some((item) => String(item?.user_id || item?.userId || "").trim() === userId)) {
          console.log("duplicate click", { request_id: id, user_id: userId });
          request.responders = responders;
          return Response.json({ ok: true, found: true, added: false, closed: false, duplicate: true, request });
        }
        request.responders = [
          ...responders,
          {
            user_id: userId,
            private_chat_id: responder.private_chat_id || responder.privateChatId || responder.chatId || userId,
            username: responder.username || "",
            name: responder.name || "",
            responded_at: (/* @__PURE__ */ new Date()).toISOString()
          }
        ];
        announcementState.replacementRequests[id] = request;
        await this.saveState(announcementState);
        console.log("responder added", { request_id: id, user_id: userId, responders_count: request.responders.length });
        return Response.json({ ok: true, found: true, added: true, closed: false, duplicate: false, request });
      }
      if (action === "select_replacement_responder") {
        const id = String(payload.id || "").trim();
        const responderId = String(payload.responderId || "").trim();
        const request = id ? announcementState.replacementRequests[id] ?? null : null;
        if (!request) {
          return Response.json({ ok: true, found: false, selected: false, closed: false, request: null });
        }
        if (request.status !== "open") {
          console.log("duplicate click", { request_id: id, action: "select_closed", responder_id: responderId });
          return Response.json({ ok: true, found: true, selected: false, closed: true, request });
        }
        const responders = Array.isArray(request.responders) ? request.responders : [];
        const selected = responders.find((item) => String(item?.user_id || item?.userId || "").trim() === responderId);
        if (!selected) {
          return Response.json({ ok: false, error: "Не нашёл откликнувшегося админа." }, { status: 400 });
        }
        request.status = "selected";
        request.selected_responder_id = String(selected.user_id || selected.userId || "").trim();
        request.selected_responder_name = String(selected.name || selected.username || "").trim();
        request.selected_responder_username = String(selected.username || "").trim();
        request.selected_at = (/* @__PURE__ */ new Date()).toISOString();
        request.acknowledged_at = null;
        announcementState.replacementRequests[id] = request;
        await this.saveState(announcementState);
        console.log("replacement request selected", { request_id: id, selected_responder_id: request.selected_responder_id });
        return Response.json({ ok: true, found: true, selected: true, closed: false, request });
      }
      if (action === "acknowledge_replacement_request") {
        const id = String(payload.id || "").trim();
        const userId = String(payload.userId || "").trim();
        const request = id ? announcementState.replacementRequests[id] ?? null : null;
        if (!request) {
          return Response.json({ ok: true, found: false, acknowledged: false, closed: false, request: null });
        }
        if (request.status === "closed") {
          console.log("duplicate click", { request_id: id, action: "acknowledge_closed", user_id: userId });
          return Response.json({ ok: true, found: true, acknowledged: false, closed: true, alreadyClosed: true, request });
        }
        if (String(request.selected_responder_id || "").trim() !== userId) {
          return Response.json({ ok: false, error: "Подтверждать может только выбранный заменяющий." }, { status: 403 });
        }
        request.status = "closed";
        request.acknowledged_at = (/* @__PURE__ */ new Date()).toISOString();
        request.closed_at = request.acknowledged_at;
        announcementState.replacementRequests[id] = request;
        await this.saveState(announcementState);
        console.log("request acknowledged", { request_id: id, user_id: userId });
        return Response.json({ ok: true, found: true, acknowledged: true, closed: true, request });
      }
      if (action === "close_replacement_request") {
        const id = String(payload.id || "").trim();
        const userId = String(payload.userId || "").trim();
        const request = id ? announcementState.replacementRequests[id] ?? null : null;
        if (!request) {
          return Response.json({ ok: true, found: false, closed: false, request: null });
        }
        if (request.status !== "open") {
          console.log("duplicate click", { request_id: id, user_id: userId, action: "close_already_closed" });
          return Response.json({ ok: true, found: true, closed: false, alreadyClosed: true, request });
        }
        if (userId && String(request.original_user_id || "").trim() !== userId) {
          return Response.json({ ok: false, error: "Закрыть запрос может только служащий, который его открыл." }, { status: 403 });
        }
        request.status = "closed";
        request.closed_at = (/* @__PURE__ */ new Date()).toISOString();
        announcementState.replacementRequests[id] = request;
        await this.saveState(announcementState);
        console.log("request closed", { request_id: id, user_id: userId });
        return Response.json({ ok: true, found: true, closed: true, alreadyClosed: false, request });
      }
      return Response.json({ ok: false, error: "Неизвестное действие объявления." }, { status: 400 });
    } catch (error) {
      return Response.json({ ok: false, error: error.message }, { status: 400 });
    }
  }
};
function getAuthorLabel(message) {
  const first = message.from?.first_name ?? "";
  const last = message.from?.last_name ?? "";
  const fullName = `${first} ${last}`.trim();
  const username = message.from?.username ? `@${message.from.username}` : "";
  if (fullName && username) {
    return `${fullName} (${username})`;
  }
  if (fullName) {
    return fullName;
  }
  if (username) {
    return username;
  }
  if (message.sender_chat?.title) {
    return `\u043E\u0442 \u0438\u043C\u0435\u043D\u0438 \u0447\u0430\u0442\u0430: ${message.sender_chat.title}`;
  }
  return "\u043D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043E\u043F\u0440\u0435\u0434\u0435\u043B\u0438\u0442\u044C";
}
__name(getAuthorLabel, "getAuthorLabel");
async function enqueueZoomMessages(env, messages) {
  const cleanMessages = (Array.isArray(messages) ? messages : [messages]).map((message) => String(message || "").trim()).filter(Boolean);
  if (!cleanMessages.length) return null;
  return callAnnouncementState(env, "enqueue_zoom_messages", { messages: cleanMessages });
}
__name(enqueueZoomMessages, "enqueueZoomMessages");
async function enqueueZoomOnlyMessages(env, messages) {
  const cleanMessages = (Array.isArray(messages) ? messages : [messages]).map((message) => String(message || "").trim()).filter(Boolean);
  if (!cleanMessages.length) return null;
  return callAnnouncementState(env, "enqueue_zoom_only_messages", { messages: cleanMessages });
}
__name(enqueueZoomOnlyMessages, "enqueueZoomOnlyMessages");
function plainZoomText(text) {
  return String(text || "").replace(/\*\*([^*]+)\*\*/g, "$1").replace(/<br\s*\/?>/giu, "\n").replace(/<\/p>/giu, "\n\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
}
__name(plainZoomText, "plainZoomText");
function isManualZoomPart(text) {
  return /^\s*\u0427\u0430\u0441\u0442\u044C\s+\d+\/\d+:/iu.test(String(text || ""));
}
__name(isManualZoomPart, "isManualZoomPart");
function getZoomMeetingMessages(key) {
  const configured = ZOOM_MEETING_MESSAGE_TEXTS[key];
  const parts = Array.isArray(configured) ? configured : [configured];
  return parts.flatMap((part) => {
    const plain = plainZoomText(part);
    return isManualZoomPart(plain) ? [plain] : splitZoomText(plain);
  }).filter(Boolean);
}
__name(getZoomMeetingMessages, "getZoomMeetingMessages");
async function callZoomOnlyQueueState(env, queueAction, queuePayload = {}) {
  return callAnnouncementState(env, "zoom_only_queue", { queueAction, queuePayload });
}
__name(callZoomOnlyQueueState, "callZoomOnlyQueueState");
async function applyQueueResponse(env, result) {
  if (result.publishQueue) {
    let deletedPreviousMessage = true;
    if (result.previousMessageId) {
      const deleted = await deleteMessageSafe(env, CHAT_GROUP_ID, result.previousMessageId);
      deletedPreviousMessage = deleted;
      if (!deleted) {
        console.warn("queue previous message delete skipped", {
          chatId: CHAT_GROUP_ID,
          messageId: result.previousMessageId
        });
      }
    }
    const sent = await sendMessage(
      env,
      CHAT_GROUP_ID,
      result.queueText,
      null,
      null,
      buildQueuePublicKeyboard(),
      result.parseMode ?? "HTML",
      true
    );
    const messageId = sent.result?.message_id ?? null;
    if (!messageId && deletedPreviousMessage) {
      console.error("queue publish failed after deleting previous message", {
        chatId: CHAT_GROUP_ID,
        previousMessageId: result.previousMessageId
      });
    }
    await callQueueState(env, "set_message_id", {
      messageId
    });
    await enqueueZoomMessages(env, splitZoomText(result.queueText)).catch((error) => notifyOwnerTechError(env, {
      module: "Zoom",
      operation: "queue outbox",
      error,
      details: { source: "queue" },
      hint: "\u041E\u0447\u0435\u0440\u0435\u0434\u044C \u0432 Telegram \u0443\u0436\u0435 \u043E\u043F\u0443\u0431\u043B\u0438\u043A\u043E\u0432\u0430\u043D\u0430, \u043D\u043E Zoom-outbox \u043D\u0435 \u043F\u0440\u0438\u043D\u044F\u043B \u0442\u0435\u043A\u0441\u0442."
    }));
  }
  if (result.closeMessage) {
    await sendMessage(env, CHAT_GROUP_ID, result.closeMessage, null, null, null, null, true);
    await enqueueZoomMessages(env, splitZoomText(result.closeMessage)).catch(() => null);
  }
  if (result.cleared && result.previousMessageId) {
    const deletion = await deleteMessageResult(env, CHAT_GROUP_ID, result.previousMessageId);
    if (!deletion.ok) {
      await notifyOwnerTechError(env, {
        module: "\u043e\u0447\u0435\u0440\u0435\u0434\u044c",
        operation: "\u043e\u0447\u0438\u0441\u0442\u043a\u0430: \u0443\u0434\u0430\u043b\u0435\u043d\u0438\u0435 \u0441\u0442\u0430\u0440\u043e\u0433\u043e \u0441\u043e\u043e\u0431\u0449\u0435\u043d\u0438\u044f",
        error: deletion.error,
        details: { chat_id: CHAT_GROUP_ID, message_id: result.previousMessageId },
        hint: "\u041f\u0440\u043e\u0432\u0435\u0440\u044c \u043f\u0440\u0430\u0432\u0430 \u0431\u043e\u0442\u0430 \u043d\u0430 \u0443\u0434\u0430\u043b\u0435\u043d\u0438\u0435 \u0438 \u043e\u0447\u0438\u0441\u0442\u043a\u0443 \u043e\u0447\u0435\u0440\u0435\u0434\u0438."
      });
    }
  }
}
__name(applyQueueResponse, "applyQueueResponse");
async function sendAdminDigest(env, kind, author, originalText, tag) {
  return sendMessage(env, INFO_CHAT_ID, buildAdminDigest(kind, author, originalText, tag), ADMIN_THREAD_ID, null, null, null, shouldSilenceBotChat(INFO_CHAT_ID));
}
__name(sendAdminDigest, "sendAdminDigest");
async function sendAdminSignal(env, author, originalText, deleted = false) {
  return sendMessage(env, INFO_CHAT_ID, buildAdminSignal(author, originalText, deleted), ADMIN_THREAD_ID, null, null, null, shouldSilenceBotChat(INFO_CHAT_ID));
}
__name(sendAdminSignal, "sendAdminSignal");
async function sendAdminThreadMessage(env, text, disableNotification = true, replyMarkup = null) {
  return sendMessage(env, INFO_CHAT_ID, text, ADMIN_THREAD_ID, null, replyMarkup, null, disableNotification || shouldSilenceBotChat(INFO_CHAT_ID));
}
__name(sendAdminThreadMessage, "sendAdminThreadMessage");
async function isUserAdmin(env, userId, chatId = INFO_CHAT_ID, chatType = "") {
  if (isPrivateChat(chatType)) {
    const roles = await getPrivateRoles(env, userId);
    return Boolean(roles.isAdmin);
  }
  const targetChatId = chatId ?? INFO_CHAT_ID;
  try {
    const data = await callTelegram(env, "getChatMember", {
      chat_id: targetChatId,
      user_id: userId
    });
    const status = data.result?.status;
    return status === "creator" || status === "administrator";
  } catch {
    return false;
  }
}
__name(isUserAdmin, "isUserAdmin");
async function fetchJsonWithCache(url, cacheName) {
  const now = Date.now();
  if (cacheName === "yozhik" && yozhikCache && now - yozhikCacheTime < DATA_CACHE_TTL_MS) {
    return yozhikCache;
  }
  if (cacheName === "bill" && billCache && now - billCacheTime < DATA_CACHE_TTL_MS) {
    return billCache;
  }
  if (cacheName === "speaker_questions" && speakerQuestionsCache && now - speakerQuestionsCacheTime < DATA_CACHE_TTL_MS) {
    return speakerQuestionsCache;
  }
  const candidates = [url];
  const githubMatch = url.match(/^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/);
  if (githubMatch) {
    const [, owner, repo, ref, filePath] = githubMatch;
    candidates.push(`https://cdn.jsdelivr.net/gh/${owner}/${repo}@${ref}/${filePath}`);
  }
  let lastError = null;
  let data = null;
  for (const candidate of candidates) {
    try {
      const response = await fetch(candidate, {
        headers: {
          accept: "application/json"
        }
      });
      if (!response.ok) {
        lastError = new Error(`Не удалось загрузить ${cacheName}. HTTP ${response.status}`);
        continue;
      }
      data = await response.json();
      break;
    } catch (error) {
      lastError = error;
    }
  }
  if (!data) {
    throw lastError || new Error(`Не удалось загрузить ${cacheName}.`);
  }
  if (cacheName === "yozhik") {
    yozhikCache = data;
    yozhikCacheTime = now;
  }
  if (cacheName === "bill") {
    billCache = data;
    billCacheTime = now;
  }
  if (cacheName === "speaker_questions") {
    speakerQuestionsCache = data;
    speakerQuestionsCacheTime = now;
  }
  return data;
}
__name(fetchJsonWithCache, "fetchJsonWithCache");
function normalizeSpeakerQuestions(data) {
  const map = /* @__PURE__ */ new Map();
  if (Array.isArray(data)) {
    data.forEach((value, index) => {
      const question = compact(value || "");
      if (question) map.set(index + 1, question);
    });
    return map;
  }
  if (data && typeof data === "object") {
    for (const [key, value] of Object.entries(data)) {
      const number = Number(key);
      const question = compact(value || "");
      if (Number.isInteger(number) && number > 0 && question) map.set(number, question);
    }
  }
  return map;
}
__name(normalizeSpeakerQuestions, "normalizeSpeakerQuestions");
async function getSpeakerQuestions() {
  const data = await fetchJsonWithCache(SPEAKER_QUESTIONS_JSON_URL, "speaker_questions");
  const map = normalizeSpeakerQuestions(data);
  if (map.size) return map;
  throw new Error("speaker questions are empty");
}
__name(getSpeakerQuestions, "getSpeakerQuestions");

function getMoscowDateKey() {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "2-digit",
    month: "2-digit"
  }).format(/* @__PURE__ */ new Date());
}
__name(getMoscowDateKey, "getMoscowDateKey");
function getMoscowHumanDate() {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "numeric",
    month: "long"
  }).format(/* @__PURE__ */ new Date());
}
__name(getMoscowHumanDate, "getMoscowHumanDate");
function isMoscowTime(hour, minute) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Moscow",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(/* @__PURE__ */ new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return Number(values.hour) === hour && Number(values.minute) === minute;
}
__name(isMoscowTime, "isMoscowTime");
function getMoscowClock(date = /* @__PURE__ */ new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const hour = Number(values.hour);
  const minute = Number(values.minute);
  const weekday = new Date(Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day))).getUTCDay();
  return {
    dateKey: `${values.year}-${values.month}-${values.day}`,
    hour,
    minute,
    weekday,
    minutesOfDay: hour * 60 + minute
  };
}
__name(getMoscowClock, "getMoscowClock");
function isWithinMoscowWindow(clock, hour, minute, windowMinutes = 20) {
  const target = hour * 60 + minute;
  const delta = clock.minutesOfDay - target;
  return delta >= 0 && delta < windowMinutes;
}
__name(isWithinMoscowWindow, "isWithinMoscowWindow");
function getMoscowDateTimeText(date = /* @__PURE__ */ new Date()) {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date).replace(",", "") + " \u041c\u0421\u041a";
}
__name(getMoscowDateTimeText, "getMoscowDateTimeText");
function shortError(error) {
  const text = String(error?.message || error || "\u043d\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043d\u043e").replace(/\s+/g, " ").trim();
  return text.slice(0, 240);
}
__name(shortError, "shortError");
function getErrorCode(error) {
  const text = String(error?.message || error || "");
  const code = text.match(/"error_code"\s*:\s*(\d+)/)?.[1] || text.match(/\b(400|403|429|500|502|503|504)\b/)?.[1] || "error";
  return code;
}
__name(getErrorCode, "getErrorCode");
function safeTechDetails(details = {}) {
  return Object.entries(details).filter(([key]) => !/(?:text|message_text|body|content|personal|private)/iu.test(key)).map(([key, value]) => `${key}=${String(value ?? "").slice(0, 500)}`).join("\n") || "\u2014";
}
__name(safeTechDetails, "safeTechDetails");
async function notifyOwnerTechError(env, { module, operation, error, details = {}, hint = "\u041f\u0440\u043e\u0432\u0435\u0440\u044c \u043b\u043e\u0433\u0438, \u043f\u0440\u0430\u0432\u0430 \u0431\u043e\u0442\u0430 \u0438 \u0438\u0441\u0445\u043e\u0434\u043d\u044b\u0435 id." } = {}) {
  const ownerChatId = env?.OWNER_PRIVATE_CHAT_ID || env?.OWNER_USER_ID;
  if (!ownerChatId) return;
  const errorCode = getErrorCode(error);
  const noticeKey = `bot_error_notice:${module || "unknown"}:${operation || "unknown"}:${errorCode}`;
  const now = Date.now();
  try {
    const previous = await callAnnouncementState(env, "get", { key: noticeKey }).catch(() => ({ messageId: null }));
    if (previous?.messageId && now - Number(previous.messageId) < 30 * 60 * 1e3) {
      return;
    }
    await callAnnouncementState(env, "set_message_id", { key: noticeKey, messageId: now }).catch(() => null);
    const text = [
      "\u26a0\ufe0f \u0421\u0431\u043e\u0439 \u041d\u0430\u0444\u0430\u043d\u0438",
      "",
      `\u041c\u043e\u0434\u0443\u043b\u044c: ${module || "\u043d\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043d\u043e"}`,
      `\u041e\u043f\u0435\u0440\u0430\u0446\u0438\u044f: ${operation || "\u043d\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043d\u043e"}`,
      `\u0412\u0440\u0435\u043c\u044f: ${getMoscowDateTimeText()}`,
      `\u041e\u0448\u0438\u0431\u043a\u0430: ${shortError(error)}`,
      "",
      "\u0414\u0435\u0442\u0430\u043b\u0438:",
      safeTechDetails(details),
      "",
      "\u0427\u0442\u043e \u043f\u0440\u043e\u0432\u0435\u0440\u0438\u0442\u044c:",
      hint
    ].join("\n");
    await sendMessage(env, ownerChatId, text);
  } catch (noticeError) {
    console.error("owner tech notice failed", noticeError);
  }
}
__name(notifyOwnerTechError, "notifyOwnerTechError");
function normalizeServiceName(value) {
  return String(value || "").toLowerCase().replace(/\u0451/g, "\u0435").replace(/[^\p{L}\p{N}@._-]+/gu, " ").replace(/\s+/g, " ").trim();
}
__name(normalizeServiceName, "normalizeServiceName");
function isMissingServicePerson(value) {
  const text = normalizeServiceName(value);
  return !text || /^(?:-|n\/a|n\/d|null|none|\u043d\u0435\u0442|\u043d\u0435 \u0443\u043a\u0430\u0437\u0430\u043d|\u043d\u0435 \u0443\u043a\u0430\u0437\u0430\u043d\u043e|\u043d\/\u0434|\u0441\u0432\u043e\u0431\u043e\u0434\u043d\u043e)$/u.test(text);
}
__name(isMissingServicePerson, "isMissingServicePerson");
function parseServicePersonMapEnv(env) {
  const raw = String(env?.SERVICE_PERSON_MAP_JSON || "").trim();
  if (!raw) return [];
  try {
    const data = JSON.parse(raw);
    if (Array.isArray(data)) return data;
    if (data && typeof data === "object") {
      return Object.entries(data).map(([displayName, item]) => ({
        display_name: displayName,
        ...(item && typeof item === "object" ? item : { telegram_user_id: item })
      }));
    }
  } catch (error) {
    console.error("service person map parse failed", error);
  }
  return [];
}
__name(parseServicePersonMapEnv, "parseServicePersonMapEnv");
function serviceMapEntryFromSubscription(subscription) {
  const firstName = String(subscription?.firstName || "").trim();
  const lastName = String(subscription?.lastName || "").trim();
  const fullName = [firstName, lastName].filter(Boolean).join(" ");
  return {
    display_name: fullName || firstName || subscription?.username || subscription?.userId || "",
    telegram_user_id: subscription?.userId || null,
    private_chat_id: subscription?.chatId || subscription?.userId || null,
    username: subscription?.username || ""
  };
}
__name(serviceMapEntryFromSubscription, "serviceMapEntryFromSubscription");
function entryMatchesServiceName(entry, name) {
  const wanted = normalizeServiceName(name);
  if (!wanted) return false;
  const candidates = [
    entry?.display_name,
    entry?.displayName,
    entry?.name,
    entry?.firstName,
    [entry?.firstName, entry?.lastName].filter(Boolean).join(" "),
    entry?.username ? `@${entry.username}` : "",
    entry?.username
  ].map(normalizeServiceName).filter(Boolean);
  return candidates.some((candidate) => candidate === wanted || candidate.includes(wanted) || wanted.includes(candidate));
}
__name(entryMatchesServiceName, "entryMatchesServiceName");
async function buildServicePersonMap(env) {
  const fromEnv = parseServicePersonMapEnv(env);
  const subscriptions = await callPersonalDayState(env, "list_personal_subscriptions").catch(() => ({ subscriptions: [] }));
  return [...fromEnv, ...(subscriptions?.subscriptions || []).map(serviceMapEntryFromSubscription)];
}
__name(buildServicePersonMap, "buildServicePersonMap");
function resolveServicePerson(map, name) {
  const entry = map.find((item) => entryMatchesServiceName(item, name));
  if (!entry) return null;
  const username = String(entry.username || "").replace(/^@/u, "").trim();
  const linkedEntry = username
    ? map.find((item) => String(item?.username || "").replace(/^@/u, "").toLowerCase() === username.toLowerCase() && (item?.userId || item?.telegram_user_id || item?.chatId || item?.private_chat_id))
    : null;
  const source = linkedEntry || entry;
  const userId = source.telegram_user_id || source.telegramUserId || source.userId || source.user_id || null;
  const chatId = source.private_chat_id || source.privateChatId || source.chatId || source.chat_id || userId || null;
  return {
    displayName: source.display_name || source.displayName || source.name || entry.display_name || entry.displayName || entry.name || name,
    userId,
    chatId,
    username: source.username || username || ""
  };
}
__name(resolveServicePerson, "resolveServicePerson");
function formatServicePersonLabel(personName, personMap) {
  const raw = compact(personName || "");
  if (!raw) return "";
  const person = resolveServicePerson(personMap, raw);
  const displayName = compact(person?.displayName || raw);
  const username = String(person?.username || "").replace(/^@/u, "").trim();
  const handle = username ? `@${username}` : "";
  if (!handle) return displayName;
  return displayName.toLowerCase().includes(handle.toLowerCase()) ? displayName : `${displayName} ${handle}`;
}
__name(formatServicePersonLabel, "formatServicePersonLabel");
function normalizeServiceHeader(value) {
  return normalizeServiceName(value);
}
__name(normalizeServiceHeader, "normalizeServiceHeader");
function findServiceHeaderIndex(headerRow, variants) {
  const expected = variants.map(normalizeServiceHeader);
  for (let i = 0; i < headerRow.length; i += 1) {
    const header = normalizeServiceHeader(headerRow[i]);
    if (expected.some((variant) => header.includes(variant))) return i;
  }
  return -1;
}
__name(findServiceHeaderIndex, "findServiceHeaderIndex");
function parseScheduleDateKey(value, fallbackYear) {
  const text = String(value || "").trim();
  let match = text.match(/\b(\d{4})-(\d{2})-(\d{2})/);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  match = text.match(/\b(\d{1,2})[./](\d{1,2})(?:[./](\d{4}))?\b/);
  if (!match) return null;
  const day = String(match[1]).padStart(2, "0");
  const month = String(match[2]).padStart(2, "0");
  const year = match[3] || fallbackYear;
  return year ? `${year}-${month}-${day}` : null;
}
__name(parseScheduleDateKey, "parseScheduleDateKey");
function formatRuDate(dateKey) {
  const match = String(dateKey || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}.${match[2]}.${match[1]}` : String(dateKey || "");
}
__name(formatRuDate, "formatRuDate");
function findTodayServiceRow(schedule, dateKey) {
  const rows = schedule?.rows || [];
  if (rows.length < 2) return null;
  const headerRow = rows[0] || [];
  const year = String(dateKey || "").slice(0, 4);
  const idx = {
    date: findServiceHeaderIndex(headerRow, ["\u0414\u0430\u0442\u0430"]),
    weekday: findServiceHeaderIndex(headerRow, ["\u0414\u0435\u043d\u044c \u043d\u0435\u0434\u0435\u043b\u0438", "\u0414\u0435\u043d\u044c"]),
    topic: findServiceHeaderIndex(headerRow, ["\u0422\u0435\u043c\u0430 \u0441\u043e\u0431\u0440\u0430\u043d\u0438\u044f", "\u0422\u0435\u043c\u0430"]),
    leader: findServiceHeaderIndex(headerRow, SERVICE_REMINDER_ROLES.leader.headerVariants),
    tech: findServiceHeaderIndex(headerRow, SERVICE_REMINDER_ROLES.tech.headerVariants)
  };
  if (idx.date < 0) return null;
  const row = rows.slice(1).find((item) => parseScheduleDateKey(item?.[idx.date], year) === dateKey);
  return row ? { row, idx } : null;
}
__name(findTodayServiceRow, "findTodayServiceRow");
function serviceScheduleHasRows(schedule) {
  return Array.isArray(schedule?.rows) && schedule.rows.length >= 2;
}
__name(serviceScheduleHasRows, "serviceScheduleHasRows");
function buildServiceReminderKeyboard(dateKey, roleKey) {
  const callbackKey = SERVICE_REMINDER_ROLES[roleKey]?.callbackKey;
  return {
    inline_keyboard: [[
      { text: "\u041f\u043e\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0430\u044e", callback_data: `srv:ok:${dateKey}:${callbackKey}` },
      { text: "\u041d\u0443\u0436\u043d\u0430 \u0437\u0430\u043c\u0435\u043d\u0430", callback_data: `srv:replace:${dateKey}:${callbackKey}` }
    ]]
  };
}
__name(buildServiceReminderKeyboard, "buildServiceReminderKeyboard");
async function sendCoordinatorServiceNotice(env, text, replyMarkup = null) {
  let coordinatorChatId = env?.COORDINATOR_PRIVATE_CHAT_ID || env?.COORDINATOR_USER_ID;
  const coordinatorUsername = String(env?.COORDINATOR_USERNAME || "").replace(/^@/u, "").trim().toLowerCase();
  if (!coordinatorChatId && coordinatorUsername) {
    const subscriptions = await callPersonalDayState(env, "list_personal_subscriptions").catch(() => ({ subscriptions: [] }));
    const coordinator = (subscriptions?.subscriptions || []).find((item) => String(item?.username || "").replace(/^@/u, "").toLowerCase() === coordinatorUsername);
    coordinatorChatId = coordinator?.chatId || coordinator?.userId || null;
  }
  if (coordinatorChatId) {
    const result = await sendMessage(env, coordinatorChatId, text, null, null, replyMarkup).catch((error) => notifyOwnerTechError(env, {
      module: "\u043b\u0438\u0447\u043d\u044b\u0435 \u043d\u0430\u043f\u043e\u043c\u0438\u043d\u0430\u043d\u0438\u044f \u0441\u043b\u0443\u0436\u0430\u0449\u0438\u043c",
      operation: "\u0443\u0432\u0435\u0434\u043e\u043c\u043b\u0435\u043d\u0438\u0435 \u043a\u043e\u043e\u0440\u0434\u0438\u043d\u0430\u0442\u043e\u0440\u0443",
      error,
      details: { coordinator_chat_id: coordinatorChatId },
      hint: "\u041f\u0440\u043e\u0432\u0435\u0440\u044c COORDINATOR_PRIVATE_CHAT_ID/COORDINATOR_USER_ID."
    }));
    if (!result?.ok) return null;
    return { chatId: coordinatorChatId, result };
  }
  return null;
}
__name(sendCoordinatorServiceNotice, "sendCoordinatorServiceNotice");
async function isCoordinatorUser(env, userId) {
  const wantedId = String(userId || "").trim();
  if (!wantedId) return false;
  const configuredId = String(env?.COORDINATOR_USER_ID || env?.COORDINATOR_PRIVATE_CHAT_ID || "").trim();
  if (configuredId) return wantedId === configuredId;
  const coordinatorUsername = String(env?.COORDINATOR_USERNAME || "").replace(/^@/u, "").trim().toLowerCase();
  if (!coordinatorUsername) return false;
  const subscriptions = await callPersonalDayState(env, "list_personal_subscriptions").catch(() => ({ subscriptions: [] }));
  return (subscriptions?.subscriptions || []).some((item) => (
    String(item?.userId || item?.chatId || "").trim() === wantedId
    && String(item?.username || "").replace(/^@/u, "").trim().toLowerCase() === coordinatorUsername
  ));
}
__name(isCoordinatorUser, "isCoordinatorUser");
async function notifyServiceIssue(env, text) {
  await Promise.all([
    sendCoordinatorServiceNotice(env, text),
    sendAdminThreadMessage(env, text, true).catch((error) => notifyOwnerTechError(env, {
      module: "\u043b\u0438\u0447\u043d\u044b\u0435 \u043d\u0430\u043f\u043e\u043c\u0438\u043d\u0430\u043d\u0438\u044f \u0441\u043b\u0443\u0436\u0430\u0449\u0438\u043c",
      operation: "\u0443\u0432\u0435\u0434\u043e\u043c\u043b\u0435\u043d\u0438\u0435 \u0432 \u0410\u0434\u043c\u0438\u043d\u043a\u0443",
      error,
      details: { thread_id: ADMIN_THREAD_ID },
      hint: "\u041f\u0440\u043e\u0432\u0435\u0440\u044c INFO_CHAT_ID, ADMIN_THREAD_ID \u0438 \u043f\u0440\u0430\u0432\u0430 \u0431\u043e\u0442\u0430."
    }))
  ]);
}
__name(notifyServiceIssue, "notifyServiceIssue");
function buildCoordinatorServiceSummary(today, dateKey, personMap) {
  const row = today?.row || [];
  const idx = today?.idx || {};
  const leader = idx.leader >= 0 ? formatServicePersonLabel(row[idx.leader], personMap) : "";
  const tech = idx.tech >= 0 ? formatServicePersonLabel(row[idx.tech], personMap) : "";
  return [
    `\u0414\u0430\u0442\u0430: ${formatRuDate(dateKey)}`,
    `\u0414\u0435\u043d\u044c \u043d\u0435\u0434\u0435\u043b\u0438: ${idx.weekday >= 0 ? compact(row[idx.weekday] || "") : ""}`,
    `\u0422\u0435\u043c\u0430 \u0441\u043e\u0431\u0440\u0430\u043d\u0438\u044f: ${idx.topic >= 0 ? compact(row[idx.topic] || "") : ""}`,
    `\u0412\u0435\u0434\u0443\u0449\u0438\u0439: ${leader}`,
    `\u0422\u0435\u0445\u0432\u0435\u0434: ${tech}`
  ].join("\n");
}
__name(buildCoordinatorServiceSummary, "buildCoordinatorServiceSummary");
async function sendCoordinatorTodayServiceSummary(env, today, dateKey, personMap) {
  const key = `service_coordinator_summary_sent:${dateKey}`;
  const previous = await callAnnouncementState(env, "get", { key }).catch(() => ({ messageId: null }));
  if (previous?.messageId) return;
  const sent = await sendCoordinatorServiceNotice(env, buildCoordinatorServiceSummary(today, dateKey, personMap));
  if (!sent) {
    throw new Error("coordinator Telegram user_id not found");
  }
  await callAnnouncementState(env, "set_message_id", { key, messageId: Date.now() });
}
__name(sendCoordinatorTodayServiceSummary, "sendCoordinatorTodayServiceSummary");
function serviceReminderSentKey(dateKey, roleKey, personName) {
  return `service_reminder_sent:${dateKey}:${SERVICE_REMINDER_ROLES[roleKey]?.label || roleKey}:${personName}`;
}
__name(serviceReminderSentKey, "serviceReminderSentKey");
async function sendOneServiceReminder(env, dateKey, roleKey, personName, personMap) {
  const role = SERVICE_REMINDER_ROLES[roleKey];
  if (!role || isMissingServicePerson(personName)) {
    const vacancyText = roleKey === "leader"
      ? "\u0421\u0435\u0433\u043e\u0434\u043d\u044f \u043d\u0435\u0442 \u0432\u0435\u0434\u0443\u0449\u0435\u0433\u043e. \u0414\u043e\u0431\u0440\u043e\u0432\u043e\u043b\u044c\u0446\u044b?"
      : "\u0421\u0435\u0433\u043e\u0434\u043d\u044f \u043d\u0435\u0442 \u0442\u0435\u0445\u0432\u0435\u0434\u0430. \u0414\u043e\u0431\u0440\u043e\u0432\u043e\u043b\u044c\u0446\u044b?";
    await createVacancyReplacementRequest(env, {
      dateKey,
      roleKey: role?.callbackKey || roleKey,
      service: role?.label || roleKey,
      vacancyText
    }, callbackHandlerDeps);
    return;
  }
  const sentKey = serviceReminderSentKey(dateKey, roleKey, personName);
  const previous = await callAnnouncementState(env, "get", { key: sentKey }).catch(() => ({ messageId: null }));
  if (previous?.messageId) return;
  const person = resolveServicePerson(personMap, personName);
  if (!person?.chatId && !person?.userId) {
    const text = "\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u043e\u0442\u043f\u0440\u0430\u0432\u0438\u0442\u044c \u043d\u0430\u043f\u043e\u043c\u0438\u043d\u0430\u043d\u0438\u0435: \u043d\u0435 \u043d\u0430\u0439\u0434\u0435\u043d Telegram user_id \u0434\u043b\u044f {NAME}.".replace("{NAME}", personName);
    await notifyOwnerTechError(env, {
      module: "\u043b\u0438\u0447\u043d\u044b\u0435 \u043d\u0430\u043f\u043e\u043c\u0438\u043d\u0430\u043d\u0438\u044f \u0441\u043b\u0443\u0436\u0430\u0449\u0438\u043c",
      operation: "service_person_map",
      error: new Error("service person not found"),
      details: { display_name: personName, date: dateKey, service: role.label },
      hint: "\u0414\u043e\u0431\u0430\u0432\u044c \u0447\u0435\u043b\u043e\u0432\u0435\u043a\u0430 \u0432 SERVICE_PERSON_MAP_JSON \u0438\u043b\u0438 \u043f\u043e\u043f\u0440\u043e\u0441\u0438 \u0435\u0433\u043e \u043d\u0430\u043f\u0438\u0441\u0430\u0442\u044c \u0431\u043e\u0442\u0443 /start."
    });
    await sendAdminThreadMessage(env, text, true).catch(() => null);
    return;
  }
  const chatId = person.chatId || person.userId;
  try {
    await sendMessage(env, chatId, role.message, null, null, buildServiceReminderKeyboard(dateKey, roleKey));
    await callAnnouncementState(env, "set_message_id", { key: sentKey, messageId: Date.now() });
  } catch (error) {
    await notifyOwnerTechError(env, {
      module: "\u043b\u0438\u0447\u043d\u044b\u0435 \u043d\u0430\u043f\u043e\u043c\u0438\u043d\u0430\u043d\u0438\u044f \u0441\u043b\u0443\u0436\u0430\u0449\u0438\u043c",
      operation: "\u043e\u0442\u043f\u0440\u0430\u0432\u043a\u0430 \u043b\u0438\u0447\u043d\u043e\u0433\u043e \u043d\u0430\u043f\u043e\u043c\u0438\u043d\u0430\u043d\u0438\u044f",
      error,
      details: { display_name: personName, user_id: person.userId, chat_id: chatId, date: dateKey, service: role.label },
      hint: "\u041f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u0435\u043b\u044c \u043c\u043e\u0433 \u043d\u0435 \u043d\u0430\u0436\u0430\u0442\u044c /start, \u0437\u0430\u0431\u043b\u043e\u043a\u0438\u0440\u043e\u0432\u0430\u0442\u044c \u0431\u043e\u0442\u0430 \u0438\u043b\u0438 private_chat_id \u0443\u0441\u0442\u0430\u0440\u0435\u043b."
    });
  }
}
__name(sendOneServiceReminder, "sendOneServiceReminder");
async function sendManualServiceReminder(env, targetName, roleKey) {
  const role = SERVICE_REMINDER_ROLES[roleKey] || SERVICE_REMINDER_ROLES.leader;
  const clock = getMoscowClock();
  const personMap = await buildServicePersonMap(env);
  const person = resolveServicePerson(personMap, targetName);
  if (!person?.chatId && !person?.userId) {
    throw new Error(`service reminder test target not found: ${targetName}`);
  }
  await sendMessage(env, person.chatId || person.userId, role.message, null, null, buildServiceReminderKeyboard(clock.dateKey, role.key));
  return { dateKey: clock.dateKey, role: role.label, target: person.displayName || targetName };
}
__name(sendManualServiceReminder, "sendManualServiceReminder");
async function resetManualReplacementRequest(env, targetName, roleKey) {
  const role = SERVICE_REMINDER_ROLES[roleKey] || SERVICE_REMINDER_ROLES.leader;
  const clock = getMoscowClock();
  const personMap = await buildServicePersonMap(env);
  const person = resolveServicePerson(personMap, targetName);
  if (!person?.userId) {
    throw new Error(`replacement test target not found: ${targetName}`);
  }
  const dedupeKey = `${clock.dateKey}:${role.callbackKey}:${person.userId}`;
  const result = await callAnnouncementState(env, "close_open_replacement_request_by_dedupe", { dedupeKey });
  return { ...result, dateKey: clock.dateKey, role: role.label, target: person.displayName || targetName };
}
__name(resetManualReplacementRequest, "resetManualReplacementRequest");
async function getTodayServiceContext(env, { required = true } = {}) {
  const clock = getMoscowClock();
  const snapshot = await knowledgeRuntime.getSnapshot?.(env);
  if (!serviceScheduleHasRows(snapshot?.schedule)) {
    throw new Error("service schedule unavailable");
  }
  const today = findTodayServiceRow(snapshot?.schedule, clock.dateKey);
  if (!today) {
    if (!required) return null;
    throw new Error("today service schedule row not found");
  }
  const personMap = await buildServicePersonMap(env);
  return { clock, today, personMap };
}
__name(getTodayServiceContext, "getTodayServiceContext");
async function sendManualCoordinatorServiceSummary(env) {
  const { clock, today, personMap } = await getTodayServiceContext(env);
  await sendCoordinatorServiceNotice(env, buildCoordinatorServiceSummary(today, clock.dateKey, personMap));
  return { dateKey: clock.dateKey };
}
__name(sendManualCoordinatorServiceSummary, "sendManualCoordinatorServiceSummary");
async function sendTodayServiceReminders(env) {
  const context = await getTodayServiceContext(env, { required: false });
  if (!context) return false;
  const { clock, today, personMap } = context;
  await Promise.all([
    sendCoordinatorTodayServiceSummary(env, today, clock.dateKey, personMap),
    sendOneServiceReminder(env, clock.dateKey, "leader", compact(today.row[today.idx.leader] || ""), personMap),
    sendOneServiceReminder(env, clock.dateKey, "tech", compact(today.row[today.idx.tech] || ""), personMap)
  ]);
  return true;
}
__name(sendTodayServiceReminders, "sendTodayServiceReminders");
async function runScheduledTaskOncePerDay(env, taskKey, hour, minute, task, windowMinutes = 20) {
  const clock = getMoscowClock();
  if (!isWithinMoscowWindow(clock, hour, minute, windowMinutes)) {
    return false;
  }
  const stateKey = `scheduled_${taskKey}`;
  let previous = await callScheduleState(env, "get", { key: stateKey }).catch(() => ({ messageId: null }));
  if (!previous?.messageId) {
    const legacyPrevious = await callAnnouncementState(env, "get", { key: stateKey }).catch(() => ({ messageId: null }));
    if (legacyPrevious?.messageId) {
      previous = legacyPrevious;
      await callScheduleState(env, "set_message_id", {
        key: stateKey,
        messageId: legacyPrevious.messageId
      }).catch(() => null);
    }
  }
  if (previous?.messageId === clock.dateKey) {
    return false;
  }
  try {
    await task();
    await callScheduleState(env, "set_message_id", {
      key: stateKey,
      messageId: clock.dateKey
    });
    return true;
  } catch (error) {
    await notifyOwnerTechError(env, {
      module: "cron",
      operation: taskKey,
      error,
      details: { taskKey, hour, minute },
      hint: "\u041f\u0440\u043e\u0432\u0435\u0440\u044c cron-\u0437\u0430\u0434\u0430\u0447\u0443, Telegram API, \u044d\u0442\u0430\u043b\u043e\u043d\u043d\u044b\u0435 message_id \u0438 \u043f\u0440\u0430\u0432\u0430 \u0431\u043e\u0442\u0430."
    });
    return false;
  }
}
__name(runScheduledTaskOncePerDay, "runScheduledTaskOncePerDay");
async function runScheduledTaskOncePerWeekday(env, taskKey, weekday, hour, minute, task, windowMinutes = 20) {
  const clock = getMoscowClock();
  if (clock.weekday !== weekday) return false;
  return runScheduledTaskOncePerDay(env, taskKey, hour, minute, task, windowMinutes);
}
__name(runScheduledTaskOncePerWeekday, "runScheduledTaskOncePerWeekday");
function splitTitleAndBody(text) {
  const normalized = String(text || "").trim();
  const parts = normalized.split(/\n\s*\n/);
  const title = (parts.shift() || "").trim();
  const body = parts.join("\n\n").trim();
  return { title, body };
}
__name(splitTitleAndBody, "splitTitleAndBody");
async function sendYozhikToGroup(env, { disableNotification = true } = {}) {
  const messageText = await buildYozhikText();
  await sendMessage(env, CHAT_GROUP_ID, messageText, null, null, null, null, disableNotification || shouldSilenceBotChat(CHAT_GROUP_ID));
  return messageText;
}
__name(sendYozhikToGroup, "sendYozhikToGroup");
async function buildYozhikText() {
  const data = await fetchJsonWithCache(YOZHIK_JSON_URL, "yozhik");
  const key = getMoscowDateKey();
  const text = data[key];
  if (!text) {
    throw new Error(`\u041D\u0435 \u043D\u0430\u0448\u0451\u043B \u0401\u0436\u0438\u043A \u043D\u0430 \u0434\u0430\u0442\u0443 ${key}`);
  }
  const humanDate = getMoscowHumanDate();
  return `\u0415\u0436\u0435\u0434\u043D\u0435\u0432\u043D\u044B\u0435 \u0440\u0430\u0437\u043C\u044B\u0448\u043B\u0435\u043D\u0438\u044F \u043D\u0430 ${humanDate}

${text}`;
}
__name(buildYozhikText, "buildYozhikText");
function getAnnouncementKey(sourceMessageId) {
  if (sourceMessageId === INFO_CHANNEL_ANNOUNCEMENT_ID) {
    return "info_channel_announcement";
  }
  if (sourceMessageId === FREE_SERVICES_ANNOUNCEMENT_ID) {
    return "free_services_announcement";
  }
  if (sourceMessageId === MORNING_ANNOUNCEMENT_ID) {
    return "morning_announcement";
  }
  if (sourceMessageId === EVENING_ANNOUNCEMENT_ID) {
    return "evening_announcement";
  }
  return sourceMessageId ? `message_${sourceMessageId}` : null;
}
__name(getAnnouncementKey, "getAnnouncementKey");
function getLegacyAnnouncementKeys(sourceMessageId) {
  if (sourceMessageId === MORNING_ANNOUNCEMENT_ID) {
    return ["only_today_announcement"];
  }
  return [];
}
__name(getLegacyAnnouncementKeys, "getLegacyAnnouncementKeys");
function shouldSilenceAnnouncement(sourceMessageId) {
  return true;
}
__name(shouldSilenceAnnouncement, "shouldSilenceAnnouncement");
function parseUserIdSet(value) {
  return new Set(String(value || "").split(/[,\s]+/u).map((item) => item.trim()).filter(Boolean));
}
__name(parseUserIdSet, "parseUserIdSet");
function parseUsernameSet(value) {
  return new Set(String(value || "").split(/[,\s]+/u).map((item) => item.replace(/^@/u, "").trim().toLowerCase()).filter(Boolean));
}
__name(parseUsernameSet, "parseUsernameSet");
function isOwner(env, userId) {
  return String(env?.OWNER_USER_ID || "").trim() === String(userId || "").trim();
}
__name(isOwner, "isOwner");
function isAdminDmUser(env, userId, username = "") {
  const id = String(userId || "").trim();
  const name = String(username || "").replace(/^@/u, "").trim().toLowerCase();
  return Boolean(id) && (isOwner(env, id) || parseUserIdSet(env?.ADMIN_DM_USER_IDS).has(id) || Boolean(name && parseUsernameSet(env?.ADMIN_DM_USERNAMES).has(name)));
}
__name(isAdminDmUser, "isAdminDmUser");
function isAdminManagerUser(env, userId, username = "") {
  const id = String(userId || "").trim();
  const name = String(username || "").replace(/^@/u, "").trim().toLowerCase();
  return Boolean(id) && (isOwner(env, id) || parseUserIdSet(env?.ADMIN_MANAGER_USER_IDS).has(id) || Boolean(name && parseUsernameSet(env?.ADMIN_MANAGER_USERNAMES).has(name)));
}
__name(isAdminManagerUser, "isAdminManagerUser");
function isPrivateSubscriber(env, userId) {
  return Boolean(String(userId || "").trim());
}
__name(isPrivateSubscriber, "isPrivateSubscriber");
async function isDynamicAdminDmUser(env, userId) {
  const id = String(userId || "").trim();
  if (!id) return false;
  const result = await callPersonalDayState(env, "get_admin_dm_user", { userId: id }).catch(() => ({ admin: null }));
  return Boolean(result?.admin);
}
__name(isDynamicAdminDmUser, "isDynamicAdminDmUser");
async function getPrivateRoles(env, userId) {
  const id = String(userId || "").trim();
  const owner = isOwner(env, id);
  const [dynamicAdmin, subscriptionResult] = await Promise.all([
    isDynamicAdminDmUser(env, id),
    callPersonalDayState(env, "get_personal_subscription", { userId: id }).catch(() => ({ subscription: null }))
  ]);
  const username = subscriptionResult?.subscription?.username || "";
  const admin = owner || isAdminDmUser(env, id, username) || dynamicAdmin;
  const adminManager = owner || isAdminManagerUser(env, id, username);
  return {
    isOwner: owner,
    canManageAdmins: adminManager,
    isAdmin: admin,
    isSubscriber: Boolean(id)
  };
}
__name(getPrivateRoles, "getPrivateRoles");
async function isPersonalDayAllowed(env, userId) {
  const roles = await getPrivateRoles(env, userId);
  return roles.isSubscriber || roles.isAdmin;
}
__name(isPersonalDayAllowed, "isPersonalDayAllowed");
function buildPersonalDayUserSnapshot(message) {
  const from = message?.from || {};
  const chat = message?.chat || {};
  const userId = String(from.id || chat.id || "").trim();
  const chatId = chat.id ?? null;
  const username = from.username ? String(from.username) : "";
  const firstName = from.first_name ? String(from.first_name) : "";
  const lastName = from.last_name ? String(from.last_name) : "";
  return { userId, chatId, username, firstName, lastName };
}
__name(buildPersonalDayUserSnapshot, "buildPersonalDayUserSnapshot");
function isPersonalDayDeliveryFatal(error) {
  const text = String(error?.message || error || "");
  return /(?:bot was blocked|bot can't initiate conversation|chat not found|user is deactivated|Forbidden|blocked by the user)/iu.test(text);
}
__name(isPersonalDayDeliveryFatal, "isPersonalDayDeliveryFatal");
function buildPersonalDayAdminError(subscription, error) {
  const userId = subscription?.userId || "unknown";
  const chatId = subscription?.chatId || "unknown";
  const username = subscription?.username ? `@${subscription.username}` : "";
  return [
    "\u041b\u0438\u0447\u043d\u0430\u044f \u0440\u0430\u0441\u0441\u044b\u043b\u043a\u0430 10-11 \u0448\u0430\u0433\u0430 \u043e\u0442\u043a\u043b\u044e\u0447\u0435\u043d\u0430.",
    `user_id: ${userId}`,
    `chat_id: ${chatId}`,
    username ? `username: ${username}` : null,
    `error: ${String(error?.message || error || "\u043d\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043d\u043e")}`
  ].filter(Boolean).join("\n");
}
__name(buildPersonalDayAdminError, "buildPersonalDayAdminError");
async function disablePersonalDaySubscription(env, subscription, error = null) {
  if (!subscription?.userId) return;
  const next = {
    ...subscription,
    enabled: false,
    disabledAt: Date.now(),
    disableReason: error ? String(error?.message || error) : null
  };
  await callPersonalDayState(env, "set_personal_subscription", {
    userId: subscription.userId,
    subscription: next
  });
  if (error) {
    console.error("personal day delivery failed", { subscription, error });
    await notifyOwnerTechError(env, {
      module: "\u043b\u0438\u0447\u043d\u0430\u044f 10-11",
      operation: "\u043e\u0442\u043f\u0440\u0430\u0432\u043a\u0430 \u0438 \u0430\u0432\u0442\u043e\u043e\u0442\u043a\u043b\u044e\u0447\u0435\u043d\u0438\u0435",
      error,
      details: { user_id: subscription.userId, chat_id: subscription.chatId },
      hint: "\u041f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u0435\u043b\u044c \u043c\u043e\u0433 \u043d\u0435 \u043d\u0430\u0436\u0430\u0442\u044c /start, \u0437\u0430\u0431\u043b\u043e\u043a\u0438\u0440\u043e\u0432\u0430\u0442\u044c \u0431\u043e\u0442\u0430 \u0438\u043b\u0438 \u0447\u0430\u0442 \u0441\u0442\u0430\u043b \u043d\u0435\u0434\u043e\u0441\u0442\u0443\u043f\u0435\u043d."
    });
  }
}
__name(disablePersonalDaySubscription, "disablePersonalDaySubscription");
async function copyPersonalDayAnnouncement(env, subscription, sourceMessageId, silent) {
  return copyTechMessageToChat(env, subscription.chatId, INFO_CHAT_ID, sourceMessageId, silent);
}
__name(copyPersonalDayAnnouncement, "copyPersonalDayAnnouncement");
async function sendPersonalDayAnnouncement(env, sourceMessageId, silent = false) {
  const result = await callPersonalDayState(env, "list_personal_subscriptions");
  const subscriptions = (result.subscriptions || []).filter((subscription) => subscription?.enabled && subscription?.chatId);
  await Promise.all(subscriptions.map(async (subscription) => {
    try {
      await copyPersonalDayAnnouncement(env, subscription, sourceMessageId, silent);
    } catch (error) {
      if (isPersonalDayDeliveryFatal(error)) {
        await disablePersonalDaySubscription(env, subscription, error);
        return;
      }
      console.error("personal day delivery transient error", { subscription, error });
      await notifyOwnerTechError(env, {
        module: "\u043b\u0438\u0447\u043d\u0430\u044f 10-11",
        operation: "\u043e\u0442\u043f\u0440\u0430\u0432\u043a\u0430 copyMessage",
        error,
        details: { user_id: subscription.userId, chat_id: subscription.chatId, source_message_id: sourceMessageId },
        hint: "\u041f\u0440\u043e\u0432\u0435\u0440\u044c private_chat_id, \u044d\u0442\u0430\u043b\u043e\u043d\u043d\u043e\u0435 message_id \u0438 \u043f\u0440\u0430\u0432\u0430 \u0431\u043e\u0442\u0430."
      });
    }
  }));
}
__name(sendPersonalDayAnnouncement, "sendPersonalDayAnnouncement");
async function listAdminDmRecipients(env) {
  const result = await callPersonalDayState(env, "list_personal_subscriptions").catch(() => ({ subscriptions: [] }));
  const checks = await Promise.all((result.subscriptions || []).map(async (subscription) => {
    const roles = await getPrivateRoles(env, subscription?.userId);
    return subscription?.chatId && (roles.isAdmin || isAdminDmUser(env, subscription?.userId, subscription?.username)) ? subscription : null;
  }));
  return checks.filter(Boolean);
}
__name(listAdminDmRecipients, "listAdminDmRecipients");
async function sendAnnouncementCopyToGroup(env, sourceMessageId) {
  const key = getAnnouncementKey(sourceMessageId);
  const allKeys = [key, ...getLegacyAnnouncementKeys(sourceMessageId)].filter(Boolean);
  const previousItems = await Promise.all(
    allKeys.map(async (itemKey) => ({
      key: itemKey,
      messageId: (await callAnnouncementState(env, "get", { key: itemKey }).catch(() => ({ messageId: null })))?.messageId ?? null
    }))
  );
  let copied;
  try {
    copied = await copyTechMessageToGroup(env, CHAT_GROUP_ID, INFO_CHAT_ID, sourceMessageId, shouldSilenceAnnouncement(sourceMessageId) || shouldSilenceBotChat(CHAT_GROUP_ID));
  } catch (error) {
    await notifyOwnerTechError(env, {
      module: "\u0440\u0430\u0441\u043f\u0438\u0441\u0430\u043d\u0438\u0435",
      operation: "copyMessage \u044d\u0442\u0430\u043b\u043e\u043d\u043d\u043e\u0433\u043e \u0441\u043e\u043e\u0431\u0449\u0435\u043d\u0438\u044f",
      error,
      details: { source_chat_id: INFO_CHAT_ID, source_message_id: sourceMessageId, target_chat_id: CHAT_GROUP_ID },
      hint: "\u041f\u0440\u043e\u0432\u0435\u0440\u044c \u044d\u0442\u0430\u043b\u043e\u043d\u043d\u043e\u0435 \u0441\u043e\u043e\u0431\u0449\u0435\u043d\u0438\u0435, message_id \u0438 \u043f\u0440\u0430\u0432\u0430 \u0431\u043e\u0442\u0430."
    });
    throw error;
  }
  const nextMessageId = copied?.result?.message_id ?? null;
  if (key) {
    await callAnnouncementState(env, "set_message_id", {
      key,
      messageId: nextMessageId
    });
  }
  for (const item of previousItems) {
    if (item.key !== key) {
      await callAnnouncementState(env, "set_message_id", { key: item.key, messageId: null }).catch(() => null);
    }
    if (item.messageId && item.messageId !== nextMessageId) {
      const deletion = await deleteMessageResult(env, CHAT_GROUP_ID, item.messageId);
      if (!deletion.ok) {
        await notifyOwnerTechError(env, {
          module: "\u0440\u0430\u0441\u043f\u0438\u0441\u0430\u043d\u0438\u0435",
          operation: "\u0443\u0434\u0430\u043b\u0435\u043d\u0438\u0435 \u0441\u0442\u0430\u0440\u043e\u0433\u043e \u043e\u0431\u044a\u044f\u0432\u043b\u0435\u043d\u0438\u044f",
          error: deletion.error,
          details: { chat_id: CHAT_GROUP_ID, message_id: item.messageId, key: item.key },
          hint: "\u041f\u0440\u043e\u0432\u0435\u0440\u044c, \u0435\u0441\u0442\u044c \u043b\u0438 \u0443 \u0431\u043e\u0442\u0430 \u043f\u0440\u0430\u0432\u043e \u0443\u0434\u0430\u043b\u044f\u0442\u044c \u044d\u0442\u043e \u0441\u043e\u043e\u0431\u0449\u0435\u043d\u0438\u0435."
        });
      }
    }
  }
  const zoomKey = getZoomMeetingKeyBySourceMessageId(sourceMessageId);
  if (zoomKey) {
    await enqueueZoomMessages(env, getZoomMeetingMessages(zoomKey)).catch((error) => notifyOwnerTechError(env, {
      module: "Zoom",
      operation: "meeting outbox",
      error,
      details: { source_message_id: sourceMessageId, zoom_key: zoomKey },
      hint: "\u0421\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0435 \u0432 Telegram \u0443\u0448\u043B\u043E, \u043D\u043E \u0432 Zoom-outbox \u043D\u0435 \u043F\u043E\u043F\u0430\u043B\u043E."
    }));
  }
  return copied;
}
__name(sendAnnouncementCopyToGroup, "sendAnnouncementCopyToGroup");
async function sendTechMessageCopyToInfoThread(env, sourceMessageId, targetThreadId, disableNotification = false) {
  try {
    return await callTelegram(env, "copyMessage", {
      chat_id: INFO_CHAT_ID,
      from_chat_id: INFO_CHAT_ID,
      message_id: sourceMessageId,
      message_thread_id: targetThreadId,
      disable_notification: disableNotification || shouldSilenceBotChat(INFO_CHAT_ID)
    });
  } catch (error) {
    await notifyOwnerTechError(env, {
      module: "\u0440\u0430\u0441\u043f\u0438\u0441\u0430\u043d\u0438\u0435",
      operation: "copyMessage \u0432 \u0442\u0435\u043c\u0443 \u0418\u041d\u0424\u041e",
      error,
      details: { source_chat_id: INFO_CHAT_ID, source_message_id: sourceMessageId, target_chat_id: INFO_CHAT_ID, target_thread_id: targetThreadId },
      hint: "\u041f\u0440\u043e\u0432\u0435\u0440\u044c message_id, id \u0442\u0435\u043c\u044b \u0438 \u043f\u0440\u0430\u0432\u0430 \u0431\u043e\u0442\u0430."
    });
    throw error;
  }
}
__name(sendTechMessageCopyToInfoThread, "sendTechMessageCopyToInfoThread");
async function sendBillToGroup(env, billNumber, { disableNotification = true } = {}) {
  const messageText = await buildBillText(billNumber);
  await sendMessage(env, CHAT_GROUP_ID, messageText, null, null, null, null, disableNotification || shouldSilenceBotChat(CHAT_GROUP_ID));
  return messageText;
}
__name(sendBillToGroup, "sendBillToGroup");
async function buildBillText(billNumber) {
  if (!Number.isInteger(billNumber) || billNumber < 1 || billNumber > 332) {
    throw new Error("\u041D\u043E\u043C\u0435\u0440 \u043E\u0442\u0440\u044B\u0432\u043A\u0430 \u0411\u0438\u043B\u043B\u0430 \u0434\u043E\u043B\u0436\u0435\u043D \u0431\u044B\u0442\u044C \u043E\u0442 1 \u0434\u043E 332.");
  }
  const data = await fetchJsonWithCache(BILL_JSON_URL, "bill");
  const text = data[String(billNumber)];
  if (!text) {
    throw new Error(`\u041D\u0435 \u043D\u0430\u0448\u0451\u043B \u043E\u0442\u0440\u044B\u0432\u043E\u043A \u0411\u0438\u043B\u043B\u0430 \u2116${billNumber}`);
  }
  const { title, body } = splitTitleAndBody(text);
  const header = title ? `\u041A\u0430\u043A \u044D\u0442\u043E \u0432\u0438\u0434\u0438\u0442 \u0411\u0438\u043B\u043B. \u2116${billNumber}. ${title}` : `\u041A\u0430\u043A \u044D\u0442\u043E \u0432\u0438\u0434\u0438\u0442 \u0411\u0438\u043B\u043B. \u2116${billNumber}`;
  return body ? `${header}

${body}` : `${header}

${text}`;
}
__name(buildBillText, "buildBillText");
function isZoomBridgeAuthorized(request, env) {
  const expected = String(env?.ZOOM_BRIDGE_SECRET || "").trim();
  if (!expected) return false;
  const actual = String(request.headers.get("x-nafanya-zoom-secret") || "").trim();
  return actual && actual === expected;
}
__name(isZoomBridgeAuthorized, "isZoomBridgeAuthorized");
function getZoomPanelToken(env) {
  return String(env?.ZOOM_PANEL_TOKEN || env?.ZOOM_V2_PANEL_TOKEN || env?.ZOOM_BRIDGE_SECRET || "").trim();
}
__name(getZoomPanelToken, "getZoomPanelToken");
function parseCookieHeader(header) {
  return Object.fromEntries(String(header || "").split(";").map((part) => {
    const index = part.indexOf("=");
    if (index === -1) return null;
    return [part.slice(0, index).trim(), part.slice(index + 1).trim()];
  }).filter(Boolean));
}
__name(parseCookieHeader, "parseCookieHeader");
function getZoomPanelRequestToken(request) {
  const url = new URL(request.url);
  const cookies = parseCookieHeader(request.headers.get("cookie"));
  return String(
    request.headers.get("x-nafanya-zoom-panel-token") || request.headers.get("x-nafanya-zoom-secret") || url.searchParams.get("token") || cookies.nafanya_zoom_panel_token || ""
  ).trim();
}
__name(getZoomPanelRequestToken, "getZoomPanelRequestToken");
function isZoomPanelAuthorized(request, env) {
  const expected = getZoomPanelToken(env);
  if (!expected) return false;
  const actual = getZoomPanelRequestToken(request);
  return actual && actual === expected;
}
__name(isZoomPanelAuthorized, "isZoomPanelAuthorized");
function zoomPanelUnauthorizedResponse() {
  return Response.json({ ok: false, error: "\u041d\u0443\u0436\u0435\u043d \u0442\u043e\u043a\u0435\u043d \u043f\u0443\u043b\u044c\u0442\u0430 Zoom." }, { status: 401 });
}
__name(zoomPanelUnauthorizedResponse, "zoomPanelUnauthorizedResponse");
function buildZoomMessage(payload) {
  const name = getZoomPayloadDisplayName(payload);
  return {
    text: String(payload?.text || payload?.message || "").trim(),
    message_id: payload?.messageId || payload?.id || getCurrentTimestamp(),
    chat: { id: "zoom", type: "zoom" },
    from: { first_name: name }
  };
}
__name(buildZoomMessage, "buildZoomMessage");
function isZoomAdminPayload(payload) {
  const user = payload?.user || payload?.from || {};
  const role = String(user.role || payload?.role || "").toLowerCase();
  return Boolean(user.isHost || user.isCoHost || payload?.isHost || payload?.isCoHost || ["host", "cohost", "co-host", "organizer", "coorganizer"].includes(role));
}
__name(isZoomAdminPayload, "isZoomAdminPayload");
function getZoomAdminNames(env) {
  return String(env?.ZOOM_ADMIN_NAMES || "").split(/[,;\n]/u).map((name) => normalizeZoomCommand(name)).filter(Boolean);
}
__name(getZoomAdminNames, "getZoomAdminNames");
function isZoomAdminName(env, name) {
  const normalizedName = normalizeZoomCommand(name);
  if (!normalizedName) return false;
  const normalizedWithoutParentheses = normalizedName.replace(/\s*\([^)]*\)\s*$/u, "").trim();
  const normalizedWithoutEllipsis = normalizedWithoutParentheses.replace(/(?:\.\.\.|…)\s*$/u, "").trim();
  const adminNames = getZoomAdminNames(env);
  return adminNames.some((adminName) => {
    if (adminName === normalizedName || adminName === normalizedWithoutParentheses || adminName === normalizedWithoutEllipsis) {
      return true;
    }
    return normalizedWithoutEllipsis.length >= 6 && adminName.startsWith(normalizedWithoutEllipsis);
  });
}
__name(isZoomAdminName, "isZoomAdminName");
function normalizeZoomCommand(text) {
  return normalizeQueueText(text).replace(/[.!?,:;]+$/u, "").replace(/\s+/g, " ").trim();
}
__name(normalizeZoomCommand, "normalizeZoomCommand");
function parseZoomManualQueueCommand(text) {
  const normalized = normalizeZoomCommand(text);
  const removeMatch = normalized.match(/^(?:\u0443\u0434\u0430\u043B\u0438\u0442\u044C|\u0443\u0434\u0430\u043B\u0438|\u0443\u0431\u0440\u0430\u0442\u044C|\u0443\u0431\u0435\u0440\u0438)(?:\s+(\d{1,3}))?$/u);
  if (removeMatch) return { action: "remove", index: removeMatch[1] ? Number(removeMatch[1]) : null };
  const addMatch = normalized.match(/^(?:\u0434\u043E\u0431\u0430\u0432\u044C|\u0434\u043E\u0431\u0430\u0432\u0438\u0442\u044C)\s+(.+)$/u);
  if (!addMatch) return null;
  const body = addMatch[1].trim();
  const gameMatch = body.match(/^(?:\u0438\u0433\u0440\u0430|\u0438\u0440\u0433\u0430|\u0432\u043E\u043F\u0440\u043E\u0441)\s+(\d{1,3})\s+(.+)$/u);
  if (gameMatch) return { action: "add_game", number: Number(gameMatch[1]), author: stripTelegramHandles(gameMatch[2]) };
  const codeMatch = body.match(/^(111|222|333|444)\s+(.+)$/u);
  if (codeMatch) return { action: "add_code", code: codeMatch[1], author: stripTelegramHandles(codeMatch[2]) };
  return { action: "invalid_add" };
}
__name(parseZoomManualQueueCommand, "parseZoomManualQueueCommand");
async function publishMeetingFromZoomCommand(env, key) {
  if (key === "yozhik") {
    const messageText = await sendYozhikToGroup(env);
    await enqueueZoomMessages(env, splitZoomText(messageText));
    return { ok: true, handled: true };
  }
  if (key === "bill_prompt") {
    await enqueueZoomMessages(env, ["\u0411\u0438\u043B\u043B: \u0432\u0432\u0435\u0434\u0438 \u043D\u043E\u043C\u0435\u0440 \u043E\u0442\u0440\u044B\u0432\u043A\u0430 \u043E\u0442 1 \u0434\u043E 332."]);
    await sendMessage(env, CHAT_GROUP_ID, "\u0412\u0432\u0435\u0434\u0438 \u043D\u043E\u043C\u0435\u0440 \u043E\u0442\u0440\u044B\u0432\u043A\u0430 \u0411\u0438\u043B\u043B\u0430.", null, null, null, null, true);
    return { ok: true, handled: true };
  }
  if (key === "today_topic") {
    const sourceMessageId = getTodayTopicSourceMessageId();
    if (!sourceMessageId) {
      await enqueueZoomMessages(env, ["\u0421\u0435\u0433\u043E\u0434\u043D\u044F \u0441\u043E\u0431\u0440\u0430\u043D\u0438\u044F \u043D\u0435\u0442."]);
      return { ok: true, handled: true };
    }
    await copyTechMessageToGroup(env, CHAT_GROUP_ID, INFO_CHAT_ID, sourceMessageId, true);
    await enqueueZoomMessages(env, getTodayTopicZoomMessages());
    return { ok: true, handled: true };
  }
  const sourceMessageId = TECH_MESSAGES[key];
  if (!sourceMessageId) return { ok: false, handled: false, error: "\u041D\u0435 \u043D\u0430\u0448\u0451\u043B \u044D\u0442\u043E \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0435." };
  if (sourceMessageId === INFO_CHANNEL_ANNOUNCEMENT_ID || sourceMessageId === FREE_SERVICES_ANNOUNCEMENT_ID) {
    await sendAnnouncementCopyToGroup(env, sourceMessageId);
  } else {
    await copyTechMessageToGroup(env, CHAT_GROUP_ID, INFO_CHAT_ID, sourceMessageId, true);
    await enqueueZoomMessages(env, getZoomMeetingMessages(key));
  }
  return { ok: true, handled: true };
}
__name(publishMeetingFromZoomCommand, "publishMeetingFromZoomCommand");
async function handleZoomBridgeMessage(env, payload) {
  const message = buildZoomMessage(payload);
  const text = message.text;
  if (!text) return { ok: true, handled: false };
  const queueInfo = await callQueueState(env, "get");
  const isAdmin = isZoomAdminPayload(payload);
  const normalized = normalizeZoomCommand(text);
  const openMode = getZoomOpenQueueMode(text);
  if (openMode) {
    if (!isAdmin) {
      await enqueueZoomMessages(env, ["\u042D\u0442\u0430 \u043A\u043E\u043C\u0430\u043D\u0434\u0430 \u0442\u043E\u043B\u044C\u043A\u043E \u0434\u043B\u044F \u043E\u0440\u0433\u0430\u043D\u0438\u0437\u0430\u0442\u043E\u0440\u0430 \u0438 \u0441\u043E\u043E\u0440\u0433\u0430\u043D\u0438\u0437\u0430\u0442\u043E\u0440\u043E\u0432."]);
      return { ok: true, handled: true, denied: true };
    }
    const result = await callQueueState(env, "open", { mode: openMode });
    await applyQueueResponse(env, result);
    return { ok: true, handled: true };
  }
  const meetingKey = ZOOM_MEETING_COMMANDS[normalized] || null;
  if (meetingKey) {
    if (!isAdmin) {
      await enqueueZoomMessages(env, ["\u042D\u0442\u0430 \u043A\u043E\u043C\u0430\u043D\u0434\u0430 \u0442\u043E\u043B\u044C\u043A\u043E \u0434\u043B\u044F \u043E\u0440\u0433\u0430\u043D\u0438\u0437\u0430\u0442\u043E\u0440\u0430 \u0438 \u0441\u043E\u043E\u0440\u0433\u0430\u043D\u0438\u0437\u0430\u0442\u043E\u0440\u043E\u0432."]);
      return { ok: true, handled: true, denied: true };
    }
    return publishMeetingFromZoomCommand(env, meetingKey);
  }
  const zoomBillNumber = parseBillInput(text);
  if (zoomBillNumber !== null && /^\/?\u0431\u0438\u043B\u043B\s+\d{1,3}$/iu.test(text.trim())) {
    if (!isAdmin) {
      await enqueueZoomMessages(env, ["\u042D\u0442\u0430 \u043A\u043E\u043C\u0430\u043D\u0434\u0430 \u0442\u043E\u043B\u044C\u043A\u043E \u0434\u043B\u044F \u043E\u0440\u0433\u0430\u043D\u0438\u0437\u0430\u0442\u043E\u0440\u0430 \u0438 \u0441\u043E\u043E\u0440\u0433\u0430\u043D\u0438\u0437\u0430\u0442\u043E\u0440\u043E\u0432."]);
      return { ok: true, handled: true, denied: true };
    }
    const messageText = await sendBillToGroup(env, zoomBillNumber);
    await enqueueZoomMessages(env, splitZoomText(messageText));
    return { ok: true, handled: true };
  }
  if (isAdmin) {
    const manual = parseZoomManualQueueCommand(text);
    if (manual) {
      if (!queueInfo.state?.isOpen || !queueInfo.state?.mode) {
        await enqueueZoomMessages(env, ["\u041E\u0447\u0435\u0440\u0435\u0434\u044C \u0441\u0435\u0439\u0447\u0430\u0441 \u0437\u0430\u043A\u0440\u044B\u0442\u0430."]);
        return { ok: true, handled: true };
      }
      if (manual.action === "remove") {
        const result = manual.index ? await callQueueState(env, "remove_by_number", { index: manual.index }) : await callQueueState(env, "remove");
        await applyQueueResponse(env, result);
        return { ok: true, handled: true };
      }
      if (manual.action === "add_code" && manual.author) {
        const label = queueInfo.state.mode === "bill" ? manual.code : "111";
        const entry = makeManualQueueEntryCore(manual.author, queueInfo.state.mode === "bill" ? (manual.code === "111" ? "first" : manual.code) : queueInfo.state.mode, label, text, { source: "Zoom" });
        const result = await callQueueState(env, "add", { entry });
        await applyQueueResponse(env, result);
        return { ok: true, handled: true };
      }
      if (manual.action === "add_game" && manual.author) {
        if (queueInfo.state.mode !== "bill") {
          await enqueueZoomMessages(env, ["\u0418\u0433\u0440\u0443 \u043C\u043E\u0436\u043D\u043E \u0434\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u0442\u043E\u043B\u044C\u043A\u043E \u0432 \u043E\u0447\u0435\u0440\u0435\u0434\u0438 \u0411\u0438\u043B\u043B."]);
          return { ok: true, handled: true };
        }
        const speakerQuestions = await getSpeakerQuestions();
        const question = speakerQuestions.get(manual.number);
        if (!question) {
          await enqueueZoomMessages(env, [`\u041D\u0435 \u043D\u0430\u0448\u0451\u043B \u0432\u043E\u043F\u0440\u043E\u0441 ${manual.number}.`]);
          return { ok: true, handled: true };
        }
        const entry = makeManualQueueEntryCore(manual.author, "first", `\u0438\u0433\u0440\u0430 ${manual.number}`, text, { source: "Zoom" });
        const result = await callQueueState(env, "add", { entry });
        await applyQueueResponse(env, result);
        const questionText = `\u0412\u043E\u043F\u0440\u043E\u0441 ${manual.number}:\n\n${question}`;
        await sendMessage(env, CHAT_GROUP_ID, questionText, null, null, null, null, true);
        await enqueueZoomMessages(env, splitZoomText(questionText));
        return { ok: true, handled: true };
      }
      await enqueueZoomMessages(env, ["\u041A\u043E\u043C\u0430\u043D\u0434\u0430 \u0434\u043E\u0431\u0430\u0432\u043B\u0435\u043D\u0438\u044F \u043D\u0435 \u043F\u043E\u043D\u044F\u0442\u043D\u0430."]);
      return { ok: true, handled: true };
    }
    if (normalized === "\u0432\u044B\u0441\u043A\u0430\u0437\u0430\u043B\u0441\u044F") {
      const result = await callQueueState(env, "done");
      await applyQueueResponse(env, result);
      return { ok: true, handled: true };
    }
    if (normalized === "\u043F\u0440\u043E\u043F\u0443\u0441\u043A\u0430\u0435\u0442") {
      const result = await callQueueState(env, "skip");
      await applyQueueResponse(env, result);
      return { ok: true, handled: true };
    }
    if (normalized === "\u043E\u0442\u043C\u0435\u043D\u0438\u0442\u044C") {
      const result = await callQueueState(env, "undo");
      await applyQueueResponse(env, result);
      return { ok: true, handled: true };
    }
    if (normalized === "\u0437\u0430\u043A\u0440\u044B\u0442\u044C \u043E\u0447\u0435\u0440\u0435\u0434\u044C") {
      const result = await callQueueState(env, "close");
      await applyQueueResponse(env, result);
      return { ok: true, handled: true };
    }
  }
  if (normalized === "\u043E\u0447\u0435\u0440\u0435\u0434\u044C") {
    await enqueueZoomMessages(env, splitZoomText(buildQueueTextCore(queueInfo.state || createEmptyQueueState())));
    return { ok: true, handled: true };
  }
  const gameNumber = parseGameCommandCore(text);
  if (gameNumber !== null) {
    const speakerQuestions = await getSpeakerQuestions();
    const question = speakerQuestions.get(gameNumber);
    if (question) {
      const questionText = `\u0412\u043E\u043F\u0440\u043E\u0441 ${gameNumber}:\n\n${question}`;
      await sendMessage(env, CHAT_GROUP_ID, questionText, null, null, null, null, true);
      await enqueueZoomMessages(env, splitZoomText(questionText));
      return { ok: true, handled: true };
    } else {
      await enqueueZoomMessages(env, [`\u041D\u0435 \u043D\u0430\u0448\u0451\u043B \u0432\u043E\u043F\u0440\u043E\u0441 ${gameNumber}.`]);
      return { ok: true, handled: true };
    }
  }
  const entry = parseQueueEntryCore(message, queueInfo.state, { source: "Zoom" });
  if (entry) {
    const result = await callQueueState(env, "add", { entry });
    await applyQueueResponse(env, result);
    return { ok: true, handled: true };
  }
  return { ok: true, handled: false };
}
__name(handleZoomBridgeMessage, "handleZoomBridgeMessage");
async function applyZoomOnlyQueueResponse(env, result) {
  if (result.publishQueue && result.queueText) {
    await enqueueZoomOnlyMessages(env, splitZoomText(result.queueText));
  }
  if (result.closeMessage) {
    await enqueueZoomOnlyMessages(env, splitZoomText(result.closeMessage));
  }
}
__name(applyZoomOnlyQueueResponse, "applyZoomOnlyQueueResponse");
async function publishZoomOnlyMeetingCommand(env, key) {
  if (key === "yozhik") {
    const messageText = await buildYozhikText();
    await enqueueZoomOnlyMessages(env, splitZoomText(messageText));
    return { ok: true, handled: true };
  }
  if (key === "bill_prompt") {
    await enqueueZoomOnlyMessages(env, ["\u0411\u0438\u043B\u043B: \u0432\u0432\u0435\u0434\u0438 \u043D\u043E\u043C\u0435\u0440 \u043E\u0442\u0440\u044B\u0432\u043A\u0430 \u043E\u0442 1 \u0434\u043E 332."]);
    return { ok: true, handled: true };
  }
  if (key === "today_topic") {
    const messages = getTodayTopicSourceMessageId() ? getTodayTopicZoomMessages() : ["\u0421\u0435\u0433\u043E\u0434\u043D\u044F \u0441\u043E\u0431\u0440\u0430\u043D\u0438\u044F \u043D\u0435\u0442."];
    await enqueueZoomOnlyMessages(env, messages);
    return { ok: true, handled: true };
  }
  if (!ZOOM_MEETING_MESSAGE_TEXTS[key]) {
    return { ok: false, handled: false, error: "\u041D\u0435 \u043D\u0430\u0448\u0451\u043B \u044D\u0442\u043E Zoom-\u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0435." };
  }
  await enqueueZoomOnlyMessages(env, getZoomMeetingMessages(key));
  return { ok: true, handled: true };
}
__name(publishZoomOnlyMeetingCommand, "publishZoomOnlyMeetingCommand");
async function handleZoomOnlyMessage(env, payload) {
  const displayName = getZoomPayloadDisplayName(payload);
  if (normalizeZoomCommand(displayName) === normalizeZoomCommand(ZOOM_BOT_NAME)) {
    return { ok: true, handled: false, ignored: "self" };
  }
  if (looksLikeZoomOnlyBotEcho(displayName) || looksLikeZoomOnlyBotEcho(payload?.sender) || looksLikeZoomOnlyBotEcho(payload?.senderName)) {
    return { ok: true, handled: false, ignored: "self_echo" };
  }
  const message = buildZoomMessage(payload);
  const text = message.text;
  if (!text) return { ok: true, handled: false };
  if (looksLikeZoomOnlyBotEcho(text)) {
    return { ok: true, handled: false, ignored: "self_echo" };
  }
  const queueInfo = await callZoomOnlyQueueState(env, "get");
  const isAdmin = Boolean(payload?.isZoomOnlyAppControl) || isZoomAdminPayload(payload) || isZoomAdminName(env, displayName) || payload?.source === "zoom_web_client";
  const normalized = normalizeZoomCommand(text);
  const openMode = getZoomOpenQueueMode(text);
  if (openMode) {
    if (!isAdmin) {
      await enqueueZoomOnlyMessages(env, ["\u042D\u0442\u0430 \u043A\u043E\u043C\u0430\u043D\u0434\u0430 \u0442\u043E\u043B\u044C\u043A\u043E \u0434\u043B\u044F \u043E\u0440\u0433\u0430\u043D\u0438\u0437\u0430\u0442\u043E\u0440\u0430 \u0438 \u0441\u043E\u043E\u0440\u0433\u0430\u043D\u0438\u0437\u0430\u0442\u043E\u0440\u043E\u0432."]);
      return { ok: true, handled: true, denied: true };
    }
    const result = await callZoomOnlyQueueState(env, "open", { mode: openMode });
    await applyZoomOnlyQueueResponse(env, result);
    return { ok: true, handled: true };
  }
  const meetingKey = ZOOM_MEETING_COMMANDS[normalized] || null;
  if (meetingKey) {
    if (!isAdmin) {
      await enqueueZoomOnlyMessages(env, ["\u042D\u0442\u0430 \u043A\u043E\u043C\u0430\u043D\u0434\u0430 \u0442\u043E\u043B\u044C\u043A\u043E \u0434\u043B\u044F \u043E\u0440\u0433\u0430\u043D\u0438\u0437\u0430\u0442\u043E\u0440\u0430 \u0438 \u0441\u043E\u043E\u0440\u0433\u0430\u043D\u0438\u0437\u0430\u0442\u043E\u0440\u043E\u0432."]);
      return { ok: true, handled: true, denied: true };
    }
    return publishZoomOnlyMeetingCommand(env, meetingKey);
  }
  const zoomBillNumber = parseBillInput(text);
  if (zoomBillNumber !== null && /^\/?\u0431\u0438\u043B\u043B\s+\d{1,3}$/iu.test(text.trim())) {
    if (!isAdmin) {
      await enqueueZoomOnlyMessages(env, ["\u042D\u0442\u0430 \u043A\u043E\u043C\u0430\u043D\u0434\u0430 \u0442\u043E\u043B\u044C\u043A\u043E \u0434\u043B\u044F \u043E\u0440\u0433\u0430\u043D\u0438\u0437\u0430\u0442\u043E\u0440\u0430 \u0438 \u0441\u043E\u043E\u0440\u0433\u0430\u043D\u0438\u0437\u0430\u0442\u043E\u0440\u043E\u0432."]);
      return { ok: true, handled: true, denied: true };
    }
    await enqueueZoomOnlyMessages(env, splitZoomText(await buildBillText(zoomBillNumber)));
    return { ok: true, handled: true };
  }
  if (isAdmin) {
    const manual = parseZoomManualQueueCommand(text);
    if (manual) {
      if (!queueInfo.state?.isOpen || !queueInfo.state?.mode) {
        await enqueueZoomOnlyMessages(env, ["\u041E\u0447\u0435\u0440\u0435\u0434\u044C \u0441\u0435\u0439\u0447\u0430\u0441 \u0437\u0430\u043A\u0440\u044B\u0442\u0430."]);
        return { ok: true, handled: true };
      }
      if (manual.action === "remove") {
        const result = manual.index ? await callZoomOnlyQueueState(env, "remove_by_number", { index: manual.index }) : await callZoomOnlyQueueState(env, "remove");
        await applyZoomOnlyQueueResponse(env, result);
        return { ok: true, handled: true };
      }
      if (manual.action === "add_code" && manual.author) {
        const label = queueInfo.state.mode === "bill" ? manual.code : "111";
        const entry = makeManualQueueEntryCore(manual.author, queueInfo.state.mode === "bill" ? (manual.code === "111" ? "first" : manual.code) : queueInfo.state.mode, label, text, { source: "Zoom" });
        const result = await callZoomOnlyQueueState(env, "add", { entry });
        await applyZoomOnlyQueueResponse(env, result);
        return { ok: true, handled: true };
      }
      if (manual.action === "add_game" && manual.author) {
        if (queueInfo.state.mode !== "bill") {
          await enqueueZoomOnlyMessages(env, ["\u0418\u0433\u0440\u0443 \u043C\u043E\u0436\u043D\u043E \u0434\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u0442\u043E\u043B\u044C\u043A\u043E \u0432 \u043E\u0447\u0435\u0440\u0435\u0434\u0438 \u0411\u0438\u043B\u043B."]);
          return { ok: true, handled: true };
        }
        const question = (await getSpeakerQuestions()).get(manual.number);
        if (!question) {
          await enqueueZoomOnlyMessages(env, [`\u041D\u0435 \u043D\u0430\u0448\u0451\u043B \u0432\u043E\u043F\u0440\u043E\u0441 ${manual.number}.`]);
          return { ok: true, handled: true };
        }
        const entry = makeManualQueueEntryCore(manual.author, "first", `\u0438\u0433\u0440\u0430 ${manual.number}`, text, { source: "Zoom" });
        const result = await callZoomOnlyQueueState(env, "add", { entry });
        await applyZoomOnlyQueueResponse(env, result);
        await enqueueZoomOnlyMessages(env, splitZoomText(`\u0412\u043E\u043F\u0440\u043E\u0441 ${manual.number}:\n\n${question}`));
        return { ok: true, handled: true };
      }
      await enqueueZoomOnlyMessages(env, ["\u041A\u043E\u043C\u0430\u043D\u0434\u0430 \u0434\u043E\u0431\u0430\u0432\u043B\u0435\u043D\u0438\u044F \u043D\u0435 \u043F\u043E\u043D\u044F\u0442\u043D\u0430."]);
      return { ok: true, handled: true };
    }
    const adminActions = {
      "\u0432\u044B\u0441\u043A\u0430\u0437\u0430\u043B\u0441\u044F": "done",
      "\u043F\u0440\u043E\u043F\u0443\u0441\u043A\u0430\u0435\u0442": "skip",
      "\u043E\u0442\u043C\u0435\u043D\u0438\u0442\u044C": "undo",
      "\u0437\u0430\u043A\u0440\u044B\u0442\u044C \u043E\u0447\u0435\u0440\u0435\u0434\u044C": "close"
    };
    if (adminActions[normalized]) {
      const result = await callZoomOnlyQueueState(env, adminActions[normalized]);
      await applyZoomOnlyQueueResponse(env, result);
      return { ok: true, handled: true };
    }
  }
  if (normalized === "\u043E\u0447\u0435\u0440\u0435\u0434\u044C") {
    await enqueueZoomOnlyMessages(env, splitZoomText(buildZoomOnlyQueueTextCore(queueInfo.state || createEmptyQueueState())));
    return { ok: true, handled: true };
  }
  const gameNumber = parseGameCommandCore(text);
  if (gameNumber !== null) {
    const question = (await getSpeakerQuestions()).get(gameNumber);
    if (!question) {
      await enqueueZoomOnlyMessages(env, [`\u041D\u0435 \u043D\u0430\u0448\u0451\u043B \u0432\u043E\u043F\u0440\u043E\u0441 ${gameNumber}.`]);
      return { ok: true, handled: true };
    }
    await enqueueZoomOnlyMessages(env, splitZoomText(`\u0412\u043E\u043F\u0440\u043E\u0441 ${gameNumber}:\n\n${question}`));
    return { ok: true, handled: true };
  }
  let queueState = queueInfo.state || createEmptyQueueState();
  if ((!queueState.isOpen || !queueState.mode) && getQueueSpeechCodeNote(text)) {
    const opened = await callZoomOnlyQueueState(env, "auto_open", { mode: "bk" });
    queueState = opened.state || queueState;
  }
  const entry = parseQueueEntryCore(message, queueState, { source: "Zoom" });
  if (entry) {
    const result = await callZoomOnlyQueueState(env, "add", { entry });
    await applyZoomOnlyQueueResponse(env, result);
    return { ok: true, handled: true };
  }
  return { ok: true, handled: false };
}
__name(handleZoomOnlyMessage, "handleZoomOnlyMessage");
async function handleZoomBridgeRequest(request, env) {
  if (!isZoomBridgeAuthorized(request, env)) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(request.url);
  if (request.method === "POST" && url.pathname === "/zoom/webhook") {
    const payload = await request.json();
    return Response.json(await handleZoomBridgeMessage(env, payload));
  }
  if (request.method === "POST" && url.pathname === "/zoom/outbox") {
    const payload = await request.json().catch(() => ({}));
    if (Array.isArray(payload.ackIds) && payload.ackIds.length) {
      await callAnnouncementState(env, "ack_zoom_messages", { ids: payload.ackIds });
    }
    const result = await callAnnouncementState(env, "pull_zoom_messages", { limit: payload.limit || 20 });
    return Response.json({ ok: true, botName: ZOOM_BOT_NAME, messages: result.messages || [] });
  }
  if (request.method === "POST" && url.pathname === "/zoom/debug") {
    const payload = await request.json().catch(() => ({}));
    if (payload.clear) {
      await callAnnouncementState(env, "clear_zoom_debug");
    }
    const result = await callAnnouncementState(env, "pull_zoom_debug");
    return Response.json({ ok: true, events: result.events || [] });
  }
  return textResponse("Not found", 404);
}
__name(handleZoomBridgeRequest, "handleZoomBridgeRequest");
async function handleZoomOnlyBridgeRequest(request, env) {
  const url = new URL(request.url);
  if (url.pathname === "/zoom-only/status" && isZoomPanelAuthorized(request, env)) {
    const result = await callAnnouncementState(env, "zoom_only_status");
    return Response.json(result);
  }
  if (!isZoomBridgeAuthorized(request, env)) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (request.method === "POST" && url.pathname === "/zoom-only/webhook") {
    const payload = await request.json();
    return Response.json(await handleZoomOnlyMessage(env, payload));
  }
  if (request.method === "POST" && url.pathname === "/zoom-only/outbox") {
    const payload = await request.json().catch(() => ({}));
    if (Array.isArray(payload.ackIds) && payload.ackIds.length) {
      await callAnnouncementState(env, "ack_zoom_only_messages", { ids: payload.ackIds });
    }
    const result = await callAnnouncementState(env, "pull_zoom_only_messages", { limit: payload.limit || 20 });
    return Response.json({ ok: true, botName: ZOOM_BOT_NAME, messages: result.messages || [] });
  }
  if (url.pathname === "/zoom-only/status") {
    const result = await callAnnouncementState(env, "zoom_only_status");
    return Response.json(result);
  }
  if (request.method === "POST" && url.pathname === "/zoom-only/reset") {
    const result = await callAnnouncementState(env, "clear_zoom_only_state");
    return Response.json(result);
  }
  return textResponse("Not found", 404);
}
__name(handleZoomOnlyBridgeRequest, "handleZoomOnlyBridgeRequest");
function isZoomAppControlCommand(command) {
  const normalized = normalizeZoomCommand(command);
  if (ZOOM_APP_ALLOWED_COMMANDS.has(normalized)) return true;
  if (/^\/?\u0431\u0438\u043b\u043b\s+\d{1,3}$/iu.test(normalized)) return true;
  if (/^(?:111|222|333|444)$/u.test(normalized)) return true;
  if (/^\u0438\u0433\u0440\u0430\s+\d{1,3}$/iu.test(normalized)) return true;
  if (parseZoomManualQueueCommand(command)) return true;
  return false;
}
__name(isZoomAppControlCommand, "isZoomAppControlCommand");
function buildZoomPayloadFromAppCommand(env, command, userContext = {}) {
  const role = String(userContext.role || "").toLowerCase();
  const displayName = stripTelegramHandles(userContext.screenName || userContext.displayName || userContext.name || "Zoom App");
  const nameIsAdmin = isZoomAdminName(env, displayName);
  return {
    id: `zoom-app-${Date.now()}`,
    text: command,
    user: {
      displayName,
      role,
      isHost: role === "host",
      isCoHost: role === "cohost" || role === "co-host" || nameIsAdmin
    },
    source: "zoom_app"
  };
}
__name(buildZoomPayloadFromAppCommand, "buildZoomPayloadFromAppCommand");
function buildZoomOnlyPayloadFromAppCommand(env, command, userContext = {}) {
  const payload = buildZoomPayloadFromAppCommand(env, command, userContext);
  return {
    ...payload,
    isZoomOnlyAppControl: true,
    user: {
      ...payload.user,
      role: payload.user?.role || "zoom-app",
      isHost: true,
      isCoHost: true
    }
  };
}
__name(buildZoomOnlyPayloadFromAppCommand, "buildZoomOnlyPayloadFromAppCommand");
async function handleZoomAppActionRequest(request, env) {
  if (request.method !== "POST") {
    return Response.json({ ok: false, error: "method_not_allowed" }, { status: 405 });
  }
  const payload = await request.json().catch(() => ({}));
  const command = String(payload.command || "").trim();
  if (!command || !isZoomAppControlCommand(command)) {
    return Response.json({ ok: false, error: "\u041a\u043e\u043c\u0430\u043d\u0434\u0430 \u0434\u043b\u044f Zoom-\u043f\u0443\u043b\u044c\u0442\u0430 \u043d\u0435 \u0440\u0430\u0437\u0440\u0435\u0448\u0435\u043d\u0430." }, { status: 400 });
  }
  const marker = await callAnnouncementState(env, "get_zoom_outbox_marker").catch(() => ({ nextId: 1 }));
  const result = await handleZoomBridgeMessage(env, buildZoomPayloadFromAppCommand(env, command, payload.userContext || {}));
  const outbox = await callAnnouncementState(env, "pull_zoom_messages", { minId: marker.nextId || 1, limit: 50 }).catch(() => ({ messages: [] }));
  const messages = Array.isArray(outbox.messages) ? outbox.messages : [];
  if (messages.length) {
    await callAnnouncementState(env, "ack_zoom_messages", { ids: messages.map((message) => message.id) }).catch(() => null);
  }
  return Response.json({
    ok: true,
    handled: Boolean(result?.handled),
    denied: Boolean(result?.denied),
    messages: messages.map((message) => ({ id: message.id, text: String(message.text || "") })).filter((message) => message.text)
  });
}
__name(handleZoomAppActionRequest, "handleZoomAppActionRequest");
async function handleZoomOnlyAppActionRequest(request, env) {
  if (request.method !== "POST") {
    return Response.json({ ok: false, error: "method_not_allowed" }, { status: 405 });
  }
  if (!isZoomPanelAuthorized(request, env)) {
    return zoomPanelUnauthorizedResponse();
  }
  const payload = await request.json().catch(() => ({}));
  if (payload.action === "test_message" || payload.type === "test_message") {
    return Response.json(await handleZoomV2PanelTestMessageAction(env));
  }
  if (payload.type === "message" || payload.key) {
    return Response.json(await handleZoomV2PanelMessageAction(env, String(payload.key || "").trim()));
  }
  if (payload.type === "queue" || payload.queueAction) {
    return Response.json(await handleZoomV2PanelQueueAction(env, String(payload.queueAction || "").trim()));
  }
  const command = String(payload.command || "").trim();
  if (!command || !isZoomAppControlCommand(command)) {
    return Response.json({ ok: false, error: "\u041A\u043E\u043C\u0430\u043D\u0434\u0430 \u0434\u043B\u044F Zoom-only \u043F\u0443\u043B\u044C\u0442\u0430 \u043D\u0435 \u0440\u0430\u0437\u0440\u0435\u0448\u0435\u043D\u0430." }, { status: 400 });
  }
  const marker = await callAnnouncementState(env, "get_zoom_only_outbox_marker").catch(() => ({ nextId: 1 }));
  const result = await handleZoomOnlyMessage(env, buildZoomOnlyPayloadFromAppCommand(env, command, payload.userContext || {}));
  const outbox = await callAnnouncementState(env, "pull_zoom_only_messages", { minId: marker.nextId || 1, limit: 50 }).catch(() => ({ messages: [] }));
  const messages = Array.isArray(outbox.messages) ? outbox.messages : [];
  return Response.json({
    ok: true,
    handled: Boolean(result?.handled),
    denied: Boolean(result?.denied),
    messages: messages.map((message) => ({ id: message.id, text: String(message.text || "") })).filter((message) => message.text)
  });
}
__name(handleZoomOnlyAppActionRequest, "handleZoomOnlyAppActionRequest");
async function handleZoomV2PanelTestMessageAction(env) {
  const marker = await callAnnouncementState(env, "get_zoom_only_outbox_marker").catch(() => ({ nextId: 1 }));
  await enqueueZoomOnlyMessages(env, [ZOOM_V2_SAFE_TEST_MESSAGE]);
  await callAnnouncementState(env, "record_zoom_only_panel_action", { key: "test_message", label: "\u0422\u0435\u0441\u0442", ok: true }).catch(() => null);
  const outbox = await callAnnouncementState(env, "pull_zoom_only_messages", { minId: marker.nextId || 1, limit: 50 }).catch(() => ({ messages: [] }));
  const queued = (Array.isArray(outbox.messages) ? outbox.messages : []).filter((message) => String(message.text || "") === ZOOM_V2_SAFE_TEST_MESSAGE);
  return {
    ok: true,
    message: "\u0422\u0435\u0441\u0442\u043e\u0432\u043e\u0435 \u0441\u043e\u043e\u0431\u0449\u0435\u043d\u0438\u0435 \u0434\u043e\u0431\u0430\u0432\u043b\u0435\u043d\u043e \u0432 Zoom outbox",
    key: "test_message",
    queued
  };
}
__name(handleZoomV2PanelTestMessageAction, "handleZoomV2PanelTestMessageAction");
function getZoomV2PanelMessageAction(key) {
  return ZOOM_V2_PANEL_MESSAGE_ACTIONS.find((action) => action.key === key) || null;
}
__name(getZoomV2PanelMessageAction, "getZoomV2PanelMessageAction");
function getZoomV2PanelMessages(action) {
  if (!action) return null;
  if (action.key === "today_topic") {
    return getTodayTopicSourceMessageId() ? getTodayTopicZoomMessages() : ["\u0421\u0435\u0433\u043e\u0434\u043d\u044f \u0441\u043e\u0431\u0440\u0430\u043d\u0438\u044f \u043d\u0435\u0442."];
  }
  const zoomKey = action.zoomKey || action.key;
  if (!ZOOM_MEETING_MESSAGE_TEXTS[zoomKey]) return null;
  return getZoomMeetingMessages(zoomKey);
}
__name(getZoomV2PanelMessages, "getZoomV2PanelMessages");
async function handleZoomV2PanelMessageAction(env, key) {
  const action = getZoomV2PanelMessageAction(key);
  const messages = getZoomV2PanelMessages(action);
  if (!action || !messages?.length) {
    await callAnnouncementState(env, "record_zoom_only_panel_action", { key, label: key, ok: false }).catch(() => null);
    return { ok: false, error: "\u041d\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043d\u0430\u044f \u043a\u043d\u043e\u043f\u043a\u0430 Zoom-\u043f\u0443\u043b\u044c\u0442\u0430." };
  }
  const marker = await callAnnouncementState(env, "get_zoom_only_outbox_marker").catch(() => ({ nextId: 1 }));
  await enqueueZoomOnlyMessages(env, messages);
  await callAnnouncementState(env, "record_zoom_only_panel_action", { key: action.key, label: action.label, ok: true }).catch(() => null);
  const outbox = await callAnnouncementState(env, "pull_zoom_only_messages", { minId: marker.nextId || 1, limit: 50 }).catch(() => ({ messages: [] }));
  return {
    ok: true,
    message: `${action.label} \u0434\u043e\u0431\u0430\u0432\u043b\u0435\u043d\u0430 \u0432 \u043e\u0447\u0435\u0440\u0435\u0434\u044c \u043e\u0442\u043f\u0440\u0430\u0432\u043a\u0438 Zoom`,
    key: action.key,
    queued: Array.isArray(outbox.messages) ? outbox.messages : []
  };
}
__name(handleZoomV2PanelMessageAction, "handleZoomV2PanelMessageAction");
async function handleZoomV2PanelQueueAction(env, key) {
  const action = ZOOM_V2_PANEL_QUEUE_ACTIONS.find((item) => item.key === key) || null;
  if (!action) {
    await callAnnouncementState(env, "record_zoom_only_panel_action", { key, label: key, ok: false }).catch(() => null);
    return { ok: false, error: "\u041d\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043d\u043e\u0435 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0435 \u043e\u0447\u0435\u0440\u0435\u0434\u0438 Zoom-\u043f\u0443\u043b\u044c\u0442\u0430." };
  }
  const queueModeByAction = {
    open_bill: "bill",
    open_bk: "bk",
    open_rs: "rs"
  };
  let result;
  if (queueModeByAction[key]) {
    result = await callZoomOnlyQueueState(env, "open", { mode: queueModeByAction[key] });
    await applyZoomOnlyQueueResponse(env, result);
  } else if (key === "show_queue") {
    result = await callZoomOnlyQueueState(env, "get");
    await enqueueZoomOnlyMessages(env, splitZoomText(buildZoomOnlyQueueTextCore(result.state || createEmptyQueueState())));
  } else if (key === "close_queue") {
    result = await callZoomOnlyQueueState(env, "close");
    await applyZoomOnlyQueueResponse(env, result);
  }
  await callAnnouncementState(env, "record_zoom_only_panel_action", { key, label: action.label, ok: true }).catch(() => null);
  return {
    ok: true,
    message: `${action.label}: \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0435 \u0434\u043e\u0431\u0430\u0432\u043b\u0435\u043d\u043e \u0432 Zoom-only`,
    key,
    queue: result?.state || null
  };
}
__name(handleZoomV2PanelQueueAction, "handleZoomV2PanelQueueAction");
function zoomDebugTextPreview(text) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  return clean.length > 120 ? `${clean.slice(0, 117)}...` : clean;
}
__name(zoomDebugTextPreview, "zoomDebugTextPreview");
async function recordZoomDebugEvent(env, event) {
  try {
    await callAnnouncementState(env, "record_zoom_debug", { event });
  } catch (error) {
    console.warn("zoom debug record failed", error?.message || String(error));
  }
}
__name(recordZoomDebugEvent, "recordZoomDebugEvent");
function bytesToHex(bytes) {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
__name(bytesToHex, "bytesToHex");
async function hmacSha256Hex(secret, message) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return bytesToHex(signature);
}
__name(hmacSha256Hex, "hmacSha256Hex");
function constantTimeEqual(a, b) {
  const left = String(a || "");
  const right = String(b || "");
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i++) {
    diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return diff === 0;
}
__name(constantTimeEqual, "constantTimeEqual");
async function verifyZoomWebhookSignature(request, env, rawBody) {
  const secret = String(env?.ZOOM_WEBHOOK_SECRET_TOKEN || "").trim();
  if (!secret) return false;
  const timestamp = String(request.headers.get("x-zm-request-timestamp") || "").trim();
  const signature = String(request.headers.get("x-zm-signature") || "").trim();
  if (!timestamp || !signature) return false;
  const expected = `v0=${await hmacSha256Hex(secret, `v0:${timestamp}:${rawBody}`)}`;
  return constantTimeEqual(signature, expected);
}
__name(verifyZoomWebhookSignature, "verifyZoomWebhookSignature");
async function buildZoomValidationResponse(env, payload) {
  const secret = String(env?.ZOOM_WEBHOOK_SECRET_TOKEN || "").trim();
  const plainToken = String(payload?.payload?.plainToken || "").trim();
  if (!secret || !plainToken) {
    return Response.json({ ok: false, error: "validation_failed" }, { status: 400 });
  }
  return Response.json({
    plainToken,
    encryptedToken: await hmacSha256Hex(secret, plainToken)
  });
}
__name(buildZoomValidationResponse, "buildZoomValidationResponse");
function buildZoomPayloadFromChatEvent(env, payload) {
  const object = payload?.payload?.object || {};
  const chatMessage = object.chat_message || {};
  const senderName = stripTelegramHandles(chatMessage.sender_name || "\u0443\u0447\u0430\u0441\u0442\u043d\u0438\u043a Zoom");
  const senderType = String(chatMessage.sender_type || "").toLowerCase();
  return {
    id: chatMessage.message_id || `${payload?.event_ts || Date.now()}`,
    text: chatMessage.message_content || "",
    user: {
      displayName: senderName,
      role: senderType,
      isHost: senderType === "host",
      isCoHost: isZoomAdminName(env, senderName)
    },
    zoomEvent: payload?.event || "",
    meetingId: object.id || null,
    meetingUuid: object.uuid || null,
    recipientType: chatMessage.recipient_type || "",
    recipientContext: chatMessage.recipient_context || "",
    senderContext: chatMessage.sender_context || ""
  };
}
__name(buildZoomPayloadFromChatEvent, "buildZoomPayloadFromChatEvent");
async function handleZoomWebhookEvent(request, env) {
  const rawBody = await request.text();
  const payload = JSON.parse(rawBody || "{}");
  if (payload.event === "endpoint.url_validation") {
    await recordZoomDebugEvent(env, { kind: "validation", event: payload.event });
    return buildZoomValidationResponse(env, payload);
  }
  const authorized = await verifyZoomWebhookSignature(request, env, rawBody);
  if (!authorized) {
    await recordZoomDebugEvent(env, { kind: "unauthorized", event: payload.event || "", hasSignature: Boolean(request.headers.get("x-zm-signature")) });
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (!ZOOM_CHAT_MESSAGE_EVENTS.has(String(payload.event || ""))) {
    await recordZoomDebugEvent(env, { kind: "ignored_event", event: payload.event || "" });
    return Response.json({ ok: true, handled: false });
  }
  const zoomPayload = buildZoomPayloadFromChatEvent(env, payload);
  const text = String(zoomPayload.text || "").trim();
  const recipientType = String(zoomPayload.recipientType || "").toLowerCase();
  const recipientContext = String(zoomPayload.recipientContext || "").toLowerCase();
  if (!text || recipientType !== "everyone" || recipientContext !== "meeting") {
    await recordZoomDebugEvent(env, {
      kind: "ignored_chat",
      event: payload.event || "",
      textPreview: zoomDebugTextPreview(text),
      sender: zoomPayload.user?.displayName || "",
      recipientType,
      recipientContext
    });
    return Response.json({ ok: true, handled: false });
  }
  const result = await handleZoomBridgeMessage(env, zoomPayload);
  await recordZoomDebugEvent(env, {
    kind: "handled_chat",
    event: payload.event || "",
    textPreview: zoomDebugTextPreview(text),
    sender: zoomPayload.user?.displayName || "",
    recipientType,
    recipientContext,
    handled: Boolean(result?.handled),
    denied: Boolean(result?.denied)
  });
  return Response.json(result);
}
__name(handleZoomWebhookEvent, "handleZoomWebhookEvent");
function okResponse() {
  return new Response("ok");
}
__name(okResponse, "okResponse");
var SECURITY_HEADERS = {
  "strict-transport-security": "max-age=31536000; includeSubDomains; preload",
  "x-content-type-options": "nosniff",
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  "referrer-policy": "no-referrer"
};
function withSecurityHeaders(headers = {}) {
  return { ...SECURITY_HEADERS, ...headers };
}
__name(withSecurityHeaders, "withSecurityHeaders");
function textResponse(text, status = 200) {
  return new Response(text, {
    status,
    headers: withSecurityHeaders({ "content-type": "text/plain; charset=UTF-8" })
  });
}
__name(textResponse, "textResponse");
var ZOOM_APP_SECURITY_HEADERS = {
  "strict-transport-security": "max-age=31536000; includeSubDomains; preload",
  "x-content-type-options": "nosniff",
  "content-security-policy": [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://appssdk.zoom.us",
    "style-src 'self' 'unsafe-inline'",
    "connect-src 'self'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    "base-uri 'none'"
  ].join("; "),
  "referrer-policy": "no-referrer"
};
function htmlResponse(html, status = 200) {
  return new Response(html, {
    status,
    headers: {
      ...ZOOM_APP_SECURITY_HEADERS,
      "content-type": "text/html; charset=UTF-8"
    }
  });
}
__name(htmlResponse, "htmlResponse");
var ZOOM_APP_ACTIONS = [
  { command: "\u043c\u0438\u043d\u0443\u0442\u0430 \u0442\u0438\u0448\u0438\u043d\u044b", label: "\u041c\u0438\u043d\u0443\u0442\u0430 \u0442\u0438\u0448\u0438\u043d\u044b", icon: "\u{1f92b}" },
  { command: "\u043c\u043e\u043b\u0438\u0442\u0432\u0430", label: "\u041c\u043e\u043b\u0438\u0442\u0432\u0430", icon: "\u{1f64f}" },
  { command: "\u043f\u0440\u0435\u0430\u043c\u0431\u0443\u043b\u0430", label: "\u041f\u0440\u0435\u0430\u043c\u0431\u0443\u043b\u0430", icon: "\u{1f4dc}" },
  { command: "\u043d\u043e\u0432\u0438\u0447\u043a\u0443", label: "\u041d\u043e\u0432\u0438\u0447\u043a\u0443", icon: "\u{1f44b}" },
  { command: "12 \u0448\u0430\u0433\u043e\u0432", label: "12 \u0428\u0430\u0433\u043e\u0432", icon: "12" },
  { command: "12 \u0442\u0440\u0430\u0434\u0438\u0446\u0438\u0439", label: "12 \u0422\u0440\u0430\u0434\u0438\u0446\u0438\u0439", icon: "12" },
  { command: "\u043f\u0440\u0430\u0432\u0438\u043b\u0430 \u0441\u043e\u0431\u0440\u0430\u043d\u0438\u044f", label: "\u041f\u0440\u0430\u0432\u0438\u043b\u0430 \u0441\u043e\u0431\u0440\u0430\u043d\u0438\u044f", icon: "\u{1f4d8}" },
  { command: "\u0442\u0435\u043c\u044b \u0441\u043e\u0431\u0440\u0430\u043d\u0438\u044f", label: "\u0422\u0435\u043c\u044b \u0441\u043e\u0431\u0440\u0430\u043d\u0438\u044f", icon: "\u{1f5c2}\ufe0f" },
  { command: "\u0440\u0430\u0441\u043f\u0438\u0441\u0430\u043d\u0438\u0435", label: "\u0420\u0430\u0441\u043f\u0438\u0441\u0430\u043d\u0438\u0435", icon: "\u{1f4c5}" },
  { command: "\u0441\u043b\u0443\u0436\u0435\u043d\u0438\u044f", label: "\u0421\u043b\u0443\u0436\u0435\u043d\u0438\u044f", icon: "\u{1f4cc}" },
  { command: "\u0441\u0441\u044b\u043b\u043a\u0438", label: "\u0421\u0441\u044b\u043b\u043a\u0438", icon: "\u{1f517}" },
  { command: "7 \u0442\u0440\u0430\u0434\u0438\u0446\u0438\u044f", label: "7-\u044f \u0422\u0440\u0430\u0434\u0438\u0446\u0438\u044f", icon: "\u{1f4b0}" },
  { command: "\u043f\u0440\u0430\u0432\u0438\u043b\u0430 \u0447\u0430\u0439\u043d\u043e\u0439", label: "\u041f\u0440\u0430\u0432\u0438\u043b\u0430 \u0447\u0430\u0439\u043d\u043e\u0439", icon: "\u2615" },
  { command: "\u0432\u043e\u043f\u0440\u043e\u0441\u044b \u0441\u043f\u0438\u043a\u0435\u0440\u0443", label: "\u0412\u043e\u043f\u0440\u043e\u0441\u044b \u0441\u043f\u0438\u043a\u0435\u0440\u0443", icon: "\u2753" },
  { command: "\u0447\u0438\u0441\u0442\u043e\u0442\u0430 \u0447\u0430\u0442\u0430", label: "\u0427\u0438\u0441\u0442\u043e\u0442\u0430 \u0447\u0430\u0442\u0430", icon: "\u203c\ufe0f" },
  { command: "\u043f\u0440\u0430\u0432\u0438\u043b\u0430 \u0447\u0430\u0442\u0430", label: "\u041f\u0440\u0430\u0432\u0438\u043b\u0430 \u0447\u0430\u0442\u0430", icon: "\u{1f4cc}" },
  { command: "\u0435\u0436\u0438\u043a", label: "\u0401\u0436\u0438\u043a", icon: "\u{1f994}" },
  { command: "\u0431\u0438\u043b\u043b", label: "\u0411\u0438\u043b\u043b", icon: "\u{1f4d9}" }
];
var ZOOM_APP_ALLOWED_COMMANDS = new Set([
  ...ZOOM_APP_ACTIONS.map((action) => normalizeZoomCommand(action.command)),
  "\u0432\u044b\u0441\u043a\u0430\u0437\u0430\u043b\u0441\u044f",
  "\u043f\u0440\u043e\u043f\u0443\u0441\u043a\u0430\u0435\u0442",
  "\u043e\u0442\u043c\u0435\u043d\u0438\u0442\u044c",
  "\u0437\u0430\u043a\u0440\u044b\u0442\u044c \u043e\u0447\u0435\u0440\u0435\u0434\u044c",
  "\u043e\u0442\u043a\u0440\u044b\u0442\u044c \u0431\u043a",
  "\u043e\u0442\u043a\u0440\u044b\u0442\u044c \u0431\u0438\u043b\u043b",
  "\u043e\u0442\u043a\u0440\u044b\u0442\u044c \u0440\u0430\u0431\u043e\u0447\u043a\u0430",
  "\u0442\u0435\u043c\u0430",
  "\u0442\u0435\u043c\u044b",
  "\u043e\u0447\u0435\u0440\u0435\u0434\u044c"
]);
var ZOOM_V2_PANEL_MESSAGE_ACTIONS = [
  { key: "minute_silence", label: "\u041c\u0438\u043d\u0443\u0442\u0430 \u0442\u0438\u0448\u0438\u043d\u044b" },
  { key: "prayer", label: "\u041c\u043e\u043b\u0438\u0442\u0432\u0430" },
  { key: "preambula", label: "\u041f\u0440\u0435\u0430\u043c\u0431\u0443\u043b\u0430" },
  { key: "newcomer", label: "\u041d\u043e\u0432\u0438\u0447\u043a\u0443" },
  { key: "steps12", label: "12 \u0448\u0430\u0433\u043e\u0432" },
  { key: "traditions12", label: "12 \u0442\u0440\u0430\u0434\u0438\u0446\u0438\u0439" },
  { key: "today_topic", label: "\u0422\u0435\u043c\u044b" },
  { key: "seventh_tradition", label: "7 \u0442\u0440\u0430\u0434\u0438\u0446\u0438\u044f" },
  { key: "free_services", label: "\u0421\u043b\u0443\u0436\u0435\u043d\u0438\u044f" },
  { key: "tea_rules", label: "\u041f\u0440\u0430\u0432\u0438\u043b\u0430 \u0447\u0430\u0439\u043d\u043e\u0439" },
  { key: "speaker_questions", label: "\u0412\u043e\u043f\u0440\u043e\u0441\u044b \u0441\u043f\u0438\u043a\u0435\u0440\u0443" },
  { key: "chat_cleanliness", label: "\u0427\u0438\u0441\u0442\u043e\u0442\u0430 \u0447\u0430\u0442\u0430", zoomKey: "meeting_rules" },
  { key: "meeting_schedule", label: "\u0420\u0430\u0441\u043f\u0438\u0441\u0430\u043d\u0438\u0435" },
  { key: "telemost_link", label: "\u0421\u0441\u044b\u043b\u043a\u0438" }
];
var ZOOM_V2_SAFE_TEST_MESSAGE = "\u0422\u0435\u0441\u0442 \u041d\u0430\u0444\u0430\u043d\u0438. \u0421\u043e\u043e\u0431\u0449\u0435\u043d\u0438\u0435 \u043c\u043e\u0436\u043d\u043e \u0438\u0433\u043d\u043e\u0440\u0438\u0440\u043e\u0432\u0430\u0442\u044c.";
var ZOOM_V2_PANEL_QUEUE_ACTIONS = [
  { key: "open_bill", label: "\u041e\u0442\u043a\u0440\u044b\u0442\u044c \u0411\u0438\u043b\u043b" },
  { key: "open_bk", label: "\u041e\u0442\u043a\u0440\u044b\u0442\u044c \u0411\u041a" },
  { key: "open_rs", label: "\u041e\u0442\u043a\u0440\u044b\u0442\u044c \u0440\u0430\u0431\u043e\u0447\u043a\u0443" },
  { key: "show_queue", label: "\u041f\u043e\u043a\u0430\u0437\u0430\u0442\u044c \u043e\u0447\u0435\u0440\u0435\u0434\u044c" },
  { key: "close_queue", label: "\u0417\u0430\u043a\u0440\u044b\u0442\u044c \u043e\u0447\u0435\u0440\u0435\u0434\u044c" }
];
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}
__name(escapeHtml, "escapeHtml");
function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}
__name(escapeAttr, "escapeAttr");
function buildZoomAppHtml({ actionPath = "/zoom/app/action", zoomOnly = false } = {}) {
  const buttons = ZOOM_APP_ACTIONS.map((action) => `<button class="action" type="button" data-command="${escapeAttr(action.command)}"><span class="icon">${escapeHtml(action.icon)}</span><span>${escapeHtml(action.label)}</span></button>`).join("");
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Nafanya Zoom Bridge</title>
  <script src="https://appssdk.zoom.us/sdk.js"></script>
  <style>
    :root { color-scheme: light; font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #f7f5f2; color: #211f1b; }
    .shell { min-height: 100vh; padding: 18px; display: flex; flex-direction: column; gap: 14px; }
    .top { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; }
    h1 { margin: 0; font-size: 22px; line-height: 1.15; }
    .badge { flex: 0 0 auto; border: 1px solid #d8d1c6; border-radius: 999px; padding: 6px 10px; font-size: 12px; background: #fff; color: #5f574d; }
    .status { min-height: 40px; border-radius: 8px; padding: 10px 12px; background: #fff; border: 1px solid #ded8ce; color: #4b443d; font-size: 13px; }
    .status.good { border-color: #9fc89e; background: #f2fbf1; }
    .status.warn { border-color: #e3c16a; background: #fff8e5; }
    .status.bad { border-color: #db8b83; background: #fff0ee; }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
    .action { min-height: 52px; border: 1px solid #cfc7bb; border-radius: 8px; background: #fff; color: #241f1a; font-size: 15px; font-weight: 650; display: flex; align-items: center; gap: 8px; justify-content: flex-start; padding: 10px 12px; text-align: left; cursor: pointer; }
    .action:active { transform: translateY(1px); }
    .action[disabled] { opacity: 0.58; cursor: wait; }
    .icon { flex: 0 0 26px; width: 26px; text-align: center; font-weight: 800; }
    .manual { margin-top: auto; display: grid; grid-template-columns: 1fr auto; gap: 8px; }
    .manual input { min-width: 0; border-radius: 8px; border: 1px solid #cfc7bb; padding: 10px 12px; font-size: 15px; background: #fff; color: #211f1b; }
    .manual button { border-radius: 8px; border: 0; padding: 10px 14px; background: #214c8f; color: #fff; font-size: 15px; font-weight: 700; cursor: pointer; }
    .log { max-height: 155px; overflow: auto; border-radius: 8px; background: #2a2622; color: #fff7eb; padding: 10px; font-size: 12px; white-space: pre-wrap; }
    @media (max-width: 380px) { .grid { grid-template-columns: 1fr; } .shell { padding: 12px; } }
  </style>
</head>
<body>
  <main class="shell">
    <section class="top">
      <div>
        <h1>Нафаня</h1>
        <div>Пульт собрания</div>
      </div>
      <div class="badge" id="roleBadge">Zoom App</div>
    </section>
    <div class="status warn" id="status">Подключаю Zoom SDK...</div>
    <section class="grid">${buttons}</section>
    <form class="manual" id="manualForm">
      <input id="manualInput" autocomplete="off" placeholder="билл 17, очередь, отменить">
      <button type="submit">OK</button>
    </form>
    <pre class="log" id="log">Жду команду.</pre>
  </main>
  <script>
    const statusEl = document.getElementById("status");
    const logEl = document.getElementById("log");
    const roleBadge = document.getElementById("roleBadge");
    const manualInput = document.getElementById("manualInput");
    const buttons = [...document.querySelectorAll(".action")];
    const zoomOnlyMode = ${zoomOnly ? "true" : "false"};
    let zoomReady = false;
    let userContext = {};

    function setStatus(text, kind = "warn") {
      statusEl.textContent = text;
      statusEl.className = "status " + kind;
    }

    function addLog(text) {
      const time = new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      logEl.textContent = "[" + time + "] " + text + "\\n" + logEl.textContent;
    }

    function normalizeRole(role) {
      return String(role || "").toLowerCase().replace(/[-_\\s]+/g, "");
    }

    function canControl() {
      const role = normalizeRole(userContext.role);
      return role === "host" || role === "cohost" || role === "co-host";
    }

    async function initZoom() {
      if (!window.zoomSdk) {
        setStatus("Открыто вне Zoom-клиента. Для отправки в чат Zoom открой пульт из кнопки Приложения в самой конференции.", "warn");
        return;
      }
      try {
        const config = await zoomSdk.config({
          version: "0.16",
          capabilities: ["getUserContext", "sendMessageToChat", "showNotification"],
          popoutSize: { width: 420, height: 760 }
        });
        zoomReady = !config.unsupportedApis?.includes("sendMessageToChat");
        userContext = await zoomSdk.getUserContext().catch(() => ({}));
        const name = userContext.screenName || "Zoom";
        const role = userContext.role || config.runningContext || "";
        roleBadge.textContent = name + (role ? " / " + role : "");
        if (config.runningContext !== "inMeeting") {
          setStatus("Пульт открыт не внутри конференции. Для отправки в чат открой его из кнопки Приложения в самой конференции.", "warn");
        } else if (zoomOnlyMode) {
          setStatus("Готов. Нажми кнопку, серверный Zoom-мост напишет в чат конференции.", "good");
        } else if (!zoomReady) {
          setStatus("Пульт открыт внутри конференции. Сообщения отправит серверный Zoom-мост.", "warn");
        } else {
          setStatus("Готов. Нажми кнопку, Нафаня отправит текст в чат Zoom.", "good");
        }
        addLog("SDK: " + JSON.stringify({ runningContext: config.runningContext, unsupportedApis: config.unsupportedApis || [], user: userContext }));
      } catch (error) {
        setStatus("Zoom SDK не настроился: " + (error?.message || String(error)), "bad");
        addLog("Ошибка SDK: " + JSON.stringify(error, Object.getOwnPropertyNames(error)));
      }
    }

    async function sendToZoomChat(text) {
      if (!zoomReady || !window.zoomSdk?.sendMessageToChat) {
        addLog("Zoom chat пропущен: SDK не разрешил отправку.");
        return false;
      }
      await zoomSdk.sendMessageToChat({ message: text });
      return true;
    }

    async function runCommand(command) {
      const clean = String(command || "").trim();
      if (!clean) return;
      buttons.forEach((button) => button.disabled = true);
      setStatus("Выполняю: " + clean, "warn");
      addLog("Команда: " + clean);
      try {
        const response = await fetch("${escapeAttr(actionPath)}", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ command: clean, userContext })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.ok) {
          throw new Error(data.error || ("HTTP " + response.status));
        }
        let sent = 0;
        if (!zoomOnlyMode) {
          for (const item of data.messages || []) {
            if (await sendToZoomChat(item.text)) sent += 1;
          }
        }
        if (data.denied) {
          setStatus("Команда не выполнена: нужны права организатора или соорганизатора.", "bad");
        } else if (zoomOnlyMode && (data.messages || []).length) {
          setStatus("Команда принята. Серверный Нафаня напишет в чат Zoom.", "good");
        } else if ((data.messages || []).length && sent === 0) {
          setStatus("Команда ушла в Worker; серверный мост напишет в чат Zoom.", "warn");
        } else {
          setStatus("Готово. Сообщений в Zoom: " + sent + ".", "good");
        }
        addLog("Ответ: " + JSON.stringify({ handled: data.handled, messages: (data.messages || []).length, sent }));
      } catch (error) {
        setStatus("Ошибка: " + (error?.message || String(error)), "bad");
        addLog("Ошибка команды: " + (error?.stack || error?.message || String(error)));
      } finally {
        buttons.forEach((button) => button.disabled = false);
      }
    }

    buttons.forEach((button) => {
      button.addEventListener("click", () => runCommand(button.dataset.command));
    });
    document.getElementById("manualForm").addEventListener("submit", (event) => {
      event.preventDefault();
      const value = manualInput.value;
      manualInput.value = "";
      runCommand(value);
    });
    initZoom();
  </script>
</body>
</html>`;
}
__name(buildZoomAppHtml, "buildZoomAppHtml");
function buildZoomV2PanelHtml({ actionPath = "/zoom-only/app/action", statusPath = "/zoom-only/status" } = {}) {
  const messageButtons = ZOOM_V2_PANEL_MESSAGE_ACTIONS.map((action) => `<button class="action" type="button" data-type="message" data-key="${escapeAttr(action.key)}">${escapeHtml(action.label)}</button>`).join("");
  const testButton = `<button class="action test" type="button" data-type="test_message" data-key="test_message">\u0422\u0435\u0441\u0442</button>`;
  const queueButtons = ZOOM_V2_PANEL_QUEUE_ACTIONS.map((action) => `<button class="action secondary" type="button" data-type="queue" data-key="${escapeAttr(action.key)}">${escapeHtml(action.label)}</button>`).join("");
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Пульт Нафани для Zoom</title>
  <style>
    :root { color-scheme: light; font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #f6f2ea; color: #171b33; }
    main { max-width: 980px; margin: 0 auto; padding: 22px; display: grid; gap: 16px; }
    h1 { margin: 0; font-size: 30px; line-height: 1.1; }
    h2 { margin: 0 0 10px; font-size: 18px; }
    section { background: #fffaf0; border: 1px solid #d8d0c1; border-radius: 8px; padding: 16px; }
    .status { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
    .metric { border: 1px solid #d8d0c1; border-radius: 8px; padding: 12px; background: #fff; min-height: 74px; }
    .label { display: block; color: #5d6475; font-size: 13px; margin-bottom: 6px; }
    .value { display: block; font-size: 20px; font-weight: 800; }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
    .queue { grid-template-columns: repeat(5, minmax(0, 1fr)); }
    .action { min-height: 48px; border: 1px solid #b9ad98; border-radius: 8px; background: #ffffff; color: #171b33; font-size: 15px; font-weight: 750; text-align: left; padding: 10px 12px; cursor: pointer; }
    .action.secondary { background: #edf3ff; border-color: #aebbd4; }
    .action.test { background: #fff4df; border-color: #d9ad67; }
    .action:disabled { opacity: .55; cursor: wait; }
    .log { min-height: 76px; max-height: 180px; overflow: auto; white-space: pre-wrap; border-radius: 8px; background: #171b33; color: #fff8e8; padding: 12px; font-size: 13px; }
    @media (max-width: 720px) { main { padding: 14px; } .status, .grid, .queue { grid-template-columns: 1fr; } h1 { font-size: 24px; } }
  </style>
</head>
<body>
  <main>
    <h1>Пульт Нафани для Zoom</h1>
    <section>
      <div class="status">
        <div class="metric"><span class="label">Zoom Sender</span><span class="value" id="senderStatus">ожидает</span></div>
        <div class="metric"><span class="label">Outbox</span><span class="value" id="outboxStatus">0 сообщений</span></div>
        <div class="metric"><span class="label">Очередь</span><span class="value" id="queueStatus">загрузка</span></div>
      </div>
    </section>
    <section>
      <h2>Сообщения</h2>
      <div class="grid">${messageButtons}</div>
      <div class="grid">${testButton}</div>
    </section>
    <section>
      <h2>Очередь</h2>
      <div class="grid queue">${queueButtons}</div>
    </section>
    <pre class="log" id="log">Пульт загружен.</pre>
  </main>
  <script>
    const token = new URLSearchParams(location.search).get("token") || "";
    const actionPath = "${escapeAttr(actionPath)}";
    const statusPath = "${escapeAttr(statusPath)}";
    const logEl = document.getElementById("log");
    const buttons = [...document.querySelectorAll(".action")];

    function addLog(text) {
      const time = new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      logEl.textContent = "[" + time + "] " + text + "\\n" + logEl.textContent;
    }

    function headers() {
      return { "content-type": "application/json", "x-nafanya-zoom-panel-token": token };
    }

    function queueName(queue) {
      if (!queue?.isOpen) return "закрыта";
      if (queue.mode === "bill") return "Билл";
      if (queue.mode === "bk") return "БК";
      if (queue.mode === "rs") return "рабочка";
      return "открыта";
    }

    async function refreshStatus() {
      const response = await fetch(statusPath, { headers: { "x-nafanya-zoom-panel-token": token } });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || "status failed");
      document.getElementById("senderStatus").textContent = data.sender?.connected ? "подключён" : "не подключён / ожидает";
      document.getElementById("outboxStatus").textContent = String(data.outboxSize || 0) + " сообщений";
      document.getElementById("queueStatus").textContent = queueName(data.queue);
      return data;
    }

    async function runAction(type, key) {
      buttons.forEach((button) => button.disabled = true);
      try {
        const body = type === "queue" ? { type, queueAction: key } : type === "test_message" ? { action: "test_message" } : { type, key };
        const response = await fetch(actionPath, { method: "POST", headers: headers(), body: JSON.stringify(body) });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.ok) throw new Error(data.error || "action failed");
        addLog(data.message || "Готово");
        await refreshStatus();
      } catch (error) {
        addLog("Ошибка: " + (error?.message || String(error)));
      } finally {
        buttons.forEach((button) => button.disabled = false);
      }
    }

    buttons.forEach((button) => {
      button.addEventListener("click", () => runAction(button.dataset.type, button.dataset.key));
    });
    refreshStatus().catch((error) => addLog("Статус недоступен: " + (error?.message || String(error))));
  </script>
</body>
</html>`;
}
__name(buildZoomV2PanelHtml, "buildZoomV2PanelHtml");
async function handleRootRequest(env) {
  return htmlResponse(buildZoomAppHtml());
}
__name(handleRootRequest, "handleRootRequest");
async function handleZoomOnlyAppRequest(request, env) {
  if (!isZoomPanelAuthorized(request, env)) {
    return textResponse("\u041d\u0443\u0436\u0435\u043d \u0442\u043e\u043a\u0435\u043d \u043f\u0443\u043b\u044c\u0442\u0430 Zoom.", 401);
  }
  return htmlResponse(buildZoomV2PanelHtml());
}
__name(handleZoomOnlyAppRequest, "handleZoomOnlyAppRequest");
async function handleStatusRequest(env) {
  const tokenStatus = env.BOT_TOKEN ? "\u0435\u0441\u0442\u044C" : "\u043D\u0435\u0442";
  const speakerQuestions = await getSpeakerQuestions().catch(() => /* @__PURE__ */ new Map());
  const text = buildRootStatusText(tokenStatus, speakerQuestions.size);
  return textResponse(text);
}
__name(handleStatusRequest, "handleStatusRequest");
function handleZoomOAuthReturn(request) {
  const url = new URL(request.url);
  const error = String(url.searchParams.get("error") || "").trim();
  if (error) {
    const description = String(url.searchParams.get("error_description") || error).trim();
    return textResponse(`Zoom authorization failed: ${description}`, 400);
  }
  const code = String(url.searchParams.get("code") || "").trim();
  const text = code ? "Nafanya Zoom Bridge authorization received. You can close this tab and return to Zoom Marketplace." : "Nafanya Zoom Bridge OAuth return endpoint is ready.";
  return textResponse(text);
}
__name(handleZoomOAuthReturn, "handleZoomOAuthReturn");
const knowledgeRuntime = createKnowledgeRuntime({
  QUERY_HINT,
  FAQ_HINT,
  sysPrompt,
  ROLE_ALIASES,
  looksLikeBlockedProgramQuestion,
  scoreChunkBonus
});
const callbackHandlerDeps = {
  isUserAdmin,
  isTechThread,
  isChatGroup,
  answerCallback,
  editMessageText,
  sendAdminSignal,
  sendAdminThreadMessage,
  sendCoordinatorServiceNotice,
  sendManualServiceReminder,
  resetManualReplacementRequest,
  sendManualCoordinatorServiceSummary,
  QUEUE_CALLBACK_TEXTS,
  TIMER_CALLBACK_TEXTS,
  sendMessage: sendMessageWithInfoSilence,
  callPersonalDayState,
  isAdminDmUser,
  getPrivateRoles,
  isCoordinatorUser,
  notifyOwnerTechError,
  deleteMessageSafe,
  listAdminDmRecipients,
  callTelegram,
  sendYozhikToGroup,
  INFO_CHAT_ID,
  TECH_THREAD_ID,
  TECH_MESSAGES,
  INFO_CHANNEL_ANNOUNCEMENT_ID,
  FREE_SERVICES_ANNOUNCEMENT_ID,
  sendAnnouncementCopyToGroup,
  copyTechMessageToGroup: copyTechMessageToGroupSilent,
  callAnnouncementState,
  CHAT_GROUP_ID,
  callQueueState,
  applyQueueResponse,
  enqueueZoomMessages,
  getZoomMeetingMessages,
  callTimerState,
  TIMER_DEFAULT_SECONDS,
  getTodayTopicSourceMessageId,
  getTodayTopicZoomMessages,
  splitZoomText
};
const messageHandlerDeps = {
  sendMessage: sendMessageWithInfoSilence,
  callTelegram,
  INFO_CHAT_ID,
  ADMIN_THREAD_ID,
  isIdCommand,
  isChatGroup,
  isPrepThread,
  hasFixMarker,
  getAuthorLabel,
  sendAdminDigest,
  FIX_CONFIRMATION,
  hasHelpMarker,
  HELP_CONFIRMATION,
  CHAT_GROUP_ID,
  callPersonalDayState,
  buildPersonalDayUserSnapshot,
  isPersonalDayAllowed,
  getPrivateRoles,
  setMyCommands,
  hasServiceRequest,
  SERVICE_CONFIRMATION,
  sendManualServiceReminder,
  resetManualReplacementRequest,
  sendManualCoordinatorServiceSummary,
  isTimerPanelCommand,
  TIMER_PANEL_TEXT,
  buildTimerKeyboard,
  isTechThread,
  isMeetingPanelCommand,
  MEETING_PANEL_TEXT,
  TECH_THREAD_ID,
  buildMeetingKeyboard,
  isQueuePanelCommand,
  QUEUE_PANEL_TEXT,
  buildQueueKeyboard,
  isYozhikCommand,
  sendYozhikToGroup,
  isBillPromptCommand,
  sendBillToGroup,
  parseBillInput,
  isUserAdmin,
  callAnnouncementState,
  shouldUseLightConversation,
  getLightTalkKey,
  callLightTalkState,
  isMainMeetingWindow,
  isGameCommandWindow,
  looksLikeBlockedProgramQuestion,
  looksLikeGroupQuestion,
  normalizeLightText,
  answerFixedMeetingQuestion,
  answerKnowledgeQuestion: knowledgeRuntime.answerKnowledgeQuestion,
  findKnowledgeAnswer: knowledgeRuntime.findKnowledgeAnswer,
  findKnowledgeAnswerDetailed: knowledgeRuntime.findKnowledgeAnswerDetailed,
  answerLightConversation,
  copyTechMessageToGroup: copyTechMessageToGroupSilent,
  TECH_MESSAGES,
  isPrivateChat,
  parseNafanyaQuestion,
  callQueueState,
  notifyOwnerTechError,
  classifyModeration,
  getModerationWarningText,
  getModerationDeleteText,
  deleteMessageSafe,
  sendAdminSignal,
  sleep,
  parseGameCommand: parseGameCommandCore,
  getBillQuestionNumber: getBillQuestionNumberCore,
  parseQueueEntry: parseQueueEntryCore,
  makeManualQueueEntry: makeManualQueueEntryCore,
  getSpeakerQuestions,
  getTodayTopicSourceMessageId,
  applyQueueResponse,
  enqueueZoomMessages,
  splitZoomText
};
  async function handleWebhookUpdate(request, env) {
    try {
      const update = await request.json();
      if (update.message_reaction || update.message_reaction_count) {
        return okResponse();
      }
      const callbackResponse = update.callback_query ? await routeCallbackQuery(env, update.callback_query, callbackHandlerDeps) : null;
      if (callbackResponse) {
        return callbackResponse;
      }
      const message = update.message || update.edited_message || update.channel_post || update.edited_channel_post || update.business_message || update.edited_business_message;
    return routeWebhookMessage(env, message, messageHandlerDeps);
  } catch (error) {
    await notifyOwnerTechError(env, {
      module: "webhook",
      operation: "\u043e\u0431\u0440\u0430\u0431\u043e\u0442\u043a\u0430 update",
      error,
      details: { path: "/webhook" },
      hint: "\u041f\u0440\u043e\u0432\u0435\u0440\u044c \u043b\u043e\u0433\u0438 Worker \u0438 \u043f\u043e\u0441\u043b\u0435\u0434\u043d\u0438\u0439 Telegram update. \u041b\u0438\u0447\u043d\u044b\u0435 \u0442\u0435\u043a\u0441\u0442\u044b \u0432 \u0443\u0432\u0435\u0434\u043e\u043c\u043b\u0435\u043d\u0438\u0435 \u043d\u0435 \u0432\u043a\u043b\u044e\u0447\u0435\u043d\u044b."
    });
    return textResponse(`Webhook error: ${error.message}`, 500);
  }
}
__name(handleWebhookUpdate, "handleWebhookUpdate");
var worker_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/zoom/app")) {
      return handleRootRequest(env);
    }
    if (request.method === "GET" && url.pathname === "/zoom-only/app") {
      return handleZoomOnlyAppRequest(request, env);
    }
    if (request.method === "GET" && url.pathname === "/status") {
      return handleStatusRequest(env);
    }
    if (request.method === "GET" && url.pathname === "/oauth") {
      return handleZoomOAuthReturn(request);
    }
    if (url.pathname === "/zoom/app/action") {
      return handleZoomAppActionRequest(request, env);
    }
    if (url.pathname === "/zoom-only/app/action") {
      return handleZoomOnlyAppActionRequest(request, env);
    }
    if (request.method === "POST" && url.pathname === "/webhook") {
      return handleWebhookUpdate(request, env);
    }
    if (request.method === "POST" && (url.pathname === "/zoom/webhook" || url.pathname === "/zoom/outbox" || url.pathname === "/zoom/debug")) {
      return handleZoomBridgeRequest(request, env);
    }
    if ((request.method === "POST" || request.method === "GET") && (url.pathname === "/zoom-only/webhook" || url.pathname === "/zoom-only/outbox" || url.pathname === "/zoom-only/status" || url.pathname === "/zoom-only/reset")) {
      return handleZoomOnlyBridgeRequest(request, env);
    }
    if (request.method === "POST" && url.pathname === "/zoom/events") {
      return handleZoomWebhookEvent(request, env);
    }
    return textResponse("Not found", 404);
  },
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(Promise.all([
      runScheduledTaskOncePerDay(env, "morning_07_00", 7, 0, () => sendAnnouncementCopyToGroup(env, MORNING_ANNOUNCEMENT_ID)),
      runScheduledTaskOncePerDay(env, "yozhik_08_00", 8, 0, () => sendYozhikToGroup(env, { disableNotification: false })),
      runScheduledTaskOncePerDay(env, "info_channel_09_00", 9, 0, () => sendAnnouncementCopyToGroup(env, INFO_CHANNEL_ANNOUNCEMENT_ID)),
      runScheduledTaskOncePerDay(env, "service_reminders_12_00", 12, 0, () => sendTodayServiceReminders(env)),
      runScheduledTaskOncePerDay(env, "announce_thread_11_00", 11, 0, () => sendTechMessageCopyToInfoThread(env, DAILY_ANNOUNCE_THREAD_MESSAGE_ID, ANNOUNCE_THREAD_ID)),
      runScheduledTaskOncePerDay(env, "daily_15_00", 15, 0, () => sendAnnouncementCopyToGroup(env, DAILY_15_ANNOUNCEMENT_ID)),
      runScheduledTaskOncePerDay(env, "announce_thread_18_00", 18, 0, () => sendTechMessageCopyToInfoThread(env, DAILY_ANNOUNCE_THREAD_MESSAGE_ID, ANNOUNCE_THREAD_ID)),
      ...WEEKDAY_TECH_ANNOUNCEMENTS.flatMap((item) => [
        runScheduledTaskOncePerWeekday(env, `${item.key}_tech_11_00`, item.weekday, 11, 0, () => sendAnnouncementCopyToGroup(env, item.sourceMessageId)),
        runScheduledTaskOncePerWeekday(env, `${item.key}_tech_21_20`, item.weekday, 21, 20, () => sendAnnouncementCopyToGroup(env, item.sourceMessageId))
      ]),
      runScheduledTaskOncePerDay(env, "free_services_22_45", 22, 45, () => sendAnnouncementCopyToGroup(env, FREE_SERVICES_ANNOUNCEMENT_ID)),
      runScheduledTaskOncePerDay(env, "evening_23_00", 23, 0, () => sendAnnouncementCopyToGroup(env, EVENING_ANNOUNCEMENT_ID)),
      ...PERSONAL_DAY_SCHEDULE.map((item) => runScheduledTaskOncePerDay(
        env,
        item.key,
        item.hour,
        item.minute,
        () => sendPersonalDayAnnouncement(env, item.sourceMessageId, item.silent)
      )),
      callTimerState(env, "tick").catch((error) => notifyOwnerTechError(env, {
        module: "\u0442\u0430\u0439\u043c\u0435\u0440",
        operation: "cron tick",
        error,
        details: { action: "tick" },
        hint: "\u041f\u0440\u043e\u0432\u0435\u0440\u044c Durable Object \u0442\u0430\u0439\u043c\u0435\u0440\u0430."
      })),
      runScheduledTaskOncePerDay(env, "queue_clear_23_55", 23, 55, async () => {
        const result = await callQueueState(env, "clear");
        await applyQueueResponse(env, result);
      })
    ]));
  }
};
export {
  AnnouncementStateDurableObject,
  buildZoomPayloadFromChatEvent,
  buildZoomValidationResponse,
  hmacSha256Hex,
  handleRootRequest,
  handleStatusRequest,
  handleZoomOAuthReturn,
  handleZoomWebhookEvent,
  LightTalkStateDurableObject,
  getQueue111NoteCore as getQueue111Note,
  isChatGroup,
  parseGameCommandCore as parseGameCommand,
  parseQueueEntryCore as parseQueueEntry,
  QueueStateDurableObject,
  TimerStateDurableObject,
  verifyZoomWebhookSignature,
  worker_default as default
};
//# sourceMappingURL=worker.js.map













