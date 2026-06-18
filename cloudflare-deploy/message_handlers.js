function okResponse() {
  return new Response("ok");
}

function isEmojiOnlyText(text) {
  const compact = String(text || "").replace(/[\s\uFE0E\uFE0F\u200D]/gu, "");
  if (!compact) return false;
  return /^(?:\p{Extended_Pictographic}|[\u{1F1E6}-\u{1F1FF}]|[\u{1F3FB}-\u{1F3FF}])+$/u.test(compact);
}

function isPersonalLightTalk(text, normalizeLightText) {
  const normalized = normalizeLightText(text);
  return /(?:^|\s)(?:\u043f\u0440\u0438\u0432\u0435\u0442|\u0441\u043f\u043e\u043a\u0438|\u0441\u043f\u0430\u0442\u044c|\u0445\u043e\u0447\u0443\s+\u043f\u043e\u043a\u043e\u044f|\u043c\u043d\u0435\s+(?:(?:\u0441\u0435\u0439\u0447\u0430\u0441|\u043e\u0447\u0435\u043d\u044c|\u0441\u043e\u0432\u0441\u0435\u043c|\u0442\u0430\u043a)\s+){0,3}(?:\u043f\u043b\u043e\u0445\u043e|\u0433\u0440\u0443\u0441\u0442\u043d\u043e|\u0442\u044f\u0436\u0435\u043b\u043e|\u043e\u0434\u0438\u043d\u043e\u043a\u043e)|\u043f\u043e\u0433\u043e\u0432\u043e\u0440\u0438\u0442\u044c\s+\u043d\u0435\s+\u0441\s+\u043a\u0435\u043c|\u043d\u0435\s+\u0441\s+\u043a\u0435\u043c\s+\u043f\u043e\u0433\u043e\u0432\u043e\u0440\u0438\u0442\u044c|\u0445\u043e\u0447\u0443\s+\u043f\u043e\u0433\u043e\u0432\u043e\u0440\u0438\u0442\u044c|\u0441\u043f\u043e\u043d\u0441\u043e\u0440\s+\u0437\u0430\u043d\u044f\u0442|\u0441\u043f\u043e\u043d\u0441\u043e\u0440\u0430\s+\u043d\u0435\u0442|\u043c\u0435\u043d\u044f\s+\u0437\u043e\u0432\u0443\u0442|\u043a\u0430\u043a\s+\u043c\u0435\u043d\u044f\s+\u0437\u043e\u0432\u0443\u0442|\u044f\s+\u043d\u0435|\u0447\u0435\u0433\u043e\s+\u0431\u0443\u0440\u0447\u0438\u0448\u044c|\u043f\u043e\u0447\u0435\u043c\u0443\s+\u0431\u0443\u0440\u0447\u0438\u0448\u044c)(?:\s|$)/u.test(normalized);
}

function hasExplicitTextAddress(text, normalizeLightText) {
  if (/^\s*\u043d\u0430\u0444\u0430\u043d\u044f\s*,/iu.test(String(text || ""))) {
    return true;
  }
  return /(?:^|\s)\u0431\u043e\u0442(?:\s|$)/u.test(normalizeLightText(text));
}

function cleanDeclaredName(name) {
  return String(name || "").replace(/[^\p{L}-]+$/gu, "").trim();
}

function extractDeclaredName(text) {
  const source = String(text || "");
  const direct = source.match(/(?:^|[\s,])\u043c\u0435\u043d\u044f\s+\u0437\u043e\u0432\u0443\u0442\s+([\p{L}-]{2,32})/iu);
  if (direct) {
    return cleanDeclaredName(direct[1]);
  }
  const correction = source.match(/(?:^|[\s,])\u044f\s+\u043d\u0435\s+[\p{L}-]{2,32}\s*,?\s*\u044f\s+([\p{L}-]{2,32})/iu);
  return correction ? cleanDeclaredName(correction[1]) : "";
}

function isNameQuestion(text, normalizeLightText) {
  return /(?:^|\s)\u043a\u0430\u043a\s+\u043c\u0435\u043d\u044f\s+\u0437\u043e\u0432\u0443\u0442(?:\s|$)/u.test(normalizeLightText(text));
}

function looksLikeTelemostLinkRequest(text, normalizeLightText) {
  const source = String(text || "");
  const normalized = normalizeLightText(text).replace(/\?/g, " ");
  const hasLinkCue = /(?:^|\s)(?:\u0434\u0430\u0439(?:\u0442\u0435)?|\u043a\u0438\u043d\u044c(?:\u0442\u0435)?|\u0441\u043a\u0438\u043d\u044c(?:\u0442\u0435)?|\u043f\u0440\u0438\u0448\u043b\u0438(?:\u0442\u0435)?|\u043f\u0440\u0438\u043d\u0435\u0441\u0438(?:\u0442\u0435)?|\u043d\u0443\u0436\u043d[\u0430\u043e\u044b]?|\u0435\u0441\u0442\u044c|\u0433\u0434\u0435|\u043a\u0443\u0434\u0430|\u0441\u0441\u044b\u043b\u043a[\p{L}]*|\u043b\u0438\u043d\u043a[\p{L}]*)(?:\s|$)/u.test(normalized);
  const hasStandaloneLinkRequest = /(?:^|\s)(?:\u0434\u0430\u0439(?:\u0442\u0435)?|\u043a\u0438\u043d\u044c(?:\u0442\u0435)?|\u0441\u043a\u0438\u043d\u044c(?:\u0442\u0435)?|\u043f\u0440\u0438\u0448\u043b\u0438(?:\u0442\u0435)?|\u043f\u0440\u0438\u043d\u0435\u0441\u0438(?:\u0442\u0435)?|\u043d\u0443\u0436\u043d[\u0430\u043e\u044b]?|\u0435\u0441\u0442\u044c|\u0433\u0434\u0435)(?:\s|$)/u.test(normalized) && /(?:^|\s)(?:\u0441\u0441\u044b\u043b\u043a[\p{L}]*|\u043b\u0438\u043d\u043a[\p{L}]*)(?:\s|$)/u.test(normalized);
  const hasMeetingPlaceCue = /(?:^|\s)(?:zoom|\u0437\u0443\u043c|\u0442\u0435\u043b\u0435\u043c\u043e\u0441\u0442[\p{L}]*|\u044f\u043d\u0434\u0435\u043a\u0441[\p{L}]*|yandex|\u0447\u0430\u0439\u043d[\p{L}]*|\u0433\u043e\u043b\u043e\u0441[\p{L}]*|\u0432\u043e\u0439\u0441[\p{L}]*|voice|voicechat|voice\s+chat|\u0440\u0430\u0431\u043e\u0447(?:\u0435\u0435|\u043a[\p{L}]*)\s+\u0441\u043e\u0431\u0440\u0430\u043d[\p{L}]*|\u0440\u0430\u0431\u043e\u0447\u043a[\p{L}]*|\u0441\u043e\u0431\u0440\u0430\u043d[\p{L}]*)(?:\s|$)/u.test(normalized);
  const directTelemostQuestion = /(?:^|\s)(?:zoom|\u0437\u0443\u043c|\u0442\u0435\u043b\u0435\u043c\u043e\u0441\u0442[\p{L}]*|\u044f\u043d\u0434\u0435\u043a\u0441[\p{L}]*|yandex|\u0447\u0430\u0439\u043d[\p{L}]*|\u0433\u043e\u043b\u043e\u0441\u043e\u0432(?:\u043e\u0439|\u0443\u044e|\u043e\u0433\u043e|\u044b\u0435)?\s+\u0447\u0430\u0442[\p{L}]*)\s*\?*\s*$/u.test(normalized);
  const hasQuestionMark = /\?/u.test(source);
  return hasStandaloneLinkRequest || (hasLinkCue && hasMeetingPlaceCue) || (directTelemostQuestion && hasQuestionMark);
}

function looksLikeMeetingScheduleRequest(text, normalizeLightText) {
  const normalized = normalizeLightText(text).replace(/[?!.,:;]/g, " ");
  const hasScheduleCue = /(?:^|\s)(?:\u0440\u0430\u0441\u043f\u0438\u0441\u0430\u043d[\p{L}]*|\u0433\u0440\u0430\u0444\u0438\u043a[\p{L}]*)(?:\s|$)/u.test(normalized);
  const hasMeetingCue = /(?:^|\s)(?:\u0441\u043e\u0431\u0440\u0430\u043d[\p{L}]*|\u0433\u0440\u0443\u043f\u043f[\p{L}]*)(?:\s|$)/u.test(normalized);
  const hasRequestCue = /(?:^|\s)(?:\u043d\u0430\u0444\u0430\u043d\u044f|\u0434\u0430\u0439(?:\u0442\u0435)?|\u043f\u0440\u0438\u0448\u043b\u0438(?:\u0442\u0435)?|\u0441\u043a\u0438\u043d\u044c(?:\u0442\u0435)?|\u043f\u043e\u043a\u0430\u0436\u0438(?:\u0442\u0435)?|\u043c\u043e\u0436\u0435\u0442|\u0433\u0434\u0435|\u043a\u0430\u043a\u043e\u0435|\u043a\u0430\u043a\u043e\u0439|\u043d\u0443\u0436\u043d[\u043e\u0430]?)(?:\s|$)/u.test(normalized);
  return hasScheduleCue && hasMeetingCue && hasRequestCue;
}

function canCopyMeetingScheduleHere(chatId, chatType, deps) {
  return deps.isPrivateChat(chatType) || chatId === deps.CHAT_GROUP_ID || chatId === deps.INFO_CHAT_ID;
}

function isNafanyaPublicChannel(chatId, deps) {
  return chatId === deps.CHAT_GROUP_ID || chatId === deps.INFO_CHAT_ID;
}

function isNafanyaRequestHere(message, text, chatId, chatType, deps) {
  if (deps.isPrivateChat(chatType)) return true;
  if (!isNafanyaPublicChannel(chatId, deps)) return false;
  return Boolean(message?.reply_to_message?.from?.is_bot) || hasExplicitTextAddress(text, deps.normalizeLightText) || deps.parseNafanyaQuestion(text) !== null;
}

async function copyTechMessageToCurrentChat(env, chatId, threadId, sourceMessageId, deps) {
  const payload = {
    chat_id: chatId,
    from_chat_id: deps.INFO_CHAT_ID,
    message_id: sourceMessageId,
    disable_notification: true
  };
  if (chatId === deps.INFO_CHAT_ID && threadId !== void 0 && threadId !== null) {
    payload.message_thread_id = threadId;
  }
  return deps.callTelegram(env, "copyMessage", payload);
}

function findDeclaredName(history) {
  const rows = Array.isArray(history) ? history : [];
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    if (rows[i]?.role !== "user") continue;
    const name = extractDeclaredName(rows[i]?.text || "");
    if (name) return name;
  }
  return "";
}

function buildRememberNameAnswer(name) {
  return `\u0417\u0430\u043f\u043e\u043c\u043d\u0438\u043b: \u0442\u044b ${name}. \u0411\u0443\u043c\u0430\u0436\u043a\u0443 \u043f\u0440\u0438\u0431\u0438\u043b \u043a \u0441\u0442\u0435\u043d\u0435, \u0442\u0435\u043f\u0435\u0440\u044c \u0433\u043b\u0430\u0432\u043d\u043e\u0435 \u0441\u0430\u043c\u043e\u043c\u0443 \u043e\u0431 \u043d\u0435\u0451 \u043d\u0435 \u0441\u043f\u043e\u0442\u043a\u043d\u0443\u0442\u044c\u0441\u044f.`;
}

function buildNameAnswer(name) {
  return name
    ? `\u0422\u044b ${name}. \u041d\u0430 \u044d\u0442\u043e\u0442 \u0440\u0430\u0437 \u0431\u0435\u0437 \u0431\u0443\u0445\u0433\u0430\u043b\u0442\u0435\u0440\u0441\u043a\u043e\u0439 \u043f\u0430\u043d\u0438\u043a\u0438, \u044f \u0437\u0430\u043f\u0438\u0441\u0430\u043b.`
    : "\u041f\u043e\u043a\u0430 \u043d\u0435 \u0437\u043d\u0430\u044e. \u0421\u043a\u0430\u0436\u0438: \u00ab\u041d\u0430\u0444\u0430\u043d\u044f, \u043c\u0435\u043d\u044f \u0437\u043e\u0432\u0443\u0442 ...\u00bb, \u0438 \u044f \u043F\u0440\u0438\u0431\u044c\u044e \u0438\u043c\u044f \u043a \u043F\u0430\u043c\u044f\u0442\u0438.";
}

function isStartCommand(text) {
  return /^\/start(?:@\w+)?(?:\s|$)/i.test(String(text || "").trim());
}

function isMyDayOnCommand(text) {
  return /^\/myday_on(?:@\w+)?(?:\s|$)/i.test(String(text || "").trim());
}

function isMyDayOffCommand(text) {
  return /^\/myday_off(?:@\w+)?(?:\s|$)/i.test(String(text || "").trim());
}

function isMenuCommand(text) {
  return /^\/menu(?:@\w+)?(?:\s|$)/i.test(String(text || "").trim());
}

function isAdminAnnounceCommand(text) {
  return /^\/admin_announce(?:@\w+)?(?:\s|$)/i.test(String(text || "").trim());
}

function isServiceReminderTestCommand(text) {
  return /^\/test_service_reminder(?:@\w+)?(?:\s|$)/i.test(String(text || "").trim());
}

function isReplacementResetTestCommand(text) {
  return /^\/test_reset_replacement(?:@\w+)?(?:\s|$)/i.test(String(text || "").trim());
}

function isServiceSummaryTestCommand(text) {
  return /^\/test_service_summary(?:@\w+)?(?:\s|$)/i.test(String(text || "").trim());
}

