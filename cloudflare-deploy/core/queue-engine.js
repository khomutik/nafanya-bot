import {
  QUEUE_CLOSED_LABEL,
  QUEUE_OPEN_LABEL,
  getQueueInstruction,
  getQueueModeTitle
} from "../bot_panels.js";

export const QUEUE_FOOTER_LINES = [];

export function normalizeQueueText(text) {
  return String(text || "").toLowerCase().replace(/\u0451/g, "\u0435").trim();
}

export function compact(value) {
  return String(value || "").replace(/\uFEFF/g, "").replace(/\s+/g, " ").trim();
}

export function stripTelegramHandles(value) {
  return compact(String(value || "").replace(/\s*\(@[A-Za-z0-9_]{2,64}\)/gu, "").replace(/@([A-Za-z0-9_]{2,64})/gu, "$1"));
}

export function cleanQueueDisplayName(value) {
  return stripTelegramHandles(value).replace(/\s*\((?:Telegram|Zoom)\)\s*$/giu, "").trim();
}

export function formatQueueAuthorLabel(author) {
  const cleanAuthor = cleanQueueDisplayName(author);
  return cleanAuthor || "\u043d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u043e\u043f\u0440\u0435\u0434\u0435\u043b\u0438\u0442\u044c";
}

export function getAuthorLabel(message) {
  const first = message?.from?.first_name ?? "";
  const last = message?.from?.last_name ?? "";
  const fullName = `${first} ${last}`.trim();
  const username = message?.from?.username ? `@${message.from.username}` : "";
  if (fullName && username) return `${fullName} (${username})`;
  if (fullName) return fullName;
  if (username) return username;
  if (message?.sender_chat?.title) return `\u043e\u0442 \u0438\u043c\u0435\u043d\u0438 \u0447\u0430\u0442\u0430: ${message.sender_chat.title}`;
  return "\u043d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u043e\u043f\u0440\u0435\u0434\u0435\u043b\u0438\u0442\u044c";
}

export function normalizeQueueEntryKey(value) {
  return normalizeQueueText(cleanQueueDisplayName(value)).replace(/\s+/g, " ");
}

export function isDuplicatePendingQueueEntry(state, entry) {
  const author = normalizeQueueEntryKey(entry.author);
  const block = String(entry.block || "");
  const label = normalizeQueueEntryKey(entry.label);
  return state.entries.some((existing) => existing.status === "pending" && normalizeQueueEntryKey(existing.author) === author && String(existing.block || "") === block && normalizeQueueEntryKey(existing.label) === label);
}

export function isDuplicatePendingBillSpeechEntry(state, entry) {
  const author = normalizeQueueEntryKey(entry.author);
  const note = normalizeQueueEntryKey(entry.speechNote || "");
  return state.entries.some((existing) => {
    if (existing.status !== "pending" || normalizeQueueEntryKey(existing.author) !== author) return false;
    const match = String(existing.label || "").match(/^(111|222|333|444)(?:\s+(.*))?$/u);
    return Boolean(match) && normalizeQueueEntryKey(match[2] || "") === note;
  });
}

function getCurrentTimestamp() {
  return Date.now() + Math.floor(Math.random() * 1e3);
}

export function makeQueueEntry(message, block, label, rawText, extra = {}) {
  const chatId = message?.chat?.id ?? "manual";
  const messageId = message?.message_id ?? getCurrentTimestamp();
  return {
    id: `${chatId}_${messageId}_${Math.random().toString(36).slice(2, 8)}`,
    author: formatQueueAuthorLabel(extra.author ?? getAuthorLabel(message)),
    rawText,
    label,
    block,
    createdAt: getCurrentTimestamp(),
    isActive: false,
    status: "pending",
    kind: extra.kind ?? null,
    speechNote: extra.speechNote ?? null
  };
}

export function makeManualQueueEntry(author, block, label, rawText, extra = {}) {
  return makeQueueEntry(
    { chat: { id: "manual" }, message_id: getCurrentTimestamp(), from: { first_name: author } },
    block,
    label,
    rawText,
    { ...extra, author }
  );
}

