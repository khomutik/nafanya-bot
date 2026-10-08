import { QUERY_HINT, FAQ_HINT, sysPrompt, CORE_PROMPT, AA_CONTEXT_PROMPT, MODE_PROMPTS, STYLE_TUNING_PROMPT, ACTION_STYLE_PROMPT, CONVERSATION_RHYTHM_PROMPT, VOICE_BALANCE_PROMPT, AA_HORIZONS_PROMPT } from "./bot_prompts.js";
import { ROLE_ALIASES, looksLikeBlockedProgramQuestion, looksLikeGroupQuestion, scoreChunkBonus } from "./bot_lexicon.js";
import { SOBER_ALCOHOLIC_IDENTITY_PROMPT } from "./bot_prompts.js";
import { FEW_SHOTS, detectNafanyaMode } from "./bot_dialogue.js";
import { classifyModeration, getModerationDeleteText, getModerationWarningText } from "./bot_moderation.js";
import { FIX_CONFIRMATION, HELP_CONFIRMATION, MEETING_PANEL_TEXT, QUEUE_CALLBACK_TEXTS, QUEUE_CLOSED_LABEL, QUEUE_OPEN_LABEL, QUEUE_PANEL_TEXT, SERVICE_CONFIRMATION, TIMER_CALLBACK_TEXTS, TIMER_PANEL_TEXT, buildMeetingKeyboard, buildQueueKeyboard, buildQueuePublicKeyboard, buildRootStatusText, buildTimerKeyboard, getQueueInstruction, getQueueModeTitle } from "./bot_panels.js";
import { answerCallback, callTelegram, copyTechMessageToChat, copyTechMessageToGroup, deleteMessageResult, deleteMessageSafe, editMessageText, getStickerSet, isTransientTelegramError, sendMessage, sendSticker, setMyCommands } from "./telegram_api.js";
import { callAnnouncementState, callLightTalkState, callPersonalDayState, callQueueState, callScheduleState, callTimerState, callZoomMeetingState, callZoomSharedTimerState } from "./state_clients.js";
import { createVacancyReplacementRequest, handleCallbackQuery as routeCallbackQuery } from "./callback_handlers.js";
import { handleWebhookMessage as routeWebhookMessage } from "./message_handlers.js";
import { createKnowledgeRuntime } from "./knowledge_runtime.js";
import { answerFixedMeetingQuestion } from "./fixed_meetings.js";
import { buildAddressingPrompt } from "./message_addressing.js";
import { RESPONSE_DISCIPLINE_PROMPT, buildRepairPrompt, reviewNafanyaAnswer } from "./response_quality.js";
import { ZOOM_MEETING_MESSAGE_TEXTS, ZOOM_TOPIC_MESSAGE_KEYS_BY_WEEKDAY } from "./zoom_meeting_texts.js";
import {
  ZOOM_LIBRARY_COLLECTIONS,
  ZOOM_LIBRARY_IMPORT_MAX_BYTES,
  buildLibraryZoomMessages,
  getLibraryEntry,
  getLibraryStatus,
  mergeLibraryCollections,
  readZoomLibrary,
  saveZoomLibrary,
  validateLibraryImport
} from "./zoom_library.js";
import {
  MEETING_BOARD_DAYS,
  buildMeetingBoardText,
  buildSpeakerQuestionsText,
  createEmptyMeetingBoardState,
  createEmptySpeakerQuestionsState,
  isMeetingBoardDay,
  normalizeMeetingBoardState,
  normalizeSpeakerQuestionsState,
  sanitizeBoardText,
  splitBoardZoomMessages
} from "./zoom_meeting_board.js";
import {
  buildQueueText as buildQueueTextCore,
  compact,
  createEmptyQueueState,
  getBillQuestionNumber as getBillQuestionNumberCore,
  getQueue111Note as getQueue111NoteCore,
  makeManualQueueEntry as makeManualQueueEntryCore,
  parseGameCommand as parseGameCommandCore,
  parseQueueEntry as parseQueueEntryCore,
  runQueueStateAction as runQueueStateActionCore
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
          temperature: 0.45,
          maxTokens: "350",
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
  const limited = limitLightAnswerSentences(text, 3, 500);
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
  includeCorePrompt = true,
  addressing = null
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
  messages.push({
    role: "system",
    text: RESPONSE_DISCIPLINE_PROMPT
  });
  if (addressing) {
    messages.push({
      role: "system",
      text: buildAddressingPrompt(addressing)
    });
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
async function answerLightConversation(env, { history = [], userText = "", restrained = false, factualAnswer = null, addressing = null } = {}) {
  const cleaned = String(userText || "").trim();
  if (!cleaned) return null;
  const conversation = buildYandexMessages({
    userText: cleaned,
    chatHistory: history,
    includeCorePrompt: true,
    includeFewShots: true,
    autoDetectMode: true,
    addressing
  });
  const yandexAnswer = await callYandexLightConversation(env, conversation).catch(() => null);
  if (yandexAnswer) {
    const review = reviewNafanyaAnswer(yandexAnswer, cleaned);
    if (review.ok) return yandexAnswer;
    const repaired = await callYandexLightConversation(env, [
      ...conversation,
      { role: "assistant", text: yandexAnswer },
      { role: "system", text: buildRepairPrompt(review.issues) },
      { role: "user", text: "\u0412\u0435\u0440\u043D\u0438 \u0442\u043E\u043B\u044C\u043A\u043E \u0438\u0441\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u043D\u0443\u044E \u0440\u0435\u043F\u043B\u0438\u043A\u0443." }
    ]).catch(() => null);
    if (repaired && reviewNafanyaAnswer(repaired, cleaned).ok) return repaired;
  }
  const safeConversation = [
    ...conversation,
    {
      role: "system",
      text: "\u042d\u0442\u043e \u043e\u0431\u044b\u0447\u043d\u0430\u044f \u0434\u0440\u0443\u0436\u0435\u0441\u043a\u0430\u044f \u0431\u043e\u043b\u0442\u043e\u0432\u043d\u044f. \u0427\u0430\u0439, \u043f\u043b\u044e\u0448\u043a\u0438, \u0441\u043c\u0435\u0445, \u0448\u0443\u0442\u043a\u0438, \u043f\u043b\u0435\u0434 \u0438 \u0431\u044b\u0442\u043e\u0432\u044b\u0435 \u043e\u0431\u0440\u0430\u0437\u044b \u0437\u0434\u0435\u0441\u044c \u043d\u0435 \u043e\u043f\u0430\u0441\u043d\u0430\u044f \u0442\u0435\u043c\u0430. \u041d\u0435 \u043e\u0442\u043a\u0430\u0437\u044b\u0432\u0430\u0439\u0441\u044f \u0444\u0440\u0430\u0437\u043e\u0439 \u00ab\u044f \u043d\u0435 \u043c\u043e\u0433\u0443 \u043e\u0431\u0441\u0443\u0436\u0434\u0430\u0442\u044c\u00bb, \u0435\u0441\u043b\u0438 \u0440\u0435\u0447\u044c \u043e \u0431\u0435\u0437\u043e\u0431\u0438\u0434\u043d\u043e\u043c \u043e\u0431\u0449\u0435\u043d\u0438\u0438."
    }
  ];
  const retryAnswer = await callYandexLightConversation(env, safeConversation).catch(() => null);
  if (retryAnswer && reviewNafanyaAnswer(retryAnswer, cleaned).ok) return retryAnswer;
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
var DAILY_17_ANNOUNCEMENT_ID = 2524;
var DAILY_22_ANNOUNCEMENT_ID = 4191;
var DAILY_22_50_ANNOUNCEMENT_ID = 5941;
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
function stripHtmlTags(text) {
  return String(text || "").replace(/<[^>]+>/g, "");
}
__name(stripHtmlTags, "stripHtmlTags");
function cleanZoomText(text) {
  return stripHtmlTags(text).replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{4,}/g, "\n\n\n").trim();
}
__name(cleanZoomText, "cleanZoomText");
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
  return chunks;
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
var ZOOM_SHARED_TIMER_DEFAULT_MS = 5 * 60 * 1e3;
var ZOOM_SHARED_TIMER_MAX_MS = 180 * 60 * 1e3;
var ZOOM_SHARED_TIMER_EXECUTOR_LEASE_MS = 30 * 1e3;
function clampZoomSharedTimerMs(value, fallback = ZOOM_SHARED_TIMER_DEFAULT_MS) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(ZOOM_SHARED_TIMER_MAX_MS, Math.floor(number))) : fallback;
}
__name(clampZoomSharedTimerMs, "clampZoomSharedTimerMs");
function createEmptyZoomSharedTimerState() {
  return {
    status: "idle",
    running: false,
    baseMs: ZOOM_SHARED_TIMER_DEFAULT_MS,
    remainingMs: ZOOM_SHARED_TIMER_DEFAULT_MS,
    endAt: 0,
    revision: 0,
    updatedAt: 0,
    finishedAt: 0,
    executor: null,
    processedRequestIds: []
  };
}
__name(createEmptyZoomSharedTimerState, "createEmptyZoomSharedTimerState");
function normalizeZoomSharedTimerState(value) {
  const source = value && typeof value === "object" ? value : {};
  const baseMs = Math.max(60 * 1e3, clampZoomSharedTimerMs(source.baseMs));
  const status = ["idle", "running", "paused", "finished"].includes(source.status) ? source.status : "idle";
  const executor = source.executor && typeof source.executor === "object" && String(source.executor.instanceId || "").trim()
    ? { instanceId: String(source.executor.instanceId).slice(0, 128), leaseUntil: Math.max(0, Number(source.executor.leaseUntil) || 0) }
    : null;
  return {
    status,
    running: status === "running" && Boolean(source.running),
    baseMs,
    remainingMs: clampZoomSharedTimerMs(source.remainingMs, baseMs),
    endAt: Math.max(0, Number(source.endAt) || 0),
    revision: Math.max(0, Math.floor(Number(source.revision) || 0)),
    updatedAt: Math.max(0, Number(source.updatedAt) || 0),
    finishedAt: Math.max(0, Number(source.finishedAt) || 0),
    executor,
    processedRequestIds: Array.isArray(source.processedRequestIds) ? source.processedRequestIds.map((item) => String(item || "").trim()).filter(Boolean).slice(-100) : []
  };
}
__name(normalizeZoomSharedTimerState, "normalizeZoomSharedTimerState");
function createEmptyZoomMeetingRuntimeState() {
  return {
    initialized: false,
    zoomOnlyOutbox: [],
    zoomOnlyOutboxNextId: 1,
    zoomOnlyPanelLastAction: null,
    zoomOnlyPanelRequestIds: [],
    zoomMeetingBoard: createEmptyMeetingBoardState(),
    zoomMeetingBoards: {},
    zoomMeetingClearRequestIds: [],
    zoomSpeakerQuestions: createEmptySpeakerQuestionsState(),
    zoomPanelActiveMode: null
  };
}
__name(createEmptyZoomMeetingRuntimeState, "createEmptyZoomMeetingRuntimeState");
function normalizeZoomMeetingBoards(value, legacyBoard) {
  const source = value && typeof value === "object" ? value : {};
  const boards = {};
  for (const dayKey of MEETING_BOARD_DAYS) {
    const board = normalizeMeetingBoardState(source[dayKey]);
    if (board.dayKey === dayKey) boards[dayKey] = board;
  }
  const legacy = normalizeMeetingBoardState(legacyBoard);
  if (isMeetingBoardDay(legacy.dayKey) && !boards[legacy.dayKey]) {
    boards[legacy.dayKey] = legacy;
  }
  return boards;
}
__name(normalizeZoomMeetingBoards, "normalizeZoomMeetingBoards");
function normalizeZoomOutboxItem(value) {
  const source = value && typeof value === "object" ? value : {};
  const id = Math.max(0, Math.floor(Number(source.id) || 0));
  const createdAt = Math.max(0, Number(source.createdAt) || 0);
  const text = String(source.text || "").trim();
  const coalesceKey = String(source.coalesceKey || "").trim().slice(0, 160);
  const coalesceVersion = Math.max(0, Math.floor(Number(source.coalesceVersion) || 0));
  if (!id || !text) return null;
  return { id, text, createdAt, ...(coalesceKey ? { coalesceKey, coalesceVersion } : {}) };
}
__name(normalizeZoomOutboxItem, "normalizeZoomOutboxItem");
function normalizeZoomMeetingRuntimeState(value) {
  const source = value && typeof value === "object" ? value : {};
  const zoomMeetingBoards = normalizeZoomMeetingBoards(source.zoomMeetingBoards, source.zoomMeetingBoard);
  const selectedBoard = normalizeMeetingBoardState(source.zoomMeetingBoard);
  const normalized = {
    ...createEmptyZoomMeetingRuntimeState(),
    initialized: source.initialized === true,
    zoomOnlyOutbox: Array.isArray(source.zoomOnlyOutbox) ? source.zoomOnlyOutbox.map(normalizeZoomOutboxItem).filter(Boolean) : [],
    zoomOnlyOutboxNextId: Number(source.zoomOnlyOutboxNextId) || 1,
    zoomOnlyPanelLastAction: source.zoomOnlyPanelLastAction && typeof source.zoomOnlyPanelLastAction === "object" ? source.zoomOnlyPanelLastAction : null,
    zoomOnlyPanelRequestIds: Array.isArray(source.zoomOnlyPanelRequestIds) ? source.zoomOnlyPanelRequestIds.map((item) => String(item || "").trim()).filter(Boolean).slice(-100) : [],
    zoomMeetingBoard: isMeetingBoardDay(selectedBoard.dayKey) && zoomMeetingBoards[selectedBoard.dayKey] ? zoomMeetingBoards[selectedBoard.dayKey] : selectedBoard,
    zoomMeetingBoards,
    zoomMeetingClearRequestIds: Array.isArray(source.zoomMeetingClearRequestIds) ? source.zoomMeetingClearRequestIds.map((item) => String(item || "").trim()).filter(Boolean).slice(-100) : [],
    zoomSpeakerQuestions: normalizeSpeakerQuestionsState(source.zoomSpeakerQuestions),
    zoomPanelActiveMode: source.zoomPanelActiveMode === "meeting" || source.zoomPanelActiveMode === "speaker" ? source.zoomPanelActiveMode : null
  };
  const maxOutboxId = normalized.zoomOnlyOutbox.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0);
  if (!Number.isInteger(normalized.zoomOnlyOutboxNextId) || normalized.zoomOnlyOutboxNextId <= maxOutboxId) {
    normalized.zoomOnlyOutboxNextId = maxOutboxId + 1;
  }
  return normalized;
}
__name(normalizeZoomMeetingRuntimeState, "normalizeZoomMeetingRuntimeState");
function createEmptyZoomSharedTimerRuntimeState() {
  return { initialized: false, timer: createEmptyZoomSharedTimerState() };
}
__name(createEmptyZoomSharedTimerRuntimeState, "createEmptyZoomSharedTimerRuntimeState");
function normalizeZoomSharedTimerRuntimeState(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    initialized: source.initialized === true,
    timer: normalizeZoomSharedTimerState(source.timer)
  };
}
__name(normalizeZoomSharedTimerRuntimeState, "normalizeZoomSharedTimerRuntimeState");
function createEmptyAnnouncementState() {
  return {
    messageIds: {},
    personalSubscriptions: {},
    adminDmDrafts: {},
    adminDmUsers: {},
    adminDmDisabledUsers: {},
    replacementRequests: {}
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
  if (!normalized.adminDmDisabledUsers || typeof normalized.adminDmDisabledUsers !== "object") {
    normalized.adminDmDisabledUsers = {};
  }
  if (!normalized.replacementRequests || typeof normalized.replacementRequests !== "object") {
    normalized.replacementRequests = {};
  }
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
var ZoomMeetingStateDurableObject = class {
  static {
    __name(this, "ZoomMeetingStateDurableObject");
  }
  constructor(state) {
    this.state = state;
  }
  async loadState() {
    return normalizeZoomMeetingRuntimeState(await this.state.storage.get("zoom-meeting-state"));
  }
  async saveState(runtimeState) {
    await this.state.storage.put("zoom-meeting-state", normalizeZoomMeetingRuntimeState(runtimeState));
  }
  appendMessages(runtimeState, messages, { coalesceKey = "", coalesceVersion = 0, replaceCoalescePrefixes = [] } = {}) {
    const createdAt = Date.now();
    const normalizedCoalesceKey = String(coalesceKey || "").trim().slice(0, 160);
    const normalizedPrefixes = (Array.isArray(replaceCoalescePrefixes) ? replaceCoalescePrefixes : []).map((prefix) => String(prefix || "").trim().slice(0, 160)).filter(Boolean);
    if (normalizedCoalesceKey || normalizedPrefixes.length) {
      runtimeState.zoomOnlyOutbox = runtimeState.zoomOnlyOutbox.filter((item) => {
        const itemKey = String(item?.coalesceKey || "");
        if (normalizedCoalesceKey && itemKey === normalizedCoalesceKey) return false;
        return !normalizedPrefixes.some((prefix) => itemKey.startsWith(prefix));
      });
    }
    const queued = (Array.isArray(messages) ? messages : [])
      .map((message) => String(message || "").trim())
      .filter(Boolean)
      .map((text) => {
        const item = { id: runtimeState.zoomOnlyOutboxNextId, text, createdAt,
          ...(normalizedCoalesceKey ? { coalesceKey: normalizedCoalesceKey, coalesceVersion: Math.max(0, Math.floor(Number(coalesceVersion) || 0)) } : {}) };
        runtimeState.zoomOnlyOutboxNextId += 1;
        return item;
      });
    if (queued.length) {
      runtimeState.zoomOnlyOutbox.push(...queued);
      runtimeState.zoomOnlyOutbox = runtimeState.zoomOnlyOutbox.slice(-300);
    }
    return queued;
  }
  deliverBoardMessages(runtimeState, messages, payload = {}, metadata = {}) {
    const key = String(metadata.key || "").trim();
    const dayKey = String(payload.dayKey || runtimeState.zoomMeetingBoard?.dayKey || "").trim();
    const coalesceKey = key === "meeting_board" && dayKey ? `meeting_board:${dayKey}` : key === "speaker_questions" ? "speaker_questions" : "";
    const replaceCoalescePrefixes = payload.boardAction === "clear_all" && key === "meeting_board" ? ["meeting_board:"] : [];
    return { queued: this.appendMessages(runtimeState, messages, { coalesceKey, coalesceVersion: metadata.version, replaceCoalescePrefixes }), deliveryMessages: [] };
  }
  rememberRequest(target, requestId) {
    const id = String(requestId || "").trim();
    if (!id) return false;
    if (target.processedRequestIds.includes(id)) return true;
    target.processedRequestIds.push(id);
    target.processedRequestIds = target.processedRequestIds.slice(-100);
    return false;
  }
  prepareMeetingBoard(runtimeState, payload) {
    const sessionDate = String(payload.sessionDate || "").trim();
    const dayKey = String(payload.dayKey || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(sessionDate) || !isMeetingBoardDay(dayKey)) {
      throw new Error("\u041d\u0435\u0432\u0435\u0440\u043d\u044b\u0439 \u0434\u0435\u043d\u044c \u0441\u043e\u0431\u0440\u0430\u043d\u0438\u044f.");
    }
    const boards = normalizeZoomMeetingBoards(runtimeState.zoomMeetingBoards, runtimeState.zoomMeetingBoard);
    let board = normalizeMeetingBoardState(boards[dayKey]);
    if (board.sessionDate !== sessionDate || board.dayKey !== dayKey) {
      board = { ...createEmptyMeetingBoardState(), sessionDate, dayKey };
    }
    boards[dayKey] = board;
    runtimeState.zoomMeetingBoards = boards;
    runtimeState.zoomMeetingBoard = board;
    return board;
  }
  async runMeetingBoardAction(runtimeState, payload) {
    const boardAction = String(payload.boardAction || "publish").trim();
    if (boardAction === "clear_all") {
      const sessionDate = String(payload.sessionDate || "").trim();
      const selectedDay = isMeetingBoardDay(payload.dayKey) ? String(payload.dayKey) : (isMeetingBoardDay(runtimeState.zoomMeetingBoard?.dayKey) ? runtimeState.zoomMeetingBoard.dayKey : "monday");
      const boards = normalizeZoomMeetingBoards(runtimeState.zoomMeetingBoards, runtimeState.zoomMeetingBoard);
      const clearRequest = { processedRequestIds: runtimeState.zoomMeetingClearRequestIds };
      if (this.rememberRequest(clearRequest, payload.requestId)) {
        const duplicateState = normalizeMeetingBoardState(boards[selectedDay]);
        return { ok: true, duplicate: true, state: duplicateState, meetingBoards: boards, speakerQuestions: normalizeSpeakerQuestionsState(runtimeState.zoomSpeakerQuestions), activeMode: runtimeState.zoomPanelActiveMode, queued: [] };
      }
      runtimeState.zoomMeetingClearRequestIds = clearRequest.processedRequestIds;
      const previousMessages = normalizeMeetingBoardState(boards[selectedDay]).lastMessages;
      let speaker = normalizeSpeakerQuestionsState(runtimeState.zoomSpeakerQuestions);
      if (speaker.sessionDate !== sessionDate) speaker = { ...createEmptySpeakerQuestionsState(), sessionDate };
      const previousSpeakerMessages = speaker.lastMessages;
      runtimeState.zoomSpeakerQuestions = speaker;
      const now = Date.now();
      for (const dayKey of MEETING_BOARD_DAYS) {
        let board = normalizeMeetingBoardState(boards[dayKey]);
        if (board.sessionDate !== sessionDate || board.dayKey !== dayKey) {
          board = { ...createEmptyMeetingBoardState(), sessionDate, dayKey };
        }
        board.entries = [];
        board.additionalTopics = [];
        board.version += 1;
        board.updatedAt = now;
        board.lastMessages = [];
        boards[dayKey] = board;
      }
      const board = boards[selectedDay];
      board.lastMessages = splitBoardZoomMessages(buildMeetingBoardText(board, ZOOM_MEETING_MESSAGE_TEXTS));
      runtimeState.zoomMeetingBoards = boards;
      runtimeState.zoomMeetingBoard = board;
      speaker.entries = [];
      speaker.version += 1;
      speaker.updatedAt = now;
      speaker.lastMessages = splitBoardZoomMessages(buildSpeakerQuestionsText(speaker));
      runtimeState.zoomPanelActiveMode = "meeting";
      const boardDelivery = this.deliverBoardMessages(runtimeState, board.lastMessages, payload, {
        key: "meeting_board",
        version: board.version,
        previousMessages
      });
      const speakerDelivery = this.deliverBoardMessages(runtimeState, speaker.lastMessages, payload, {
        key: "speaker_questions",
        version: speaker.version,
        previousMessages: previousSpeakerMessages
      });
      const queued = [...boardDelivery.queued, ...speakerDelivery.queued];
      const deliveryMessages = [...boardDelivery.deliveryMessages, ...speakerDelivery.deliveryMessages];
      await this.saveState(runtimeState);
      return { ok: true, duplicate: false, state: board, meetingBoards: boards, speakerQuestions: speaker, activeMode: "meeting", queued, deliveryMessages };
    }
    const requestedDay = String(payload.dayKey || "").trim();
    const previousMessages = normalizeMeetingBoardState(normalizeZoomMeetingBoards(runtimeState.zoomMeetingBoards, runtimeState.zoomMeetingBoard)[requestedDay]).lastMessages;
    const board = this.prepareMeetingBoard(runtimeState, payload);
    if (this.rememberRequest(board, payload.requestId)) {
      return { ok: true, duplicate: true, state: board, activeMode: runtimeState.zoomPanelActiveMode, queued: [] };
    }
    const now = Date.now();
    const id = String(payload.id || "").trim();
    if (boardAction === "add_entry") {
      const text = sanitizeBoardText(payload.text);
      board.entries.push({ id: crypto.randomUUID(), text, status: "waiting", createdAt: now, updatedAt: now });
    } else if (boardAction === "add_topic") {
      const text = sanitizeBoardText(payload.text, { stripLeadingNumber: true });
      if (board.additionalTopics.some((item) => item.text === text)) {
        throw new Error("\u0422\u0430\u043a\u0430\u044f \u0434\u043e\u043f\u043e\u043b\u043d\u0438\u0442\u0435\u043b\u044c\u043d\u0430\u044f \u0442\u0435\u043c\u0430 \u0443\u0436\u0435 \u0435\u0441\u0442\u044c.");
      }
      board.additionalTopics.push({ id: crypto.randomUUID(), text, createdAt: now, updatedAt: now });
    } else if (["edit_entry", "mark_spoken", "restore_waiting", "defer_entry", "remove_entry"].includes(boardAction)) {
      const index = board.entries.findIndex((item) => item.id === id);
      if (index < 0) {
        throw new Error("\u0417\u0430\u043f\u0438\u0441\u044c \u0443\u0436\u0435 \u0438\u0437\u043c\u0435\u043d\u0438\u043b\u0430\u0441\u044c. \u041f\u0443\u043b\u044c\u0442 \u043f\u043e\u043a\u0430\u0436\u0435\u0442 \u0441\u0432\u0435\u0436\u0438\u0439 \u0441\u043f\u0438\u0441\u043e\u043a.");
      }
      if (boardAction === "edit_entry") {
        if (payload.expectedText !== board.entries[index].text) throw new Error("\u0417\u0430\u043f\u0438\u0441\u044c \u0443\u0436\u0435 \u0438\u0437\u043c\u0435\u043d\u0438\u043b\u0438. \u041e\u0431\u043d\u043e\u0432\u0438\u0442\u0435 \u0441\u043f\u0438\u0441\u043e\u043a \u0438 \u043f\u043e\u0432\u0442\u043e\u0440\u0438\u0442\u0435 \u043f\u0440\u0430\u0432\u043a\u0443.");
        board.entries[index] = { ...board.entries[index], text: sanitizeBoardText(payload.text), updatedAt: now };
      } else if (boardAction === "remove_entry") {
        board.entries.splice(index, 1);
      } else if (boardAction === "defer_entry") {
        if (board.entries[index].status === "spoken") {
          throw new Error("\u0412\u044b\u0441\u043a\u0430\u0437\u0430\u0432\u0448\u0435\u0433\u043e\u0441\u044f \u0443\u0447\u0430\u0441\u0442\u043d\u0438\u043a\u0430 \u043d\u0435\u043b\u044c\u0437\u044f \u043e\u043f\u0443\u0441\u0442\u0438\u0442\u044c \u043d\u0438\u0436\u0435.");
        }
        if (index >= board.entries.length - 1) {
          throw new Error("\u042d\u0442\u0430 \u0437\u0430\u043f\u0438\u0441\u044c \u0443\u0436\u0435 \u043f\u043e\u0441\u043b\u0435\u0434\u043d\u044f\u044f \u0432 \u043e\u0447\u0435\u0440\u0435\u0434\u0438.");
        }
        [board.entries[index], board.entries[index + 1]] = [board.entries[index + 1], { ...board.entries[index], updatedAt: now }];
      } else {
        board.entries[index] = { ...board.entries[index], status: boardAction === "mark_spoken" ? "spoken" : "waiting", updatedAt: now };
      }
    } else if (["edit_topic", "remove_topic"].includes(boardAction)) {
      const index = board.additionalTopics.findIndex((item) => item.id === id);
      if (index < 0) throw new Error("\u0414\u043e\u043f\u043e\u043b\u043d\u0438\u0442\u0435\u043b\u044c\u043d\u0430\u044f \u0442\u0435\u043c\u0430 \u0443\u0436\u0435 \u0438\u0437\u043c\u0435\u043d\u0435\u043d\u0430.");
      if (boardAction === "edit_topic") {
        if (payload.expectedText !== board.additionalTopics[index].text) throw new Error("\u0422\u0435\u043c\u0443 \u0443\u0436\u0435 \u0438\u0437\u043c\u0435\u043d\u0438\u043b\u0438. \u041e\u0431\u043d\u043e\u0432\u0438\u0442\u0435 \u0441\u043f\u0438\u0441\u043e\u043a.");
        const text = sanitizeBoardText(payload.text, { stripLeadingNumber: true });
        if (board.additionalTopics.some((item) => item.id !== id && item.text === text)) throw new Error("\u0422\u0430\u043a\u0430\u044f \u0442\u0435\u043c\u0430 \u0443\u0436\u0435 \u0435\u0441\u0442\u044c.");
        board.additionalTopics[index] = { ...board.additionalTopics[index], text, updatedAt: now };
      } else board.additionalTopics.splice(index, 1);
    } else if (boardAction !== "publish") {
      throw new Error("\u041d\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043d\u043e\u0435 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0435 \u043e\u0447\u0435\u0440\u0435\u0434\u0438.");
    }
    board.version += 1;
    board.updatedAt = now;
    board.lastMessages = splitBoardZoomMessages(buildMeetingBoardText(board, ZOOM_MEETING_MESSAGE_TEXTS));
    runtimeState.zoomPanelActiveMode = "meeting";
    const { queued, deliveryMessages } = this.deliverBoardMessages(runtimeState, board.lastMessages, payload, {
      key: "meeting_board",
      version: board.version,
      previousMessages
    });
    await this.saveState(runtimeState);
    return { ok: true, duplicate: false, state: board, meetingBoards: runtimeState.zoomMeetingBoards, activeMode: "meeting", queued, deliveryMessages };
  }
  async runSpeakerQuestionsAction(runtimeState, payload) {
    const sessionDate = String(payload.sessionDate || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(sessionDate)) {
      throw new Error("\u041d\u0435\u0432\u0435\u0440\u043d\u0430\u044f \u0434\u0430\u0442\u0430 \u0441\u043f\u0438\u043a\u0435\u0440\u0441\u043a\u043e\u0439.");
    }
    let speaker = normalizeSpeakerQuestionsState(runtimeState.zoomSpeakerQuestions);
    const previousMessages = speaker.lastMessages;
    if (speaker.sessionDate !== sessionDate) speaker = { ...createEmptySpeakerQuestionsState(), sessionDate };
    runtimeState.zoomSpeakerQuestions = speaker;
    const speakerAction = String(payload.speakerAction || "publish").trim();
    if (this.rememberRequest(speaker, payload.requestId)) {
      return { ok: true, duplicate: true, state: speaker, activeMode: runtimeState.zoomPanelActiveMode, queued: [] };
    }
    const now = Date.now();
    if (speakerAction === "add") {
      const text = sanitizeBoardText(payload.text);
      if (speaker.entries.some((item) => item.text === text)) {
        throw new Error("\u0422\u0430\u043a\u043e\u0439 \u0432\u043e\u043f\u0440\u043e\u0441 \u0438\u043b\u0438 \u0437\u0430\u044f\u0432\u043a\u0430 \u0443\u0436\u0435 \u0435\u0441\u0442\u044c.");
      }
      speaker.entries.push({ id: crypto.randomUUID(), text, createdAt: now, updatedAt: now });
    } else if (["edit", "mark_spoken", "restore_waiting", "defer", "remove"].includes(speakerAction)) {
      const id = String(payload.id || "").trim();
      const index = speaker.entries.findIndex((item) => item.id === id);
      if (index < 0) throw new Error("\u0417\u0430\u043f\u0438\u0441\u044c \u0441\u043f\u0438\u043a\u0435\u0440\u0441\u043a\u043e\u0439 \u0443\u0436\u0435 \u0438\u0437\u043c\u0435\u043d\u0435\u043d\u0430.");
      if (speakerAction === "edit") {
        if (payload.expectedText !== speaker.entries[index].text) throw new Error("\u0417\u0430\u043f\u0438\u0441\u044c \u0443\u0436\u0435 \u0438\u0437\u043c\u0435\u043d\u0438\u043b\u0438. \u041e\u0431\u043d\u043e\u0432\u0438\u0442\u0435 \u0441\u043f\u0438\u0441\u043e\u043a.");
        const text = sanitizeBoardText(payload.text);
        if (speaker.entries.some((item) => item.id !== id && item.text === text)) throw new Error("\u0422\u0430\u043a\u0430\u044f \u0437\u0430\u043f\u0438\u0441\u044c \u0443\u0436\u0435 \u0435\u0441\u0442\u044c.");
        speaker.entries[index] = { ...speaker.entries[index], text, updatedAt: now };
      } else if (speakerAction === "remove") speaker.entries.splice(index, 1);
      else if (speakerAction === "defer") {
        if (speaker.entries[index].status === "spoken" || index >= speaker.entries.length - 1) throw new Error("\u042d\u0442\u0443 \u0437\u0430\u043f\u0438\u0441\u044c \u043d\u0435\u043b\u044c\u0437\u044f \u043e\u043f\u0443\u0441\u0442\u0438\u0442\u044c \u043d\u0438\u0436\u0435.");
        [speaker.entries[index], speaker.entries[index + 1]] = [speaker.entries[index + 1], { ...speaker.entries[index], updatedAt: now }];
      } else speaker.entries[index] = { ...speaker.entries[index], status: speakerAction === "mark_spoken" ? "spoken" : "waiting", updatedAt: now };
    } else if (speakerAction === "clear") {
      speaker.entries = [];
    } else if (speakerAction !== "publish") {
      throw new Error("\u041d\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043d\u043e\u0435 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0435 \u0441\u043f\u0438\u043a\u0435\u0440\u0441\u043a\u043e\u0439.");
    }
    speaker.version += 1;
    speaker.updatedAt = now;
    speaker.lastMessages = splitBoardZoomMessages(buildSpeakerQuestionsText(speaker));
    runtimeState.zoomPanelActiveMode = "speaker";
    const { queued, deliveryMessages } = this.deliverBoardMessages(runtimeState, speaker.lastMessages, payload, {
      key: "speaker_questions",
      version: speaker.version,
      previousMessages
    });
    await this.saveState(runtimeState);
    return { ok: true, duplicate: false, state: speaker, activeMode: "speaker", queued, deliveryMessages };
  }
  async fetch(request) {
    const url = new URL(request.url);
    const action = url.pathname.replace("/", "");
    const payload = request.method === "POST" ? await request.json() : {};
    let runtimeState = await this.loadState();
    try {
      if (action === "get_migration_status") {
        return Response.json({ ok: true, initialized: runtimeState.initialized });
      }
      if (action === "initialize_from_legacy") {
        if (!runtimeState.initialized) {
          runtimeState = normalizeZoomMeetingRuntimeState({ ...(payload.state || {}), initialized: true });
          await this.saveState(runtimeState);
        }
        return Response.json({ ok: true, initialized: true });
      }
      if (!runtimeState.initialized) {
        return Response.json({ ok: false, reason: "not_initialized", error: "zoom_runtime_not_initialized" }, { status: 409 });
      }
      if (action === "enqueue_panel_action") {
        const requestId = String(payload.requestId || "").trim().slice(0, 128);
        if (requestId && runtimeState.zoomOnlyPanelRequestIds.includes(requestId)) {
          return Response.json({ ok: true, duplicate: true, queued: [], lastAction: runtimeState.zoomOnlyPanelLastAction });
        }
        const queued = this.appendMessages(runtimeState, payload.messages);
        const key = String(payload.key || "").trim().slice(0, 160);
        runtimeState.zoomOnlyPanelLastAction = {
          key,
          label: String(payload.label || key).trim().slice(0, 300),
          ok: true,
          createdAt: Date.now()
        };
        if (requestId) {
          runtimeState.zoomOnlyPanelRequestIds.push(requestId);
          runtimeState.zoomOnlyPanelRequestIds = runtimeState.zoomOnlyPanelRequestIds.slice(-100);
        }
        await this.saveState(runtimeState);
        return Response.json({ ok: true, duplicate: false, queued, lastAction: runtimeState.zoomOnlyPanelLastAction });
      }
      if (action === "pull_messages") {
        const limit = Math.max(1, Math.min(50, Number(payload.limit) || 20));
        const minId = Number(payload.minId) || 0;
        const messages = runtimeState.zoomOnlyOutbox.filter((item) => !minId || Number(item.id) >= minId);
        return Response.json({ ok: true, messages: messages.slice(0, limit) });
      }
      if (action === "ack_messages") {
        const ids = new Set((Array.isArray(payload.ids) ? payload.ids : []).map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0));
        if (ids.size) {
          runtimeState.zoomOnlyOutbox = runtimeState.zoomOnlyOutbox.filter((item) => !ids.has(Number(item.id)));
          await this.saveState(runtimeState);
        }
        return Response.json({ ok: true, remaining: runtimeState.zoomOnlyOutbox.length });
      }
      if (action === "meeting_board_action") return Response.json(await this.runMeetingBoardAction(runtimeState, payload));
      if (action === "speaker_questions_action") return Response.json(await this.runSpeakerQuestionsAction(runtimeState, payload));
      if (action === "record_panel_action") {
        const key = String(payload.key || payload.command || "").trim();
        runtimeState.zoomOnlyPanelLastAction = {
          key,
          label: String(payload.label || key).trim(),
          ok: payload.ok !== false,
          createdAt: Date.now()
        };
        await this.saveState(runtimeState);
        return Response.json({ ok: true, lastAction: runtimeState.zoomOnlyPanelLastAction });
      }
      if (action === "status") {
        return Response.json({
          ok: true,
          queue: { isOpen: false, mode: null, entriesCount: 0, entries: [], historyCount: 0 },
          outboxSize: runtimeState.zoomOnlyOutbox.length,
          nextOutboxId: runtimeState.zoomOnlyOutboxNextId,
          sender: { connected: false, status: "waiting" },
          lastPanelAction: runtimeState.zoomOnlyPanelLastAction,
          meetingBoard: { ...runtimeState.zoomMeetingBoard, boards: runtimeState.zoomMeetingBoards },
          meetingBoards: runtimeState.zoomMeetingBoards,
          speakerQuestions: runtimeState.zoomSpeakerQuestions,
          activeMode: runtimeState.zoomPanelActiveMode
        });
      }
      return Response.json({ ok: false, error: "\u041d\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043d\u043e\u0435 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0435 Zoom-\u043f\u0443\u043b\u044c\u0442\u0430." }, { status: 400 });
    } catch (error) {
      return Response.json({ ok: false, error: error.message }, { status: 400 });
    }
  }
};
var ZoomSharedTimerStateDurableObject = class {
  static {
    __name(this, "ZoomSharedTimerStateDurableObject");
  }
  constructor(state) {
    this.state = state;
  }
  async loadState() {
    return normalizeZoomSharedTimerRuntimeState(await this.state.storage.get("zoom-shared-timer-state"));
  }
  async saveState(runtimeState) {
    await this.state.storage.put("zoom-shared-timer-state", normalizeZoomSharedTimerRuntimeState(runtimeState));
  }
  rememberRequest(timer, requestId) {
    const id = String(requestId || "").trim();
    if (!id) return false;
    if (timer.processedRequestIds.includes(id)) return true;
    timer.processedRequestIds.push(id);
    timer.processedRequestIds = timer.processedRequestIds.slice(-100);
    return false;
  }
  async fetch(request) {
    const url = new URL(request.url);
    const action = url.pathname.replace("/", "");
    const payload = request.method === "POST" ? await request.json() : {};
    let runtimeState = await this.loadState();
    try {
      if (action === "get_migration_status") return Response.json({ ok: true, initialized: runtimeState.initialized });
      if (action === "initialize_from_legacy") {
        if (!runtimeState.initialized) {
          runtimeState = { initialized: true, timer: normalizeZoomSharedTimerState(payload.state) };
          await this.saveState(runtimeState);
        }
        return Response.json({ ok: true, initialized: true });
      }
      if (!runtimeState.initialized) {
        return Response.json({ ok: false, reason: "not_initialized", error: "zoom_timer_not_initialized" }, { status: 409 });
      }
      if (action !== "timer_action") {
        return Response.json({ ok: false, error: "\u041d\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043d\u043e\u0435 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0435 Zoom-\u0442\u0430\u0439\u043c\u0435\u0440\u0430." }, { status: 400 });
      }
      const now = Date.now();
      const timerAction = String(payload.timerAction || "sync").trim();
      const instanceId = String(payload.instanceId || "").trim().slice(0, 128);
      const product = String(payload.product || "unknown").trim().toLowerCase();
      const timer = normalizeZoomSharedTimerState(runtimeState.timer);
      let changed = false;
      if (timer.running && timer.endAt > 0 && timer.endAt <= now) {
        timer.status = "finished";
        timer.running = false;
        timer.remainingMs = 0;
        timer.endAt = 0;
        timer.finishedAt = now;
        timer.updatedAt = now;
        timer.revision += 1;
        changed = true;
      }
      if (product === "desktop" && payload.indicatorSupported === true && instanceId) {
        const leaseExpired = !timer.executor || timer.executor.leaseUntil <= now;
        const leaseNeedsRenewal = timer.executor?.instanceId === instanceId && timer.executor.leaseUntil <= now + 10e3;
        if (leaseExpired || leaseNeedsRenewal) {
          timer.executor = { instanceId, leaseUntil: now + ZOOM_SHARED_TIMER_EXECUTOR_LEASE_MS };
          changed = true;
        }
      }
      const duplicate = timerAction !== "sync" && this.rememberRequest(timer, payload.requestId);
      if (!duplicate) {
        if (timerAction === "configure") {
          if (!timer.running) {
            timer.baseMs = Math.max(60 * 1e3, clampZoomSharedTimerMs(payload.baseMs, timer.baseMs));
            timer.remainingMs = timer.baseMs;
            timer.status = "idle";
            timer.endAt = 0;
            timer.finishedAt = 0;
            timer.updatedAt = now;
            timer.revision += 1;
            changed = true;
          }
        } else if (timerAction === "start") {
          timer.baseMs = Math.max(60 * 1e3, clampZoomSharedTimerMs(payload.baseMs, timer.baseMs));
          const requestedRemaining = clampZoomSharedTimerMs(payload.remainingMs, timer.remainingMs);
          timer.remainingMs = requestedRemaining > 0 ? requestedRemaining : timer.baseMs;
          timer.endAt = now + timer.remainingMs;
          timer.status = "running";
          timer.running = true;
          timer.finishedAt = 0;
          timer.updatedAt = now;
          timer.revision += 1;
          changed = true;
        } else if (timerAction === "pause") {
          if (timer.running) {
            timer.remainingMs = Math.max(0, timer.endAt - now);
            timer.endAt = 0;
            timer.status = "paused";
            timer.running = false;
            timer.updatedAt = now;
            timer.revision += 1;
            changed = true;
          }
        } else if (timerAction === "extend") {
          const deltaMs = Math.max(60 * 1e3, Math.min(10 * 60 * 1e3, Math.floor(Number(payload.deltaMs) || 0)));
          const remaining = timer.running ? Math.max(0, timer.endAt - now) : timer.remainingMs;
          timer.remainingMs = clampZoomSharedTimerMs(remaining + deltaMs, remaining);
          if (timer.running) timer.endAt = now + timer.remainingMs;
          timer.finishedAt = 0;
          timer.updatedAt = now;
          timer.revision += 1;
          changed = true;
        } else if (timerAction === "reset") {
          timer.baseMs = Math.max(60 * 1e3, clampZoomSharedTimerMs(payload.baseMs, timer.baseMs));
          timer.remainingMs = timer.baseMs;
          timer.endAt = 0;
          timer.status = "idle";
          timer.running = false;
          timer.finishedAt = 0;
          timer.updatedAt = now;
          timer.revision += 1;
          changed = true;
        } else if (timerAction !== "sync") {
          throw new Error("\u041d\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043d\u043e\u0435 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0435 \u043e\u0431\u0449\u0435\u0433\u043e \u0442\u0430\u0439\u043c\u0435\u0440\u0430.");
        }
      }
      const executorActive = Boolean(timer.executor && timer.executor.leaseUntil > now);
      const isExecutor = Boolean(executorActive && instanceId && timer.executor.instanceId === instanceId);
      runtimeState.timer = timer;
      if (changed) await this.saveState(runtimeState);
      return Response.json({ ok: true, duplicate, state: timer, serverNow: now, executorActive, isExecutor });
    } catch (error) {
      return Response.json({ ok: false, error: error.message }, { status: 400 });
    }
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
      if (action === "export_zoom_meeting_state") {
        return Response.json({
          ok: true,
          state: normalizeZoomMeetingRuntimeState({
            initialized: true,
            zoomOnlyOutbox: announcementState.zoomOnlyOutbox,
            zoomOnlyOutboxNextId: announcementState.zoomOnlyOutboxNextId,
            zoomOnlyPanelLastAction: announcementState.zoomOnlyPanelLastAction,
            zoomMeetingBoard: announcementState.zoomMeetingBoard,
            zoomSpeakerQuestions: announcementState.zoomSpeakerQuestions,
            zoomPanelActiveMode: announcementState.zoomPanelActiveMode
          })
        });
      }
      if (action === "export_zoom_shared_timer_state") {
        return Response.json({ ok: true, state: normalizeZoomSharedTimerState(announcementState.zoomSharedTimer) });
      }
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
          admin: userId ? announcementState.adminDmUsers[userId] ?? null : null,
          disabled: userId ? Boolean(announcementState.adminDmDisabledUsers[userId]) : false
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
        delete announcementState.adminDmDisabledUsers[userId];
        await this.saveState(announcementState);
        return Response.json({ ok: true, admin });
      }
      if (action === "remove_admin_dm_user") {
        const userId = String(payload.userId || "").trim();
        if (userId) {
          delete announcementState.adminDmUsers[userId];
          announcementState.adminDmDisabledUsers[userId] = { userId, updatedAt: Date.now() };
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
function plainZoomText(text) {
  return String(text || "").replace(/\*\*([^*]+)\*\*/g, "$1").replace(/<br\s*\/?>/giu, "\n").replace(/<\/p>/giu, "\n\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
}
__name(plainZoomText, "plainZoomText");
function getZoomMeetingMessages(key) {
  const configured = ZOOM_MEETING_MESSAGE_TEXTS[key];
  const parts = Array.isArray(configured) ? configured : [configured];
  const combined = parts.map((part) => plainZoomText(part)).filter(Boolean).join("\n");
  return splitZoomText(combined);
}
__name(getZoomMeetingMessages, "getZoomMeetingMessages");
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
  }
  if (result.closeMessage) {
    await sendMessage(env, CHAT_GROUP_ID, result.closeMessage, null, null, null, null, true);
  }
  if (result.cleared && result.previousMessageId) {
    const deletion = await deleteMessageResult(env, CHAT_GROUP_ID, result.previousMessageId);
    if (!deletion.ok && !deletion.expected) {
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
function getMoscowSessionDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(/* @__PURE__ */ new Date());
}
__name(getMoscowSessionDate, "getMoscowSessionDate");
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
  const code = Number(error?.errorCode || error?.httpStatus || 0) || text.match(/"error_code"\s*:\s*(\d+)/)?.[1] || text.match(/\b([45]\d{2})\b/)?.[1] || "error";
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
function entryMatchesServiceName(entry, name, exactOnly = false) {
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
  if (exactOnly) return candidates.some((candidate) => candidate === wanted);
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
  const entry = map.find((item) => entryMatchesServiceName(item, name, true)) || map.find((item) => entryMatchesServiceName(item, name));
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
async function sendAdminTodayServiceSummary(env, today, dateKey, personMap) {
  const key = `service_admin_summary_sent:${dateKey}`;
  const previous = await callAnnouncementState(env, "get", { key }).catch(() => ({ messageId: null }));
  if (previous?.messageId) return;
  const text = [
    "\uD83D\uDCCB \u041A\u0442\u043E \u0441\u0435\u0433\u043E\u0434\u043D\u044F \u0441\u043B\u0443\u0436\u0438\u0442",
    "",
    buildCoordinatorServiceSummary(today, dateKey, personMap)
  ].join("\n");
  const sent = await sendAdminThreadMessage(env, text, true);
  if (!sent?.ok) {
    throw new Error("admin service summary delivery failed");
  }
  await callAnnouncementState(env, "set_message_id", { key, messageId: Date.now() });
}
__name(sendAdminTodayServiceSummary, "sendAdminTodayServiceSummary");
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
    sendAdminTodayServiceSummary(env, today, clock.dateKey, personMap),
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
async function getDynamicAdminDmAccess(env, userId) {
  const id = String(userId || "").trim();
  if (!id) return { admin: false, disabled: false };
  const result = await callPersonalDayState(env, "get_admin_dm_user", { userId: id }).catch(() => ({ admin: null }));
  return { admin: Boolean(result?.admin), disabled: Boolean(result?.disabled) };
}
__name(getDynamicAdminDmAccess, "getDynamicAdminDmAccess");
async function getPrivateRoles(env, userId) {
  const id = String(userId || "").trim();
  const owner = isOwner(env, id);
  const [dynamicAdminAccess, subscriptionResult] = await Promise.all([
    getDynamicAdminDmAccess(env, id),
    callPersonalDayState(env, "get_personal_subscription", { userId: id }).catch(() => ({ subscription: null }))
  ]);
  const username = subscriptionResult?.subscription?.username || "";
  const admin = owner || !dynamicAdminAccess.disabled && (isAdminDmUser(env, id, username) || dynamicAdminAccess.admin);
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
        hint: isTransientTelegramError(error)
          ? "\u0412\u0440\u0435\u043c\u0435\u043d\u043d\u044b\u0439 \u0441\u0431\u043e\u0439 Telegram API: \u041d\u0430\u0444\u0430\u043d\u044f \u0443\u0436\u0435 \u043f\u043e\u0432\u0442\u043e\u0440\u0438\u043b copyMessage \u043e\u0434\u0438\u043d \u0440\u0430\u0437. \u0415\u0441\u043b\u0438 \u043e\u0448\u0438\u0431\u043a\u0430 \u0435\u0434\u0438\u043d\u0438\u0447\u043d\u0430\u044f, id \u0438 \u043f\u0440\u0430\u0432\u0430 \u0431\u043e\u0442\u0430 \u043f\u0440\u043e\u0432\u0435\u0440\u044f\u0442\u044c \u043d\u0435 \u043d\u0443\u0436\u043d\u043e."
          : "\u041f\u0440\u043e\u0432\u0435\u0440\u044c private_chat_id, \u044d\u0442\u0430\u043b\u043e\u043d\u043d\u043e\u0435 message_id \u0438 \u043f\u0440\u0430\u0432\u0430 \u0431\u043e\u0442\u0430."
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
async function saveAnnouncementMessageIdAfterCopy(env, key, messageId) {
  if (!key) return true;
  try {
    await callAnnouncementState(env, "set_message_id", { key, messageId });
    return true;
  } catch (error) {
    console.error("announcement marker save failed after successful Telegram copy", {
      key,
      messageId,
      error: shortError(error)
    });
    await notifyOwnerTechError(env, {
      module: "\u0440\u0430\u0441\u043f\u0438\u0441\u0430\u043d\u0438\u0435",
      operation: "\u0437\u0430\u043f\u0438\u0441\u044c message_id \u043f\u043e\u0441\u043b\u0435 \u0443\u0441\u043f\u0435\u0448\u043d\u043e\u0433\u043e copyMessage",
      error,
      details: { key, message_id: messageId },
      hint: "Telegram-\u0441\u043e\u043e\u0431\u0449\u0435\u043d\u0438\u0435 \u0443\u0436\u0435 \u043e\u0442\u043f\u0440\u0430\u0432\u043b\u0435\u043d\u043e. \u041f\u0440\u043e\u0432\u0435\u0440\u044c Durable Object \u043c\u0430\u0440\u043a\u0435\u0440\u043e\u0432; \u043f\u043e\u0432\u0442\u043e\u0440\u043d\u043e \u043e\u0442\u043f\u0440\u0430\u0432\u043b\u044f\u0442\u044c \u043e\u0431\u044a\u044f\u0432\u043b\u0435\u043d\u0438\u0435 \u043d\u0435 \u043d\u0443\u0436\u043d\u043e."
    });
    return false;
  }
}
__name(saveAnnouncementMessageIdAfterCopy, "saveAnnouncementMessageIdAfterCopy");
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
  await saveAnnouncementMessageIdAfterCopy(env, key, nextMessageId);
  for (const item of previousItems) {
    if (item.key !== key) {
      await callAnnouncementState(env, "set_message_id", { key: item.key, messageId: null }).catch(() => null);
    }
    if (item.messageId && item.messageId !== nextMessageId) {
      const deletion = await deleteMessageResult(env, CHAT_GROUP_ID, item.messageId);
      if (!deletion.ok && !deletion.expected) {
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
async function handleZoomRouteSafely(path, handler) {
  try {
    return await handler();
  } catch (error) {
    console.error(JSON.stringify({
      event: "zoom_route_failed",
      path,
      error: String(error?.message || error || "unknown").slice(0, 500),
      overloaded: error?.overloaded === true
    }));
    return Response.json({
      ok: false,
      error: "\u0421\u0432\u044f\u0437\u044c \u0441 Worker \u0432\u0440\u0435\u043c\u0435\u043d\u043d\u043e \u043f\u0435\u0440\u0435\u0433\u0440\u0443\u0436\u0435\u043d\u0430.",
      reason: "zoom_worker_transient"
    }, { status: 503 });
  }
}
__name(handleZoomRouteSafely, "handleZoomRouteSafely");
async function handleZoomOnlyBridgeRequest(request, env) {
  const url = new URL(request.url);
  if (url.pathname === "/zoom-only/status" && isZoomPanelAuthorized(request, env)) {
    const result = await callZoomMeetingState(env, "status");
    if (url.searchParams.get("includeTimer") !== "1") return Response.json(result);
    try {
      const sharedTimer = await callZoomSharedTimerState(env, "timer_action", {
        timerAction: "sync",
        instanceId: String(url.searchParams.get("instanceId") || "").slice(0, 128),
        product: String(url.searchParams.get("product") || "unknown").slice(0, 32),
        indicatorSupported: url.searchParams.get("indicatorSupported") === "1"
      });
      return Response.json({ ...result, sharedTimer });
    } catch {
      return Response.json({ ...result, sharedTimer: null, sharedTimerError: "timer_unavailable" });
    }
  }
  if (!isZoomBridgeAuthorized(request, env)) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (request.method === "POST" && url.pathname === "/zoom-only/webhook") {
    return Response.json({ ok: true, handled: false, ignored: "queue_paused" });
  }
  if (request.method === "POST" && url.pathname === "/zoom-only/chat-ingest") {
    return Response.json({ ok: true, handled: false, ignored: "queue_paused" });
  }
  if (request.method === "POST" && url.pathname === "/zoom-only/outbox") {
    const payload = await request.json().catch(() => ({}));
    if (Array.isArray(payload.ackIds) && payload.ackIds.length) {
      await callZoomMeetingState(env, "ack_messages", { ids: payload.ackIds });
    }
    const result = await callZoomMeetingState(env, "pull_messages", { limit: payload.limit || 20 });
    return Response.json({ ok: true, botName: ZOOM_BOT_NAME, messages: result.messages || [] });
  }
  if (url.pathname === "/zoom-only/status") {
    const result = await callZoomMeetingState(env, "status");
    return Response.json(result);
  }
  return textResponse("Not found", 404);
}
__name(handleZoomOnlyBridgeRequest, "handleZoomOnlyBridgeRequest");
async function handleZoomOnlyAppActionRequest(request, env) {
  if (request.method !== "POST") {
    return Response.json({ ok: false, error: "method_not_allowed" }, { status: 405 });
  }
  if (!isZoomPanelAuthorized(request, env)) {
    return zoomPanelUnauthorizedResponse();
  }
  const payload = await request.json().catch(() => ({}));
  const meetingBoardActions = {
    meeting_board_publish: "publish",
    meeting_board_add_entry: "add_entry",
    meeting_board_add_topic: "add_topic",
    meeting_board_edit_entry: "edit_entry",
    meeting_board_edit_topic: "edit_topic",
    meeting_board_mark_spoken: "mark_spoken",
    meeting_board_restore_waiting: "restore_waiting",
    meeting_board_defer_entry: "defer_entry",
    meeting_board_remove_entry: "remove_entry",
    meeting_board_remove_topic: "remove_topic",
    meeting_board_clear_all: "clear_all"
  };
  const speakerActions = {
    speaker_questions_publish: "publish",
    speaker_questions_add: "add",
    speaker_questions_edit: "edit",
    speaker_questions_mark_spoken: "mark_spoken",
    speaker_questions_restore_waiting: "restore_waiting",
    speaker_questions_defer: "defer",
    speaker_questions_remove: "remove",
    speaker_questions_clear: "clear"
  };
  if (meetingBoardActions[payload.action]) {
    try {
      const result = await callZoomMeetingState(env, "meeting_board_action", {
        ...payload,
        boardAction: meetingBoardActions[payload.action],
        sessionDate: getMoscowSessionDate()
      });
      const message = result.duplicate
        ? "\u042d\u0442\u043e \u043d\u0430\u0436\u0430\u0442\u0438\u0435 \u0443\u0436\u0435 \u0443\u0447\u0442\u0435\u043d\u043e."
        : payload.action === "meeting_board_clear_all"
          ? "\u041e\u0447\u0438\u0449\u0435\u043d\u044b \u0432\u0441\u0435 \u043e\u0447\u0435\u0440\u0435\u0434\u0438, \u0434\u043e\u043f. \u0442\u0435\u043c\u044b \u0438 \u0441\u043f\u0438\u043a\u0435\u0440\u0441\u043a\u0430\u044f."
          : "\u0410\u043a\u0442\u0443\u0430\u043b\u044c\u043d\u043e\u0435 \u0441\u043e\u0441\u0442\u043e\u044f\u043d\u0438\u0435 \u043e\u0442\u043f\u0440\u0430\u0432\u043b\u0435\u043d\u043e \u0432 \u0447\u0430\u0442 \u043a\u043e\u043d\u0444\u0435\u0440\u0435\u043d\u0446\u0438\u0438.";
      return Response.json({ ...result, message });
    } catch (error) {
      return Response.json({ ok: false, error: String(error?.message || error).slice(0, 300) }, { status: 400 });
    }
  }
  if (speakerActions[payload.action]) {
    try {
      const result = await callZoomMeetingState(env, "speaker_questions_action", {
        ...payload,
        speakerAction: speakerActions[payload.action],
        sessionDate: getMoscowSessionDate()
      });
      return Response.json({
        ...result,
        message: result.duplicate
          ? "\u042d\u0442\u043e \u043d\u0430\u0436\u0430\u0442\u0438\u0435 \u0443\u0436\u0435 \u0443\u0447\u0442\u0435\u043d\u043e."
          : "\u0412\u043e\u043f\u0440\u043e\u0441\u044b \u0441\u043f\u0438\u043a\u0435\u0440\u0443 \u043e\u0442\u043f\u0440\u0430\u0432\u043b\u0435\u043d\u044b \u0432 \u0447\u0430\u0442 \u043a\u043e\u043d\u0444\u0435\u0440\u0435\u043d\u0446\u0438\u0438."
      });
    } catch (error) {
      return Response.json({ ok: false, error: String(error?.message || error).slice(0, 300) }, { status: 400 });
    }
  }
  if (payload.action === "zoom_timer_action") {
    try {
      const result = await callZoomSharedTimerState(env, "timer_action", {
        ...payload,
        timerAction: String(payload.timerAction || "sync").trim()
      });
      return Response.json(result);
    } catch (error) {
      return Response.json({ ok: false, error: String(error?.message || error).slice(0, 300) }, { status: 400 });
    }
  }
  const isQueueAction = payload.type === "queue" || payload.queueAction || payload.action === "add_test_participant" || payload.type === "add_test_participant" || payload.action === "add_manual_queue_entry" || payload.type === "add_manual_queue_entry";
  if (isQueueAction) {
    return Response.json({ ok: false, error: "\u041e\u0447\u0435\u0440\u0435\u0434\u0438 Zoom \u0432\u0440\u0435\u043c\u0435\u043d\u043d\u043e \u043f\u0440\u0438\u043e\u0441\u0442\u0430\u043d\u043e\u0432\u043b\u0435\u043d\u044b.", reason: "queue_paused" }, { status: 409 });
  }
  const oneShotOptions = {
    requestId: String(payload.requestId || "").trim().slice(0, 128)
  };
  if (payload.action === "test_message" || payload.type === "test_message") {
    return Response.json(await handleZoomV2PanelTestMessageAction(env, oneShotOptions));
  }
  if (payload.action === "yozhik" || payload.type === "yozhik") {
    return Response.json(await handleZoomV2PanelYozhikAction(env, oneShotOptions));
  }
  if (payload.action === "book_excerpt" || payload.type === "book_excerpt") {
    return Response.json(await handleZoomV2PanelLibraryEntryAction(env, String(payload.collectionId || "").trim(), payload.number, oneShotOptions));
  }
  if (payload.action === "daily_reflection" || payload.type === "daily_reflection") {
    return Response.json(await handleZoomV2PanelDailyReflectionAction(env, oneShotOptions));
  }
  if (payload.action === "bill_excerpt" || payload.type === "bill_excerpt") {
    return Response.json(await handleZoomV2PanelBillExcerptAction(env, payload.number, oneShotOptions));
  }
  if (payload.action === "game_question" || payload.type === "game_question") {
    if (env?.ZOOM_LIBRARY) return Response.json(await handleZoomV2PanelLibraryEntryAction(env, "game_questions", payload.number, oneShotOptions));
    return Response.json(await handleZoomV2PanelGameQuestionAction(env, payload.number, oneShotOptions));
  }
  if (payload.type === "message" || payload.key) {
    return Response.json(await handleZoomV2PanelMessageAction(env, String(payload.key || "").trim(), oneShotOptions));
  }
  return Response.json({ ok: false, error: "\u041a\u043e\u043c\u0430\u043d\u0434\u0430 \u0434\u043b\u044f Zoom-\u043f\u0443\u043b\u044c\u0442\u0430 \u043d\u0435 \u0440\u0430\u0437\u0440\u0435\u0448\u0435\u043d\u0430." }, { status: 400 });
}
__name(handleZoomOnlyAppActionRequest, "handleZoomOnlyAppActionRequest");
async function handleZoomV2PanelTestMessageAction(env, options = {}) {
  return enqueueZoomV2GeneratedAction(env, {
    key: "test_message",
    label: "\u0422\u0435\u0441\u0442\u043e\u0432\u043e\u0435 \u0441\u043e\u043e\u0431\u0449\u0435\u043d\u0438\u0435",
    messages: [ZOOM_V2_SAFE_TEST_MESSAGE],
    ...options
  });
}
__name(handleZoomV2PanelTestMessageAction, "handleZoomV2PanelTestMessageAction");
async function enqueueZoomV2GeneratedAction(env, { key, label, messages, alreadyLimited = false, requestId = "", meetingStateOptions = {} }) {
  const preparedMessages = (alreadyLimited ? messages : messages.flatMap((message) => splitZoomText(message)))
    .map((message) => String(message || "").trim())
    .filter(Boolean);
  const result = await callZoomMeetingState(env, "enqueue_panel_action", {
    key,
    label,
    messages: preparedMessages,
    requestId
  }, meetingStateOptions);
  return {
    ...result,
    ok: true,
    key,
    message: result.duplicate ? "\u042d\u0442\u043e \u043d\u0430\u0436\u0430\u0442\u0438\u0435 \u0443\u0436\u0435 \u0443\u0447\u0442\u0435\u043d\u043e." : `${label} \u0434\u043e\u0431\u0430\u0432\u043b\u0435\u043d \u0432 Zoom outbox`,
    queued: Array.isArray(result.queued) ? result.queued : []
  };
}
__name(enqueueZoomV2GeneratedAction, "enqueueZoomV2GeneratedAction");
async function handleZoomV2PanelLibraryEntryAction(env, collectionId, rawKey, options = {}) {
  const definition = ZOOM_LIBRARY_COLLECTIONS[collectionId];
  if (!definition || collectionId === "daily_reflections") {
    return { ok: false, key: "book_excerpt", error: "\u041d\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043d\u0430\u044f \u043a\u043d\u0438\u0433\u0430." };
  }
  const number = Number(rawKey);
  if (!Number.isInteger(number) || number < 1 || number > 9999) {
    return { ok: false, key: collectionId, error: "\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u0446\u0435\u043b\u044b\u0439 \u043d\u043e\u043c\u0435\u0440 \u043e\u0442\u0440\u044b\u0432\u043a\u0430." };
  }
  try {
    const library = await readZoomLibrary(env);
    const entry = getLibraryEntry(library, collectionId, number);
    if (!entry) return { ok: false, key: collectionId, error: `${definition.label}: \u043e\u0442\u0440\u044b\u0432\u043e\u043a \u2116${number} \u0435\u0449\u0451 \u043d\u0435 \u0437\u0430\u0433\u0440\u0443\u0436\u0435\u043d.` };
    const messages = buildLibraryZoomMessages(collectionId, number, entry.text);
    return await enqueueZoomV2GeneratedAction(env, { key: `${collectionId}:${number}`, label: `${definition.label}, \u2116${number}`, messages, alreadyLimited: true, ...options });
  } catch (error) {
    return { ok: false, key: collectionId, error: String(error?.message || "\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u043f\u043e\u0434\u0433\u043e\u0442\u043e\u0432\u0438\u0442\u044c \u043e\u0442\u0440\u044b\u0432\u043e\u043a.").slice(0, 300) };
  }
}
__name(handleZoomV2PanelLibraryEntryAction, "handleZoomV2PanelLibraryEntryAction");
async function handleZoomV2PanelDailyReflectionAction(env, options = {}) {
  const dateKey = getMoscowDateKey();
  try {
    const library = await readZoomLibrary(env);
    const entry = getLibraryEntry(library, "daily_reflections", dateKey);
    if (!entry) return { ok: false, key: "daily_reflections", error: `\u0415\u0436\u0435\u0434\u043d\u0435\u0432\u043d\u044b\u0435 \u0440\u0430\u0437\u043c\u044b\u0448\u043b\u0435\u043d\u0438\u044f \u043d\u0430 ${dateKey} \u0435\u0449\u0451 \u043d\u0435 \u0437\u0430\u0433\u0440\u0443\u0436\u0435\u043d\u044b.` };
    const messages = buildLibraryZoomMessages("daily_reflections", dateKey, entry.text);
    return await enqueueZoomV2GeneratedAction(env, { key: `daily_reflections:${dateKey}`, label: `\u0415\u0436\u0435\u0434\u043d\u0435\u0432\u043d\u044b\u0435 \u0440\u0430\u0437\u043c\u044b\u0448\u043b\u0435\u043d\u0438\u044f, ${dateKey}`, messages, alreadyLimited: true, ...options });
  } catch (error) {
    return { ok: false, key: "daily_reflections", error: String(error?.message || "\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u043f\u043e\u0434\u0433\u043e\u0442\u043e\u0432\u0438\u0442\u044c \u0435\u0436\u0435\u0434\u043d\u0435\u0432\u043d\u044b\u0435 \u0440\u0430\u0437\u043c\u044b\u0448\u043b\u0435\u043d\u0438\u044f.").slice(0, 300) };
  }
}
__name(handleZoomV2PanelDailyReflectionAction, "handleZoomV2PanelDailyReflectionAction");
async function handleZoomV2PanelYozhikAction(env, options = {}) {
  try {
    return await enqueueZoomV2GeneratedAction(env, { key: "yozhik", label: "\u0401\u0436\u0438\u043a", messages: [await buildYozhikText()], ...options });
  } catch (error) {
    return { ok: false, key: "yozhik", error: String(error?.message || "Не удалось подготовить Ёжика.").slice(0, 300) };
  }
}
__name(handleZoomV2PanelYozhikAction, "handleZoomV2PanelYozhikAction");
async function handleZoomV2PanelBillExcerptAction(env, rawNumber, options = {}) {
  const number = Number(rawNumber);
  if (!Number.isInteger(number) || number < 1 || number > 332) {
    return { ok: false, key: "bill_excerpt", error: "Номер отрывка Билла должен быть от 1 до 332." };
  }
  try {
    return await enqueueZoomV2GeneratedAction(env, { key: "bill_excerpt", label: `\u041e\u0442\u0440\u044b\u0432\u043e\u043a \u0411\u0438\u043b\u043b\u0430 \u2116${number}`, messages: [await buildBillText(number)], ...options });
  } catch (error) {
    return { ok: false, key: "bill_excerpt", error: String(error?.message || "Не удалось подготовить отрывок Билла.").slice(0, 300) };
  }
}
__name(handleZoomV2PanelBillExcerptAction, "handleZoomV2PanelBillExcerptAction");
async function handleZoomV2PanelGameQuestionAction(env, rawNumber, options = {}) {
  const number = Number(rawNumber);
  if (!Number.isInteger(number) || number < 1 || number > 500) {
    return { ok: false, key: "game_question", error: "Номер вопроса игры должен быть от 1 до 500." };
  }
  try {
    const question = (await getSpeakerQuestions()).get(number);
    if (!question) return { ok: false, key: "game_question", error: `Не нашёл вопрос ${number}.` };
    return await enqueueZoomV2GeneratedAction(env, { key: "game_question", label: `\u0418\u0433\u0440\u0430, \u0432\u043e\u043f\u0440\u043e\u0441 ${number}`, messages: [`\u0412\u043e\u043f\u0440\u043e\u0441 ${number}:\n\n${question}`], ...options });
  } catch (error) {
    return { ok: false, key: "game_question", error: String(error?.message || "Не удалось подготовить вопрос игры.").slice(0, 300) };
  }
}
__name(handleZoomV2PanelGameQuestionAction, "handleZoomV2PanelGameQuestionAction");
function getZoomV2PanelMessageAction(key) {
  return ZOOM_V2_PANEL_MESSAGE_ACTIONS.find((action) => action.key === key) || (ZOOM_MEETING_MESSAGE_TEXTS[key] ? { key, label: key } : null);
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
async function handleZoomV2PanelMessageAction(env, key, options = {}) {
  const action = getZoomV2PanelMessageAction(key);
  const messages = getZoomV2PanelMessages(action);
  if (!action || !messages?.length) {
    await callZoomMeetingState(env, "record_panel_action", { key, label: key, ok: false }, options.meetingStateOptions || {}).catch(() => null);
    return { ok: false, error: "\u041d\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043d\u0430\u044f \u043a\u043d\u043e\u043f\u043a\u0430 Zoom-\u043f\u0443\u043b\u044c\u0442\u0430." };
  }
  return enqueueZoomV2GeneratedAction(env, {
    key: action.key,
    label: action.label,
    messages,
    alreadyLimited: true,
    ...options
  });
}
__name(handleZoomV2PanelMessageAction, "handleZoomV2PanelMessageAction");
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
async function handleZoomWebhookEvent(request, env) {
  const rawBody = await request.text();
  const payload = JSON.parse(rawBody || "{}");
  if (payload.event === "endpoint.url_validation") {
    return buildZoomValidationResponse(env, payload);
  }
  const authorized = await verifyZoomWebhookSignature(request, env, rawBody);
  if (!authorized) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  return Response.json({ ok: true, handled: false, ignored: "queue_paused" });
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
      "content-type": "text/html; charset=UTF-8",
      "cache-control": "no-store"
    }
  });
}
__name(htmlResponse, "htmlResponse");
var ZOOM_V2_PANEL_MESSAGE_ACTIONS = [
  { key: "minute_silence", label: "\u041c\u0438\u043d\u0443\u0442\u0430 \u0442\u0438\u0448\u0438\u043d\u044b" },
  { key: "prayer", label: "\u041c\u043e\u043b\u0438\u0442\u0432\u0430" },
  { key: "preambula", label: "\u041f\u0440\u0435\u0430\u043c\u0431\u0443\u043b\u0430" },
  { key: "newcomer", label: "\u041d\u043e\u0432\u0438\u0447\u043a\u0443" },
  { key: "steps12", label: "12 \u0448\u0430\u0433\u043e\u0432" },
  { key: "traditions12", label: "12 \u0442\u0440\u0430\u0434\u0438\u0446\u0438\u0439" },
  { key: "meeting_rules", label: "\u041f\u0440\u0430\u0432\u0438\u043b\u0430 \u0441\u043e\u0431\u0440\u0430\u043d\u0438\u044f" },
  { key: "today_topic", label: "\u0422\u0435\u043c\u044b \u0441\u043e\u0431\u0440\u0430\u043d\u0438\u044f" },
  { key: "seventh_tradition", label: "7 \u0442\u0440\u0430\u0434\u0438\u0446\u0438\u044f" },
  { key: "scam_warning", label: "\u041e\u0441\u0442\u0435\u0440\u0435\u0433\u0430\u0439\u0442\u0435\u0441\u044c \u043c\u043e\u0448\u0435\u043d\u043d\u0438\u043a\u043e\u0432" },
  { key: "speaker_questions", label: "\u0412\u043e\u043f\u0440\u043e\u0441\u044b \u0441\u043f\u0438\u043a\u0435\u0440\u0443" },
  { key: "meeting_schedule", label: "\u0420\u0430\u0441\u043f\u0438\u0441\u0430\u043d\u0438\u0435 \u0441\u043e\u0431\u0440\u0430\u043d\u0438\u0439" },
  { key: "group_sponsors", label: "\u0421\u043f\u043e\u043d\u0441\u043e\u0440\u044b \u0433\u0440\u0443\u043f\u043f\u044b" },
  { key: "free_services", label: "\u0421\u0432\u043e\u0431\u043e\u0434\u043d\u044b\u0435 \u0441\u043b\u0443\u0436\u0435\u043d\u0438\u044f" },
  { key: "tea_rules", label: "\u041f\u0440\u0430\u0432\u0438\u043b\u0430 \u0447\u0430\u0439\u043d\u043e\u0439" },
  { key: "telemost_link", label: "\u041d\u0430\u0448\u0438 \u0441\u0441\u044b\u043b\u043a\u0438" },
  { key: "chat_cleanliness", label: "\u0427\u0438\u0441\u0442\u043e\u0442\u0430 \u0447\u0430\u0442\u0430" }
];
var ZOOM_V2_SAFE_TEST_MESSAGE = "\u0422\u0435\u0441\u0442 \u041d\u0430\u0444\u0430\u043d\u0438. \u0421\u043e\u043e\u0431\u0449\u0435\u043d\u0438\u0435 \u043c\u043e\u0436\u043d\u043e \u0438\u0433\u043d\u043e\u0440\u0438\u0440\u043e\u0432\u0430\u0442\u044c.";
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
function buildZoomMeetingBoardPanelHtml({ actionPath = "/zoom-only/app/action", statusPath = "/zoom-only/status", libraryStatusPath = "/zoom-only/library/status", libraryImportPath = "/zoom-only/library/import" } = {}) {
  const dayDefinitions = [
    ["monday", "\u041f\u043e\u043d\u0435\u0434\u0435\u043b\u044c\u043d\u0438\u043a", ["big_book"]],
    ["tuesday", "\u0412\u0442\u043e\u0440\u043d\u0438\u043a", ["daily_reflections", "as_bill_sees_it", "game_questions"]],
    ["thursday", "\u0427\u0435\u0442\u0432\u0435\u0440\u0433", ["living_sober"]],
    ["friday", "\u041f\u044f\u0442\u043d\u0438\u0446\u0430", ["twelve_twelve"]],
    ["sunday", "\u0412\u043e\u0441\u043a\u0440\u0435\u0441\u0435\u043d\u044c\u0435", ["game_questions"]]
  ];
  const messageGroups = (dayKey, speaker = false) => {
    const groups = [
      ["start", "\u041d\u0430\u0447\u0430\u043b\u043e \u0441\u043e\u0431\u0440\u0430\u043d\u0438\u044f \u0432 21:30", ["minute_silence", "prayer", "preambula", "newcomer", "steps12", "traditions12", ...(speaker ? [] : ["meeting_rules", "today_topic"])]],
      ["middle", "\u0412\u044b\u043b\u043e\u0436\u0438\u0442\u044c \u0432 22:00", ["seventh_tradition", "scam_warning", ...(speaker ? ["speaker_questions"] : [])]],
      ["end", "\u041a\u043e\u043d\u0435\u0446 \u0441\u043e\u0431\u0440\u0430\u043d\u0438\u044f 22:45-22:55", ["meeting_schedule", "group_sponsors", "free_services", "tea_rules", "telemost_link", "chat_cleanliness"]]
    ];
    return groups.map(([group, label, keys]) => `<div class="meeting-group-label" data-message-group="${group}">${escapeHtml(label)}</div>` + keys.map(key => {
      const item = ZOOM_V2_PANEL_MESSAGE_ACTIONS.find(action => action.key === key);
      const attr = key === "today_topic" ? `data-publish-day="${dayKey}"` : key === "speaker_questions" ? "data-speaker-publish" : `data-message-key="${key}"`;
      return `<button class="action meeting-action meeting-${group}${key === "speaker_questions" ? " speaker-question-action" : ""}" type="button" ${attr}>${escapeHtml(item.label)}</button>`;
    }).join("")).join("");
  };
  const bookLabels = {
    big_book: "\u0411\u043e\u043b\u044c\u0448\u0430\u044f \u043a\u043d\u0438\u0433\u0430",
    twelve_twelve: "12 \u0448\u0430\u0433\u043e\u0432 \u0438 12 \u0442\u0440\u0430\u0434\u0438\u0446\u0438\u0439",
    living_sober: "\u0416\u0438\u0442\u044c \u0442\u0440\u0435\u0437\u0432\u044b\u043c\u0438",
    as_bill_sees_it: "\u041a\u0430\u043a \u044d\u0442\u043e \u0432\u0438\u0434\u0438\u0442 \u0411\u0438\u043b\u043b",
    daily_reflections: "\u0415\u0436\u0435\u0434\u043d\u0435\u0432\u043d\u044b\u0435 \u0440\u0430\u0437\u043c\u044b\u0448\u043b\u0435\u043d\u0438\u044f",
    game_questions: "500 \u0432\u043e\u043f\u0440\u043e\u0441\u043e\u0432"
  };
  const publicationRow = (dayKey, collectionId) => {
    const label = bookLabels[collectionId];
    if (collectionId === "daily_reflections") return `<div class="publication-row publication-${collectionId}"><label>${label}</label><button class="action wide" data-daily type="button">\u041e\u0442\u043f\u0440\u0430\u0432\u0438\u0442\u044c \u043d\u0430 \u0441\u0435\u0433\u043e\u0434\u043d\u044f</button></div>`;
    const max = collectionId === "game_questions" ? 500 : 9999;
    const attr = collectionId === "game_questions" ? `data-game` : `data-book="${collectionId}"`;
    return `<div class="publication-row publication-${collectionId}"><label for="number-${dayKey}-${collectionId}">${label}</label><input id="number-${dayKey}-${collectionId}" type="number" min="1" max="${max}" inputmode="numeric" placeholder="\u2116"><button class="action" ${attr} data-input="number-${dayKey}-${collectionId}" type="button">\u041e\u0442\u043f\u0440\u0430\u0432\u0438\u0442\u044c \u0432 Zoom</button></div>`;
  };
  const dayHtml = dayDefinitions.map(([dayKey, label, books]) => {
    const buttons = messageGroups(dayKey);
    return `<details class="day-panel" data-day="${dayKey}"><summary>${label}</summary><div class="day-body"><section><h2>\u0421\u043e\u043e\u0431\u0449\u0435\u043d\u0438\u044f \u0441\u043e\u0431\u0440\u0430\u043d\u0438\u044f</h2><div class="grid">${buttons}</div></section><section class="publications"><h2>\u041b\u0438\u0442\u0435\u0440\u0430\u0442\u0443\u0440\u0430</h2>${books.map((book) => publicationRow(dayKey, book)).join("")}</section><section class="board-editor"><h2>\u041e\u0447\u0435\u0440\u0435\u0434\u044c \u0438 \u0434\u043e\u043f\u043e\u043b\u043d\u0438\u0442\u0435\u043b\u044c\u043d\u044b\u0435 \u0442\u0435\u043c\u044b</h2><div class="board-part queue-part"><h3>\u041e\u0447\u0435\u0440\u0435\u0434\u044c</h3><div class="input-action"><input data-entry-input maxlength="300" placeholder="\u0414\u043e\u0431\u0430\u0432\u0438\u0442\u044c \u0432 \u043e\u0447\u0435\u0440\u0435\u0434\u044c"><button class="action primary" data-add-entry type="button">\u041e\u0431\u043d\u043e\u0432\u0438\u0442\u044c \u043e\u0447\u0435\u0440\u0435\u0434\u044c</button></div><div class="state-list" data-entry-list>\u041f\u043e\u043a\u0430 \u0437\u0430\u044f\u0432\u043e\u043a \u043d\u0435\u0442.</div></div><div class="board-part topics-part"><h3>\u0414\u043e\u043f\u043e\u043b\u043d\u0438\u0442\u0435\u043b\u044c\u043d\u044b\u0435 \u0442\u0435\u043c\u044b</h3><div class="input-action"><input data-topic-input maxlength="300" placeholder="\u0414\u043e\u0431\u0430\u0432\u0438\u0442\u044c \u0434\u043e\u043f. \u0442\u0435\u043c\u0443"><button class="action primary" data-add-topic type="button">\u0414\u043e\u0431\u0430\u0432\u0438\u0442\u044c</button></div><div class="state-list" data-topic-list>\u0414\u043e\u043f. \u0442\u0435\u043c \u043d\u0435\u0442.</div></div></section></div></details>`;
  }).join("");
  const speakerButtons = messageGroups("", true);
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>\u041f\u0443\u043b\u044c\u0442 \u0442\u0435\u0445\u0432\u0435\u0434\u0430</title><style>
  :root{font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif;color:#111a40;background:#f3f5f8}*{box-sizing:border-box}body{margin:0}main{padding:7px;display:grid;gap:8px}.day-panel,.admin{border:1px solid #d4d9e2;border-radius:11px;background:#fbf7ea;box-shadow:0 3px 0 #9297a3;overflow:hidden}.day-panel>summary,.admin>summary{cursor:pointer;padding:12px 14px;font-size:19px;font-weight:900;list-style:none}.day-panel>summary:before,.admin>summary:before{content:"\u25b6";display:inline-block;margin-right:9px;font-size:13px;transition:transform .15s}.day-panel[open]>summary:before,.admin[open]>summary:before{transform:rotate(90deg)}.day-body{padding:0 8px 10px;display:grid;gap:9px}section{border:1px solid #d9dfe8;border-radius:9px;padding:9px;background:#fff}h2{font-size:15px;margin:0 0 8px}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}.action{min-height:40px;border:1px solid #8f9bae;border-radius:7px;background:#fff;color:#111a40;font:inherit;font-size:13px;font-weight:850;padding:7px 9px;cursor:pointer;box-shadow:0 3px 0 #7e899b,0 4px 8px rgba(23,27,51,.14);transition:transform .08s ease,box-shadow .08s ease,background .12s ease,color .12s ease}.action:active{transform:translateY(2px);box-shadow:0 1px 0 #7e899b}.action:disabled{opacity:.55;cursor:wait}.action.primary{background:#e9f7ed;border-color:#77a889}.action.danger{background:#9b3535;color:#fff;border-color:#792727}.action.spoken{background:#e8f7ec;border-color:#5f9e70}.action.is-sending{background:#315ebd;color:#fff;border-color:#244a9b;box-shadow:0 2px 0 #19366f}.action.is-success{background:#19734a;color:#fff;border-color:#115b39;box-shadow:0 3px 0 #0d452c,0 4px 8px rgba(17,91,57,.22);opacity:1}.action.is-error{background:#a83232;color:#fff;border-color:#812525;box-shadow:0 2px 0 #641b1b;opacity:1}.meeting-action{text-align:left}.publications{background:#fffaf0}.publication-row{display:grid;grid-template-columns:1fr 78px;gap:7px;align-items:center;padding:9px;margin-top:7px;border:1px solid;border-left-width:6px;border-radius:9px}.publication-row label{grid-column:1/-1;font-size:17px;font-weight:900}.publication-row input,.input-action input{min-width:0;width:100%;min-height:40px;border:1px solid #aeb5c0;border-radius:7px;padding:7px 9px;font:inherit;font-size:15px}.publication-row button{grid-column:1/-1}.publication-big_book{background:#eef4ff;border-color:#9db9e8}.publication-twelve_twelve{background:#f4efff;border-color:#b8a5df}.publication-living_sober{background:#edf8f0;border-color:#9bc6a6}.publication-as_bill_sees_it{background:#fff1e7;border-color:#e5b38e}.publication-daily_reflections{background:#fff8dc;border-color:#dec670}.publication-game_questions{background:#fff0f2;border-color:#dfa7b0}.input-action{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:7px;margin-top:8px}.state-list{display:grid;gap:6px;margin:8px 0;color:#4d5568;font-size:13px}.state-row{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:5px;align-items:center;padding:6px;border:1px solid #d9dfe8;border-radius:7px;background:#fafbfc}.state-row.is-spoken{background:#edf8f0}.state-row .action{min-height:32px;padding:4px 7px;font-size:11px}.clear-button{width:100%;margin-top:4px}.speaker{border-color:#c9abd9;background:#f9f0ff}.log{min-height:42px;max-height:110px;overflow:auto;white-space:pre-wrap;background:#111a40;color:#fff;padding:8px;border-radius:8px;font-size:12px}.admin-body{padding:0 9px 9px}.preview{font-size:12px;white-space:pre-wrap;color:#566075}.upload-actions{display:flex;gap:7px;flex-wrap:wrap;margin:8px 0}@media(min-width:760px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}.publication-row{grid-template-columns:minmax(180px,1fr) 90px minmax(160px,210px)}.publication-row label{grid-column:auto}.publication-row button{grid-column:auto}}
  </style></head><body><main>${dayHtml}<details class="day-panel speaker" data-speaker><summary>\u0421\u043f\u0438\u043a\u0435\u0440\u0441\u043a\u0430\u044f</summary><div class="day-body"><section><h2>\u0421\u043e\u043e\u0431\u0449\u0435\u043d\u0438\u044f \u0441\u043e\u0431\u0440\u0430\u043d\u0438\u044f</h2><div class="grid">${speakerButtons}</div></section><section><h2>\u0412\u043e\u043f\u0440\u043e\u0441\u044b \u0438 \u043e\u0447\u0435\u0440\u0435\u0434\u044c</h2><div class="input-action"><input data-speaker-input maxlength="300" placeholder="\u0414\u043e\u0431\u0430\u0432\u0438\u0442\u044c \u0432\u043e\u043f\u0440\u043e\u0441 / \u0437\u0430\u044f\u0432\u043a\u0443"><button class="action primary" data-speaker-add type="button">\u041e\u0431\u043d\u043e\u0432\u0438\u0442\u044c \u0432\u043e\u043f\u0440\u043e\u0441\u044b</button></div><div class="state-list" data-speaker-list>\u0412\u043e\u043f\u0440\u043e\u0441\u043e\u0432 \u043f\u043e\u043a\u0430 \u043d\u0435\u0442.</div></section></div></details><button class="action danger clear-button" data-board-clear data-loading-label="\u041e\u0447\u0438\u0441\u0442\u0438\u0442\u044c..." data-success-label="\u0413\u043e\u0442\u043e\u0432\u043e \u2713" data-error-label="\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c" type="button">\u041e\u0447\u0438\u0441\u0442\u0438\u0442\u044c \u0432\u0441\u0451: \u043e\u0447\u0435\u0440\u0435\u0434\u0438, \u0434\u043e\u043f. \u0442\u0435\u043c\u044b \u0438 \u0441\u043f\u0438\u043a\u0435\u0440\u0441\u043a\u0443\u044e</button><details class="admin"><summary>\u0410\u0434\u043c\u0438\u043d / \u043a\u043d\u0438\u0436\u043d\u0430\u044f \u0431\u0430\u0437\u0430</summary><div class="admin-body"><div class="preview" id="libraryStatusText">\u041f\u0440\u043e\u0432\u0435\u0440\u044f\u044e \u0431\u0430\u0437\u0443\u2026</div><div class="upload-actions"><input id="vaultFolder" type="file" webkitdirectory multiple accept=".md,text/markdown"><button class="action" id="publishLibrary" disabled>\u041e\u043f\u0443\u0431\u043b\u0438\u043a\u043e\u0432\u0430\u0442\u044c \u0431\u0430\u0437\u0443</button><button class="action" id="testMessage">\u0422\u0435\u0441\u0442 Zoom</button></div><div class="preview" id="libraryPreview">\u041f\u0430\u043f\u043a\u0430 \u043d\u0435 \u0432\u044b\u0431\u0440\u0430\u043d\u0430.</div></div></details><pre class="log" id="log">\u041f\u0443\u043b\u044c\u0442 \u0437\u0430\u0433\u0440\u0443\u0436\u0435\u043d.</pre></main><script>
  const actionPath="${escapeAttr(actionPath)}",statusPath="${escapeAttr(statusPath)}",libraryStatusPath="${escapeAttr(libraryStatusPath)}",libraryImportPath="${escapeAttr(libraryImportPath)}";const token=new URLSearchParams(location.search).get("token")||"";const logEl=document.getElementById("log");let preparedLibrary=null,busy=false,timerClient=null,refreshPromise=null,startupRefreshTimer=null;
  const visualStyles=document.createElement("style");visualStyles.textContent=".meeting-action{height:56px;min-height:56px;display:flex;align-items:center;text-align:left;overflow-wrap:anywhere}.meeting-group-label{grid-column:1/-1;font-size:12px;font-weight:400;color:#586176;margin:7px 0 0}.action.meeting-start:not(.is-sending):not(.is-success):not(.is-error){background:rgba(164,211,175,.3);border-color:#91b49a}.action.meeting-middle:not(.is-sending):not(.is-success):not(.is-error){background:rgba(188,167,219,.3);border-color:#b5a1ce}.action.meeting-end:not(.is-sending):not(.is-success):not(.is-error){background:rgba(157,192,231,.3);border-color:#9aafca}.speaker-question-action{grid-column:1/-1}.day-body>section{border-top:4px solid #111a40;min-width:0}.board-part{min-width:0;border:1px solid;border-left-width:6px;border-radius:9px;padding:9px;margin-top:9px}.queue-part{background:#eef4ff;border-color:#9db9e8}.topics-part{background:#f4efff;border-color:#b8a5df}.board-part h3{font-size:16px;margin:0 0 7px}.state-list{grid-template-columns:minmax(0,1fr)}.state-row{display:block;min-width:0}.state-row>span{display:block;min-width:0;font-weight:750;color:#111a40;overflow-wrap:anywhere}.row-actions{display:flex;gap:4px;flex-wrap:nowrap;margin-top:6px}.state-row .action.rare{min-height:27px;padding:3px 4px;font-size:10px;white-space:nowrap}.state-row .action.edit:not(.is-sending):not(.is-success):not(.is-error){background:#e9f7ed;border-color:#77a889}.state-row .action.defer:not(.is-sending):not(.is-success):not(.is-error){background:#e6efff;border-color:#88a6d1}.state-row .action.check:not(.is-sending):not(.is-success):not(.is-error){min-width:28px;background:#e9f7ed;border-color:#77a889}.state-row .action.check:not(.is-sending):not(.is-success):not(.is-error)[aria-pressed=true]{background:#c6e7d1}.row-edit-input{width:100%;min-width:0;font:inherit;font-size:15px;padding:8px;border:1px solid #849bb5;border-radius:6px}";document.head.append(visualStyles);
  const headers=()=>({"content-type":"application/json","x-nafanya-zoom-panel-token":token});const requestId=()=>crypto.randomUUID();const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));function log(text){const time=new Date().toLocaleTimeString("ru-RU");logEl.textContent="["+time+"] "+text+"\\n"+logEl.textContent}async function requestJson(path,init={}){const response=await fetch(path,{...init,headers:{...headers(),...(init.headers||{})}}),data=await response.json().catch(()=>({}));if(!response.ok||data.ok===false){const error=new Error(data.error||("HTTP "+response.status));error.status=response.status;throw error}return data}function setBusy(value){busy=value;document.querySelectorAll("button").forEach(button=>button.disabled=value||button.dataset.unavailable==="true"||(button.id==="publishLibrary"&&!preparedLibrary))}const feedbackTimers=new WeakMap();function feedbackLabels(button,state){const custom=button?.dataset||{};if(state==="sending")return custom.loadingLabel||"\u041e\u0442\u043f\u0440\u0430\u0432\u043b\u044f\u044e\u2026";if(state==="success")return custom.successLabel||"\u0413\u043e\u0442\u043e\\u0432\\u043e \u2713";return custom.errorLabel||"\u041e\u0448\\u0438\\u0431\\u043a\\u0430"}function setButtonFeedback(button,state){if(!button)return;const previous=feedbackTimers.get(button);if(previous)clearTimeout(previous);if(!button.dataset.originalLabel)button.dataset.originalLabel=button.textContent;button.classList.remove("is-sending","is-success","is-error");if(state==="sending"){button.classList.add("is-sending");button.textContent=feedbackLabels(button,"sending");return}if(state==="success"){button.classList.add("is-success");button.textContent=feedbackLabels(button,"success")}else{button.classList.add("is-error");button.textContent=feedbackLabels(button,"error")}feedbackTimers.set(button,setTimeout(()=>{button.classList.remove("is-success","is-error");button.textContent=button.dataset.originalLabel||button.textContent;feedbackTimers.delete(button)},1800))}async function requestAction(body){const payload={...body,requestId:body.requestId||requestId()};for(let attempt=0;attempt<2;attempt+=1){try{return await requestJson(actionPath,{method:"POST",body:JSON.stringify(payload)})}catch(error){if(attempt>0||(Number(error.status)||0)<500)throw error;await wait(1600)}}return null}function renderActionState(data,body){if(/(?:edit_entry|edit_topic|questions_edit)$/.test(body.action||""))document.querySelectorAll("[data-editing]").forEach(el=>delete el.dataset.editing);if(String(body.action||"").startsWith("meeting_board_")&&data.state)renderBoard(data.meetingBoards?{boards:data.meetingBoards}:{boards:{[body.dayKey]:data.state}});if(String(body.action||"").startsWith("speaker_questions_")&&data.state)renderSpeaker(data.state);if(data.speakerQuestions)renderSpeaker(data.speakerQuestions)}async function run(body,button=null){if(busy)return null;const targetButton=button||((document.activeElement instanceof HTMLButtonElement)?document.activeElement:null);setButtonFeedback(targetButton,"sending");setBusy(true);try{const data=await requestAction(body);renderActionState(data,body);log(data.message||"\u0413\u043e\u0442\u043e\u0432\u043e");setButtonFeedback(targetButton,"success");return data}catch(error){log("\u041e\u0448\u0438\u0431\u043a\u0430: "+error.message);setButtonFeedback(targetButton,"error");return null}finally{setBusy(false)}}
  function row(text,buttons,spoken=false){const el=document.createElement("div");el.className="state-row"+(spoken?" is-spoken":"");const label=document.createElement("span");label.textContent=text;const controls=document.createElement("div");controls.className="row-actions";controls.append(...buttons);el.append(label,controls);return el}
  function smallButton(label,action,className="",title=""){const button=document.createElement("button");button.type="button";button.className="action "+className;button.textContent=label;if(title){button.title=title;button.setAttribute("aria-label",title)}button.onclick=()=>{button.focus();action(button)};return button}
  function editRow(button,item,body){if(busy||document.querySelector("[data-editing]"))return;const el=button.closest(".state-row"),original=[...el.childNodes],input=document.createElement("input");input.className="row-edit-input";input.maxLength=300;input.value=item.text;input.setAttribute("aria-label","\u0420\u0435\u0434\u0430\u043a\u0442\u0438\u0440\u043e\u0432\u0430\u0442\u044c \u0437\u0430\u043f\u0438\u0441\u044c");el.dataset.editing="true";const controls=document.createElement("div");controls.className="row-actions";const save=smallButton("\u0421\u043e\u0445\u0440\u0430\u043d\u0438\u0442\u044c",b=>run({...body,id:item.id,text:input.value,expectedText:item.text},b),"edit rare");const cancel=()=>{delete el.dataset.editing;el.replaceChildren(...original)};controls.append(save,smallButton("\u041e\u0442\u043c\u0435\u043d\u0430",cancel,"rare"));el.replaceChildren(input,controls);input.onkeydown=event=>{if(event.key==="Enter"){event.preventDefault();save.click()}if(event.key==="Escape")cancel()};input.focus();input.select()}
  function checkButton(item,body){const spoken=item.status==="spoken",button=smallButton("\u2705",b=>run({...body,action:spoken?body.restoreAction:body.action},b),"check rare",spoken?"\u0412\u0435\u0440\u043d\u0443\u0442\u044c \u0432 \u043e\u0447\u0435\u0440\u0435\u0434\u044c":"\u0412\u044b\u0441\u043a\u0430\u0437\u0430\u043b\u0441\u044f");button.setAttribute("aria-pressed",String(spoken));return button}
  function renderBoard(activeBoard){const boards=activeBoard?.boards||(activeBoard?.dayKey?{[activeBoard.dayKey]:activeBoard}:{});document.querySelectorAll("[data-day]").forEach(panel=>{
    if(panel.querySelector("[data-editing]"))return;const board=boards[panel.dataset.day],entries=panel.querySelector("[data-entry-list]"),topics=panel.querySelector("[data-topic-list]");entries.replaceChildren();topics.replaceChildren();
    if(!board?.entries?.length)entries.textContent="\u041f\u043e\u043a\u0430 \u0437\u0430\u044f\u0432\u043e\u043a \u043d\u0435\u0442.";
    (board?.entries||[]).forEach((item,index)=>{const dayKey=panel.dataset.day,spoken=item.status==="spoken",buttons=[
      checkButton(item,{action:"meeting_board_mark_spoken",restoreAction:"meeting_board_restore_waiting",dayKey,id:item.id}),
      smallButton("\u0420\u0435\u0434\u0430\u043a\u0442\u0438\u0440\u043e\u0432\u0430\u0442\u044c",b=>editRow(b,item,{action:"meeting_board_edit_entry",dayKey}),"edit rare"),
      smallButton("\u0423\u0434\u0430\u043b\u0438\u0442\u044c",b=>run({action:"meeting_board_remove_entry",dayKey,id:item.id},b),"danger rare"),
      smallButton("\u041f\u0440\u043e\u043f\u0443\u0441\u043a\u0430\u0435\u0442",b=>run({action:"meeting_board_defer_entry",dayKey,id:item.id},b),"defer rare")
    ];buttons[3].dataset.unavailable=String(spoken||index===board.entries.length-1);buttons[3].disabled=buttons[3].dataset.unavailable==="true";entries.append(row((index+1)+". "+(spoken?"\u2705 ":"")+item.text,buttons,spoken))});
    if(!board?.additionalTopics?.length)topics.textContent="\u0414\u043e\u043f. \u0442\u0435\u043c \u043d\u0435\u0442.";
    (board?.additionalTopics||[]).forEach((item,index)=>topics.append(row((index+1)+". "+item.text,[
      smallButton("\u0420\u0435\u0434\u0430\u043a\u0442\u0438\u0440\u043e\u0432\u0430\u0442\u044c",b=>editRow(b,item,{action:"meeting_board_edit_topic",dayKey:panel.dataset.day}),"edit rare"),
      smallButton("\u0423\u0434\u0430\u043b\u0438\u0442\u044c",b=>run({action:"meeting_board_remove_topic",dayKey:panel.dataset.day,id:item.id},b),"danger rare")
    ])))
  })}
  function renderSpeaker(state){const list=document.querySelector("[data-speaker-list]");if(list.querySelector("[data-editing]"))return;list.replaceChildren();if(!state?.entries?.length){list.textContent="\u0412\u043e\u043f\u0440\u043e\u0441\u043e\u0432 \u043f\u043e\u043a\u0430 \u043d\u0435\u0442.";return}state.entries.forEach((item,index)=>{const spoken=item.status==="spoken",buttons=[
    checkButton(item,{action:"speaker_questions_mark_spoken",restoreAction:"speaker_questions_restore_waiting",id:item.id}),
    smallButton("\u0420\u0435\u0434\u0430\u043a\u0442\u0438\u0440\u043e\u0432\u0430\u0442\u044c",b=>editRow(b,item,{action:"speaker_questions_edit"}),"edit rare"),
    smallButton("\u0423\u0434\u0430\u043b\u0438\u0442\u044c",b=>run({action:"speaker_questions_remove",id:item.id},b),"danger rare"),
    smallButton("\u041f\u0440\u043e\u043f\u0443\u0441\u043a\u0430\u0435\u0442",b=>run({action:"speaker_questions_defer",id:item.id},b),"defer rare")
  ];buttons[3].dataset.unavailable=String(spoken||index===state.entries.length-1);buttons[3].disabled=buttons[3].dataset.unavailable==="true";list.append(row((index+1)+". "+(spoken?"\u2705 ":"")+item.text,buttons,spoken))})}
  function statusRequestPath(){const url=new URL(statusPath,location.href);if(timerClient){url.searchParams.set("includeTimer","1");url.searchParams.set("instanceId",timerClient.instanceId);url.searchParams.set("product",timerClient.product);url.searchParams.set("indicatorSupported",timerClient.indicatorSupported?"1":"0")}return url.toString()}async function refreshState(){if(refreshPromise)return refreshPromise;refreshPromise=(async()=>{try{const data=await requestJson(statusRequestPath());renderBoard(data.meetingBoard);renderSpeaker(data.speakerQuestions);if(data.sharedTimer&&parent!==window)parent.postMessage({type:"nafanya-worker-state",sharedTimer:data.sharedTimer},location.origin);return data}catch(error){log("\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u043e\u0431\u043d\u043e\u0432\u0438\u0442\u044c \u0441\u043e\u0441\u0442\u043e\u044f\u043d\u0438\u0435: "+error.message);return null}})();try{return await refreshPromise}finally{refreshPromise=null}}
  document.querySelectorAll("[data-message-key]").forEach(button=>button.onclick=()=>run({type:"message",key:button.dataset.messageKey},button));document.querySelectorAll("[data-publish-day]").forEach(button=>button.onclick=()=>run({action:"meeting_board_publish",dayKey:button.dataset.publishDay,requestId:requestId()},button));document.querySelectorAll("[data-book]").forEach(button=>button.onclick=()=>{const input=document.getElementById(button.dataset.input),number=Number(input.value);if(!Number.isInteger(number)||number<1){log("\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u0446\u0435\u043b\u044b\u0439 \u043d\u043e\u043c\u0435\u0440.");return}run({action:"book_excerpt",collectionId:button.dataset.book,number},button).then(data=>{if(data)input.value=""})});document.querySelectorAll("[data-daily]").forEach(button=>button.onclick=()=>run({action:"daily_reflection"},button));document.querySelectorAll("[data-game]").forEach(button=>button.onclick=()=>{const input=document.getElementById(button.dataset.input),number=Number(input.value);if(!Number.isInteger(number)||number<1||number>500){log("\u041d\u043e\u043c\u0435\u0440 \u0432\u043e\u043f\u0440\u043e\u0441\u0430: \u043e\u0442 1 \u0434\u043e 500.");return}run({action:"game_question",number},button).then(data=>{if(data)input.value=""})});
  document.querySelectorAll("[data-day]").forEach(panel=>{const dayKey=panel.dataset.day;panel.querySelector("[data-add-entry]").onclick=()=>{const input=panel.querySelector("[data-entry-input]");run({action:"meeting_board_add_entry",dayKey,text:input.value,requestId:requestId()},panel.querySelector("[data-add-entry]")).then(data=>{if(data)input.value=""})};panel.querySelector("[data-add-topic]").onclick=()=>{const input=panel.querySelector("[data-topic-input]");run({action:"meeting_board_add_topic",dayKey,text:input.value,requestId:requestId()},panel.querySelector("[data-add-topic]")).then(data=>{if(data)input.value=""})}});document.querySelector("[data-speaker-publish]").onclick=event=>run({action:"speaker_questions_publish",requestId:requestId()},event.currentTarget);document.querySelector("[data-speaker-add]").onclick=()=>{const input=document.querySelector("[data-speaker-input]");run({action:"speaker_questions_add",text:input.value,requestId:requestId()},document.querySelector("[data-speaker-add]")).then(data=>{if(data)input.value=""})}
  const weekday=new Intl.DateTimeFormat("en-US",{timeZone:"Europe/Moscow",weekday:"short"}).format(new Date()).toLowerCase(),map={mon:"monday",tue:"tuesday",thu:"thursday",fri:"friday",sun:"sunday"};const todayPanel=document.querySelector('[data-day="'+map[weekday]+'"]');if(todayPanel)todayPanel.open=true;
  const fullClearButton=document.querySelector("[data-board-clear]");if(fullClearButton){fullClearButton.onclick=event=>{const selected=document.querySelector("[data-day][open]")||document.querySelector("[data-day]");run({action:"meeting_board_clear_all",dayKey:selected?.dataset.day||"monday",requestId:requestId()},event.currentTarget)};}
  function normalizedPath(value){return String(value||"").toLocaleLowerCase("ru-RU").replaceAll("\\\\","/").replaceAll("\u0451","\u0435")}function collectionForPath(path){const value=normalizedPath(path);if(value.includes("\u043a\u0430\u043a \u044d\u0442\u043e \u0432\u0438\u0434\u0438\u0442 \u0431\u0438\u043b\u043b"))return"as_bill_sees_it";if(value.includes("\u0435\u0436\u0435\u0434\u043d\u0435\u0432\u043d")||value.includes("\u0435\u0436\u0438\u043a"))return"daily_reflections";if(value.includes("\u0436\u0438\u0442\u044c \u0442\u0440\u0435\u0437\u0432"))return"living_sober";if(/12\\s*[x\u0445]\\s*12|12\\s+\u0448\u0430\u0433/u.test(value))return"twelve_twelve";if(value.includes("\u0432\u043e\u043f\u0440\u043e\u0441")&&value.includes("\u0438\u0433\u0440"))return"game_questions";if(value.includes("\u0431\u043e\u043b\u044c\u0448\u0430\u044f \u043a\u043d\u0438\u0433\u0430")||value.includes("big book")||value.includes("\u0430\u043d\u043e\u043d\u0438\u043c\u043d\u044b\u0435_\u0430\u043b\u043a\u043e\u0433\u043e\u043b\u0438\u043a\u0438"))return"big_book";return null}function entryKey(collectionId,path){const name=String(path||"").split(/[\\\\/]/u).at(-1).replace(/\\.md$/iu,"");if(collectionId==="daily_reflections"){const match=name.match(/^(\\d{1,2})[.-](\\d{1,2})$/u);return match?match[1].padStart(2,"0")+"."+match[2].padStart(2,"0"):null}const match=name.match(/^(\\d{1,4})/u);return match?String(Number(match[1])):null}async function inspectFolder(files){const collections={},errors=[];for(const file of files){const path=file.webkitRelativePath||file.name;if(!/\\.md$/iu.test(path)||normalizedPath(path).includes("/.obsidian/"))continue;const collectionId=collectionForPath(path),key=collectionId&&entryKey(collectionId,path);if(!collectionId||!key)continue;const bucket=collections[collectionId]||(collections[collectionId]={entries:[]});if(bucket.entries.some(item=>item.key===key)){errors.push("\u0414\u0443\u0431\u043b\u044c "+key+": "+path);continue}const text=(await file.text()).trim();if(!text){errors.push("\u041f\u0443\u0441\u0442\u043e\u0439 \u0444\u0430\u0439\u043b: "+path);continue}bucket.entries.push({key,text,sourcePath:path})}preparedLibrary=null;if(!errors.length&&Object.keys(collections).length){try{const checked=await requestJson(libraryImportPath+"?dryRun=1",{method:"POST",body:JSON.stringify({collections})});preparedLibrary={collections};document.getElementById("libraryPreview").textContent="\u041d\u0430\u0439\u0434\u0435\u043d\u043e: "+checked.preview.totalEntries+"; Zoom-\u0441\u043e\u043e\u0431\u0449\u0435\u043d\u0438\u0439: "+checked.preview.totalMessages}catch(error){errors.push(error.message)}}if(errors.length||!preparedLibrary)document.getElementById("libraryPreview").textContent=errors.join("\\n")||"\u041d\u0435 \u043d\u0430\u0448\u0451\u043b Markdown-\u043a\u043d\u0438\u0433.";document.getElementById("publishLibrary").disabled=!preparedLibrary}document.getElementById("vaultFolder").onchange=event=>inspectFolder(event.target.files);document.getElementById("publishLibrary").onclick=async()=>{if(!preparedLibrary)return;setBusy(true);try{const data=await requestJson(libraryImportPath,{method:"POST",body:JSON.stringify(preparedLibrary)});log(data.message||"\u0411\u0430\u0437\u0430 \u043e\u0431\u043d\u043e\u0432\u043b\u0435\u043d\u0430");await refreshLibrary()}catch(error){log("\u041e\u0448\u0438\u0431\u043a\u0430: "+error.message)}finally{setBusy(false)}};document.getElementById("testMessage").onclick=event=>run({action:"test_message"},event.currentTarget);async function refreshLibrary(){try{const data=await requestJson(libraryStatusPath),items=Object.values(data.collections||{}).filter(item=>item.available).map(item=>item.label+": "+item.count);document.getElementById("libraryStatusText").textContent=items.join(" \u00b7 ")||"\u0411\u0430\u0437\u0430 \u0435\u0449\u0451 \u043d\u0435 \u0437\u0430\u0433\u0440\u0443\u0436\u0435\u043d\u0430"}catch(error){log(error.message)}}window.addEventListener("message",event=>{if(event.origin!==location.origin||event.data?.type!=="nafanya-timer-client")return;timerClient={instanceId:String(event.data.instanceId||"").slice(0,128),product:String(event.data.product||"unknown").slice(0,32),indicatorSupported:event.data.indicatorSupported===true};if(startupRefreshTimer){clearTimeout(startupRefreshTimer);startupRefreshTimer=null}void refreshState()});startupRefreshTimer=setTimeout(()=>{startupRefreshTimer=null;void refreshState()},300);refreshLibrary();setInterval(()=>{if(!document.hidden)void refreshState()},5000);
  </script></body></html>`;
}
__name(buildZoomMeetingBoardPanelHtml, "buildZoomMeetingBoardPanelHtml");
async function handleRootRequest(env) {
  return handleStatusRequest(env);
}
__name(handleRootRequest, "handleRootRequest");
async function handleZoomOnlyAppRequest(request, env) {
  if (!isZoomPanelAuthorized(request, env)) {
    return textResponse("\u041d\u0443\u0436\u0435\u043d \u0442\u043e\u043a\u0435\u043d \u043f\u0443\u043b\u044c\u0442\u0430 Zoom.", 401);
  }
  return htmlResponse(buildZoomMeetingBoardPanelHtml());
}
__name(handleZoomOnlyAppRequest, "handleZoomOnlyAppRequest");
async function handleZoomLibraryRequest(request, env) {
  if (!isZoomPanelAuthorized(request, env)) return zoomPanelUnauthorizedResponse();
  if (request.method === "GET") {
    try {
      return Response.json({ ok: true, ...getLibraryStatus(await readZoomLibrary(env)) });
    } catch (error) {
      return Response.json({ ok: false, error: String(error?.message || "\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u043f\u0440\u043e\u0447\u0438\u0442\u0430\u0442\u044c \u043a\u043d\u0438\u0436\u043d\u0443\u044e \u0431\u0430\u0437\u0443.").slice(0, 300) }, { status: 500 });
    }
  }
  if (request.method !== "POST") return Response.json({ ok: false, error: "method_not_allowed" }, { status: 405 });
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > ZOOM_LIBRARY_IMPORT_MAX_BYTES) return Response.json({ ok: false, error: "\u041a\u043d\u0438\u0436\u043d\u0430\u044f \u0431\u0430\u0437\u0430 \u0441\u043b\u0438\u0448\u043a\u043e\u043c \u0431\u043e\u043b\u044c\u0448\u0430\u044f." }, { status: 413 });
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > ZOOM_LIBRARY_IMPORT_MAX_BYTES) return Response.json({ ok: false, error: "\u041a\u043d\u0438\u0436\u043d\u0430\u044f \u0431\u0430\u0437\u0430 \u0441\u043b\u0438\u0448\u043a\u043e\u043c \u0431\u043e\u043b\u044c\u0448\u0430\u044f." }, { status: 413 });
    const payload = JSON.parse(raw || "{}");
    const validation = validateLibraryImport(payload);
    if (!validation.ok) return Response.json({ ok: false, error: "\u0411\u0430\u0437\u0430 \u043d\u0435 \u043e\u043f\u0443\u0431\u043b\u0438\u043a\u043e\u0432\u0430\u043d\u0430.", errors: validation.errors, warnings: validation.warnings, preview: validation.preview }, { status: 400 });
    const current = await readZoomLibrary(env).catch(() => null);
    const next = mergeLibraryCollections(current, validation.collections);
    if (new URL(request.url).searchParams.get("dryRun") === "1") {
      return Response.json({ ok: true, validated: true, warnings: validation.warnings, preview: validation.preview, ...getLibraryStatus(next) });
    }
    await saveZoomLibrary(env, next);
    return Response.json({ ok: true, message: "\u041a\u043d\u0438\u0436\u043d\u0430\u044f \u0431\u0430\u0437\u0430 \u043e\u0431\u043d\u043e\u0432\u043b\u0435\u043d\u0430.", warnings: validation.warnings, preview: validation.preview, ...getLibraryStatus(next) });
  } catch (error) {
    const isSyntaxError = error instanceof SyntaxError;
    return Response.json({ ok: false, error: isSyntaxError ? "\u041d\u0435\u0432\u0435\u0440\u043d\u044b\u0439 \u0444\u043e\u0440\u043c\u0430\u0442 \u043a\u043d\u0438\u0436\u043d\u043e\u0439 \u0431\u0430\u0437\u044b." : String(error?.message || "\u041e\u0448\u0438\u0431\u043a\u0430 \u043e\u0431\u043d\u043e\u0432\u043b\u0435\u043d\u0438\u044f \u043a\u043d\u0438\u0436\u043d\u043e\u0439 \u0431\u0430\u0437\u044b.").slice(0, 300) }, { status: isSyntaxError ? 400 : 500 });
  }
}
__name(handleZoomLibraryRequest, "handleZoomLibraryRequest");
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
  callTimerState,
  TIMER_DEFAULT_SECONDS,
  getTodayTopicSourceMessageId
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
  applyQueueResponse
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
    if (String(env?.ZOOM_LOCAL_DEBUG || "").toLowerCase() === "true" && (url.pathname === "/webhook" || url.pathname === "/zoom/events")) {
      return Response.json({ ok: false, error: "telegram_disabled_in_local_debug" }, { status: 410 });
    }
    if (request.method === "GET" && url.pathname === "/") {
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
    if (url.pathname === "/zoom-only/app/action") {
      return handleZoomRouteSafely(url.pathname, () => handleZoomOnlyAppActionRequest(request, env));
    }
    if (url.pathname.startsWith("/zoom-only/team-chat/")) {
      return Response.json({ ok: false, error: "team_chat_test_retired" }, { status: 410 });
    }
    if ((request.method === "GET" && url.pathname === "/zoom-only/library/status") || (request.method === "POST" && url.pathname === "/zoom-only/library/import")) {
      return handleZoomLibraryRequest(request, env);
    }
    if (request.method === "POST" && url.pathname === "/webhook") {
      return handleWebhookUpdate(request, env);
    }
    if ((request.method === "POST" || request.method === "GET") && (url.pathname === "/zoom-only/webhook" || url.pathname === "/zoom-only/outbox" || url.pathname === "/zoom-only/status" || url.pathname === "/zoom-only/chat-ingest")) {
      return handleZoomRouteSafely(url.pathname, () => handleZoomOnlyBridgeRequest(request, env));
    }
    if (request.method === "POST" && url.pathname === "/zoom/events") {
      return handleZoomWebhookEvent(request, env);
    }
    return textResponse("Not found", 404);
  },
  async scheduled(controller, env, ctx) {
    if (String(env?.ZOOM_LOCAL_DEBUG || "").toLowerCase() === "true") return;
    ctx.waitUntil(Promise.all([
      runScheduledTaskOncePerDay(env, "morning_07_00", 7, 0, () => sendAnnouncementCopyToGroup(env, MORNING_ANNOUNCEMENT_ID)),
      runScheduledTaskOncePerDay(env, "yozhik_08_00", 8, 0, () => sendYozhikToGroup(env, { disableNotification: false })),
      runScheduledTaskOncePerDay(env, "info_channel_09_00", 9, 0, () => sendAnnouncementCopyToGroup(env, INFO_CHANNEL_ANNOUNCEMENT_ID)),
      runScheduledTaskOncePerDay(env, "service_reminders_12_00", 12, 0, () => sendTodayServiceReminders(env)),
      runScheduledTaskOncePerDay(env, "announce_thread_11_00", 11, 0, () => sendTechMessageCopyToInfoThread(env, DAILY_ANNOUNCE_THREAD_MESSAGE_ID, ANNOUNCE_THREAD_ID)),
      runScheduledTaskOncePerDay(env, "daily_15_00", 15, 0, () => sendAnnouncementCopyToGroup(env, DAILY_15_ANNOUNCEMENT_ID)),
      runScheduledTaskOncePerDay(env, "announce_thread_18_00", 18, 0, () => sendTechMessageCopyToInfoThread(env, DAILY_ANNOUNCE_THREAD_MESSAGE_ID, ANNOUNCE_THREAD_ID)),
      runScheduledTaskOncePerDay(env, "daily_17_00", 17, 0, () => sendAnnouncementCopyToGroup(env, DAILY_17_ANNOUNCEMENT_ID)),
      ...WEEKDAY_TECH_ANNOUNCEMENTS.flatMap((item) => [
        runScheduledTaskOncePerWeekday(env, `${item.key}_tech_11_00`, item.weekday, 11, 0, () => sendAnnouncementCopyToGroup(env, item.sourceMessageId)),
        runScheduledTaskOncePerWeekday(env, `${item.key}_tech_21_20`, item.weekday, 21, 20, () => sendAnnouncementCopyToGroup(env, item.sourceMessageId))
      ]),
      runScheduledTaskOncePerDay(env, "daily_22_00", 22, 0, () => sendAnnouncementCopyToGroup(env, DAILY_22_ANNOUNCEMENT_ID), 120),
      runScheduledTaskOncePerDay(env, "free_services_22_45", 22, 45, () => sendAnnouncementCopyToGroup(env, FREE_SERVICES_ANNOUNCEMENT_ID)),
      runScheduledTaskOncePerDay(env, "daily_22_50", 22, 50, () => sendAnnouncementCopyToGroup(env, DAILY_22_50_ANNOUNCEMENT_ID)),
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
      }))
    ]));
  }
};
export {
  AnnouncementStateDurableObject,
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
  saveAnnouncementMessageIdAfterCopy,
  TimerStateDurableObject,
  ZoomMeetingStateDurableObject,
  ZoomSharedTimerStateDurableObject,
  verifyZoomWebhookSignature,
  worker_default as default
};
//# sourceMappingURL=worker.js.map