function parseServiceReminderTestCommand(text) {
  const source = String(text || "").trim();
  const body = source.replace(/^\/test_service_reminder(?:@\w+)?\s*/i, "").trim();
  const target = body.match(/@\w+/)?.[0] || "";
  const normalized = body.toLowerCase().replace(/\u0451/g, "\u0435");
  const roleKey = /(?:техвед|tech|тех)/iu.test(normalized) ? "tech" : "leader";
  return { target, roleKey };
}

function parseReplacementResetTestCommand(text) {
  const source = String(text || "").trim();
  const body = source.replace(/^\/test_reset_replacement(?:@\w+)?\s*/i, "").trim();
  const target = body.match(/@\w+/)?.[0] || "";
  const normalized = body.toLowerCase().replace(/\u0451/g, "\u0435");
  const roleKey = /(?:\u0442\u0435\u0445\u0432\u0435\u0434|tech|\u0442\u0435\u0445)/iu.test(normalized) ? "tech" : "leader";
  return { target, roleKey };
}

function looksLikeAlcoholPermissionQuestion(text, normalizeLightText) {
  const normalized = normalizeLightText(text);
  const hasAlcohol = /(?:^|\s)(?:\u0430\u043b\u043a\u043e\u0433\u043e\u043b[\p{L}]*|\u0431\u0443\u0445\u043b[\p{L}]*|\u0431\u0443\u0445\u043d[\p{L}]*|\u0432\u044b\u043f\u0438\u0442[\p{L}]*|\u043f\u0438\u0442\u044c|\u043f\u044c\u044f\u043d[\p{L}]*|\u043a\u043e\u043d\u044c\u044f\u0447[\p{L}]*|\u043a\u043e\u043d\u044c\u044f\u043a[\p{L}]*|\u0432\u043e\u0434\u043a[\p{L}]*|\u0432\u0438\u043d\u043e|\u043f\u0438\u0432[\p{L}]*|\u0448\u0430\u043c\u043f\u0430\u043d\u0441\u043a[\p{L}]*)(?:\s|$)/u.test(normalized);
  const asksPermission = /(?:^|\s)(?:\u043c\u043e\u0436\u043d\u043e|\u043d\u0435\u043b\u044c\u0437\u044f|\u043a\u0430\u043a\s+\u0434\u0443\u043c\u0430\u0435\u0448\u044c|\u043d\u0443\u0436\u043d\u043e\s+\u043b\u0438|\u0441\u0442\u043e\u0438\u0442\s+\u043b\u0438|\u0447\u0442\u043e\s+\u0434\u0443\u043c\u0430\u0435\u0448\u044c|\u0447\u0443\u0442\u044c\s+\u0447\u0443\u0442\u044c|\u043f\u0440\u0438\u0433\u0443\u0431)(?:\s|$)|\?/u.test(normalized);
  const aaContext = /(?:^|\s)(?:\u0430\u043b\u043a\u0430\u0448[\p{L}]*|\u0430\u043b\u043a\u043e\u0433\u043e\u043b\u0438\u043a[\p{L}]*|\u0430\u0430|\u0442\u0440\u0435\u0437\u0432[\p{L}]*)(?:\s|$)/u.test(normalized);
  const casualDrinkingHook = /(?:^|\s)(?:\u043f\u043e\u0434\s+\u043a\u043e\u043d\u044c\u044f\u0447[\p{L}]*|\u043f\u043e\u0434\s+\u043a\u043e\u043d\u044c\u044f\u043a[\p{L}]*|\u043f\u043e\u0434\s+\u0432\u043e\u0434\u043a[\p{L}]*|\u043f\u043e\u0434\s+\u0432\u0438\u043d\u043e|\u043f\u043e\u0434\s+\u043f\u0438\u0432[\p{L}]*|\u043f\u043e\u0434\s+\u0448\u0430\u0448\u043b\u044b\u043a|\u0437\u0430\s+\u043a\u043e\u043c\u043f\u0430\u043d\u0438\u044e)(?:\s|$)/u.test(normalized);
  return hasAlcohol && (aaContext || casualDrinkingHook) && asksPermission;
}

function looksLikeMedicineQuestion(text, normalizeLightText) {
  const normalized = normalizeLightText(text);
  const lexical = normalized.replace(/\?/g, " ");
  const hasMedicine = /(?:^|\s)(?:\u043b\u0435\u043a\u0430\u0440\u0441\u0442\u0432[\p{L}]*|\u0442\u0430\u0431\u043b\u0435\u0442[\p{L}]*|\u043f\u0440\u0435\u043f\u0430\u0440\u0430\u0442[\p{L}]*|\u0434\u043e\u0437\u0438\u0440\u043e\u0432[\p{L}]*|\u0440\u0435\u0446\u0435\u043f\u0442[\p{L}]*|\u0430\u043d\u0442\u0438\u0434\u0435\u043f\u0440\u0435\u0441\u0441\u0430\u043d\u0442[\p{L}]*|\u0442\u0440\u0430\u043d\u043a\u0432\u0438\u043b\u0438\u0437\u0430\u0442\u043e\u0440[\p{L}]*|\u0441\u043d\u043e\u0442\u0432\u043e\u0440\u043d[\p{L}]*|\u0443\u0441\u043f\u043e\u043a\u043e\u0438\u0442\u0435\u043b[\p{L}]*|\u043d\u0435\u0439\u0440\u043e\u043b\u0435\u043f\u0442\u0438\u043a[\p{L}]*|\u0444\u0435\u043d\u0430\u0437\u0435\u043f\u0430\u043c[\p{L}]*|\u043a\u043e\u0440\u0432\u0430\u043b\u043e\u043b[\p{L}]*|\u0432\u0430\u043b\u043e\u043a\u043e\u0440\u0434\u0438\u043d[\p{L}]*)(?:\s|$)/u.test(lexical);
  const questionCue = /\?/u.test(String(text || "")) || /(?:^|\s)(?:\u043c\u043e\u0436\u043d\u043e|\u043d\u0435\u043b\u044c\u0437\u044f|\u043a\u0430\u043a|\u0447\u0442\u043e\s+\u0434\u0435\u043b\u0430\u0442\u044c|\u043d\u0443\u0436\u043d\u043e\s+\u043b\u0438|\u0441\u0442\u043e\u0438\u0442\s+\u043b\u0438|\u043f\u0438\u0442\u044c|\u043f\u0440\u0438\u043d\u0438\u043c\u0430\u0442[\p{L}]*|\u0431\u0440\u043e\u0441\u0430\u0442[\p{L}]*|\u043e\u0442\u043c\u0435\u043d\u044f\u0442[\p{L}]*|\u0434\u043e\u0437[\p{L}]*|\u043b\u0435\u0447[\p{L}]*)(?:\s|$)/u.test(normalized);
  return hasMedicine && questionCue;
}

function looksLikeOtherAddictionQuestion(text, normalizeLightText) {
  const source = String(text || "");
  const normalized = normalizeLightText(text);
  const lexical = normalized.replace(/\?/g, " ");
  const hasOtherAddiction = /(?:^|\s)(?:\u043a\u0443\u0440\u0438[\p{L}]*|\u043a\u0443\u0440\u0435\u043d[\p{L}]*|\u0441\u0438\u0433\u0430\u0440\u0435\u0442[\p{L}]*|\u043d\u0438\u043a\u043e\u0442\u0438\u043d[\p{L}]*|\u0432\u0435\u0439\u043f[\p{L}]*|\u044d\u043b\u0435\u043a\u0442\u0440\u043e\u043d\u043a[\p{L}]*|\u043d\u0430\u0440\u043a\u043e\u0442\u0438\u043a[\p{L}]*|\u043d\u0430\u0440\u043a\u043e\u043c\u0430\u043d[\p{L}]*|\u0442\u0440\u0430\u0432[\p{L}]*|\u043c\u0430\u0440\u0438\u0445\u0443\u0430\u043d[\p{L}]*|\u043a\u0430\u043d\u043d\u0430\u0431\u0438\u0441[\p{L}]*|\u0430\u043c\u0444\u0435\u0442\u0430\u043c\u0438\u043d[\p{L}]*|\u0430\u043c\u0444\u0438\u0442\u0430\u043c\u0438\u043d[\p{L}]*|\u043c\u0435\u0444[\p{L}]*|\u043c\u0435\u0444\u0435\u0434\u0440\u043e\u043d[\p{L}]*|\u0441\u043e\u043b[\p{L}]*|\u0441\u043f\u0430\u0439\u0441[\p{L}]*|\u043a\u043e\u043a\u0430\u0438\u043d[\p{L}]*|\u0433\u0435\u0440\u043e\u0438\u043d[\p{L}]*|\u043c\u0435\u0442\u0430\u0434\u043e\u043d[\p{L}]*|\u043e\u043f\u0438\u0430\u0442[\p{L}]*|\u043f\u0430\u0432|\u043f\u0441\u0438\u0445\u043e\u0430\u043a\u0442\u0438\u0432[\p{L}]*|\u0437\u0430\u043f\u0440\u0435\u0449\u0435\u043d[\p{L}]*\s+\u0432\u0435\u0449\u0435\u0441\u0442\u0432[\p{L}]*|\u0445\u0438\u043c\u0438\u0447\u0435\u0441\u043a[\p{L}]*\s+\u0437\u0430\u0432\u0438\u0441\u0438\u043c[\p{L}]*|\u0445\u0438\u043c\u0438\u0447\u0435\u0441\u043a[\p{L}]*\s+\u0443\u043f\u043e\u0442\u0440\u0435\u0431[\p{L}]*|\u0437\u0430\u0432\u0438\u0441\u0438\u043c\u043e\u0441\u0442[\p{L}]*|\u0437\u0430\u0432\u0438\u0441\u0438\u043c[\p{L}]*|\u0438\u0433\u0440\u043e\u043c\u0430\u043d[\p{L}]*|\u0441\u0442\u0430\u0432\u043a[\p{L}]*|\u0430\u0437\u0430\u0440\u0442[\p{L}]*|\u0441\u0435\u043a\u0441\u043e\u0433\u043e\u043b[\p{L}]*|\u043f\u0438\u0449\u0435\u0432[\p{L}]*)(?:\s|$)/u.test(lexical);
  const alcoholOnly = /(?:^|\s)\u0430\u043b\u043a\u043e\u0433\u043e\u043b[\p{L}]*\s+\u0437\u0430\u0432\u0438\u0441\u0438\u043c[\p{L}]*(?:\s|$)/u.test(lexical);
  const questionCue = /\?/u.test(source) || /(?:^|\s)(?:\u043c\u043e\u0436\u043d\u043e|\u043d\u0435\u043b\u044c\u0437\u044f|\u043a\u0430\u043a|\u0447\u0442\u043e\s+\u0434\u0435\u043b\u0430\u0442\u044c|\u043d\u0443\u0436\u043d\u043e\s+\u043b\u0438|\u0441\u0442\u043e\u0438\u0442\s+\u043b\u0438|\u0431\u0440\u043e\u0441\u0430\u0442[\p{L}]*|\u0443\u043f\u043e\u0442\u0440\u0435\u0431\u043b\u044f\u0442[\p{L}]*|\u043a\u0443\u0440\u0438\u0442[\p{L}]*|\u043f\u0430\u0440\u0438\u0442[\p{L}]*)(?:\s|$)/u.test(normalized);
  return hasOtherAddiction && !alcoholOnly && questionCue;
}

const DM_BUTTONS = {
  mydayOn: "\u{1F305} \u0412\u043a\u043b\u044e\u0447\u0438\u0442\u044c 10\u201311 \u0448\u0430\u0433",
  mydayOff: "\u{1F319} \u0412\u044b\u043a\u043b\u044e\u0447\u0438\u0442\u044c 10\u201311 \u0448\u0430\u0433",
  adminAnnounce: "\u{1F4E3} \u041e\u0431\u044a\u044f\u0432\u043b\u0435\u043d\u0438\u0435 \u0430\u0434\u043c\u0438\u043d\u0430\u043c",
  addAdmin: "\u2795 \u0414\u043e\u0431\u0430\u0432\u0438\u0442\u044c \u0430\u0434\u043c\u0438\u043d\u0430",
  removeAdmin: "\u2796 \u0423\u0434\u0430\u043b\u0438\u0442\u044c \u0430\u0434\u043c\u0438\u043d\u0430"
};

const ADMIN_DM_CALLBACKS = {
  send: "admin_dm:send",
  cancel: "admin_dm:cancel"
};

