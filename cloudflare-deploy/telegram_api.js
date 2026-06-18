const TELEGRAM_RETRY_AFTER_LIMIT_SECONDS = 5;
const SILENT_MAIN_CHAT_ID = -1003547823625;

function shouldForceSilentMainChat(chatId) {
  return Number(chatId) === SILENT_MAIN_CHAT_ID;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function postTelegram(env, method, payload) {
  const response = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  return response.json();
}

export async function callTelegram(env, method, payload) {
  let data = await postTelegram(env, method, payload);
  const retryAfter = Number(data?.parameters?.retry_after || 0);
  if (!data.ok && data.error_code === 429 && retryAfter > 0 && retryAfter <= TELEGRAM_RETRY_AFTER_LIMIT_SECONDS) {
    await sleep(retryAfter * 1000);
    data = await postTelegram(env, method, payload);
  }
  if (!data.ok) {
    throw new Error(`${method} failed: ${JSON.stringify(data)}`);
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
  const response = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: "POST",
    body: formData
  });
  const data = await response.json();
  if (!data.ok) {
    throw new Error(`${method} failed: ${JSON.stringify(data)}`);
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

export async function deleteMessageResult(env, chatId, messageId) {
  if (!messageId) {
    return { ok: false, error: new Error("deleteMessage skipped: message_id is empty") };
  }
  try {
    await callTelegram(env, "deleteMessage", {
      chat_id: chatId,
      message_id: messageId
    });
    return { ok: true, error: null };
  } catch (error) {
    console.error("deleteMessageSafe failed", { chatId, messageId, error });
    return { ok: false, error };
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
  return callTelegram(env, "copyMessage", payload);
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