export function getQueue111Note(rawText) {
  const text = String(rawText || "").trim();
  const match = text.match(/(^|[\s!.,?:;#-]+)111(?=$|[\s!.,?:;#-]+)/);
  if (!match) return null;
  const numberIndex = match.index + match[1].length;
  const before = text.slice(0, numberIndex).replace(/[\s!.,?:;#-]+$/u, "").trim();
  const after = text.slice(numberIndex + 3).replace(/^[\s!.,?:;#-]+/u, "").trim();
  return compact(`${before} ${after}`);
}

export function getQueueSpeechCodeNote(rawText) {
  const text = String(rawText || "").trim();
  const match = text.match(/(^|[\s!.,?:;#-]+)(111|222|333|444)(?=$|[\s!.,?:;#-]+)/);
  if (!match) return null;
  const numberIndex = match.index + match[1].length;
  const code = match[2];
  const before = text.slice(0, numberIndex).replace(/[\s!.,?:;#-]+$/u, "").trim();
  const after = text.slice(numberIndex + code.length).replace(/^[\s!.,?:;#-]+/u, "").trim();
  return { code, note: compact(`${before} ${after}`) };
}

export function formatQueue111Label(note, code = "111") {
  const cleanNote = stripTelegramHandles(note);
  return cleanNote ? `${code} ${cleanNote}` : code;
}

export function getQueueBlockDividerTitle(block) {
  const titleByBlock = {
    first: "111 / \u0418\u0413\u0420\u0410",
    "222": "222",
    "333": "333",
    "444": "444"
  };
  const title = titleByBlock[block] ?? "\u041e\u0427\u0415\u0420\u0415\u0414\u042c";
  return `\u2501\u2501\u2501\u2501 ${title} \u2501\u2501\u2501\u2501`;
}

export function getBillQuestionNumber(text) {
  const normalized = normalizeQueueText(text);
  const explicit = normalized.match(/(?:\u0438\u0433\u0440\u0430[\u0430-\u044f]*|\u0438\u0440\u0433\u0430[\u0430-\u044f]*|\u0432\u043e\u043f\u0440\u043e\u0441[\u0430-\u044f]*)\s*(\d{1,3})/i);
  if (!explicit) return null;
  const number = Number(explicit[1]);
  return number >= 1 && number <= 500 ? number : null;
}

export function parseGameCommand(text) {
  return getBillQuestionNumber(text);
}

export function createEmptyQueueState() {
  return {
    isOpen: false,
    mode: null,
    entries: [],
    history: [],
    queueMessageId: null
  };
}

export function cloneQueueState(state) {
  return JSON.parse(JSON.stringify(state));
}

export function normalizeQueueState(queueState) {
  const source = queueState && typeof queueState === "object" ? queueState : {};
  return {
    ...createEmptyQueueState(),
    ...cloneQueueState(source),
    entries: Array.isArray(source.entries) ? cloneQueueState(source.entries) : [],
    history: Array.isArray(source.history) ? cloneQueueState(source.history) : []
  };
}

export function pushQueueHistory(state) {
  state.history.push(cloneQueueState({
    isOpen: state.isOpen,
    mode: state.mode,
    entries: state.entries,
    history: [],
    queueMessageId: state.queueMessageId
  }));
  if (state.history.length > 50) state.history.shift();
}

export function ensureSingleActiveEntry(state) {
  const pendingEntries = state.entries.filter((entry) => entry.status === "pending");
  if (pendingEntries.length === 0) {
    state.entries.forEach((entry) => {
      entry.isActive = false;
    });
    return;
  }
  const alreadyActive = pendingEntries.find((entry) => entry.isActive);
  if (alreadyActive) {
    state.entries.forEach((entry) => {
      if (entry.id !== alreadyActive.id) entry.isActive = false;
    });
    return;
  }
  const firstPending = pendingEntries[0];
  state.entries.forEach((entry) => {
    entry.isActive = entry.id === firstPending.id;
  });
}

export function stripQueueHtml(text) {
  return String(text || "").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim();
}

export function getEntryBlock(state, entry) {
  return state.mode === "bill" ? entry.block : "single";
}

export function buildQueueText(state) {
  const lines = [
    `<b>${getQueueModeTitle(state.mode)}</b>`,
    `<i>${getQueueInstruction(state.mode)}</i>`,
    "",
    state.isOpen ? `<b>${QUEUE_OPEN_LABEL}</b>` : `<b>${QUEUE_CLOSED_LABEL}</b>`,
    ""
  ];
  if (state.entries.length === 0) {
    lines.push("\u041f\u043e\u043a\u0430 \u043f\u0443\u0441\u0442\u043e.");
    lines.push(...QUEUE_FOOTER_LINES);
    return lines.join("\n");
  }
  let previousBlock = null;
  for (const [index, entry] of state.entries.entries()) {
    const block = state.mode === "bill" ? getEntryBlock(state, entry) : "single";
    if (state.mode === "bill" && block !== previousBlock) {
      if (previousBlock !== null) lines.push("");
      lines.push(`<b>${getQueueBlockDividerTitle(block)}</b>`);
      previousBlock = block;
    }
    let marker = "\u2022";
    if (entry.status === "done") marker = "\u2705";
    else if (entry.isActive) marker = "\u25B6";
    lines.push(`${marker} ${index + 1}. ${entry.author} \u2014 ${entry.label}`);
  }
  lines.push(...QUEUE_FOOTER_LINES);
  return lines.join("\n");
}

export function buildZoomOnlyQueueText(state) {
  const title = stripQueueHtml(getQueueModeTitle(state.mode));
  const instruction = state.mode === "bill"
    ? "\u041f\u0438\u0448\u0438\u0442\u0435 \u0432 \u0447\u0430\u0442 \"111\" \u0434\u043b\u044f \u0432\u044b\u0441\u043a\u0430\u0437\u044b\u0432\u0430\u043d\u0438\u044f \u0438\u043b\u0438 \"\u0438\u0433\u0440\u0430 \u043d\u043e\u043c\u0435\u0440 \u0432\u043e\u043f\u0440\u043e\u0441\u0430 \u043e\u0442 1 \u0434\u043e 500\" \u0434\u043b\u044f \u0443\u0447\u0430\u0441\u0442\u0438\u044f \u0432 \u0438\u0433\u0440\u0435 \"500 \u043f\u043e\u0447\u0442\u0438 \u043d\u043e\u0440\u043c\u0430\u043b\u044c\u043d\u044b\u0445 \u0432\u043e\u043f\u0440\u043e\u0441\u043e\u0432\""
    : stripQueueHtml(getQueueInstruction(state.mode));
  const base = [title, instruction, "", state.isOpen ? QUEUE_OPEN_LABEL : QUEUE_CLOSED_LABEL, ""];
  if (!state.entries.length) {
    base.push("\u041f\u043e\u043a\u0430 \u043f\u0443\u0441\u0442\u043e.");
    return base.join("\n");
  }
  for (const [index, entry] of state.entries.entries()) {
    let marker = "\u2022";
    if (entry.status === "done") marker = "\u2705";
    else if (entry.isActive) marker = "\u25B6";
    base.push(`${marker} ${index + 1}. ${entry.author} \u2014 ${entry.label}`);
  }
  return base.join("\n");
}

export function addQueueEntryToState(state, entry, { allowDuplicateEntries = false } = {}) {
  if (!allowDuplicateEntries && isDuplicatePendingQueueEntry(state, entry)) {
    ensureSingleActiveEntry(state);
    return;
  }
  state.entries.push(entry);
  if (state.mode === "bill") {
    const priorityOrder = { first: 1, "222": 2, "333": 3, "444": 4 };
    state.entries.sort((a, b) => {
      const diff = (priorityOrder[a.block] ?? 99) - (priorityOrder[b.block] ?? 99);
      return diff !== 0 ? diff : a.createdAt - b.createdAt;
    });
  } else {
    state.entries.sort((a, b) => a.createdAt - b.createdAt);
  }
  ensureSingleActiveEntry(state);
}

export function getNextPendingIndex(state, startIndex = 0) {
  for (let i = startIndex; i < state.entries.length; i += 1) {
    if (state.entries[i].status === "pending") return i;
  }
  return -1;
}

export function getCurrentActiveIndex(state) {
  return state.entries.findIndex((entry) => entry.isActive && entry.status === "pending");
}

export function activateFirstPending(state) {
  state.entries.forEach((entry) => {
    entry.isActive = false;
  });
  const firstIndex = getNextPendingIndex(state, 0);
  if (firstIndex !== -1) state.entries[firstIndex].isActive = true;
}

export function getNextBillSpeechCode(state, author) {
  const getSpeechCode = (entry) => {
    const match = String(entry.label || "").match(/^(111|222|333|444)(?:\s|$)/);
    return match ? match[1] : null;
  };
  const count = state.entries.filter(
    (entry) => entry.author === author && ["111", "222", "333", "444"].includes(getSpeechCode(entry))
  ).length;
  if (count <= 0) return "111";
  if (count === 1) return "222";
  if (count === 2) return "333";
  return "444";
}

export function getBillSpeechBlock(label) {
  if (label === "111") return "first";
  return label;
}

export function parseBillQueueEntry(message, state, { allowGameEntries = true, source = "Telegram" } = {}) {
  const rawText = String(message.text || "").trim();
  const normalized = normalizeQueueText(rawText);
  const questionNumber = getBillQuestionNumber(rawText);
  if (questionNumber !== null) {
    if (!allowGameEntries) return null;
    return makeQueueEntry(message, "first", `\u0438\u0433\u0440\u0430 ${questionNumber}`, rawText, { source });
  }
  const trigger = normalized.match(/^(222|333|444)(?:[\s!.,?:;#-]*)$/);
  const speechNote = getQueue111Note(rawText);
  if (!trigger && speechNote === null) return null;
  if (trigger) return makeQueueEntry(message, trigger[1], trigger[1], rawText, { source });
  return makeQueueEntry(message, "speech", "__speech__", rawText, { kind: "bill_speech", speechNote, source });
}

export function parseBkQueueEntry(message, { source = "Telegram" } = {}) {
  const rawText = String(message.text || "").trim();
  const codeInfo = getQueueSpeechCodeNote(rawText);
  if (!codeInfo) return null;
  const label = formatQueue111Label(codeInfo.note);
  return makeQueueEntry(message, "bk", label, rawText, { source });
}

export function parseRsQueueEntry(message, { source = "Telegram" } = {}) {
  const rawText = String(message.text || "").trim();
  const codeInfo = getQueueSpeechCodeNote(rawText);
  if (!codeInfo) return null;
  return makeQueueEntry(message, "rs", formatQueue111Label(codeInfo.note), rawText, { source });
}

export function parseQueueEntry(message, state, options = {}) {
  if (!state?.isOpen || !state?.mode) return null;
  if (state.mode === "bill") {
    return parseBillQueueEntry(message, state, { allowGameEntries: options.allowBillGameEntries !== false, source: options.source || "Telegram" });
  }
  if (state.mode === "bk") return parseBkQueueEntry(message, { source: options.source || "Telegram" });
  if (state.mode === "rs") return parseRsQueueEntry(message, { source: options.source || "Telegram" });
  return null;
}

function queueResult(state, response, buildText) {
  return {
    state,
    response: {
      ...response,
      queueText: response.publishQueue ? buildText(state) : response.queueText
    }
  };
}

export function runQueueStateAction(queueState, action, payload = {}, buildText = buildQueueText) {
  let state = normalizeQueueState(queueState);
  const previousMessageId = state.queueMessageId ?? null;
  if (action === "get") return { state, response: { ok: true, state } };
  if (action === "set_message_id") {
    state.queueMessageId = payload.messageId ?? null;
    return { state, response: { ok: true } };
  }
  if (action === "clear") {
    state = createEmptyQueueState();
    return { state, response: { ok: true, cleared: true, previousMessageId } };
  }
  if (action === "open") {
    pushQueueHistory(state);
    state.isOpen = true;
    state.mode = payload.mode;
    state.entries = [];
    state.queueMessageId = null;
    return queueResult(state, { ok: true, publishQueue: true, previousMessageId }, buildText);
  }
  if (action === "auto_open") {
    pushQueueHistory(state);
    state.isOpen = true;
    state.mode = payload.mode;
    state.queueMessageId = null;
    return { state, response: { ok: true, state } };
  }
  if (action === "close") {
    pushQueueHistory(state);
    state.isOpen = false;
    state.queueMessageId = null;
    return queueResult(state, { ok: true, publishQueue: true, previousMessageId }, buildText);
  }
  if (action === "add") {
    if (payload.entry?.kind === "bill_speech") {
      if (isDuplicatePendingBillSpeechEntry(state, payload.entry)) {
        return queueResult(state, { ok: true, duplicate: true, publishQueue: true }, buildText);
      }
      pushQueueHistory(state);
      const nextCode = getNextBillSpeechCode(state, payload.entry.author);
      payload.entry.label = formatQueue111Label(payload.entry.speechNote, nextCode);
      payload.entry.block = getBillSpeechBlock(nextCode);
      payload.entry.kind = null;
    } else {
      if (!payload.allowDuplicateEntries && isDuplicatePendingQueueEntry(state, payload.entry)) {
        return queueResult(state, { ok: true, duplicate: true, publishQueue: true }, buildText);
      }
      pushQueueHistory(state);
    }
    addQueueEntryToState(state, payload.entry, { allowDuplicateEntries: Boolean(payload.allowDuplicateEntries) });
    state.queueMessageId = null;
    return queueResult(state, { ok: true, publishQueue: true, previousMessageId }, buildText);
  }
  if (action === "done") {
    const activeIndex = getCurrentActiveIndex(state);
    if (activeIndex === -1) throw new Error("\u041d\u0435\u043a\u043e\u0433\u043e \u043e\u0442\u043c\u0435\u0447\u0430\u0442\u044c: \u0430\u043a\u0442\u0438\u0432\u043d\u044b\u0439 \u0443\u0447\u0430\u0441\u0442\u043d\u0438\u043a \u0441\u0435\u0439\u0447\u0430\u0441 \u043d\u0435 \u0432\u044b\u0431\u0440\u0430\u043d.");
    pushQueueHistory(state);
    state.entries[activeIndex].status = "done";
    state.entries[activeIndex].isActive = false;
    activateFirstPending(state);
    state.queueMessageId = null;
    return queueResult(state, { ok: true, publishQueue: true, previousMessageId }, buildText);
  }
  if (action === "remove") {
    const activeIndex = getCurrentActiveIndex(state);
    if (activeIndex === -1) throw new Error("\u041d\u0435\u043a\u043e\u0433\u043e \u0443\u0434\u0430\u043b\u044f\u0442\u044c: \u0430\u043a\u0442\u0438\u0432\u043d\u044b\u0439 \u0443\u0447\u0430\u0441\u0442\u043d\u0438\u043a \u0441\u0435\u0439\u0447\u0430\u0441 \u043d\u0435 \u0432\u044b\u0431\u0440\u0430\u043d.");
    pushQueueHistory(state);
    state.entries.splice(activeIndex, 1);
    activateFirstPending(state);
    state.queueMessageId = null;
    return queueResult(state, { ok: true, publishQueue: true, previousMessageId }, buildText);
  }
  if (action === "remove_by_number") {
    const visibleNumber = Number(payload.index);
    if (!Number.isInteger(visibleNumber) || visibleNumber < 1 || visibleNumber > state.entries.length) {
      throw new Error("\u041d\u0435\u0442 \u0442\u0430\u043a\u043e\u0433\u043e \u043d\u043e\u043c\u0435\u0440\u0430 \u0432 \u043e\u0447\u0435\u0440\u0435\u0434\u0438.");
    }
    pushQueueHistory(state);
    state.entries.splice(visibleNumber - 1, 1);
    ensureSingleActiveEntry(state);
    state.queueMessageId = null;
    return queueResult(state, { ok: true, publishQueue: true, previousMessageId }, buildText);
  }
  if (action === "skip") {
    const activeIndex = getCurrentActiveIndex(state);
    if (activeIndex === -1) throw new Error("\u041d\u0435\u043a\u043e\u0433\u043e \u043f\u0440\u043e\u043f\u0443\u0441\u043a\u0430\u0442\u044c: \u0430\u043a\u0442\u0438\u0432\u043d\u044b\u0439 \u0443\u0447\u0430\u0441\u0442\u043d\u0438\u043a \u0441\u0435\u0439\u0447\u0430\u0441 \u043d\u0435 \u0432\u044b\u0431\u0440\u0430\u043d.");
    const currentEntry = state.entries[activeIndex];
    const block = getEntryBlock(state, currentEntry);
    let targetIndex = -1;
    for (let i = activeIndex + 1; i < state.entries.length; i += 1) {
      if (state.entries[i].status === "pending" && getEntryBlock(state, state.entries[i]) === block) {
        targetIndex = i;
        break;
      }
    }
    if (targetIndex === -1) {
      for (let i = activeIndex + 1; i < state.entries.length; i += 1) {
        if (state.entries[i].status === "pending") {
          targetIndex = i;
          break;
        }
      }
    }
    if (targetIndex === -1) throw new Error("\u041d\u0438\u0436\u0435 \u0432 \u043e\u0447\u0435\u0440\u0435\u0434\u0438 \u0431\u043e\u043b\u044c\u0448\u0435 \u043d\u0438\u043a\u043e\u0433\u043e \u043d\u0435\u0442.");
    pushQueueHistory(state);
    const nextEntry = state.entries[targetIndex];
    state.entries[activeIndex] = nextEntry;
    state.entries[targetIndex] = currentEntry;
    activateFirstPending(state);
    state.queueMessageId = null;
    return queueResult(state, { ok: true, publishQueue: true, previousMessageId }, buildText);
  }
  if (action === "undo") {
    if (!state.history.length) throw new Error("\u041e\u0442\u043a\u0430\u0442\u044b\u0432\u0430\u0442\u044c \u043f\u043e\u043a\u0430 \u043d\u0435\u0447\u0435\u0433\u043e.");
    const snapshot = state.history.pop();
    state = {
      ...snapshot,
      history: state.history,
      queueMessageId: null
    };
    return queueResult(state, { ok: true, publishQueue: true, previousMessageId }, buildText);
  }
  throw new Error("\u041d\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043d\u043e\u0435 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0435 \u043e\u0447\u0435\u0440\u0435\u0434\u0438.");
}