const TEXT = {
  yozhikOk: "\u0401\u0436\u0438\u043a \u043e\u0442\u043f\u0440\u0430\u0432\u043b\u0435\u043d \u0432 \u0447\u0430\u0442 \u0433\u0440\u0443\u043f\u043f\u044b.",
  yozhikError: "\u041e\u0448\u0438\u0431\u043a\u0430 \u0401\u0436\u0438\u043a\u0430",
  billPrompt: "\u0412\u0432\u0435\u0434\u0438 \u043d\u043e\u043c\u0435\u0440 \u043e\u0442\u0440\u044b\u0432\u043a\u0430 \u0411\u0438\u043b\u043b\u0430.\n\n\u041d\u0430\u043f\u0440\u0438\u043c\u0435\u0440: 17\n\n\u0414\u043e\u043f\u0443\u0441\u0442\u0438\u043c\u044b\u0435 \u043d\u043e\u043c\u0435\u0440\u0430: \u043e\u0442 1 \u0434\u043e 332.",
  billSent: "\u041e\u0442\u0440\u044b\u0432\u043e\u043a \u0411\u0438\u043b\u043b\u0430",
  billSentTail: "\u043e\u0442\u043f\u0440\u0430\u0432\u043b\u0435\u043d \u0432 \u0447\u0430\u0442 \u0433\u0440\u0443\u043f\u043f\u044b.",
  billError: "\u041e\u0448\u0438\u0431\u043a\u0430 \u0411\u0438\u043b\u043b\u0430",
  accepted: "\u041f\u0440\u0438\u043d\u044f\u0442\u043e.",
  unknown: "\u043d\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043d\u043e",
  none: "\u043d\u0435\u0442",
  connected: "\u041d\u0430\u0444\u0430\u043d\u044f \u043d\u0430 \u0441\u0432\u044f\u0437\u0438. \u041b\u0438\u0447\u043a\u0430 \u043f\u043e\u0434\u043a\u043b\u044e\u0447\u0435\u043d\u0430.",
  online: "\u041d\u0430\u0444\u0430\u043d\u044f \u043d\u0430 \u0441\u0432\u044f\u0437\u0438.",
  noButtons: "\u0414\u043b\u044f \u0442\u0435\u0431\u044f \u0441\u0435\u0439\u0447\u0430\u0441 \u043d\u0435\u0442 \u0434\u043e\u0441\u0442\u0443\u043f\u043d\u044b\u0445 \u043a\u043d\u043e\u043f\u043e\u043a.",
  privateOnly: "\u042d\u0442\u0430 \u043a\u043e\u043c\u0430\u043d\u0434\u0430 \u0440\u0430\u0431\u043e\u0442\u0430\u0435\u0442 \u0442\u043e\u043b\u044c\u043a\u043e \u0432 \u043b\u0438\u0447\u043d\u043e\u043c \u0447\u0430\u0442\u0435 \u0441 \u0431\u043e\u0442\u043e\u043c.",
  mydayDenied: "\u041b\u0438\u0447\u043d\u0430\u044f \u0440\u0430\u0441\u0441\u044b\u043b\u043a\u0430 \u0434\u043b\u044f \u044d\u0442\u043e\u0433\u043e user_id \u043d\u0435 \u0440\u0430\u0437\u0440\u0435\u0448\u0435\u043d\u0430. \u0411\u0435\u043b\u044b\u0439 \u0441\u043f\u0438\u0441\u043e\u043a \u2014 \u044d\u0442\u043e \u0432\u0430\u0445\u0442\u0451\u0440, \u0443 \u043d\u0435\u0433\u043e \u043b\u0438\u0446\u043e \u043a\u0438\u0440\u043f\u0438\u0447\u043e\u043c.",
  mydayStartSaved: "\u041b\u0438\u0447\u043d\u044b\u0439 chat_id \u0441\u043e\u0445\u0440\u0430\u043d\u0438\u043b. \u0414\u043b\u044f \u0435\u0436\u0435\u0434\u043d\u0435\u0432\u043d\u043e\u0439 \u043b\u0438\u0447\u043d\u043e\u0439 \u0440\u0430\u0441\u0441\u044b\u043b\u043a\u0438 \u0432\u043a\u043b\u044e\u0447\u0438 /myday_on.",
  mydayStartSavedDenied: "\u041b\u0438\u0447\u043d\u044b\u0439 chat_id \u0441\u043e\u0445\u0440\u0430\u043d\u0438\u043b, \u043d\u043e \u044d\u0442\u043e\u0442 user_id \u043f\u043e\u043a\u0430 \u043d\u0435 \u0432 whitelist. \u041f\u0440\u043e\u043f\u0443\u0441\u043a \u043d\u0435 \u0432\u044b\u0434\u0430\u043d, \u0432\u0430\u0445\u0442\u0451\u0440 \u043a\u0430\u0440\u0430\u043d\u0434\u0430\u0448 \u043e\u0431\u043b\u0438\u0437\u0430\u043b \u0438 \u0436\u0434\u0451\u0442.",
  mydayOn: "\u041b\u0438\u0447\u043d\u0430\u044f \u0440\u0430\u0441\u0441\u044b\u043b\u043a\u0430 \u0432\u043a\u043b\u044e\u0447\u0435\u043d\u0430: 7:00 \u0443\u0442\u0440\u043e, 11:00-20:00 \u043c\u0435\u0434\u0438\u0442\u0430\u0446\u0438\u0438 \u043a\u0430\u0436\u0434\u044b\u0439 \u0447\u0430\u0441, 23:00 \u0432\u0435\u0447\u0435\u0440. \u0412\u0441\u0451 \u043f\u043e \u041c\u0421\u041a.",
  mydayOff: "\u041b\u0438\u0447\u043d\u0430\u044f \u0440\u0430\u0441\u0441\u044b\u043b\u043a\u0430 \u0432\u044b\u043a\u043b\u044e\u0447\u0435\u043d\u0430.",
  mydayOnShort: "\u0412\u043a\u043b\u044e\u0447\u0438\u043b. \u0411\u0443\u0434\u0443 \u043f\u0440\u0438\u0441\u044b\u043b\u0430\u0442\u044c \u0443\u0442\u0440\u043e, \u0434\u043d\u0435\u0432\u043d\u044b\u0435 \u043c\u0435\u0434\u0438\u0442\u0430\u0446\u0438\u0438 \u0438 \u0432\u0435\u0447\u0435\u0440 \u043f\u043e \u043c\u043e\u0441\u043a\u043e\u0432\u0441\u043a\u043e\u043c\u0443 \u0432\u0440\u0435\u043c\u0435\u043d\u0438.",
  mydayOffShort: "\u0412\u044b\u043a\u043b\u044e\u0447\u0438\u043b \u043b\u0438\u0447\u043d\u0443\u044e \u0440\u0430\u0441\u0441\u044b\u043b\u043a\u0443 10\u201311 \u0448\u0430\u0433\u0430.",
  mydayAccessDenied: "\u041b\u0438\u0447\u043d\u0430\u044f \u0440\u0430\u0441\u0441\u044b\u043b\u043a\u0430 10\u201311 \u0448\u0430\u0433\u0430 \u0442\u0435\u0431\u0435 \u0441\u0435\u0439\u0447\u0430\u0441 \u043d\u0435\u0434\u043e\u0441\u0442\u0443\u043f\u043d\u0430.",
  mydayStatusOn: "\u041b\u0438\u0447\u043d\u0430\u044f \u0440\u0430\u0441\u0441\u044b\u043b\u043a\u0430: \u0432\u043a\u043b\u044e\u0447\u0435\u043d\u0430. \u041c\u0421\u041a: 7:00, 11:00-20:00, 23:00.",
  mydayStatusOff: "\u041b\u0438\u0447\u043d\u0430\u044f \u0440\u0430\u0441\u0441\u044b\u043b\u043a\u0430: \u0432\u044b\u043a\u043b\u044e\u0447\u0435\u043d\u0430.",
  adminAnnouncePrompt: "\u041f\u0440\u0438\u0448\u043b\u0438 \u0441\u043e\u043e\u0431\u0449\u0435\u043d\u0438\u0435, \u043a\u043e\u0442\u043e\u0440\u043e\u0435 \u043d\u0443\u0436\u043d\u043e \u043e\u0442\u043f\u0440\u0430\u0432\u0438\u0442\u044c \u0432\u0441\u0435\u043c \u0430\u0434\u043c\u0438\u043d\u0430\u043c.",
  adminDraftReady: "\u0427\u0435\u0440\u043d\u043e\u0432\u0438\u043a \u0433\u043e\u0442\u043e\u0432. \u041f\u043e\u0434\u0442\u0432\u0435\u0440\u0434\u0438 \u043e\u0442\u043f\u0440\u0430\u0432\u043a\u0443 \u0430\u0434\u043c\u0438\u043d\u0430\u043c.",
  adminDenied: "\u042d\u0442\u0430 \u043a\u043e\u043c\u0430\u043d\u0434\u0430 \u0434\u043e\u0441\u0442\u0443\u043f\u043d\u0430 \u0442\u043e\u043b\u044c\u043a\u043e \u0430\u0434\u043c\u0438\u043d\u0430\u043c.",
  ownerDenied: "\u042d\u0442\u0430 \u043a\u043d\u043e\u043f\u043a\u0430 \u0434\u043e\u0441\u0442\u0443\u043f\u043d\u0430 \u0442\u043e\u043b\u044c\u043a\u043e \u0432\u043b\u0430\u0434\u0435\u043b\u044c\u0446\u0443.",
  chooseAddAdmin: "\u0412\u044b\u0431\u0435\u0440\u0438, \u043a\u043e\u043c\u0443 \u0434\u0430\u0442\u044c \u0430\u0434\u043c\u0438\u043d\u0441\u043a\u0438\u0435 \u043a\u043d\u043e\u043f\u043a\u0438:",
  chooseRemoveAdmin: "\u0412\u044b\u0431\u0435\u0440\u0438, \u0443 \u043a\u043e\u0433\u043e \u0443\u0431\u0440\u0430\u0442\u044c \u0430\u0434\u043c\u0438\u043d\u0441\u043a\u0438\u0435 \u043a\u043d\u043e\u043f\u043a\u0438:",
  noAdminCandidates: "\u041f\u043e\u043a\u0430 \u043d\u0435\u043a\u043e\u0433\u043e \u043f\u043e\u043a\u0430\u0437\u0430\u0442\u044c. \u0427\u0435\u043b\u043e\u0432\u0435\u043a \u0441\u043d\u0430\u0447\u0430\u043b\u0430 \u0434\u043e\u043b\u0436\u0435\u043d \u043d\u0430\u043f\u0438\u0441\u0430\u0442\u044c \u0431\u043e\u0442\u0443 /start.",
  addAdminPrompt: "\u041f\u0440\u0438\u0448\u043b\u0438 @username \u0447\u0435\u043b\u043e\u0432\u0435\u043a\u0430, \u043a\u043e\u0442\u043e\u0440\u043e\u043c\u0443 \u0434\u0430\u0442\u044c \u0430\u0434\u043c\u0438\u043d\u0441\u043a\u0438\u0435 \u043a\u043d\u043e\u043f\u043a\u0438. \u041e\u043d \u0441\u043d\u0430\u0447\u0430\u043b\u0430 \u0434\u043e\u043b\u0436\u0435\u043d \u043d\u0430\u043f\u0438\u0441\u0430\u0442\u044c \u0431\u043e\u0442\u0443 /start.",
  removeAdminPrompt: "\u041f\u0440\u0438\u0448\u043b\u0438 @username \u0430\u0434\u043c\u0438\u043d\u0430, \u0443 \u043a\u043e\u0442\u043e\u0440\u043e\u0433\u043e \u0443\u0431\u0440\u0430\u0442\u044c \u0430\u0434\u043c\u0438\u043d\u0441\u043a\u0438\u0435 \u043a\u043d\u043e\u043f\u043a\u0438.",
  adminUserNotFound: "\u041d\u0435 \u043d\u0430\u0448\u0451\u043b \u0442\u0430\u043a\u043e\u0433\u043e \u043f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u0435\u043b\u044f. \u0421\u043d\u0430\u0447\u0430\u043b\u0430 \u043e\u043d \u0434\u043e\u043b\u0436\u0435\u043d \u043d\u0430\u043f\u0438\u0441\u0430\u0442\u044c \u0431\u043e\u0442\u0443 /start, \u0438\u043d\u0430\u0447\u0435 Telegram \u0434\u0435\u0440\u0436\u0438\u0442 \u0435\u0433\u043e id \u0432 \u0441\u0435\u0439\u0444\u0435 \u0438 \u0434\u0435\u043b\u0430\u0435\u0442 \u0432\u0438\u0434, \u0447\u0442\u043e \u0442\u0430\u043a \u0438 \u0431\u044b\u043b\u043e.",
  addAdminOk: "\u0414\u043e\u0431\u0430\u0432\u0438\u043b \u0430\u0434\u043c\u0438\u043d\u0430:",
  removeAdminOk: "\u0423\u0434\u0430\u043b\u0438\u043b \u0430\u0434\u043c\u0438\u043d\u0430:",
  serviceReminderTestDenied: "\u042d\u0442\u0443 \u0442\u0435\u0441\u0442-\u043a\u043d\u043e\u043f\u043a\u0443 \u043c\u043e\u0436\u0435\u0442 \u0434\u0451\u0440\u0433\u0430\u0442\u044c \u0442\u043e\u043b\u044c\u043a\u043e \u0432\u043b\u0430\u0434\u0435\u043b\u0435\u0446. \u0418\u043d\u0430\u0447\u0435 \u044d\u0442\u043e \u0443\u0436\u0435 \u043d\u0435 \u0442\u0435\u0441\u0442, \u0430 \u043a\u043d\u043e\u043f\u043a\u0430 \u0441 \u043b\u0438\u0446\u043e\u043c \u0431\u0443\u0445\u0433\u0430\u043b\u0442\u0435\u0440\u0430.",
  serviceReminderTestUsage: "\u0424\u043e\u0440\u043c\u0430\u0442: /test_service_reminder @username \u0432\u0435\u0434\u0443\u0449\u0438\u0439\n\u0418\u043b\u0438: /test_service_reminder @username \u0442\u0435\u0445\u0432\u0435\u0434",
  testMessage: "\u042d\u0442\u043e \u0442\u0435\u0441\u0442\u043e\u0432\u043e\u0435 \u0441\u043e\u043e\u0431\u0449\u0435\u043d\u0438\u0435 \u043e\u0442 \u0431\u043e\u0442\u0430.",
  fallback: "\u041d\u0430\u0444\u0430\u043d\u044f \u0431\u0443\u0440\u043a\u043d\u0443\u043b: \u043d\u0435 \u0440\u0430\u0437\u043e\u0431\u0440\u0430\u043b, \u043e \u0447\u0451\u043c \u0440\u0435\u0447\u044c.",
  unansweredUser: "\u042f \u043d\u0435 \u043d\u0430\u0448\u0451\u043b \u0442\u043e\u0447\u043d\u043e\u0433\u043e \u043e\u0442\u0432\u0435\u0442\u0430 \u0432 \u0434\u043e\u043a\u0443\u043c\u0435\u043d\u0442\u0430\u0445 \u0433\u0440\u0443\u043f\u043f\u044b. \u041f\u0435\u0440\u0435\u0434\u0430\u043b \u0432\u043e\u043f\u0440\u043e\u0441 \u0430\u0434\u043c\u0438\u043d\u0430\u043c.",
  unansweredAdminTail: "\u041d\u0430\u0444\u0430\u043d\u044f \u043d\u0435 \u043d\u0430\u0448\u0451\u043b \u0442\u043e\u0447\u043d\u043e\u0433\u043e \u043e\u0442\u0432\u0435\u0442\u0430 \u0432 \u0434\u043e\u043a\u0443\u043c\u0435\u043d\u0442\u0430\u0445 \u0433\u0440\u0443\u043f\u043f\u044b.",
  noSpecificGroupRequest: "\u042f \u043d\u0435 \u0443\u043c\u0435\u044e \u0440\u0430\u0437\u0433\u043e\u0432\u0430\u0440\u0438\u0432\u0430\u0442\u044c \u0431\u0435\u0437 \u043a\u043e\u043d\u043a\u0440\u0435\u0442\u043d\u043e\u0433\u043e \u0437\u0430\u043f\u0440\u043e\u0441\u0430 \u043f\u043e \u0433\u0440\u0443\u043f\u043f\u0435",
  alcoholUseNo: [
    "\u041a\u043e\u0440\u043e\u0442\u043a\u043e: \u043d\u0435\u0442. \u0414\u043b\u044f \u0430\u043b\u043a\u043e\u0433\u043e\u043b\u0438\u043a\u0430 \u0432 \u0410\u0410 \u201c\u043a\u043e\u043d\u044c\u044f\u0447\u043e\u043a\u201d \u2014 \u044d\u0442\u043e \u043d\u0435 \u201c\u0447\u0443\u0442\u044c-\u0447\u0443\u0442\u044c \u043f\u043e\u0434 \u0448\u0430\u0448\u043b\u044b\u043a\u201d, \u0430 \u043f\u0435\u0440\u0432\u044b\u0439 \u0433\u0432\u043e\u0437\u0434\u044c \u0432 \u0441\u0442\u0430\u0440\u044b\u0435 \u0440\u0435\u043b\u044c\u0441\u044b.",
    "",
    "\u041f\u0440\u043e\u0433\u0440\u0430\u043c\u043c\u0430 \u0410\u0410 \u043d\u0435 \u043f\u0440\u0435\u0434\u043f\u043e\u043b\u0430\u0433\u0430\u0435\u0442 \u0431\u0435\u0437\u043e\u043f\u0430\u0441\u043d\u043e\u0433\u043e \u0443\u043f\u043e\u0442\u0440\u0435\u0431\u043b\u0435\u043d\u0438\u044f \u0430\u043b\u043a\u043e\u0433\u043e\u043b\u044f. \u041d\u0438\u043a\u0430\u043a\u043e\u0433\u043e \u201c\u043f\u043e \u0447\u0443\u0442\u044c-\u0447\u0443\u0442\u044c\u201d, \u201c\u043f\u043e \u043f\u0440\u0430\u0437\u0434\u043d\u0438\u043a\u0430\u043c\u201d \u0438 \u201c\u044f \u0442\u043e\u043b\u044c\u043a\u043e \u043f\u0440\u0438\u0433\u0443\u0431\u043b\u044e, \u0447\u0435\u0441\u0442\u043d\u043e-\u0447\u0435\u0441\u0442\u043d\u043e, \u0441\u043c\u043e\u0442\u0440\u0438\u0442\u0435 \u043a\u0430\u043a\u043e\u0439 \u044f \u0432\u0437\u0440\u043e\u0441\u043b\u044b\u0439\u201d.",
    "",
    "\u0421\u043e \u0441\u043f\u043e\u043d\u0441\u043e\u0440\u043e\u043c \u043c\u043e\u0436\u043d\u043e \u043e\u0431\u0441\u0443\u0434\u0438\u0442\u044c \u043d\u0435 \u201c\u043c\u043e\u0436\u043d\u043e \u043b\u0438 \u043c\u043d\u0435 \u043f\u0438\u0442\u044c\u201d, \u0430 \u043a\u0430\u043a \u043d\u0435 \u0440\u0430\u0437\u0432\u0435\u0441\u0442\u0438 \u0441\u0435\u0431\u044f \u043d\u0430 \u043f\u0435\u0440\u0432\u044b\u0439 \u0431\u043e\u043a\u0430\u043b \u0438 \u0447\u0442\u043e \u0441\u0434\u0435\u043b\u0430\u0442\u044c \u043f\u0440\u044f\u043c\u043e \u0441\u0435\u0439\u0447\u0430\u0441, \u0447\u0442\u043e\u0431\u044b \u043e\u0441\u0442\u0430\u0442\u044c\u0441\u044f \u0442\u0440\u0435\u0437\u0432\u044b\u043c."
  ].join("\n"),
  otherAddictionsBlocked: "\u0417\u0434\u0435\u0441\u044c \u043c\u044b \u0432\u044b\u0437\u0434\u043e\u0440\u0430\u0432\u043b\u0438\u0432\u0430\u0435\u043c \u043e\u0442 \u0430\u043b\u043a\u043e\u0433\u043e\u043b\u0438\u0437\u043c\u0430 \u0438 \u043d\u0435 \u043e\u0431\u0441\u0443\u0436\u0434\u0430\u0435\u043c \u0434\u0440\u0443\u0433\u0438\u0435 \u0437\u0430\u0432\u0438\u0441\u0438\u043c\u043e\u0441\u0442\u0438: \u043a\u0443\u0440\u0435\u043d\u0438\u0435, \u043d\u0430\u0440\u043a\u043e\u0442\u0438\u043a\u0438, \u0445\u0438\u043c\u0438\u0447\u0435\u0441\u043a\u0438\u0435 \u0437\u0430\u0432\u0438\u0441\u0438\u043c\u043e\u0441\u0442\u0438, \u0438\u0433\u0440\u044b \u0438 \u0432\u0441\u044e \u044d\u0442\u0443 \u0431\u0440\u0438\u0433\u0430\u0434\u0443. \u0410\u043c\u0444\u0435\u0442\u0430\u043c\u0438\u043d, \u043c\u0430\u0440\u0438\u0445\u0443\u0430\u043d\u0430 \u0438 \u043f\u0440\u043e\u0447\u0438\u0435 \u041f\u0410\u0412 \u2014 \u044d\u0442\u043e \u043d\u0430\u0440\u043a\u043e\u0442\u0438\u043a\u0438, \u0442\u043e\u0447\u043a\u0430. \u041f\u043e \u044d\u0442\u0438\u043c \u0442\u0435\u043c\u0430\u043c \u043b\u0443\u0447\u0448\u0435 \u0438\u0441\u043a\u0430\u0442\u044c \u043f\u0440\u043e\u0444\u0438\u043b\u044c\u043d\u0443\u044e \u043f\u043e\u043c\u043e\u0449\u044c, \u0430 \u0442\u0443\u0442 \u0434\u0435\u0440\u0436\u0438\u043c \u0444\u043e\u043a\u0443\u0441 \u043d\u0430 \u0442\u0440\u0435\u0437\u0432\u043e\u0441\u0442\u0438 \u043e\u0442 \u0430\u043b\u043a\u043e\u0433\u043e\u043b\u044f.",
  medicineBlocked: "\u041f\u043e \u043b\u0435\u043a\u0430\u0440\u0441\u0442\u0432\u0430\u043c \u044f \u043d\u0435 \u0444\u0430\u043d\u0442\u0430\u0437\u0438\u0440\u0443\u044e \u0441 \u0443\u043c\u043d\u044b\u043c \u0432\u0438\u0434\u043e\u043c. \u0422\u0430\u0431\u043b\u0435\u0442\u043a\u0438, \u0434\u043e\u0437\u044b, \u043e\u0442\u043c\u0435\u043d\u0430, \u0441\u043e\u0432\u043c\u0435\u0441\u0442\u0438\u043c\u043e\u0441\u0442\u044c \u0438 \u043b\u044e\u0431\u043e\u0435 \u043b\u0435\u0447\u0435\u043d\u0438\u0435 \u2014 \u044d\u0442\u043e \u043a \u0432\u0440\u0430\u0447\u0443. \u0422\u0443\u0442 \u043d\u0435 \u0430\u043f\u0442\u0435\u043a\u0430 \u043f\u0440\u0438 \u0434\u043e\u043c\u043e\u0432\u043e\u043c.",
  lightFallback: "\u042f \u0442\u0443\u0442, \u043d\u043e \u0443 \u043c\u0435\u043d\u044f \u0441\u0435\u0439\u0447\u0430\u0441 \u0447\u0430\u0439\u043d\u0438\u043a \u0432 \u0433\u043e\u043b\u043e\u0432\u0435 \u0441\u0432\u0438\u0441\u0442\u043d\u0443\u043b. \u041f\u043e\u0432\u0442\u043e\u0440\u0438 \u0447\u0443\u0442\u044c \u0438\u043d\u0430\u0447\u0435, \u0438 \u044f \u043f\u043e\u0439\u043c\u0430\u044e, \u043a\u0443\u0434\u0430 \u043d\u0435\u0441\u0442\u0438 \u0442\u0430\u0431\u0443\u0440\u0435\u0442\u043a\u0443.",
  moderationFallback: "\u041d\u0430\u0444\u0430\u043d\u044f \u0431\u0443\u0440\u043a\u043d\u0443\u043b: \u043d\u0435 \u0448\u0430\u043b\u0438, \u0442\u0443\u0442 \u043d\u0435 \u0431\u0430\u0437\u0430\u0440.",
  questionsLoadError: "\u0412\u043e\u043f\u0440\u043e\u0441\u044b \u0434\u043b\u044f \u0438\u0433\u0440\u044b \u0432\u0440\u0435\u043c\u0435\u043d\u043d\u043e \u043d\u0435 \u043f\u043e\u0434\u0433\u0440\u0443\u0437\u0438\u043b\u0438\u0441\u044c \u0438\u0437 GitHub. \u042f \u0442\u0443\u0442 \u043d\u0435 \u043a\u043e\u0441\u044e \u043f\u043e\u0434 \u0433\u0435\u043d\u0438\u044f, \u043f\u0440\u043e\u0441\u0442\u043e \u0438\u0441\u0442\u043e\u0447\u043d\u0438\u043a \u043d\u0435 \u043e\u0442\u0434\u0430\u043b\u0441\u044f. \u041f\u043e\u043f\u0440\u043e\u0431\u0443\u0439 \u0435\u0449\u0451 \u0440\u0430\u0437 \u0447\u0443\u0442\u044c \u043f\u043e\u0437\u0436\u0435."
};

