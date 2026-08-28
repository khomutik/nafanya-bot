const TELEGRAM_RETRY_AFTER_LIMIT_SECONDS = 5;
const TELEGRAM_TRANSIENT_RETRY_DELAY_MS = 750;
const TELEGRAM_RESPONSE_BODY_LIMIT_BYTES = 2 * 1024 * 1024;
const TELEGRAM_ERROR_BODY_PREVIEW_CHARS = 500;
const SILENT_MAIN_CHAT_ID = -1003547823625;

function shouldForceSilentMainChat(chatId) {
  return Number(chatId) === SILENT_MAIN_CHAT_ID;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readResponseBodyLimited(response) {
  if (!response.body) {
    return { text: "", truncated: false };
  }
  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  let truncated = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value?.byteLength) continue;
    const remaining = TELEGRAM_RESPONSE_BODY_LIMIT_BYTES - totalBytes;
    if (remaining <= 0) {
      truncated = true;
      await reader.cancel();
      break;
    }
    if (value.byteLength > remaining) {
      chunks.push(value.slice(0, remaining));
      totalBytes += remaining;
      truncated = true;
      await reader.cancel();
      break;
    }
    chunks.push(value);
    totalBytes += value.byteLength;
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { text: new TextDecoder().decode(bytes), truncated };
}

function responsePreview(text, truncated = false) {
  const clean = String(text || "").replace(/\s+/gu, " ").trim();
  if (!clean) return "<empty>";
  const suffix = truncated || clean.length > TELEGRAM_ERROR_BODY_PREVIEW_CHARS ? "..." : "";
  return `${clean.slice(0, TELEGRAM_ERROR_BODY_PREVIEW_CHARS)}${suffix}`;
}

function isTransientStatus(status) {
  const numericStatus = Number(status || 0);
  return numericStatus === 408 || numericStatus === 425 || numericStatus === 429 || numericStatus >= 500 && numericStatus <= 599;
}

function isTransientTelegramResult(result) {
  if (result?.transportError) return true;
  return isTransientStatus(result?.httpStatus || result?.data?.error_code);
}

export class TelegramApiError extends Error {
  constructor(method, result) {
    const data = result?.data;
    const httpStatus = Number(result?.httpStatus || 0);
    const errorCode = Number(data?.error_code || httpStatus || 0);
    const detail = data
      ? JSON.stringify(data)
      : result?.transportError
        ? `network error: ${String(result.transportError?.message || result.transportError)}`
        : `HTTP ${httpStatus || "unknown"}; non-JSON response: ${responsePreview(result?.bodyText, result?.truncated)}`;
    super(`${method} failed: ${detail}`);
    this.name = "TelegramApiError";
    this.method = method;
    this.httpStatus = httpStatus;
    this.errorCode = errorCode;
    this.transient = isTransientTelegramResult(result);
  }
}

export function isTransientTelegramError(error) {
  return error?.transient === true || isTransientStatus(error?.httpStatus || error?.errorCode);
}

async function postTelegram(env, method, payload) {
  let response;
  try {
    response = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(payload)
    });
  } catch (transportError) {
    return { data: null, httpStatus: 0, bodyText: "", truncated: false, transportError };
  }
  let body;
  try {
    body = await readResponseBodyLimited(response);
  } catch (transportError) {
    return { data: null, httpStatus: response.status, bodyText: "", truncated: false, transportError };
  }
  let data = null;
  if (!body.truncated && body.text.trim()) {
    try {
      data = JSON.parse(body.text);
    } catch {
      data = null;
    }
  }
  return {
    data,
    httpStatus: response.status,
    bodyText: body.text,
    truncated: body.truncated,
    transportError: null
  };
}

export async function callTelegram(env, method, payload, { retryTransient = false, transientRetryDelayMs = TELEGRAM_TRANSIENT_RETRY_DELAY_MS } = {}) {
  let result = await postTelegram(env, method, payload);
  let data = result.data;
  const retryAfter = Number(data?.parameters?.retry_after || 0);
  if (data && !data.ok && data.error_code === 429 && retryAfter > 0 && retryAfter <= TELEGRAM_RETRY_AFTER_LIMIT_SECONDS) {
    await sleep(retryAfter * 1000);
    result = await postTelegram(env, method, payload);
    data = result.data;
  } else if (retryTransient && data?.error_code !== 429 && isTransientTelegramResult(result)) {
    await sleep(Math.max(0, Number(transientRetryDelayMs) || 0));
    result = await postTelegram(env, method, payload);
    data = result.data;
  }
  if (!data?.ok) {
    throw new TelegramApiError(method, result);
  }
  return data;
}

