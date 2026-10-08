export const MEETING_BOARD_DAYS = Object.freeze(["monday", "tuesday", "thursday", "friday", "sunday"]);
export const MEETING_BOARD_TEXT_LIMIT = 300;

const DAY_LABELS = Object.freeze({
  monday: "\u041f\u043e\u043d\u0435\u0434\u0435\u043b\u044c\u043d\u0438\u043a",
  tuesday: "\u0412\u0442\u043e\u0440\u043d\u0438\u043a",
  thursday: "\u0427\u0435\u0442\u0432\u0435\u0440\u0433",
  friday: "\u041f\u044f\u0442\u043d\u0438\u0446\u0430",
  sunday: "\u0412\u043e\u0441\u043a\u0440\u0435\u0441\u0435\u043d\u044c\u0435"
});

const DAY_TOPIC_KEYS = Object.freeze({
  monday: "theme_monday",
  tuesday: "theme_tuesday",
  thursday: "theme_thursday",
  friday: "theme_friday",
  sunday: "theme_sunday"
});

const MONTH_STEPS = Object.freeze([
  "\u041f\u0415\u0420\u0412\u042b\u0419", "\u0412\u0422\u041e\u0420\u041e\u0419", "\u0422\u0420\u0415\u0422\u0418\u0419", "\u0427\u0415\u0422\u0412\u0401\u0420\u0422\u042b\u0419",
  "\u041f\u042f\u0422\u042b\u0419", "\u0428\u0415\u0421\u0422\u041e\u0419", "\u0421\u0415\u0414\u042c\u041c\u041e\u0419", "\u0412\u041e\u0421\u042c\u041c\u041e\u0419",
  "\u0414\u0415\u0412\u042f\u0422\u042b\u0419", "\u0414\u0415\u0421\u042f\u0422\u042b\u0419", "\u041e\u0414\u0418\u041d\u041d\u0410\u0414\u0426\u0410\u0422\u042b\u0419", "\u0414\u0412\u0415\u041d\u0410\u0414\u0426\u0410\u0422\u042b\u0419"
]);

export function unicodeLength(value) {
  return Array.from(String(value || "")).length;
}

export function createEmptyMeetingBoardState() {
  return { sessionDate: "", dayKey: "", version: 0, entries: [], additionalTopics: [], lastMessages: [], processedRequestIds: [], updatedAt: 0 };
}

export function createEmptySpeakerQuestionsState() {
  return { sessionDate: "", version: 0, entries: [], lastMessages: [], processedRequestIds: [], updatedAt: 0 };
}

function normalizeRequestIds(value) {
  return (Array.isArray(value) ? value : []).map((item) => String(item || "").trim()).filter(Boolean).slice(-100);
}

export function normalizeMeetingBoardState(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    ...createEmptyMeetingBoardState(),
    ...source,
    entries: (Array.isArray(source.entries) ? source.entries : []).filter((item) => item && item.id && item.text).map((item) => ({ ...item, status: item.status === "spoken" ? "spoken" : "waiting" })),
    additionalTopics: (Array.isArray(source.additionalTopics) ? source.additionalTopics : []).filter((item) => item && item.id && item.text),
    lastMessages: (Array.isArray(source.lastMessages) ? source.lastMessages : []).map(String).filter(Boolean),
    processedRequestIds: normalizeRequestIds(source.processedRequestIds)
  };
}

export function normalizeSpeakerQuestionsState(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    ...createEmptySpeakerQuestionsState(),
    ...source,
    entries: (Array.isArray(source.entries) ? source.entries : []).filter((item) => item && item.id && item.text),
    lastMessages: (Array.isArray(source.lastMessages) ? source.lastMessages : []).map(String).filter(Boolean),
    processedRequestIds: normalizeRequestIds(source.processedRequestIds)
  };
}

export function sanitizeBoardText(value, { stripLeadingNumber = false } = {}) {
  const raw = String(value || "");
  if (!raw.trim()) throw new Error("\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u0442\u0435\u043a\u0441\u0442.");
  if (/[\u0000-\u001F\u007F<>]/u.test(raw)) throw new Error("\u0417\u0430\u043f\u0438\u0441\u044c \u0434\u043e\u043b\u0436\u043d\u0430 \u0431\u044b\u0442\u044c \u043e\u0434\u043d\u043e\u0439 \u0441\u0442\u0440\u043e\u043a\u043e\u0439 \u0431\u0435\u0437 \u0441\u043b\u0443\u0436\u0435\u0431\u043d\u044b\u0445 \u0441\u0438\u043c\u0432\u043e\u043b\u043e\u0432.");
  let text = raw.replace(/\s+/gu, " ").trim();
  if (stripLeadingNumber) text = text.replace(/^\d{1,3}[.)]\s*/u, "").trim();
  if (!text) throw new Error("\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u0442\u0435\u043a\u0441\u0442.");
  if (unicodeLength(text) > MEETING_BOARD_TEXT_LIMIT) throw new Error("\u041e\u0434\u043d\u0430 \u0437\u0430\u043f\u0438\u0441\u044c \u043c\u043e\u0436\u0435\u0442 \u0441\u043e\u0434\u0435\u0440\u0436\u0430\u0442\u044c \u043d\u0435 \u0431\u043e\u043b\u0435\u0435 300 \u0437\u043d\u0430\u043a\u043e\u0432.");
  return text;
}