async function sendPanelMessage(env, sendMessage, callTelegram, chatId, text, threadId, replyToMessageId, keyboard) {
  try {
    return await sendMessage(env, chatId, text, threadId, replyToMessageId, keyboard);
  } catch (error) {
    const closedTopic = threadId && /TOPIC_CLOSED|topic.*closed/i.test(String(error?.message || ""));
    if (!closedTopic || !callTelegram) {
      throw error;
    }
    await callTelegram(env, "reopenForumTopic", {
      chat_id: chatId,
      message_thread_id: threadId
    });
    try {
      return await sendMessage(env, chatId, text, threadId, replyToMessageId, keyboard);
    } finally {
      await callTelegram(env, "closeForumTopic", {
        chat_id: chatId,
        message_thread_id: threadId
      }).catch((closeError) => console.error("closeForumTopic failed after panel send", closeError));
    }
  }
}

export async function handleTechThreadMessage(env, message, text, chatId, threadId, deps) {
  const {
    isTechThread,
    isChatGroup,
    isPrivateChat,
    isMeetingPanelCommand,
    isUserAdmin,
    getPrivateRoles,
    buildPersonalDayUserSnapshot,
    sendMessage,
    callTelegram,
    INFO_CHAT_ID,
    CHAT_GROUP_ID,
    MEETING_PANEL_TEXT,
    TECH_THREAD_ID,
    buildMeetingKeyboard,
    isQueuePanelCommand,
    QUEUE_PANEL_TEXT,
    buildQueueKeyboard,
    isYozhikCommand,
    sendYozhikToGroup,
    isBillPromptCommand,
    callAnnouncementState,
    parseBillInput,
    sendBillToGroup
  } = deps;

  const chatType = message.chat?.type ?? TEXT.unknown;
  const isPanelPlace = isTechThread(chatId, threadId) || isChatGroup(chatId, threadId) || isPrivateChat(chatType);
  const panelTargetChatId = isPrivateChat(chatType) ? chatId : isChatGroup(chatId, threadId) ? CHAT_GROUP_ID : INFO_CHAT_ID;
  const panelTargetThreadId = isPrivateChat(chatType) || isChatGroup(chatId, threadId) ? null : TECH_THREAD_ID;
  const panelReplyId = isPrivateChat(chatType) ? message.message_id : null;
  const canUsePanel = async () => {
    if (Number(message?.sender_chat?.id) === Number(chatId)) {
      return true;
    }
    if (isPrivateChat(chatType)) {
      const user = buildPersonalDayUserSnapshot(message);
      const roles = await getPrivateRoles(env, user.userId);
      return Boolean(roles.isAdmin);
    }
    return isUserAdmin(env, message.from?.id, chatId, chatType);
  };

  if (isPanelPlace && isMeetingPanelCommand(text, { allowBare: !isChatGroup(chatId, threadId) })) {
    if (!await canUsePanel()) {
      await sendMessage(env, chatId, "\u041F\u0443\u043B\u044C\u0442\u044B \u0442\u043E\u043B\u044C\u043A\u043E \u0434\u043B\u044F \u0430\u0434\u043C\u0438\u043D\u043E\u0432.", threadId, message.message_id);
      return okResponse();
    }
    await sendPanelMessage(env, sendMessage, callTelegram, panelTargetChatId, MEETING_PANEL_TEXT, panelTargetThreadId, panelReplyId, buildMeetingKeyboard());
    return okResponse();
  }

  if (isPanelPlace && isQueuePanelCommand(text)) {
    if (!await canUsePanel()) {
      await sendMessage(env, chatId, "\u041F\u0443\u043B\u044C\u0442\u044B \u0442\u043E\u043B\u044C\u043A\u043E \u0434\u043B\u044F \u0430\u0434\u043C\u0438\u043D\u043E\u0432.", threadId, message.message_id);
      return okResponse();
    }
    await sendPanelMessage(env, sendMessage, callTelegram, panelTargetChatId, QUEUE_PANEL_TEXT, panelTargetThreadId, panelReplyId, buildQueueKeyboard());
    return okResponse();
  }

  if (isTechThread(chatId, threadId) && isYozhikCommand(text)) {
    try {
      await sendYozhikToGroup(env);
      await sendMessage(env, INFO_CHAT_ID, TEXT.yozhikOk, TECH_THREAD_ID, message.message_id);
    } catch (error) {
      await sendMessage(env, INFO_CHAT_ID, `${TEXT.yozhikError}: ${error.message}`, TECH_THREAD_ID, message.message_id);
    }
    return okResponse();
  }

  const billPromptStateKey = `bill_prompt_waiting:${chatId}:${threadId || 0}`;
  const billLastRequestKey = `bill_last_request:${chatId}:${threadId || 0}`;

  if (isPanelPlace && isBillPromptCommand(text)) {
    if (!await canUsePanel()) return null;
    const prompt = await sendMessage(env, chatId, TEXT.billPrompt, threadId, message.message_id);
    await callAnnouncementState(env, "set_message_id", {
      key: billPromptStateKey,
      messageId: prompt?.result?.message_id ?? 1
    });
    return okResponse();
  }

  if (isPanelPlace) {
    const billNumber = parseBillInput(text);
    if (billNumber !== null) {
      if (!await canUsePanel()) return null;
      const explicitBillCommand = /^билл\s+\d{1,3}$/i.test(text.trim());
      const lastProcessed = await callAnnouncementState(env, "get", { key: billLastRequestKey }).catch(() => ({ messageId: null }));
      if (Number(lastProcessed?.messageId) === Number(message.message_id)) {
        return okResponse();
      }
      const waiting = explicitBillCommand ? { messageId: 1 } : await callAnnouncementState(env, "get", { key: billPromptStateKey }).catch(() => ({ messageId: null }));
      if (!waiting?.messageId) {
        return null;
      }
      try {
        await callAnnouncementState(env, "set_message_id", { key: billLastRequestKey, messageId: message.message_id });
        await callAnnouncementState(env, "set_message_id", { key: billPromptStateKey, messageId: null });
        await sendBillToGroup(env, billNumber);
        if (!isChatGroup(chatId, threadId)) {
          await sendMessage(env, chatId, `${TEXT.billSent} \u2116${billNumber} ${TEXT.billSentTail}`, threadId, message.message_id);
        }
      } catch (error) {
        await callAnnouncementState(env, "set_message_id", { key: billPromptStateKey, messageId: 1 });
        await sendMessage(env, chatId, `${TEXT.billError}: ${error.message}`, threadId, message.message_id);
      }
      return okResponse();
    }
  }

  return null;
}