export async function sendMessage(env, chatId, text, messageThreadId = null, replyToMessageId = null, replyMarkup = null, parseMode = null, disableNotification = false) {
  const payload = {
    chat_id: chatId,
    text
  };
  if (messageThreadId) {
    payload.message_thread_id = messageThreadId;
  }
  if (replyToMessageId) {
    payload.reply_to_message_id = replyToMessageId;
  }
  if (replyMarkup) {
    payload.reply_markup = replyMarkup;
  }
  if (parseMode) {
    payload.parse_mode = parseMode;
  }
  payload.disable_web_page_preview = true;
  if (disableNotification || shouldForceSilentMainChat(chatId)) {
    payload.disable_notification = true;
  }
  try {
    return await callTelegram(env, "sendMessage", payload);
  } catch (error) {
    const canRetryWithoutReply = replyToMessageId && /message to be replied not found/i.test(error.message);
    if (!canRetryWithoutReply) {
      throw error;
    }
    const retryPayload = { ...payload };
    delete retryPayload.reply_to_message_id;
    return callTelegram(env, "sendMessage", retryPayload);
  }
}

export async function editMessageText(env, chatId, messageId, text, replyMarkup = null, parseMode = null) {
  const payload = {
    chat_id: chatId,
    message_id: messageId,
    text
  };
  if (replyMarkup) {
    payload.reply_markup = replyMarkup;
  }
  if (parseMode) {
    payload.parse_mode = parseMode;
  }
  payload.disable_web_page_preview = true;
  return callTelegram(env, "editMessageText", payload);
}

export async function setMyCommands(env, commands, scope = null) {
  const payload = { commands };
  if (scope) {
    payload.scope = scope;
  }
  return callTelegram(env, "setMyCommands", payload);
}

export async function callTelegramForm(env, method, formData) {
  let response;
  try {
    response = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
      method: "POST",
      body: formData
    });
  } catch (transportError) {
    throw new TelegramApiError(method, { data: null, httpStatus: 0, bodyText: "", truncated: false, transportError });
  }
  let body;
  try {
    body = await readResponseBodyLimited(response);
  } catch (transportError) {
    throw new TelegramApiError(method, { data: null, httpStatus: response.status, bodyText: "", truncated: false, transportError });
  }
  let data = null;
  if (!body.truncated && body.text.trim()) {
    try {
      data = JSON.parse(body.text);
    } catch {
      data = null;
    }
  }
  const result = { data, httpStatus: response.status, bodyText: body.text, truncated: body.truncated, transportError: null };
  if (!data?.ok) {
    throw new TelegramApiError(method, result);
  }
  return data;
}

export async function getStickerSet(env, name) {
  return callTelegram(env, "getStickerSet", { name });
}

export async function sendSticker(env, chatId, sticker, messageThreadId = null, emoji = null, disableNotification = false) {
  if (typeof sticker === "string") {
    const payload = {
      chat_id: chatId,
      sticker
    };
    if (messageThreadId) {
      payload.message_thread_id = messageThreadId;
    }
    if (emoji) {
      payload.emoji = emoji;
    }
    if (disableNotification || shouldForceSilentMainChat(chatId)) {
      payload.disable_notification = true;
    }
    return callTelegram(env, "sendSticker", payload);
  }
  const formData = new FormData();
  formData.append("chat_id", String(chatId));
  if (messageThreadId) {
    formData.append("message_thread_id", String(messageThreadId));
  }
  if (emoji) {
    formData.append("emoji", emoji);
  }
  if (disableNotification || shouldForceSilentMainChat(chatId)) {
    formData.append("disable_notification", "true");
  }
  formData.append("sticker", sticker, "sticker.webp");
  return callTelegramForm(env, "sendSticker", formData);
}

export async function deleteMessageSafe(env, chatId, messageId) {
  return (await deleteMessageResult(env, chatId, messageId)).ok;
}

export function isExpectedDeleteMessageFailure(error) {
  const message = String(error?.message || error || "").toLowerCase();
  return /(?:message (?:can(?:not|'t) be deleted|to delete not found)|message_id_invalid)/u.test(message);
}

export async function deleteMessageResult(env, chatId, messageId) {
  if (!messageId) {
    return { ok: false, expected: true, error: new Error("deleteMessage skipped: message_id is empty") };
  }
  try {
    await callTelegram(env, "deleteMessage", {
      chat_id: chatId,
      message_id: messageId
    });
    return { ok: true, expected: false, error: null };
  } catch (error) {
    const expected = isExpectedDeleteMessageFailure(error);
    const log = expected ? console.warn : console.error;
    log("deleteMessageSafe failed", { chatId, messageId, expected, error });
    return { ok: false, expected, error };
  }
}

export async function copyTechMessageToChat(env, targetChatId, infoChatId, sourceMessageId, disableNotification = false) {
  const payload = {
    chat_id: targetChatId,
    from_chat_id: infoChatId,
    message_id: sourceMessageId
  };
  if (disableNotification || shouldForceSilentMainChat(targetChatId)) {
    payload.disable_notification = true;
  }
  return callTelegram(env, "copyMessage", payload, { retryTransient: true });
}

export async function copyTechMessageToGroup(env, chatGroupId, infoChatId, sourceMessageId, disableNotification = false) {
  return copyTechMessageToChat(env, chatGroupId, infoChatId, sourceMessageId, disableNotification);
}

export async function answerCallback(env, callbackQueryId, text, showAlert = false) {
  return callTelegram(env, "answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    text,
    show_alert: showAlert
  });
}