function safePartSplit(value, maxLength) {
  const chunks = [];
  let rest = String(value || "").trim();
  while (unicodeLength(rest) > maxLength) {
    const codepoints = Array.from(rest);
    const candidate = codepoints.slice(0, maxLength).join("");
    const breaks = [candidate.lastIndexOf("\n\n"), candidate.lastIndexOf("\n"), candidate.lastIndexOf(". "), candidate.lastIndexOf(" ")];
    const best = Math.max(...breaks);
    const cutText = best >= Math.floor(candidate.length * 0.55) ? candidate.slice(0, best + (candidate.slice(best, best + 2) === ". " ? 1 : 0)) : candidate;
    const cut = Math.max(1, unicodeLength(cutText));
    chunks.push(codepoints.slice(0, cut).join("").trim());
    rest = codepoints.slice(cut).join("").trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

export function splitBoardZoomMessages(value, limit = 950) {
  const text = String(value || "").replace(/\r\n?/gu, "\n").replace(/[ \t]+\n/gu, "\n").replace(/\n{4,}/gu, "\n\n\n").trim();
  if (!text) return [];
  if (unicodeLength(text) <= limit) return [text];
  return safePartSplit(text, limit);
}

function applyMonthlyStep(text, sessionDate) {
  const month = Number(String(sessionDate || "").slice(5, 7));
  if (!Number.isInteger(month) || month < 1 || month > 12) return text;
  return String(text || "").replace(/(?:\u041f\u0415\u0420\u0412\u042b\u0419|\u0412\u0422\u041e\u0420\u041e\u0419|\u0422\u0420\u0415\u0422\u0418\u0419|\u0427\u0415\u0422\u0412\u0401\u0420\u0422\u042b\u0419|\u041f\u042f\u0422\u042b\u0419|\u0428\u0415\u0421\u0422\u041e\u0419|\u0421\u0415\u0414\u042c\u041c\u041e\u0419|\u0412\u041e\u0421\u042c\u041c\u041e\u0419|\u0414\u0415\u0412\u042f\u0422\u042b\u0419|\u0414\u0415\u0421\u042f\u0422\u042b\u0419|\u041e\u0414\u0418\u041d\u041d\u0410\u0414\u0426\u0410\u0422\u042b\u0419|\u0414\u0412\u0415\u041d\u0410\u0414\u0426\u0410\u0422\u042b\u0419)\s+\u0428\u0410\u0413/u, `${MONTH_STEPS[month - 1]} \u0428\u0410\u0413`);
}

export function buildMeetingBoardText(state, topicTexts) {
  const board = normalizeMeetingBoardState(state);
  const topicKey = DAY_TOPIC_KEYS[board.dayKey];
  const configured = topicKey ? topicTexts?.[topicKey] : null;
  const base = applyMonthlyStep(Array.isArray(configured) ? configured.join("\n") : String(configured || ""), board.sessionDate).trim();
  if (!base) throw new Error("\u041d\u0435 \u043d\u0430\u0439\u0434\u0435\u043d \u0442\u0435\u043a\u0441\u0442 \u0442\u0435\u043c \u0434\u043b\u044f \u044d\u0442\u043e\u0433\u043e \u0434\u043d\u044f.");
  const topicLines = board.additionalTopics.map((item, index) => `${index + 1}. ${item.text}`);
  const queueLines = board.entries.length ? board.entries.map((item, index) => `${index + 1}. ${item.status === "spoken" ? "\u2705 " : ""}${item.text}`) : ["\u041f\u043e\u043a\u0430 \u0437\u0430\u044f\u0432\u043e\u043a \u043d\u0435\u0442."];
  return [base, topicLines.length ? topicLines.join("\n") : "", "\u041e\u0427\u0415\u0420\u0415\u0414\u042c \u041e\u0422\u041a\u0420\u042b\u0422\u0410:", queueLines.join("\n")].filter(Boolean).join("\n\n");
}

export function buildSpeakerQuestionsText(state) {
  const speaker = normalizeSpeakerQuestionsState(state);
  const lines = speaker.entries.map((item, index) => `${index + 1}. ${item.status === "spoken" ? "\u2705 " : ""}${item.text}`);
  return [
    "\u0412\u041e\u041f\u0420\u041e\u0421\u042b \u0421\u041f\u0418\u041a\u0415\u0420\u0423",
    "\uD83D\uDC49 \u0414\u043b\u044f \u0442\u043e\u0433\u043e, \u0447\u0442\u043e\u0431\u044b \u0437\u0430\u0434\u0430\u0442\u044c \u0432\u043e\u043f\u0440\u043e\u0441 \u0441\u043f\u0438\u043a\u0435\u0440\u0443 \u0433\u043e\u043b\u043e\u0441\u043e\u043c, \u043f\u0438\u0448\u0438\u0442\u0435 \u0432 \u0447\u0430\u0442\u0435 \u00ab111\u00bb\n\u270D\uFE0F \u041b\u0438\u0431\u043e \u043d\u0430\u043f\u0438\u0448\u0438\u0442\u0435 \u0432\u043e\u043f\u0440\u043e\u0441 \u0432 \u0447\u0430\u0442\u0435 \u0438 \u0435\u0433\u043e \u0437\u0430\u0434\u0430\u0441\u0442 \u0432\u0435\u0434\u0443\u0449\u0438\u0439",
    lines.join("\n")
  ].filter(Boolean).join("\n\n");
}

export function meetingDayLabel(dayKey) {
  return DAY_LABELS[dayKey] || dayKey;
}

export function isMeetingBoardDay(dayKey) {
  return MEETING_BOARD_DAYS.includes(String(dayKey || ""));
}