function normalizeButtonText(text) {
  return String(text || "").replace(/\uFE0F/g, "").trim();
}

function isMyDayOnButton(text) {
  return normalizeButtonText(text) === normalizeButtonText(DM_BUTTONS.mydayOn);
}

function isMyDayOffButton(text) {
  return normalizeButtonText(text) === normalizeButtonText(DM_BUTTONS.mydayOff);
}

function isAdminAnnounceButton(text) {
  return normalizeButtonText(text) === normalizeButtonText(DM_BUTTONS.adminAnnounce);
}

function isAddAdminButton(text) {
  return normalizeButtonText(text) === normalizeButtonText(DM_BUTTONS.addAdmin);
}

function isRemoveAdminButton(text) {
  return normalizeButtonText(text) === normalizeButtonText(DM_BUTTONS.removeAdmin);
}

function buildPrivateMenuKeyboard({ isOwner = false, isAdmin = false, isSubscriber = false } = {}) {
  if (!isAdmin && !isSubscriber) {
    return { remove_keyboard: true };
  }
  const keyboard = [[DM_BUTTONS.mydayOn, DM_BUTTONS.mydayOff]];
  if (isAdmin) {
    keyboard.push([DM_BUTTONS.adminAnnounce]);
  }
  if (isOwner) {
    keyboard.push([DM_BUTTONS.addAdmin, DM_BUTTONS.removeAdmin]);
  }
  return {
    keyboard,
    resize_keyboard: true,
    one_time_keyboard: false,
    is_persistent: true
  };
}

function buildAdminDraftInlineKeyboard() {
  return {
    inline_keyboard: [[
      { text: "\u041e\u0442\u043f\u0440\u0430\u0432\u0438\u0442\u044c \u0430\u0434\u043c\u0438\u043d\u0430\u043c", callback_data: ADMIN_DM_CALLBACKS.send },
      { text: "\u041e\u0442\u043c\u0435\u043d\u0430", callback_data: ADMIN_DM_CALLBACKS.cancel }
    ]]
  };
}

function buildUserLabel(user) {
  const name = `${user?.firstName || ""} ${user?.lastName || ""}`.trim();
  const username = user?.username ? `@${user.username}` : "";
  return (name && username ? `${name} (${username})` : name || username || `id ${user?.userId || "unknown"}`).slice(0, 60);
}

function buildOwnerAdminListKeyboard(users, action) {
  return {
    inline_keyboard: users.slice(0, 30).map((user) => ([{
      text: buildUserLabel(user),
      callback_data: `owner_admin:${action}:${user.userId}`
    }]))
  };
}

async function ensurePrivateBotCommands(env, setMyCommands) {
  if (!setMyCommands) return;
  await setMyCommands(env, [
    { command: "start", description: "\u041f\u043e\u0434\u043a\u043b\u044e\u0447\u0438\u0442\u044c \u043b\u0438\u0447\u043a\u0443" },
    { command: "menu", description: "\u041f\u043e\u043a\u0430\u0437\u0430\u0442\u044c \u043a\u043d\u043e\u043f\u043a\u0438" },
    { command: "myday_on", description: "\u0412\u043a\u043b\u044e\u0447\u0438\u0442\u044c \u0440\u0430\u0441\u0441\u044b\u043b\u043a\u0443 10\u201311 \u0448\u0430\u0433\u0430" },
    { command: "myday_off", description: "\u0412\u044b\u043a\u043b\u044e\u0447\u0438\u0442\u044c \u0440\u0430\u0441\u0441\u044b\u043b\u043a\u0443 10\u201311 \u0448\u0430\u0433\u0430" },
    { command: "admin_announce", description: "\u041e\u0442\u043f\u0440\u0430\u0432\u0438\u0442\u044c \u043e\u0431\u044a\u044f\u0432\u043b\u0435\u043d\u0438\u0435 \u0430\u0434\u043c\u0438\u043d\u0430\u043c" }
  ], { type: "all_private_chats" }).catch((error) => console.error("setMyCommands failed", error));
}

async function savePrivateContact(env, user, callPersonalDayState, extra = {}) {
  const current = (await callPersonalDayState(env, "get_personal_subscription", { userId: user.userId }).catch(() => ({ subscription: null }))).subscription || {};
  const subscription = {
    ...current,
    ...user,
    ...extra
  };
  await callPersonalDayState(env, "set_personal_subscription", {
    userId: user.userId,
    subscription
  });
  return subscription;
}

async function handleMyDayOn(env, message, chatId, user, roles, deps) {
  const { callPersonalDayState, sendMessage } = deps;
  if (!roles.isAdmin && !roles.isSubscriber) {
    await sendMessage(env, chatId, TEXT.mydayAccessDenied, null, message.message_id);
    return okResponse();
  }
  await savePrivateContact(env, user, callPersonalDayState, {
    enabled: true,
    allowed: true,
    enabledAt: Date.now()
  });
  await sendMessage(env, chatId, TEXT.mydayOnShort, null, message.message_id, buildPrivateMenuKeyboard(roles));
  return okResponse();
}

async function handleMyDayOff(env, message, chatId, user, roles, deps) {
  const { callPersonalDayState, sendMessage } = deps;
  if (!roles.isAdmin && !roles.isSubscriber) {
    await sendMessage(env, chatId, TEXT.mydayAccessDenied, null, message.message_id);
    return okResponse();
  }
  await savePrivateContact(env, user, callPersonalDayState, {
    enabled: false,
    allowed: true,
    disabledAt: Date.now()
  });
  await sendMessage(env, chatId, TEXT.mydayOffShort, null, message.message_id, buildPrivateMenuKeyboard(roles));
  return okResponse();
}

async function handleAdminAnnounce(env, message, chatId, user, roles, deps) {
  const { callPersonalDayState, sendMessage } = deps;
  if (!roles.isAdmin) {
    await sendMessage(env, chatId, TEXT.adminDenied, null, message.message_id);
    return okResponse();
  }
  await savePrivateContact(env, user, callPersonalDayState, { allowed: roles.isSubscriber || roles.isAdmin });
  await callPersonalDayState(env, "set_admin_dm_draft", {
    userId: user.userId,
    draft: {
      mode: "waiting",
      createdAt: Date.now()
    }
  });
  await sendMessage(env, chatId, TEXT.adminAnnouncePrompt, null, message.message_id, buildPrivateMenuKeyboard(roles));
  return okResponse();
}

async function handleAdminDraftMessage(env, message, text, chatId, user, roles, deps) {
  const { callPersonalDayState, sendMessage } = deps;
  if (!roles.isAdmin) return null;
  const current = await callPersonalDayState(env, "get_admin_dm_draft", { userId: user.userId }).catch(() => ({ draft: null }));
  if (current?.draft?.mode !== "waiting") {
    return null;
  }
  const draftText = String(text || "").trim();
  const draft = {
    mode: "draft",
    text: draftText,
    createdAt: current.draft.createdAt || Date.now()
  };
  if (!message.text) {
    draft.sourceChatId = chatId;
    draft.sourceMessageId = message.message_id;
  }
  await callPersonalDayState(env, "set_admin_dm_draft", { userId: user.userId, draft });
  await sendMessage(env, chatId, TEXT.adminDraftReady, null, message.message_id, buildAdminDraftInlineKeyboard());
  return okResponse();
}

async function handleOwnerAddAdmin(env, message, chatId, roles, deps) {
  const { callPersonalDayState, sendMessage, getPrivateRoles } = deps;
  if (!roles.isOwner) {
    await sendMessage(env, chatId, TEXT.ownerDenied, null, message.message_id);
    return okResponse();
  }
  const result = await callPersonalDayState(env, "list_personal_subscriptions").catch(() => ({ subscriptions: [] }));
  const candidates = [];
  for (const item of result.subscriptions || []) {
    const itemRoles = await getPrivateRoles(env, item.userId);
    if (!itemRoles.isAdmin) {
      candidates.push(item);
    }
  }
  if (!candidates.length) {
    await sendMessage(env, chatId, TEXT.noAdminCandidates, null, message.message_id, buildPrivateMenuKeyboard(roles));
    return okResponse();
  }
  await sendMessage(env, chatId, TEXT.chooseAddAdmin, null, message.message_id, buildOwnerAdminListKeyboard(candidates, "add"));
  return okResponse();
}

async function handleOwnerRemoveAdmin(env, message, chatId, roles, deps) {
  const { callPersonalDayState, sendMessage, getPrivateRoles } = deps;
  if (!roles.isOwner) {
    await sendMessage(env, chatId, TEXT.ownerDenied, null, message.message_id);
    return okResponse();
  }
  const result = await callPersonalDayState(env, "list_personal_subscriptions").catch(() => ({ subscriptions: [] }));
  const candidates = [];
  for (const item of result.subscriptions || []) {
    const itemRoles = await getPrivateRoles(env, item.userId);
    if (itemRoles.isAdmin && !itemRoles.isOwner) {
      candidates.push(item);
    }
  }
  if (!candidates.length) {
    await sendMessage(env, chatId, TEXT.noAdminCandidates, null, message.message_id, buildPrivateMenuKeyboard(roles));
    return okResponse();
  }
  await sendMessage(env, chatId, TEXT.chooseRemoveAdmin, null, message.message_id, buildOwnerAdminListKeyboard(candidates, "remove"));
  return okResponse();
}

export async function handleServiceMessages(env, message, text, chatId, threadId, chatType, deps) {
  const {
    isIdCommand,
    sendMessage,
    isPrivateChat,
    isChatGroup,
    isTechThread,
    isUserAdmin,
    isTimerPanelCommand,
    CHAT_GROUP_ID,
    INFO_CHAT_ID,
    callPersonalDayState,
    buildPersonalDayUserSnapshot,
    getPrivateRoles,
    setMyCommands,
    TIMER_PANEL_TEXT,
    TECH_THREAD_ID,
    buildTimerKeyboard,
    callTelegram,
    isPrepThread,
    hasFixMarker,
    getAuthorLabel,
    sendAdminDigest,
    FIX_CONFIRMATION,
    hasHelpMarker,
    HELP_CONFIRMATION,
    hasServiceRequest,
    normalizeLightText,
    parseNafanyaQuestion,
    SERVICE_CONFIRMATION,
    sendManualServiceReminder,
    resetManualReplacementRequest,
    sendManualCoordinatorServiceSummary
  } = deps;

  const privateMenuCommand = isStartCommand(text) || isMenuCommand(text) || isMyDayOnCommand(text) || isMyDayOffCommand(text) || isAdminAnnounceCommand(text) || isMyDayOnButton(text) || isMyDayOffButton(text) || isAdminAnnounceButton(text) || isAddAdminButton(text) || isRemoveAdminButton(text);
  if ((isMenuCommand(text) || isAdminAnnounceCommand(text)) && !isPrivateChat(chatType)) {
    return okResponse();
  }
  if (privateMenuCommand) {
    if (!isPrivateChat(chatType)) {
      return okResponse();
    }
    await ensurePrivateBotCommands(env, setMyCommands);
    const user = buildPersonalDayUserSnapshot(message);
    const roles = await getPrivateRoles(env, user.userId);
    if (isStartCommand(text)) {
      await savePrivateContact(env, user, callPersonalDayState, {
        allowed: roles.isAdmin || roles.isSubscriber,
        startedAt: Date.now()
      });
      const hasButtons = roles.isAdmin || roles.isSubscriber;
      await sendMessage(env, chatId, hasButtons ? TEXT.connected : TEXT.online, null, message.message_id, buildPrivateMenuKeyboard(roles));
      return okResponse();
    }
    if (isMenuCommand(text)) {
      if (!roles.isAdmin && !roles.isSubscriber) {
        await sendMessage(env, chatId, TEXT.noButtons, null, message.message_id, { remove_keyboard: true });
      } else {
        await sendMessage(env, chatId, TEXT.connected, null, message.message_id, buildPrivateMenuKeyboard(roles));
      }
      return okResponse();
    }
    if (isMyDayOnCommand(text) || isMyDayOnButton(text)) {
      return handleMyDayOn(env, message, chatId, user, roles, { callPersonalDayState, sendMessage });
    }
    if (isMyDayOffCommand(text) || isMyDayOffButton(text)) {
      return handleMyDayOff(env, message, chatId, user, roles, { callPersonalDayState, sendMessage });
    }
    if (isAdminAnnounceCommand(text) || isAdminAnnounceButton(text)) {
      return handleAdminAnnounce(env, message, chatId, user, roles, { callPersonalDayState, sendMessage });
    }
    if (isAddAdminButton(text)) {
      return handleOwnerAddAdmin(env, message, chatId, roles, { callPersonalDayState, sendMessage, getPrivateRoles });
    }
    if (isRemoveAdminButton(text)) {
      return handleOwnerRemoveAdmin(env, message, chatId, roles, { callPersonalDayState, sendMessage, getPrivateRoles });
    }
  }

  if (isPrivateChat(chatType)) {
    const user = buildPersonalDayUserSnapshot(message);
    const roles = await getPrivateRoles(env, user.userId);
    if (isServiceSummaryTestCommand(text)) {
      if (!roles.isOwner) {
        await sendMessage(env, chatId, TEXT.serviceReminderTestDenied, null, message.message_id);
        return okResponse();
      }
      try {
        const result = await sendManualCoordinatorServiceSummary(env);
        await sendMessage(env, chatId, `\u0422\u0435\u0441\u0442\u043e\u0432\u0430\u044f \u0441\u0432\u043e\u0434\u043a\u0430 \u043a\u043e\u043e\u0440\u0434\u0438\u043d\u0430\u0442\u043e\u0440\u0443 \u043e\u0442\u043f\u0440\u0430\u0432\u043b\u0435\u043d\u0430: ${result.dateKey}.`, null, message.message_id);
      } catch (error) {
        await sendMessage(env, chatId, `\u041d\u0435 \u0441\u043c\u043e\u0433 \u043e\u0442\u043f\u0440\u0430\u0432\u0438\u0442\u044c \u0441\u0432\u043e\u0434\u043a\u0443: ${error.message}`, null, message.message_id);
      }
      return okResponse();
    }
    if (isReplacementResetTestCommand(text)) {
      if (!roles.isOwner) {
        await sendMessage(env, chatId, TEXT.serviceReminderTestDenied, null, message.message_id);
        return okResponse();
      }
      const parsed = parseReplacementResetTestCommand(text);
      if (!parsed.target) {
        await sendMessage(env, chatId, "\u0424\u043e\u0440\u043c\u0430\u0442: /test_reset_replacement @username \u0432\u0435\u0434\u0443\u0449\u0438\u0439\n\u0418\u043b\u0438: /test_reset_replacement @username \u0442\u0435\u0445\u0432\u0435\u0434", null, message.message_id);
        return okResponse();
      }
      try {
        const result = await resetManualReplacementRequest(env, parsed.target, parsed.roleKey);
        const status = result.closed ? "\u0417\u0430\u043a\u0440\u044b\u043b \u043e\u0442\u043a\u0440\u044b\u0442\u044b\u0439 \u0442\u0435\u0441\u0442\u043e\u0432\u044b\u0439 \u0437\u0430\u043f\u0440\u043e\u0441." : "\u041e\u0442\u043a\u0440\u044b\u0442\u043e\u0433\u043e \u0437\u0430\u043f\u0440\u043e\u0441\u0430 \u043d\u0435 \u0431\u044b\u043b\u043e.";
        await sendMessage(env, chatId, `${status}\n${result.target}, ${result.role}, ${result.dateKey}.`, null, message.message_id);
      } catch (error) {
        await sendMessage(env, chatId, `\u041d\u0435 \u0441\u043c\u043e\u0433 \u0441\u0431\u0440\u043e\u0441\u0438\u0442\u044c \u0442\u0435\u0441\u0442: ${error.message}`, null, message.message_id);
      }
      return okResponse();
    }
    if (isServiceReminderTestCommand(text)) {
      if (!roles.isOwner) {
        await sendMessage(env, chatId, TEXT.serviceReminderTestDenied, null, message.message_id);
        return okResponse();
      }
      const parsed = parseServiceReminderTestCommand(text);
      if (!parsed.target) {
        await sendMessage(env, chatId, TEXT.serviceReminderTestUsage, null, message.message_id);
        return okResponse();
      }
      try {
        const result = await sendManualServiceReminder(env, parsed.target, parsed.roleKey);
        await sendMessage(env, chatId, `\u0422\u0435\u0441\u0442\u043e\u0432\u043e\u0435 \u043d\u0430\u043f\u043e\u043c\u0438\u043d\u0430\u043d\u0438\u0435 \u043e\u0442\u043f\u0440\u0430\u0432\u043b\u0435\u043d\u043e: ${result.target}, ${result.role}, ${result.dateKey}.`, null, message.message_id);
      } catch (error) {
        await sendMessage(env, chatId, `\u041d\u0435 \u0441\u043c\u043e\u0433 \u043e\u0442\u043f\u0440\u0430\u0432\u0438\u0442\u044c \u0442\u0435\u0441\u0442: ${error.message}`, null, message.message_id);
      }
      return okResponse();
    }
    const draftResponse = await handleAdminDraftMessage(env, message, text, chatId, user, roles, { callPersonalDayState, sendMessage });
    if (draftResponse) {
      return draftResponse;
    }
  }

  if (isIdCommand(text)) {
    const userId = message.from?.id ?? TEXT.unknown;
    const replyText = [
      TEXT.accepted,
      `chat_id: ${chatId}`,
      `user_id: ${userId}`,
      `message_thread_id: ${threadId ?? TEXT.none}`,
      `chat_type: ${chatType ?? TEXT.unknown}`,
      "",
      TEXT.testMessage
    ].join("\n");
    await sendMessage(env, chatId, replyText, threadId, message.message_id);
    return okResponse();
  }

  if ((isChatGroup(chatId, threadId) || isTechThread(chatId, threadId) || isPrivateChat(chatType)) && isTimerPanelCommand(text)) {
    let allowed = false;
    if (isPrivateChat(chatType)) {
      const user = buildPersonalDayUserSnapshot(message);
      const roles = await getPrivateRoles(env, user.userId);
      allowed = Boolean(roles.isAdmin);
    } else {
      allowed = await isUserAdmin(env, message.from?.id, chatId, chatType);
    }
    if (!allowed) {
      await sendMessage(env, chatId, "\u041F\u0443\u043B\u044C\u0442\u044B \u0442\u043E\u043B\u044C\u043A\u043E \u0434\u043B\u044F \u0430\u0434\u043C\u0438\u043D\u043E\u0432.", threadId, message.message_id);
      return okResponse();
    }
    const targetChatId = isPrivateChat(chatType) ? chatId : isChatGroup(chatId, threadId) ? CHAT_GROUP_ID : INFO_CHAT_ID;
    const targetThreadId = isPrivateChat(chatType) || isChatGroup(chatId, threadId) ? null : TECH_THREAD_ID;
    const replyToMessageId = isPrivateChat(chatType) ? message.message_id : null;
    await sendPanelMessage(env, sendMessage, callTelegram, targetChatId, TIMER_PANEL_TEXT, targetThreadId, replyToMessageId, buildTimerKeyboard());
    return okResponse();
  }

  const nafanyaRequestHere = isNafanyaRequestHere(message, text, chatId, chatType, { isPrivateChat, CHAT_GROUP_ID, INFO_CHAT_ID, normalizeLightText, parseNafanyaQuestion });
  const canSendAdminSignal = nafanyaRequestHere || isPrepThread(chatId, threadId);

  if (canSendAdminSignal && hasFixMarker(text)) {
    const author = getAuthorLabel(message);
    await sendAdminDigest(env, "\u0424\u0418\u041a\u0421\u0418\u0420\u0423\u042e", author, text, "#\u0444\u0438\u043a\u0441\u0438\u0440\u0443\u044e");
    await sendMessage(env, chatId, FIX_CONFIRMATION, threadId, message.message_id);
    return okResponse();
  }

  if (canSendAdminSignal && hasHelpMarker(text)) {
    const author = getAuthorLabel(message);
    await sendAdminDigest(env, "HELP", author, text, "#help");
    await sendMessage(env, chatId, HELP_CONFIRMATION, threadId, message.message_id);
    return okResponse();
  }

  if (nafanyaRequestHere && hasServiceRequest(text)) {
    const author = getAuthorLabel(message);
    await sendAdminDigest(env, "\u0421\u041b\u0423\u0416\u0415\u041d\u0418\u0415", author, text, "#\u0441\u043b\u0443\u0436\u0435\u043d\u0438\u0435");
    await sendMessage(env, chatId, SERVICE_CONFIRMATION, threadId, message.message_id);
    return okResponse();
  }

  return null;
}

function buildMessageLink(chatId, messageId) {
  const rawChatId = String(chatId || "");
  if (!messageId || !rawChatId.startsWith("-100")) return "";
  return `https://t.me/c/${rawChatId.slice(4)}/${messageId}`;
}

function buildUnansweredDisplayName(user) {
  const name = `${user?.first_name || ""} ${user?.last_name || ""}`.trim();
  return name || (user?.username ? `@${user.username}` : `id ${user?.id || "unknown"}`);
}

function buildUnansweredSource(chatType, repliedToBot) {
  if (chatType === "private") return "\u043b\u0438\u0447\u043a\u0430";
  return repliedToBot ? "\u043e\u0442\u0432\u0435\u0442 \u043d\u0430 \u0441\u043e\u043e\u0431\u0449\u0435\u043d\u0438\u0435" : "\u043e\u0431\u0449\u0438\u0439 \u0447\u0430\u0442";
}

function buildUnansweredAdminText(message, question, chatType, { searchFailed = false } = {}) {
  const user = message?.from || {};
  const username = user.username ? `@${user.username}` : "\u043d\u0435\u0442";
  const source = buildUnansweredSource(chatType, Boolean(message?.reply_to_message?.from?.is_bot));
  const link = buildMessageLink(message?.chat?.id, message?.message_id);
  return [
    "\u0412\u041e\u041f\u0420\u041e\u0421 \u0411\u0415\u0417 \u041e\u0422\u0412\u0415\u0422\u0410 \u0412 \u0414\u041e\u041a\u0423\u041c\u0415\u041d\u0422\u0410\u0425",
    "",
    `\u041e\u0442: ${buildUnansweredDisplayName(user)}`,
    `Username: ${username}`,
    `User ID: ${user.id || "\u043d\u0435\u0442"}`,
    `\u0418\u0441\u0442\u043e\u0447\u043d\u0438\u043a: ${source}`,
    link ? `\u0421\u0441\u044b\u043b\u043a\u0430: ${link}` : "",
    searchFailed ? "\u041f\u0440\u0438\u0447\u0438\u043d\u0430: \u0434\u043e\u043a\u0443\u043c\u0435\u043d\u0442\u044b \u0432\u0440\u0435\u043c\u0435\u043d\u043d\u043e \u043d\u0435\u0434\u043e\u0441\u0442\u0443\u043f\u043d\u044b / \u043e\u0448\u0438\u0431\u043a\u0430 \u043f\u043e\u0438\u0441\u043a\u0430." : "",
    "\u0412\u043e\u043f\u0440\u043e\u0441:",
    String(question || "").trim(),
    "",
    TEXT.unansweredAdminTail
  ].filter((line) => line !== null && line !== undefined).join("\n");
}

async function notifyUnansweredQuestion(env, message, question, chatId, threadId, chatType, deps, { searchFailed = false, searchError = null } = {}) {
  const {
    sendMessage,
    callAnnouncementState,
    callTelegram,
    notifyOwnerTechError,
    INFO_CHAT_ID,
    CHAT_GROUP_ID,
    ADMIN_THREAD_ID
  } = deps;
  const key = `unanswered_question:${chatId}:${message?.message_id || "unknown"}`;
  const existing = await callAnnouncementState(env, "get", { key }).catch(() => ({ messageId: null }));
  if (existing?.messageId) {
    console.log("duplicate unanswered question skipped", { chatId, messageId: message?.message_id });
    return false;
  }

  if (searchFailed || searchError) {
    console.log("search failed", { chatId, messageId: message?.message_id, userId: message?.from?.id });
    await notifyOwnerTechError?.(env, {
      module: "\u0425\u0440\u0430\u043d\u0438\u0442\u0435\u043b\u044c \u0438\u043d\u0444\u043e\u0440\u043c\u0430\u0446\u0438\u0438",
      operation: "\u043f\u043e\u0438\u0441\u043a \u0432 \u0434\u043e\u043a\u0443\u043c\u0435\u043d\u0442\u0430\u0445",
      error: searchError || new Error("knowledge snapshot unavailable"),
      details: { chat_id: chatId, message_id: message?.message_id, user_id: message?.from?.id },
      hint: "\u041f\u0440\u043e\u0432\u0435\u0440\u044c Google Sheets/Docs, service account, file_id \u0438 \u043f\u0440\u0430\u0432\u0430 \u043d\u0430 \u0447\u0442\u0435\u043d\u0438\u0435."
    });
  } else {
    console.log("unanswered question detected", { chatId, messageId: message?.message_id, userId: message?.from?.id });
  }

  await sendMessage(env, chatId, TEXT.unansweredUser, threadId, message?.message_id);
  await sendMessage(env, INFO_CHAT_ID, buildUnansweredAdminText(message, question, chatType, { searchFailed: searchFailed || Boolean(searchError) }), ADMIN_THREAD_ID);
  if (callTelegram) {
    await callTelegram(env, "copyMessage", {
      chat_id: INFO_CHAT_ID,
      message_thread_id: ADMIN_THREAD_ID,
      from_chat_id: chatId,
      message_id: message?.message_id
    }).catch((error) => {
      console.error("unanswered question copy failed", { chatId, messageId: message?.message_id, error });
      return notifyOwnerTechError?.(env, {
        module: "\u0425\u0440\u0430\u043d\u0438\u0442\u0435\u043b\u044c \u0438\u043d\u0444\u043e\u0440\u043c\u0430\u0446\u0438\u0438",
        operation: "copyMessage \u0432\u043e\u043f\u0440\u043e\u0441\u0430 \u0432 \u0410\u0434\u043c\u0438\u043d\u043a\u0443",
        error,
        details: { source_chat_id: chatId, source_message_id: message?.message_id, target_chat_id: INFO_CHAT_ID },
        hint: "\u041f\u0440\u043e\u0432\u0435\u0440\u044c \u0434\u043e\u0441\u0442\u0443\u043f \u0431\u043e\u0442\u0430 \u043a \u0438\u0441\u0445\u043e\u0434\u043d\u043e\u043c\u0443 \u0447\u0430\u0442\u0443 \u0438 \u0410\u0434\u043c\u0438\u043d\u043a\u0435."
      });
    });
  }
  await callAnnouncementState(env, "set_message_id", { key, messageId: Date.now() });
  console.log("admin notification sent", { chatId, messageId: message?.message_id });
  return true;
}

async function handleConversationMessage(env, message, text, chatId, threadId, chatType, deps) {
  const {
    shouldUseLightConversation,
    getLightTalkKey,
    callLightTalkState,
    isMainMeetingWindow,
    looksLikeBlockedProgramQuestion,
    looksLikeGroupQuestion,
    normalizeLightText,
    answerFixedMeetingQuestion,
    answerKnowledgeQuestion,
    findKnowledgeAnswer,
    findKnowledgeAnswerDetailed,
    answerLightConversation,
    copyTechMessageToGroup,
    TECH_MESSAGES,
    sendMessage,
    isPrivateChat,
    parseNafanyaQuestion,
    isChatGroup,
    callQueueState,
    callAnnouncementState,
    callTelegram,
    notifyOwnerTechError,
    CHAT_GROUP_ID,
    INFO_CHAT_ID,
    ADMIN_THREAD_ID
  } = deps;

  const nafanyaRequestHere = isNafanyaRequestHere(message, text, chatId, chatType, { isPrivateChat, CHAT_GROUP_ID, INFO_CHAT_ID, normalizeLightText, parseNafanyaQuestion });
  const fixedMeeting = answerFixedMeetingQuestion(text);
  if (fixedMeeting?.answer) {
    await sendMessage(env, chatId, fixedMeeting.answer, threadId, message.message_id);
    return okResponse();
  }

  if ((isChatGroup(chatId, threadId) || nafanyaRequestHere) && looksLikeTelemostLinkRequest(text, normalizeLightText)) {
    await copyTechMessageToCurrentChat(env, chatId, threadId, TECH_MESSAGES.telemost_link, { callTelegram, INFO_CHAT_ID });
    return okResponse();
  }

  if (nafanyaRequestHere && canCopyMeetingScheduleHere(chatId, chatType, { isPrivateChat, CHAT_GROUP_ID, INFO_CHAT_ID }) && looksLikeMeetingScheduleRequest(text, normalizeLightText)) {
    await copyTechMessageToCurrentChat(env, chatId, threadId, TECH_MESSAGES.meeting_schedule, { callTelegram, INFO_CHAT_ID });
    return okResponse();
  }

  if (nafanyaRequestHere && looksLikeAlcoholPermissionQuestion(text, normalizeLightText)) {
    await sendMessage(env, chatId, TEXT.alcoholUseNo, threadId, message.message_id);
    return okResponse();
  }

  if (nafanyaRequestHere && looksLikeMedicineQuestion(text, normalizeLightText)) {
    await sendMessage(env, chatId, TEXT.medicineBlocked, threadId, message.message_id);
    return okResponse();
  }

  if (nafanyaRequestHere && looksLikeOtherAddictionQuestion(text, normalizeLightText)) {
    await sendMessage(env, chatId, TEXT.otherAddictionsBlocked, threadId, message.message_id);
    return okResponse();
  }

  if (isPrivateChat(chatType)) {
    const privateKnowledgeQuestion = parseNafanyaQuestion(text) ?? text;
    try {
      const knowledgeResult = findKnowledgeAnswerDetailed
        ? await findKnowledgeAnswerDetailed(env, privateKnowledgeQuestion, { restrained: false })
        : { answer: await findKnowledgeAnswer(env, privateKnowledgeQuestion, { restrained: false }), searchFailed: false };
      if (knowledgeResult.answer) {
        await sendMessage(env, chatId, knowledgeResult.answer, threadId, message.message_id);
        return okResponse();
      }
    } catch (error) {
      console.error("private knowledge answer failed", { chatId, error });
    }
  }

  if (shouldUseLightConversation(message, text, chatType)) {
    const restrained = isMainMeetingWindow();
    let factualAnswer = null;
    const groupQuestionLike = looksLikeGroupQuestion(text, normalizeLightText);
    const blockedProgramLike = looksLikeBlockedProgramQuestion(text, normalizeLightText);
    const replyToBot = Boolean(message?.reply_to_message?.from?.is_bot);
    const parsedAddressedQuestion = parseNafanyaQuestion(text);
    const explicitTextAddress = hasExplicitTextAddress(text, normalizeLightText) || parsedAddressedQuestion !== null;
    if ((isChatGroup(chatId, threadId) || nafanyaRequestHere) && looksLikeTelemostLinkRequest(text, normalizeLightText)) {
      await copyTechMessageToCurrentChat(env, chatId, threadId, TECH_MESSAGES.telemost_link, { callTelegram, INFO_CHAT_ID });
      return okResponse();
    }
    if (nafanyaRequestHere && canCopyMeetingScheduleHere(chatId, chatType, { isPrivateChat, CHAT_GROUP_ID, INFO_CHAT_ID }) && looksLikeMeetingScheduleRequest(text, normalizeLightText)) {
      await copyTechMessageToCurrentChat(env, chatId, threadId, TECH_MESSAGES.meeting_schedule, { callTelegram, INFO_CHAT_ID });
      return okResponse();
    }
    if (!isPrivateChat(chatType) && parsedAddressedQuestion !== null) {
      try {
        const knowledgeResult = findKnowledgeAnswerDetailed
          ? await findKnowledgeAnswerDetailed(env, parsedAddressedQuestion, { restrained })
          : { answer: await findKnowledgeAnswer(env, parsedAddressedQuestion, { restrained }), searchFailed: false };
        factualAnswer = knowledgeResult.answer;
      } catch (error) {
        factualAnswer = null;
        console.error("addressed knowledge answer failed", { chatId, threadId, error });
      }
    }
    if (!factualAnswer && (groupQuestionLike || blockedProgramLike) && (!replyToBot || explicitTextAddress)) {
      try {
        const knowledgeResult = findKnowledgeAnswerDetailed
          ? await findKnowledgeAnswerDetailed(env, text, { restrained })
          : { answer: await findKnowledgeAnswer(env, text, { restrained }), searchFailed: false };
        factualAnswer = knowledgeResult.answer;
        if (!factualAnswer && (explicitTextAddress || replyToBot || isPrivateChat(chatType))) {
          await notifyUnansweredQuestion(env, message, text, chatId, threadId, chatType, {
            sendMessage,
            callAnnouncementState,
            callTelegram,
            notifyOwnerTechError,
            INFO_CHAT_ID,
            ADMIN_THREAD_ID
          }, { searchFailed: Boolean(knowledgeResult.searchFailed) });
          return okResponse();
        }
      } catch (error) {
        factualAnswer = null;
        if (explicitTextAddress || replyToBot || isPrivateChat(chatType)) {
          await notifyUnansweredQuestion(env, message, text, chatId, threadId, chatType, {
            sendMessage,
            callAnnouncementState,
            callTelegram,
            notifyOwnerTechError,
            INFO_CHAT_ID,
            ADMIN_THREAD_ID
          }, { searchFailed: true, searchError: error });
          return okResponse();
        }
      }
    }

    if (factualAnswer) {
      await sendMessage(env, chatId, factualAnswer, threadId, message.message_id);
      return okResponse();
    }

    if (!explicitTextAddress && !replyToBot && !isPrivateChat(chatType)) {
      return okResponse();
    }

    const lightTalkKey = getLightTalkKey(chatId, threadId, chatType, message?.from?.id ?? null);
    let history = [];
    try {
      const lightTalkInfo = await callLightTalkState(env, "get", {}, lightTalkKey);
      history = Array.isArray(lightTalkInfo?.state?.history) ? lightTalkInfo.state.history : [];
    } catch (error) {
      console.error("light talk history load failed", { chatId, threadId, error });
    }

    const finalAnswer = await answerLightConversation(env, {
      history,
      userText: text,
      restrained,
      factualAnswer: null
    }) || TEXT.lightFallback;

    try {
      await callLightTalkState(env, "append", { role: "user", text }, lightTalkKey);
      await callLightTalkState(env, "append", { role: "assistant", text: finalAnswer }, lightTalkKey);
    } catch (error) {
      console.error("light talk history save failed", { chatId, threadId, error });
    }

    await sendMessage(env, chatId, finalAnswer, threadId, message.message_id);
    return okResponse();
  }

  if (nafanyaRequestHere && parseNafanyaQuestion(text) !== null) {
    const question = parseNafanyaQuestion(text);
    let restrained = false;
    if (isChatGroup(chatId, threadId)) {
      const queueInfo = await callQueueState(env, "get");
      restrained = Boolean(queueInfo.state?.isOpen);
    }
    try {
      const knowledgeResult = findKnowledgeAnswerDetailed
        ? await findKnowledgeAnswerDetailed(env, question, { restrained })
        : { answer: await findKnowledgeAnswer(env, question, { restrained }), searchFailed: false };
      if (knowledgeResult.answer) {
        await sendMessage(env, chatId, knowledgeResult.answer, threadId, message.message_id);
      } else {
        await notifyUnansweredQuestion(env, message, question, chatId, threadId, chatType, {
          sendMessage,
          callAnnouncementState,
          callTelegram,
          notifyOwnerTechError,
          INFO_CHAT_ID,
          ADMIN_THREAD_ID
        }, { searchFailed: Boolean(knowledgeResult.searchFailed) });
      }
    } catch (error) {
      await notifyUnansweredQuestion(env, message, question, chatId, threadId, chatType, {
        sendMessage,
        callAnnouncementState,
        callTelegram,
        notifyOwnerTechError,
        INFO_CHAT_ID,
        ADMIN_THREAD_ID
      }, { searchFailed: true, searchError: error });
    }
    return okResponse();
  }

  return null;
}

async function handleModerationMessage(env, message, text, chatId, threadId, deps) {
  const {
    isChatGroup,
    classifyModeration,
    getAuthorLabel,
    sendMessage,
    getModerationWarningText,
    getModerationDeleteText,
    sleep,
    deleteMessageSafe,
    sendAdminSignal
  } = deps;

  if (!isChatGroup(chatId, threadId)) {
    return null;
  }

  const moderationLevel = classifyModeration(text);
  const author = getAuthorLabel(message);
  if (moderationLevel === "warn") {
    await sendAdminSignal(env, author, text, false);
    await sendMessage(env, chatId, getModerationWarningText(), null, message.message_id);
    return okResponse();
  }
  if (moderationLevel === "delete") {
    await sendAdminSignal(env, author, text, true);
    let noticeSent = false;
    try {
      await sendMessage(env, chatId, getModerationDeleteText(), null, message.message_id);
      noticeSent = true;
    } catch (error) {
      console.error("moderation delete notice failed", { chatId, messageId: message.message_id, error });
      try {
        await sendMessage(env, chatId, TEXT.moderationFallback, null, message.message_id);
        noticeSent = true;
      } catch (fallbackError) {
        console.error("moderation delete fallback failed", {
          chatId,
          messageId: message.message_id,
          fallbackError
        });
      }
    }
    if (noticeSent) {
      await sleep(350);
    }
    await deleteMessageSafe(env, chatId, message.message_id);
    return okResponse();
  }
  return null;
}

async function handleGroupQueueAndGameMessage(env, message, text, chatId, threadId, deps) {
  const {
    isChatGroup,
    callQueueState,
    parseGameCommand,
    parseQueueEntry,
    getBillQuestionNumber,
    getSpeakerQuestions,
    sendMessage,
    applyQueueResponse
  } = deps;

  if (!isChatGroup(chatId, threadId)) {
    return null;
  }

  if (message?.reply_to_message && !message.reply_to_message?.from?.is_bot) {
    return null;
  }

  const queueInfo = await callQueueState(env, "get");
  const gameNumber = parseGameCommand(text);

  if (gameNumber !== null) {
    if (!queueInfo.state?.isOpen || queueInfo.state?.mode !== "bill") {
      await sendMessage(env, chatId, "\u0418\u0433\u0440\u0430 \u0440\u0430\u0431\u043e\u0442\u0430\u0435\u0442 \u0442\u043e\u043b\u044c\u043a\u043e \u0432\u043e \u0432\u0440\u0435\u043c\u044f \u0441\u043e\u0431\u0440\u0430\u043d\u0438\u044f", null, message.message_id);
      return okResponse();
    }
    let speakerQuestions;
    try {
      speakerQuestions = await getSpeakerQuestions();
    } catch {
      await sendMessage(env, chatId, TEXT.questionsLoadError, null, message.message_id);
      return okResponse();
    }
    if (gameNumber >= 1 && gameNumber <= speakerQuestions.size) {
      const question = speakerQuestions.get(gameNumber);
      if (question) {
        await sendMessage(env, chatId, `\u0412\u043e\u043f\u0440\u043e\u0441 ${gameNumber}:\n\n${question}`, null, message.message_id);
        if (queueInfo.state?.isOpen && queueInfo.state?.mode === "bill") {
          const gameQueueEntry = parseQueueEntry(message, queueInfo.state);
          if (gameQueueEntry) {
            const result = await callQueueState(env, "add", { entry: gameQueueEntry });
            await applyQueueResponse(env, result);
          }
        }
      } else {
        await sendMessage(env, chatId, `\u041d\u0435 \u043d\u0430\u0448\u0451\u043b \u0432\u043e\u043f\u0440\u043e\u0441 ${gameNumber}. \u041f\u0440\u043e\u0432\u0435\u0440\u044c \u043d\u043e\u043c\u0435\u0440.`, null, message.message_id);
      }
    } else {
      await sendMessage(env, chatId, `\u0414\u043b\u044f \u0438\u0433\u0440\u044b \u0443 \u043c\u0435\u043d\u044f \u0441\u0435\u0439\u0447\u0430\u0441 \u0435\u0441\u0442\u044c \u0432\u043e\u043f\u0440\u043e\u0441\u044b \u0441 1 \u043f\u043e ${speakerQuestions.size}. \u041d\u0435 \u043f\u044b\u0442\u0430\u0439\u0441\u044f \u043e\u0431\u043c\u0430\u043d\u0443\u0442\u044c \u043c\u0430\u0442\u0435\u043c\u0430\u0442\u0438\u043a\u0443, \u043e\u043d\u0430 \u0437\u043b\u043e\u043f\u0430\u043c\u044f\u0442\u043d\u0430\u044f.`, null, message.message_id);
    }
    return okResponse();
  }

  const billGameNumber = typeof getBillQuestionNumber === "function" ? getBillQuestionNumber(text) : null;
  if (billGameNumber !== null && (!queueInfo.state?.isOpen || queueInfo.state?.mode !== "bill")) {
    await sendMessage(env, chatId, "\u0418\u0433\u0440\u0430 \u0440\u0430\u0431\u043e\u0442\u0430\u0435\u0442 \u0442\u043e\u043b\u044c\u043a\u043e \u0432\u043e \u0432\u0440\u0435\u043c\u044f \u0441\u043e\u0431\u0440\u0430\u043d\u0438\u044f", null, message.message_id);
    return okResponse();
  }

  const queueEntry = parseQueueEntry(message, queueInfo.state);
  if (queueEntry) {
    const result = await callQueueState(env, "add", { entry: queueEntry });
    await applyQueueResponse(env, result);
  }

  return null;
}

function stripManualQueueAddress(text) {
  return String(text || "")
    .trim()
    .replace(/^\s*(?:\u043d\u0430\u0444\u0430\u043d\u044f|nafanya|\u0431\u043e\u0442|bot)\s*[,:\-]?\s*/iu, "")
    .trim();
}

function cleanManualQueueAuthor(value) {
  return String(value || "").replace(/^[\s!.,?:;#-]+|[\s!.,?:;#-]+$/gu, "").trim();
}

function parseManualQueueCommand(text) {
  const source = stripManualQueueAddress(text);
  const removeMatch = source.match(/^(?:\u0443\u0434\u0430\u043b\u0438|\u0443\u0434\u0430\u043b\u0438\u0442\u044c|\u0443\u0431\u0435\u0440\u0438)\s+\u0438\u0437\s+\u043e\u0447\u0435\u0440\u0435\u0434\u0438\s+(\d{1,3})$/iu);
  if (removeMatch) {
    return { action: "remove", index: Number(removeMatch[1]) };
  }
  const addMatch = source.match(/^(?:\u0434\u043e\u0431\u0430\u0432\u044c|\u0434\u043e\u0431\u0430\u0432\u0438\u0442\u044c|\u0432\u043d\u0435\u0441\u0438|\u0432\u043d\u0435\u0441\u0442\u0438)(?:\s+\u0432\s+\u043e\u0447\u0435\u0440\u0435\u0434\u044c)?\s+(.+)$/iu);
  if (!addMatch) {
    return null;
  }
  const body = addMatch[1].trim();
  const gameMatch = body.match(/^(?:\u0438\u0433\u0440\u0430|\u0438\u0440\u0433\u0430|\u0432\u043e\u043f\u0440\u043e\u0441)\s+(\d{1,3})(?:[\s!.,?:;#-]+)(.+)$/iu);
  if (gameMatch) {
    return {
      action: "add_game",
      number: Number(gameMatch[1]),
      author: cleanManualQueueAuthor(gameMatch[2])
    };
  }
  const direct111 = body.match(/^111(?:$|[\s!.,?:;#-]+)(.*)$/u);
  if (direct111) {
    return { action: "add_111", author: cleanManualQueueAuthor(direct111[1]) };
  }
  const reverse111 = body.match(/^(.+?)(?:[\s!.,?:;#-]+)111(?:[\s!.,?:;#-]*)$/u);
  if (reverse111) {
    return { action: "add_111", author: cleanManualQueueAuthor(reverse111[1]) };
  }
  return { action: "invalid_add" };
}

async function handleManualQueueAdminCommand(env, message, text, chatId, threadId, chatType, deps) {
  const parsed = parseManualQueueCommand(text);
  if (!parsed) {
    return null;
  }
  const {
    buildPersonalDayUserSnapshot,
    getPrivateRoles,
    isUserAdmin,
    callQueueState,
    makeManualQueueEntry,
    getSpeakerQuestions,
    sendMessage,
    applyQueueResponse,
    isPrivateChat,
    CHAT_GROUP_ID
  } = deps;

  const user = buildPersonalDayUserSnapshot(message);
  const roles = isPrivateChat(chatType)
    ? await getPrivateRoles(env, user.userId)
    : { isAdmin: await isUserAdmin(env, message.from?.id, chatId, chatType) };
  if (!roles.isAdmin) {
    await sendMessage(env, chatId, "\u042d\u0442\u0430 \u043a\u043e\u043c\u0430\u043d\u0434\u0430 \u0442\u043e\u043b\u044c\u043a\u043e \u0434\u043b\u044f \u0430\u0434\u043c\u0438\u043d\u043e\u0432.", threadId, message.message_id);
    return okResponse();
  }

  const queueInfo = await callQueueState(env, "get");
  if (!queueInfo.state?.isOpen || !queueInfo.state?.mode) {
    await sendMessage(env, chatId, "\u041e\u0447\u0435\u0440\u0435\u0434\u044c \u0441\u0435\u0439\u0447\u0430\u0441 \u0437\u0430\u043a\u0440\u044b\u0442\u0430.", threadId, message.message_id);
    return okResponse();
  }

  try {
    if (parsed.action === "remove") {
      const result = await callQueueState(env, "remove_by_number", { index: parsed.index });
      await applyQueueResponse(env, result);
      if (isPrivateChat(chatType)) {
        await sendMessage(env, chatId, "\u0423\u0431\u0440\u0430\u043b \u0438\u0437 \u043e\u0447\u0435\u0440\u0435\u0434\u0438.", null, message.message_id);
      }
      return okResponse();
    }

    if (parsed.action === "add_111") {
      if (!parsed.author) {
        await sendMessage(env, chatId, "\u041d\u0430\u043f\u0438\u0448\u0438 \u0438\u043c\u044f: \u00ab\u041d\u0430\u0444\u0430\u043d\u044f, \u0434\u043e\u0431\u0430\u0432\u044c \u0432 \u043e\u0447\u0435\u0440\u0435\u0434\u044c 111 \u0442\u0430\u0442\u0430\u00bb.", threadId, message.message_id);
        return okResponse();
      }
      const entry = queueInfo.state.mode === "bill"
        ? makeManualQueueEntry(parsed.author, "speech", "__speech__", text, { kind: "bill_speech", speechNote: null })
        : makeManualQueueEntry(parsed.author, queueInfo.state.mode, "111", text);
      const result = await callQueueState(env, "add", { entry });
      await applyQueueResponse(env, result);
      if (isPrivateChat(chatType)) {
        await sendMessage(env, chatId, "\u0414\u043e\u0431\u0430\u0432\u0438\u043b \u0432 \u043e\u0447\u0435\u0440\u0435\u0434\u044c.", null, message.message_id);
      }
      return okResponse();
    }

    if (parsed.action === "add_game") {
      if (queueInfo.state.mode !== "bill") {
        await sendMessage(env, chatId, "\u0418\u0433\u0440\u0443 \u043c\u043e\u0436\u043d\u043e \u0432\u0440\u0443\u0447\u043d\u0443\u044e \u0434\u043e\u0431\u0430\u0432\u0438\u0442\u044c \u0442\u043e\u043b\u044c\u043a\u043e \u0432 \u043e\u0447\u0435\u0440\u0435\u0434\u0438 \u0411\u0438\u043b\u043b.", threadId, message.message_id);
        return okResponse();
      }
      if (!parsed.author) {
        await sendMessage(env, chatId, "\u041d\u0430\u043f\u0438\u0448\u0438 \u0438\u043c\u044f: \u00ab\u041d\u0430\u0444\u0430\u043d\u044f, \u0434\u043e\u0431\u0430\u0432\u044c \u0432 \u043e\u0447\u0435\u0440\u0435\u0434\u044c \u0438\u0433\u0440\u0430 100 \u0442\u0430\u0442\u0430\u00bb.", threadId, message.message_id);
        return okResponse();
      }
      const speakerQuestions = await getSpeakerQuestions();
      const question = speakerQuestions.get(parsed.number);
      if (!question) {
        await sendMessage(env, chatId, `\u041d\u0435 \u043d\u0430\u0448\u0451\u043b \u0432\u043e\u043f\u0440\u043e\u0441 ${parsed.number}.`, threadId, message.message_id);
        return okResponse();
      }
      const entry = makeManualQueueEntry(parsed.author, "first", `\u0438\u0433\u0440\u0430 ${parsed.number}`, text);
      const result = await callQueueState(env, "add", { entry });
      await applyQueueResponse(env, result);
      const targetChatId = isPrivateChat(chatType) ? CHAT_GROUP_ID : chatId;
      const targetThreadId = isPrivateChat(chatType) ? null : threadId;
      const replyToMessageId = isPrivateChat(chatType) ? null : message.message_id;
      await sendMessage(env, targetChatId, `\u0412\u043e\u043f\u0440\u043e\u0441 ${parsed.number}:\n\n${question}`, targetThreadId, replyToMessageId);
      if (isPrivateChat(chatType)) {
        await sendMessage(env, chatId, "\u0414\u043e\u0431\u0430\u0432\u0438\u043b \u0432 \u043e\u0447\u0435\u0440\u0435\u0434\u044c \u0438 \u043e\u0442\u043f\u0440\u0430\u0432\u0438\u043b \u0432\u043e\u043f\u0440\u043e\u0441.", null, message.message_id);
      }
      return okResponse();
    }

    await sendMessage(env, chatId, "\u041a\u043e\u043c\u0430\u043d\u0434\u0430 \u043d\u0435 \u043f\u043e\u043d\u044f\u0442\u043d\u0430. \u041f\u0440\u0438\u043c\u0435\u0440: \u00ab\u041d\u0430\u0444\u0430\u043d\u044f, \u0434\u043e\u0431\u0430\u0432\u044c \u0432 \u043e\u0447\u0435\u0440\u0435\u0434\u044c 111 \u0442\u0430\u0442\u0430\u00bb.", threadId, message.message_id);
  } catch (error) {
    await sendMessage(env, chatId, `\u0421\u0431\u043e\u0439: ${error.message}`, threadId, message.message_id);
  }
  return okResponse();
}

export async function handleWebhookMessage(env, message, deps) {
  if (!message?.text && !message?.caption) {
    const chatType = message?.chat?.type ?? TEXT.unknown;
    if (deps.isPrivateChat(chatType) && message?.chat?.id && message?.message_id) {
      const user = deps.buildPersonalDayUserSnapshot(message);
      const roles = await deps.getPrivateRoles(env, user.userId);
      const draftResponse = await handleAdminDraftMessage(env, message, "", message.chat.id, user, roles, {
        callPersonalDayState: deps.callPersonalDayState,
        sendMessage: deps.sendMessage
      });
      if (draftResponse) return draftResponse;
    }
    return okResponse();
  }

  const text = String(message.text ?? message.caption ?? "").trim();
  if (isEmojiOnlyText(text)) {
    return okResponse();
  }

  const chatId = message.chat.id;
  const threadId = message.message_thread_id ?? null;
  const chatType = message.chat?.type ?? TEXT.unknown;

  const serviceResponse = await handleServiceMessages(env, message, text, chatId, threadId, chatType, deps);
  if (serviceResponse) return serviceResponse;

  const techResponse = await handleTechThreadMessage(env, message, text, chatId, threadId, deps);
  if (techResponse) return techResponse;

  const manualQueueResponse = await handleManualQueueAdminCommand(env, message, text, chatId, threadId, chatType, deps);
  if (manualQueueResponse) return manualQueueResponse;

  const moderationResponse = await handleModerationMessage(env, message, text, chatId, threadId, deps);
  if (moderationResponse) return moderationResponse;

  const queueResponse = await handleGroupQueueAndGameMessage(env, message, text, chatId, threadId, deps);
  if (queueResponse) return queueResponse;

  const conversationResponse = await handleConversationMessage(env, message, text, chatId, threadId, chatType, deps);
  if (conversationResponse) return conversationResponse;

  return okResponse();
}
