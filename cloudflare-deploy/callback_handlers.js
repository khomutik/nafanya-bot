function okResponse() {
  return new Response("ok");
}

const ADMIN_DM_CALLBACKS = {
  send: "admin_dm:send",
  cancel: "admin_dm:cancel"
};

const ADMIN_DM_TEXT = {
  sent: "\u041e\u0442\u043f\u0440\u0430\u0432\u0438\u043b \u043e\u0431\u044a\u044f\u0432\u043b\u0435\u043d\u0438\u0435 \u0430\u0434\u043c\u0438\u043d\u0430\u043c.",
  cancelled: "\u041e\u0442\u043c\u0435\u043d\u0438\u043b \u0440\u0430\u0441\u0441\u044b\u043b\u043a\u0443 \u0430\u0434\u043c\u0438\u043d\u0430\u043c.",
  noDraft: "\u0410\u043a\u0442\u0438\u0432\u043d\u043e\u0439 \u0440\u0430\u0441\u0441\u044b\u043b\u043a\u0438 \u043d\u0435\u0442.",
  onlyAdmins: "\u042d\u0442\u0430 \u043a\u043d\u043e\u043f\u043a\u0430 \u0442\u043e\u043b\u044c\u043a\u043e \u0434\u043b\u044f \u0430\u0434\u043c\u0438\u043d\u043e\u0432.",
  header: "\u041e\u0431\u044a\u044f\u0432\u043b\u0435\u043d\u0438\u0435 \u0430\u0434\u043c\u0438\u043d\u0430\u043c:"
};
const SERVICE_REMINDER_CALLBACK_ROLES = {
  l: "\u0432\u0435\u0434\u0443\u0449\u0438\u0439",
  t: "\u0442\u0435\u0445\u0432\u0435\u0434"
};

function serviceCallbackRoleLabel(roleKey) {
  return SERVICE_REMINDER_CALLBACK_ROLES[roleKey] || roleKey || "\u0441\u043b\u0443\u0436\u0435\u043d\u0438\u0435";
}

function formatPersonDisplayName(name, username, fallback) {
  const cleanName = String(name || "").trim();
  const cleanUsername = String(username || "").replace(/^@/u, "").trim();
  const handle = cleanUsername ? `@${cleanUsername}` : "";
  if (cleanName && handle) {
    const lowerName = cleanName.toLowerCase();
    const lowerHandle = handle.toLowerCase();
    if (lowerName.includes(lowerHandle)) return cleanName;
    return `${cleanName} ${handle}`;
  }
  if (cleanName) return cleanName;
  if (handle) return handle;
  return String(fallback || "\u043d\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043d\u043e");
}

function serviceCallbackPersonName(callbackQuery) {
  const from = callbackQuery.from || {};
  const name = [from.first_name, from.last_name].filter(Boolean).join(" ").trim();
  return formatPersonDisplayName(name, from.username, from.id);
}

function serviceRequestId(dateKey, roleKey, userId) {
  return `rr_${String(dateKey || "").replace(/-/g, "")}_${roleKey}_${userId}_${Date.now().toString(36)}`;
}

function serviceRequestDedupeKey(dateKey, roleKey, userId) {
  return `${dateKey}:${roleKey}:${userId}`;
}

function formatRuDate(dateKey) {
  const match = String(dateKey || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}.${match[2]}.${match[1]}` : String(dateKey || "");
}

function buildReplacementCloseKeyboard(requestId) {
  return {
    inline_keyboard: [[
      { text: "\u0417\u0430\u043c\u0435\u043d\u0430 \u0431\u043e\u043b\u044c\u0448\u0435 \u043d\u0435 \u043d\u0443\u0436\u043d\u0430", callback_data: `repl:close:${requestId}` }
    ]]
  };
}

function buildReplacementOfferKeyboard(requestId) {
  return {
    inline_keyboard: [[
      { text: "\u041c\u043e\u0433\u0443 \u043f\u043e\u0434\u043c\u0435\u043d\u0438\u0442\u044c", callback_data: `repl:offer:${requestId}` }
    ]]
  };
}

function buildReplacementSelectKeyboard(request) {
  const responders = Array.isArray(request?.responders) ? request.responders : [];
  return {
    inline_keyboard: responders.length
      ? responders.map((responder) => [{
        text: `\u0412\u044b\u0431\u0440\u0430\u0442\u044c ${responder.name || responder.username || responder.user_id}`,
        callback_data: `repl:select:${request.id}:${String(responder.user_id || responder.userId || "").trim()}`
      }])
      : []
  };
}

function buildReplacementOkKeyboard(requestId) {
  return {
    inline_keyboard: [[
      { text: "\u041e\u043a", callback_data: `repl:ack:${requestId}` }
    ]]
  };
}

function buildAdminReplacementRequestText(request) {
  if (request.request_kind === "vacancy") {
    return [
      request.vacancy_text || `\u0421\u0435\u0433\u043e\u0434\u043d\u044f \u043d\u0435\u0442 ${request.service}. \u0414\u043e\u0431\u0440\u043e\u0432\u043e\u043b\u044c\u0446\u044b?`,
      "",
      `\u0421\u043b\u0443\u0436\u0435\u043d\u0438\u0435: ${request.service}`,
      `\u0413\u0440\u0443\u043f\u043f\u0430: \u00ab${request.group_name}\u00bb`,
      `\u0412\u0440\u0435\u043c\u044f: ${request.time}`,
      "",
      "\u0415\u0441\u043b\u0438 \u043c\u043e\u0436\u0435\u0448\u044c \u043f\u043e\u0434\u043c\u0435\u043d\u0438\u0442\u044c \u2014 \u043d\u0430\u0436\u043c\u0438 \u043a\u043d\u043e\u043f\u043a\u0443."
    ].join("\n");
  }
  const original = formatPersonDisplayName(request.original_person_name, request.original_username, request.original_user_id);
  return [
    "\u041d\u0443\u0436\u043d\u0430 \u043f\u043e\u0434\u043c\u0435\u043d\u0430.",
    "",
    `${original} \u043d\u0435 \u043c\u043e\u0436\u0435\u0442 \u043d\u0435\u0441\u0442\u0438 \u0441\u043b\u0443\u0436\u0435\u043d\u0438\u0435 \u0441\u0435\u0433\u043e\u0434\u043d\u044f.`,
    "",
    `\u0421\u043b\u0443\u0436\u0435\u043d\u0438\u0435: ${request.service}`,
    `\u0413\u0440\u0443\u043f\u043f\u0430: \u00ab${request.group_name}\u00bb`,
    `\u0412\u0440\u0435\u043c\u044f: ${request.time}`,
    "",
    "\u0415\u0441\u043b\u0438 \u043c\u043e\u0436\u0435\u0448\u044c \u043f\u043e\u0434\u043c\u0435\u043d\u0438\u0442\u044c \u2014 \u043d\u0430\u0436\u043c\u0438 \u043a\u043d\u043e\u043f\u043a\u0443."
  ].join("\n");
}

function responderName(from) {
  const name = [from?.first_name, from?.last_name].filter(Boolean).join(" ").trim();
  return formatPersonDisplayName(name, from?.username, from?.id || "\u0430\u0434\u043c\u0438\u043d");
}

function buildRespondersListText(request) {
  const names = (request.responders || []).map((item) => formatPersonDisplayName(item?.name || "", item?.username || "", item?.user_id)).filter(Boolean);
  const target = request.request_kind === "vacancy"
    ? request.service
    : formatPersonDisplayName(request.original_person_name, request.original_username, request.original_user_id);
  return [
    `\u0413\u043e\u0442\u043e\u0432\u044b \u043f\u043e\u0434\u043c\u0435\u043d\u0438\u0442\u044c ${target}:`,
    `${names.join("\n")}.`,
    "",
    `\u0421\u043b\u0443\u0436\u0435\u043d\u0438\u0435: ${request.service}`,
    `\u0414\u0430\u0442\u0430: ${formatRuDate(request.date)}`,
    `\u0412\u0440\u0435\u043c\u044f: ${request.time}`
  ].join("\n");
}

function buildReplacementSelectionText(request, responderNameText) {
  const replacementLine = request.request_kind === "vacancy"
    ? `${responderNameText} \u0431\u0443\u0434\u0435\u0442 \u043d\u0435\u0441\u0442\u0438 \u0441\u043b\u0443\u0436\u0435\u043d\u0438\u0435`
    : `${responderNameText} \u043f\u043e\u0434\u043c\u0435\u043d\u0438\u0442 ${formatPersonDisplayName(request.original_person_name, request.original_username, request.original_user_id)}`;
  return [
    "\u0417\u0410\u041c\u0415\u041d\u0410:",
    "",
    replacementLine,
    `\u0421\u043b\u0443\u0436\u0435\u043d\u0438\u0435: ${request.service}`,
    `\u0414\u0430\u0442\u0430: ${formatRuDate(request.date)}`,
    `\u0412\u0440\u0435\u043c\u044f: ${request.time}`,
    "",
    "\u0421\u043f\u0430\u0441\u0438\u0431\u043e \u0437\u0430 \u0441\u043b\u0443\u0436\u0435\u043d\u0438\u0435!\u{1f64f}"
  ].join("\n");
}

function buildReplacementClosedText(request, admin = false) {
  const header = admin ? "\u0417\u0410\u041f\u0420\u041e\u0421 \u041d\u0410 \u0417\u0410\u041c\u0415\u041d\u0423 \u0417\u0410\u041a\u0420\u042b\u0422" : "\u0417\u0430\u043f\u0440\u043e\u0441 \u043d\u0430 \u0437\u0430\u043c\u0435\u043d\u0443 \u0437\u0430\u043a\u0440\u044b\u0442.";
  const original = formatPersonDisplayName(request.original_person_name, request.original_username, request.original_user_id);
  return [
    header,
    "",
    original,
    `\u0421\u043b\u0443\u0436\u0435\u043d\u0438\u0435: ${request.service}`,
    `\u0414\u0430\u0442\u0430: ${formatRuDate(request.date)}`,
    `\u0412\u0440\u0435\u043c\u044f: ${request.time}`
  ].join("\n");
}

function buildServiceConfirmationText(template, name, service, date) {
  return template
    .replace("{NAME}", name)
    .replace("{SERVICE}", service)
    .replace("{DATE}", date);
}

async function sendReplacementCoordinatorStage(env, request, text, replyMarkup, deps) {
  const {
    callPersonalDayState,
    deleteMessageSafe,
    sendCoordinatorServiceNotice
  } = deps;
  if (!request?.id || !sendCoordinatorServiceNotice) return null;
  const previousChatId = request.coordinator_message_chat_id || request.coordinatorMessageChatId;
  const previousMessageId = request.coordinator_message_id || request.coordinatorMessageId;
  if (previousChatId && previousMessageId && deleteMessageSafe) {
    await deleteMessageSafe(env, previousChatId, previousMessageId).catch(() => null);
  }
  const sent = await sendCoordinatorServiceNotice(env, text, replyMarkup).catch(() => null);
  const chatId = sent?.result?.result?.chat?.id || sent?.result?.chat?.id || sent?.chatId || null;
  const messageId = sent?.result?.result?.message_id || sent?.result?.message_id || null;
  if (chatId && messageId && callPersonalDayState) {
    await callPersonalDayState(env, "set_replacement_coordinator_message", {
      id: request.id,
      chatId,
      messageId
    }).catch(() => null);
  }
  return sent;
}

async function sendReplacementAdminStage(env, request, text, deps, replyMarkup = null) {
  const {
    callPersonalDayState,
    deleteMessageSafe,
    sendAdminThreadMessage
  } = deps;
  if (!request?.id || !sendAdminThreadMessage) return null;
  const previousChatId = request.admin_thread_message_chat_id || request.adminThreadMessageChatId;
  const previousMessageId = request.admin_thread_message_id || request.adminThreadMessageId;
  if (previousChatId && previousMessageId && deleteMessageSafe) {
    await deleteMessageSafe(env, previousChatId, previousMessageId).catch(() => null);
  }
  const sent = await sendAdminThreadMessage(env, text, true, replyMarkup).catch(() => null);
  const chatId = sent?.result?.result?.chat?.id || sent?.result?.chat?.id || null;
  const messageId = sent?.result?.result?.message_id || sent?.result?.message_id || null;
  if (chatId && messageId && callPersonalDayState) {
    await callPersonalDayState(env, "set_replacement_coordinator_message", {
      id: request.id,
      adminChatId: chatId,
      adminMessageId: messageId
    }).catch(() => null);
  }
  return sent;
}

async function notifyReplacementAdmins(env, request, deps) {
  const {
    sendMessage,
    listAdminDmRecipients,
    isCoordinatorUser,
    notifyOwnerTechError
  } = deps;
  const recipients = await listAdminDmRecipients(env);
  const text = buildAdminReplacementRequestText(request);
  await Promise.all(recipients.map(async (recipient) => {
    if (!recipient?.chatId) return;
    if (isCoordinatorUser && await isCoordinatorUser(env, recipient.userId || recipient.chatId)) return;
    try {
      await sendMessage(env, recipient.chatId, text, null, null, buildReplacementOfferKeyboard(request.id));
      console.log("admin notified", { request_id: request.id, user_id: recipient.userId });
    } catch (error) {
      await notifyOwnerTechError?.(env, {
        module: "\u0437\u0430\u043c\u0435\u043d\u044b \u0441\u043b\u0443\u0436\u0430\u0449\u0438\u0445",
        operation: "\u0443\u0432\u0435\u0434\u043e\u043c\u043b\u0435\u043d\u0438\u0435 \u0430\u0434\u043c\u0438\u043d\u0430",
        error,
        details: { request_id: request.id, user_id: recipient.userId, chat_id: recipient.chatId },
        hint: "\u0410\u0434\u043c\u0438\u043d \u043c\u043e\u0433 \u043d\u0435 \u043d\u0430\u0436\u0430\u0442\u044c /start, \u0437\u0430\u0431\u043b\u043e\u043a\u0438\u0440\u043e\u0432\u0430\u0442\u044c \u0431\u043e\u0442\u0430 \u0438\u043b\u0438 chat_id \u0443\u0441\u0442\u0430\u0440\u0435\u043b."
      });
    }
  }));
  await Promise.all([
    sendReplacementAdminStage(env, request, text, deps, buildReplacementOfferKeyboard(request.id)),
    sendReplacementCoordinatorStage(env, request, text, buildReplacementOfferKeyboard(request.id), deps)
  ]);
}

export async function createVacancyReplacementRequest(env, { dateKey, roleKey, service, vacancyText }, deps) {
  const createResult = await deps.callPersonalDayState(env, "create_replacement_request", {
    dedupeKey: `${dateKey}:${roleKey}:vacancy`,
    request: {
      id: `rr_${String(dateKey || "").replace(/-/g, "")}_${roleKey}_vacancy_${Date.now().toString(36)}`,
      date: dateKey,
      time: "21:30",
      group_name: "\u041f\u043e\u0447\u0442\u0438 \u043d\u043e\u0440\u043c\u0430\u043b\u044c\u043d\u044b\u0435",
      service,
      request_kind: "vacancy",
      vacancy_text: vacancyText
    }
  });
  const request = createResult?.request;
  if (!request || createResult?.duplicateOpen) return createResult;
  await notifyReplacementAdmins(env, request, deps);
  return createResult;
}

async function handleReplacementOfferCallback(env, callbackQuery, requestId, deps) {
  const {
    answerCallback,
    callPersonalDayState,
    getPrivateRoles,
    isUserAdmin,
    sendCoordinatorServiceNotice,
    sendAdminThreadMessage
  } = deps;
  const userId = String(callbackQuery.from?.id || "").trim();
  const sourceChat = callbackQuery.message?.chat || {};
  const isPrivate = sourceChat.type === "private";
  const isAdmin = isPrivate
    ? Boolean((await getPrivateRoles(env, userId)).isAdmin)
    : Boolean(await isUserAdmin(env, userId, sourceChat.id, sourceChat.type));
  if (!isAdmin) {
    await answerCallback(env, callbackQuery.id, "\u042d\u0442\u0430 \u043a\u043d\u043e\u043f\u043a\u0430 \u0442\u043e\u043b\u044c\u043a\u043e \u0434\u043b\u044f \u0430\u0434\u043c\u0438\u043d\u043e\u0432.", true);
    return okResponse();
  }
  const result = await callPersonalDayState(env, "add_replacement_responder", {
    id: requestId,
    responder: {
      user_id: userId,
      private_chat_id: callbackQuery.message?.chat?.type === "private" ? callbackQuery.message.chat.id : userId,
      username: callbackQuery.from?.username || "",
      name: responderName(callbackQuery.from)
    }
  });
  if (!result?.found) {
    await answerCallback(env, callbackQuery.id, "\u0417\u0430\u043f\u0440\u043e\u0441 \u043d\u0435 \u043d\u0430\u0439\u0434\u0435\u043d.", true);
    return okResponse();
  }
  if (result.closed) {
    const closedText = result.request?.status === "selected"
      ? "\u0417\u0430\u043c\u0435\u043d\u0430 \u0443\u0436\u0435 \u043d\u0430\u0439\u0434\u0435\u043d\u0430."
      : "\u0417\u0430\u043f\u0440\u043e\u0441 \u0443\u0436\u0435 \u0437\u0430\u043a\u0440\u044b\u0442.";
    await answerCallback(env, callbackQuery.id, closedText);
    return okResponse();
  }
  if (result.duplicate) {
    await answerCallback(env, callbackQuery.id, "\u0422\u044b \u0443\u0436\u0435 \u043e\u0442\u043a\u043b\u0438\u043a\u043d\u0443\u043b\u0441\u044f.");
    return okResponse();
  }
  await answerCallback(env, callbackQuery.id, "\u041e\u0442\u043a\u043b\u0438\u043a \u043f\u0440\u0438\u043d\u044f\u043b. \u041a\u043e\u043e\u0440\u0434\u0438\u043d\u0430\u0442\u043e\u0440\u0443 \u043f\u0435\u0440\u0435\u0434\u0430\u043d\u043e.");
  const text = buildRespondersListText(result.request);
  await Promise.all([
    sendReplacementCoordinatorStage(env, result.request, text, buildReplacementSelectKeyboard(result.request), deps),
    sendReplacementAdminStage(env, result.request, text, deps)
  ]);
  return okResponse();
}

async function handleReplacementSelectCallback(env, callbackQuery, requestId, responderId, deps) {
  const {
    answerCallback,
    callPersonalDayState,
    isCoordinatorUser,
    sendAdminThreadMessage,
    sendMessage
  } = deps;
  const coordinatorUserId = String(callbackQuery.from?.id || "").trim();
  if (!isCoordinatorUser || !await isCoordinatorUser(env, coordinatorUserId)) {
    await answerCallback(env, callbackQuery.id, "\u0412\u044b\u0431\u0440\u0430\u0442\u044c \u0437\u0430\u043c\u0435\u043d\u044f\u044e\u0449\u0435\u0433\u043e \u043c\u043e\u0436\u0435\u0442 \u0442\u043e\u043b\u044c\u043a\u043e \u043a\u043e\u043e\u0440\u0434\u0438\u043d\u0430\u0442\u043e\u0440.", true);
    return okResponse();
  }
  const selection = await callPersonalDayState(env, "select_replacement_responder", {
    id: requestId,
    responderId
  });
  const request = selection?.request;
  if (!request) {
    await answerCallback(env, callbackQuery.id, "\u0417\u0430\u043f\u0440\u043e\u0441 \u043d\u0435 \u043d\u0430\u0448\u0451\u043b.", true);
    return okResponse();
  }
  if (selection.closed) {
    await answerCallback(env, callbackQuery.id, "\u0417\u0430\u043f\u0440\u043e\u0441 \u0443\u0436\u0435 \u0437\u0430\u043a\u0440\u044b\u0442.");
    return okResponse();
  }
  if (!selection.selected) {
    await answerCallback(env, callbackQuery.id, "\u041d\u0435 \u0441\u043c\u043e\u0433 \u0432\u044b\u0431\u0440\u0430\u0442\u044c.", true);
    return okResponse();
  }
  const responder = (request.responders || []).find((item) => String(item?.user_id || item?.userId || "").trim() === responderId);
  const responderDisplay = formatPersonDisplayName(responder?.name || "", responder?.username || "", responderId);
  await answerCallback(env, callbackQuery.id, `\u0412\u044b\u0431\u0440\u0430\u043b: ${responderDisplay}.`);
  const selectedText = buildReplacementSelectionText(request, responderDisplay);
  const others = (request.responders || []).filter((item) => String(item?.user_id || item?.userId || "").trim() !== responderId);
  await Promise.all([
    sendMessage(env, responder?.private_chat_id || responderId, selectedText, null, null, buildReplacementOkKeyboard(request.id)).catch(() => null),
    ...others.map((item) => sendMessage(env, item.private_chat_id || item.user_id, selectedText).catch(() => null)),
    sendReplacementCoordinatorStage(env, request, selectedText, null, deps),
    sendReplacementAdminStage(env, request, selectedText, deps)
  ]);
  return okResponse();
}

async function handleReplacementCloseCallback(env, callbackQuery, requestId, deps) {
  const {
    answerCallback,
    sendMessage,
    callPersonalDayState,
    sendCoordinatorServiceNotice,
    sendAdminThreadMessage
  } = deps;
  const userId = String(callbackQuery.from?.id || "").trim();
  let result;
  try {
    result = await callPersonalDayState(env, "close_replacement_request", { id: requestId, userId });
  } catch (error) {
    await answerCallback(env, callbackQuery.id, error.message || "\u041d\u0435 \u043f\u043e\u043b\u0443\u0447\u0438\u043b\u043e\u0441\u044c \u0437\u0430\u043a\u0440\u044b\u0442\u044c.", true);
    return okResponse();
  }
  if (!result?.found) {
    await answerCallback(env, callbackQuery.id, "\u0417\u0430\u043f\u0440\u043e\u0441 \u043d\u0435 \u043d\u0430\u0439\u0434\u0435\u043d.", true);
    return okResponse();
  }
  if (result.alreadyClosed) {
    await answerCallback(env, callbackQuery.id, "\u0417\u0430\u043f\u0440\u043e\u0441 \u0443\u0436\u0435 \u0437\u0430\u043a\u0440\u044b\u0442.");
    return okResponse();
  }
  const chatId = callbackQuery.message?.chat?.id || callbackQuery.from?.id;
  const userText = "\u0417\u0430\u043a\u0440\u044b\u043b \u0437\u0430\u043f\u0440\u043e\u0441 \u043d\u0430 \u0437\u0430\u043c\u0435\u043d\u0443.";
  await answerCallback(env, callbackQuery.id, userText).catch(() => null);
  if (chatId) await sendMessage(env, chatId, userText).catch(() => null);
  await Promise.all([
    sendReplacementCoordinatorStage(env, result.request, buildReplacementClosedText(result.request, false), null, deps),
    sendReplacementAdminStage(env, result.request, buildReplacementClosedText(result.request, true), deps)
  ]);
  return okResponse();
}

async function handleReplacementAckCallback(env, callbackQuery, requestId, deps) {
  const {
    answerCallback,
    callPersonalDayState,
    getPrivateRoles,
    sendMessage
  } = deps;
  const userId = String(callbackQuery.from?.id || "").trim();
  const roles = await getPrivateRoles(env, userId);
  if (!roles.isAdmin) {
    await answerCallback(env, callbackQuery.id, "\u042d\u0442\u0430 \u043a\u043d\u043e\u043f\u043a\u0430 \u0442\u043e\u043b\u044c\u043a\u043e \u0434\u043b\u044f \u0430\u0434\u043c\u0438\u043d\u043e\u0432.", true);
    return okResponse();
  }
  const result = await callPersonalDayState(env, "acknowledge_replacement_request", { id: requestId, userId }).catch((error) => ({ error }));
  if (result?.error) {
    await answerCallback(env, callbackQuery.id, result.error.message || "\u041d\u0435 \u0441\u043c\u043e\u0433 \u043f\u0440\u0438\u043d\u044f\u0442\u044c.", true);
    return okResponse();
  }
  if (!result?.found) {
    await answerCallback(env, callbackQuery.id, "\u0417\u0430\u043f\u0440\u043e\u0441 \u043d\u0435 \u043d\u0430\u0448\u0451\u043b.", true);
    return okResponse();
  }
  if (result.alreadyClosed) {
    await answerCallback(env, callbackQuery.id, "\u0417\u0430\u043f\u0440\u043e\u0441 \u0443\u0436\u0435 \u0437\u0430\u043a\u0440\u044b\u0442.");
    return okResponse();
  }
  await answerCallback(env, callbackQuery.id).catch(() => null);
  const chatId = callbackQuery.message?.chat?.id || callbackQuery.from?.id;
  if (chatId && sendMessage) {
    await sendMessage(env, chatId, "\u041f\u0440\u0438\u043d\u044f\u0442\u043e.").catch(() => null);
  }
  if (result.acknowledged) {
    const request = result.request;
    const responderDisplay = formatPersonDisplayName(request?.selected_responder_name || "", request?.selected_responder_username || "", request?.selected_responder_id);
    const coordinatorText = [
      buildReplacementSelectionText(request, responderDisplay),
      "",
      "\u041f\u0440\u0438\u043d\u044f\u0442\u043e\u{1f91d}"
    ].join("\n");
    await sendReplacementCoordinatorStage(env, request, coordinatorText, null, deps);
  }
  return okResponse();
}

async function handleServiceReminderCallback(env, callbackQuery, action, dateKey, roleKey, deps) {
  const {
    answerCallback,
    sendMessage,
    sendCoordinatorServiceNotice,
    callPersonalDayState
  } = deps;
  const chatId = callbackQuery.message?.chat?.id || callbackQuery.from?.id;
  const userId = String(callbackQuery.from?.id || "").trim();
  const name = serviceCallbackPersonName(callbackQuery);
  const service = serviceCallbackRoleLabel(roleKey);
  const displayDate = formatRuDate(dateKey);
  if (action === "ok") {
    const userText = "\u041f\u0440\u0438\u043d\u044f\u043b.";
    await answerCallback(env, callbackQuery.id, userText).catch(() => null);
    if (chatId) await sendMessage(env, chatId, userText).catch(() => null);
    const coordinatorText = buildServiceConfirmationText(
      "\u0421\u043b\u0443\u0436\u0435\u043d\u0438\u0435 \u043f\u043e\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043d\u043e.\n\n{NAME} \u043f\u043e\u0434\u0442\u0432\u0435\u0440\u0434\u0438\u043b(\u0430):\n\u0421\u043b\u0443\u0436\u0435\u043d\u0438\u0435: {SERVICE}\n\u0414\u0430\u0442\u0430: {DATE}\n\u0412\u0440\u0435\u043c\u044f: 21:30",
      name,
      service,
      displayDate
    );
    await Promise.resolve(
      sendCoordinatorServiceNotice ? sendCoordinatorServiceNotice(env, coordinatorText) : null
    );
    return okResponse();
  }
  if (action === "replace") {
    const createResult = await callPersonalDayState(env, "create_replacement_request", {
      dedupeKey: serviceRequestDedupeKey(dateKey, roleKey, userId),
      request: {
        id: serviceRequestId(dateKey, roleKey, userId),
        date: dateKey,
        time: "21:30",
        group_name: "\u041f\u043e\u0447\u0442\u0438 \u043d\u043e\u0440\u043c\u0430\u043b\u044c\u043d\u044b\u0435",
        service,
        original_person_name: name,
        original_user_id: userId,
        original_username: callbackQuery.from?.username || ""
      }
    });
    const request = createResult?.request;
    if (createResult?.duplicateOpen) {
      const duplicateText = "\u0417\u0430\u043f\u0440\u043e\u0441 \u043d\u0430 \u0437\u0430\u043c\u0435\u043d\u0443 \u0443\u0436\u0435 \u043e\u0442\u043a\u0440\u044b\u0442.";
      await answerCallback(env, callbackQuery.id, duplicateText);
      return okResponse();
    }
    const userText = "\u041f\u043e\u043d\u044f\u043b. \u0418\u0449\u0443 \u043f\u043e\u0434\u043c\u0435\u043d\u0443 \u0441\u0440\u0435\u0434\u0438 \u0430\u0434\u043c\u0438\u043d\u043e\u0432.";
    await answerCallback(env, callbackQuery.id, userText).catch(() => null);
    if (chatId) await sendMessage(env, chatId, userText, null, null, buildReplacementCloseKeyboard(request.id)).catch(() => null);
    await notifyReplacementAdmins(env, request, deps);
    return okResponse();
  }
  return null;
}

function ownerAdminDoneText(action, user) {
  const prefix = action === "add" ? "\u0414\u043e\u0431\u0430\u0432\u0438\u043b \u0430\u0434\u043c\u0438\u043d\u0430:" : "\u0423\u0434\u0430\u043b\u0438\u043b \u0430\u0434\u043c\u0438\u043d\u0430:";
  const name = `${user?.firstName || ""} ${user?.lastName || ""}`.trim();
  const username = user?.username ? `@${user.username}` : "";
  return [prefix, name || null, username || null, `id ${user?.userId || "unknown"}`].filter(Boolean).join(" ");
}

async function handleOwnerAdminCallback(env, callbackQuery, action, targetUserId, deps) {
  const {
    answerCallback,
    editMessageText,
    callPersonalDayState,
    getPrivateRoles
  } = deps;
  const managerId = String(callbackQuery.from?.id || "").trim();
  const managerRoles = await getPrivateRoles(env, managerId);
  if (!managerRoles.canManageAdmins) {
    await answerCallback(env, callbackQuery.id, "\u042d\u0442\u0430 \u043a\u043d\u043e\u043f\u043a\u0430 \u0442\u043e\u043b\u044c\u043a\u043e \u0434\u043b\u044f \u0442\u0435\u0445, \u043a\u0442\u043e \u0443\u043f\u0440\u0430\u0432\u043b\u044f\u0435\u0442 \u0430\u0434\u043c\u0438\u043d\u0430\u043c\u0438.", true);
    return okResponse();
  }
  const target = await callPersonalDayState(env, "get_personal_subscription", { userId: targetUserId }).catch(() => ({ subscription: null }));
  if (!target?.subscription) {
    await answerCallback(env, callbackQuery.id, "\u041d\u0435 \u043d\u0430\u0448\u0451\u043b \u043f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u0435\u043b\u044f.", true);
    return okResponse();
  }
  if (action === "add") {
    await callPersonalDayState(env, "set_admin_dm_user", {
      userId: targetUserId,
      admin: target.subscription
    });
  } else {
    await callPersonalDayState(env, "remove_admin_dm_user", { userId: targetUserId });
  }
  const text = ownerAdminDoneText(action, target.subscription);
  await answerCallback(env, callbackQuery.id, text);
  const message = callbackQuery.message;
  if (message?.chat?.id && message?.message_id) {
    await editMessageText(env, message.chat.id, message.message_id, text, { inline_keyboard: [] }).catch(() => null);
  }
  return okResponse();
}

async function handleAdminDmCallback(env, callbackQuery, key, deps) {
  const {
    answerCallback,
    editMessageText,
    sendMessage,
    callPersonalDayState,
    getPrivateRoles,
    notifyOwnerTechError,
    listAdminDmRecipients,
    callTelegram
  } = deps;
  const userId = String(callbackQuery.from?.id || "").trim();
  const message = callbackQuery.message;
  const chatId = message?.chat?.id ?? null;
  const messageId = message?.message_id ?? null;
  const roles = await getPrivateRoles(env, userId);
  if (!roles.isAdmin) {
    await answerCallback(env, callbackQuery.id, ADMIN_DM_TEXT.onlyAdmins, true);
    return okResponse();
  }
  const current = await callPersonalDayState(env, "get_admin_dm_draft", { userId }).catch(() => ({ draft: null }));
  const draft = current?.draft;
  const hasCopyableMessage = Boolean(draft?.sourceChatId && draft?.sourceMessageId);
  if (!draft?.text && !hasCopyableMessage) {
    await answerCallback(env, callbackQuery.id, ADMIN_DM_TEXT.noDraft);
    if (chatId && messageId) {
      await editMessageText(env, chatId, messageId, ADMIN_DM_TEXT.noDraft, { inline_keyboard: [] }).catch(() => null);
    }
    return okResponse();
  }
  if (key === "cancel") {
    await callPersonalDayState(env, "clear_admin_dm_draft", { userId });
    await answerCallback(env, callbackQuery.id, ADMIN_DM_TEXT.cancelled);
    if (chatId && messageId) {
      await editMessageText(env, chatId, messageId, ADMIN_DM_TEXT.cancelled, { inline_keyboard: [] }).catch(() => null);
    }
    return okResponse();
  }
  if (key === "send") {
    const recipients = await listAdminDmRecipients(env);
    await Promise.all(recipients.map(async (recipient) => {
      if (!recipient.chatId) return;
      try {
        if (hasCopyableMessage && callTelegram) {
          await sendMessage(env, recipient.chatId, ADMIN_DM_TEXT.header);
          await callTelegram(env, "copyMessage", {
            chat_id: recipient.chatId,
            from_chat_id: draft.sourceChatId,
            message_id: draft.sourceMessageId
          });
        } else {
          await sendMessage(env, recipient.chatId, `${ADMIN_DM_TEXT.header}\n\n${draft.text}`);
        }
      } catch (error) {
        console.error("admin dm delivery failed", { recipient, error });
        return notifyOwnerTechError?.(env, {
          module: "\u0430\u0434\u043c\u0438\u043d\u0441\u043a\u0430\u044f DM-\u0440\u0430\u0441\u0441\u044b\u043b\u043a\u0430",
          operation: "\u043e\u0442\u043f\u0440\u0430\u0432\u043a\u0430 \u0430\u0434\u043c\u0438\u043d\u0443",
          error,
          details: { user_id: recipient.userId, chat_id: recipient.chatId },
          hint: "\u0410\u0434\u043c\u0438\u043d \u043c\u043e\u0433 \u043d\u0435 \u043d\u0430\u0436\u0430\u0442\u044c /start, \u0437\u0430\u0431\u043b\u043e\u043a\u0438\u0440\u043e\u0432\u0430\u0442\u044c \u0431\u043e\u0442\u0430 \u0438\u043b\u0438 chat_id \u0443\u0441\u0442\u0430\u0440\u0435\u043b."
        });
      }
    }));
    await callPersonalDayState(env, "clear_admin_dm_draft", { userId });
    await answerCallback(env, callbackQuery.id, ADMIN_DM_TEXT.sent);
    if (chatId && messageId) {
      await editMessageText(env, chatId, messageId, ADMIN_DM_TEXT.sent, { inline_keyboard: [] }).catch(() => null);
    }
    return okResponse();
  }
  return null;
}

async function handleMeetingCallback(env, callbackQuery, chatId, threadId, key, deps) {
  const {
    answerCallback,
    sendYozhikToGroup,
    sendMessage,
    callAnnouncementState,
    INFO_CHAT_ID,
    TECH_THREAD_ID,
    TECH_MESSAGES,
    INFO_CHANNEL_ANNOUNCEMENT_ID,
    FREE_SERVICES_ANNOUNCEMENT_ID,
    sendAnnouncementCopyToGroup,
    copyTechMessageToGroup,
    CHAT_GROUP_ID,
    getTodayTopicSourceMessageId,
    enqueueZoomMessages,
    getZoomMeetingMessages
  } = deps;
  if (key === "yozhik") {
    try {
      await sendYozhikToGroup(env);
      await answerCallback(env, callbackQuery.id, "\u0401\u0436\u0438\u043A \u043E\u0442\u043F\u0440\u0430\u0432\u043B\u0435\u043D \u0432 \u0447\u0430\u0442 \u0433\u0440\u0443\u043F\u043F\u044B.");
    } catch (error) {
      await answerCallback(env, callbackQuery.id, `\u041E\u0448\u0438\u0431\u043A\u0430: ${error.message}`, true);
    }
    return okResponse();
  }
  if (key === "bill_prompt") {
    const prompt = await sendMessage(
      env,
      chatId,
      "\u0412\u0432\u0435\u0434\u0438 \u043D\u043E\u043C\u0435\u0440 \u043E\u0442\u0440\u044B\u0432\u043A\u0430 \u0411\u0438\u043B\u043B\u0430.\n\n\u041D\u0430\u043F\u0440\u0438\u043C\u0435\u0440: 17\n\n\u0414\u043E\u043F\u0443\u0441\u0442\u0438\u043C\u044B\u0435 \u043D\u043E\u043C\u0435\u0440\u0430: \u043E\u0442 1 \u0434\u043E 332.",
      threadId
    );
    await callAnnouncementState(env, "set_message_id", {
      key: `bill_prompt_waiting:${chatId}:${threadId || 0}`,
      messageId: prompt?.result?.message_id ?? 1
    });
    await answerCallback(env, callbackQuery.id, "\u0421\u043D\u0430\u0447\u0430\u043B\u0430 \u043D\u043E\u043C\u0435\u0440 \u043E\u0442\u0440\u044B\u0432\u043A\u0430 \u0411\u0438\u043B\u043B\u0430, \u043F\u043E\u0442\u043E\u043C \u043A\u043E\u043C\u0430\u043D\u0434\u0443\u0439.");
    return okResponse();
  }
  if (key === "today_topic") {
    const sourceMessageId = getTodayTopicSourceMessageId();
    if (!sourceMessageId) {
      await answerCallback(env, callbackQuery.id, "\u0421\u0435\u0433\u043E\u0434\u043D\u044F \u0441\u043E\u0431\u0440\u0430\u043D\u0438\u044F \u043D\u0435\u0442.");
      return okResponse();
    }
    await copyTechMessageToGroup(env, CHAT_GROUP_ID, INFO_CHAT_ID, sourceMessageId);
    if (enqueueZoomMessages && getZoomMeetingMessages) {
      await enqueueZoomMessages(env, getZoomMeetingMessages("today_topic")).catch(() => null);
    }
    await answerCallback(env, callbackQuery.id, "\u0422\u0435\u043C\u0430 \u0441\u043E\u0431\u0440\u0430\u043D\u0438\u044F \u0443\u0442\u0430\u0449\u0435\u043D\u0430 \u0432 \u0447\u0430\u0442.");
    return okResponse();
  }
  const sourceMessageId = TECH_MESSAGES[key];
  if (!sourceMessageId) {
    await answerCallback(env, callbackQuery.id, "\u041D\u0435 \u043D\u0430\u0448\u0451\u043B \u044D\u0442\u0430\u043B\u043E\u043D\u043D\u043E\u0435 \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0435, \u0443\u0432\u044B.");
    return okResponse();
  }
  const sentViaAnnouncementCopy = sourceMessageId === INFO_CHANNEL_ANNOUNCEMENT_ID || sourceMessageId === FREE_SERVICES_ANNOUNCEMENT_ID;
  if (sentViaAnnouncementCopy) {
    await sendAnnouncementCopyToGroup(env, sourceMessageId);
  } else {
    await copyTechMessageToGroup(env, CHAT_GROUP_ID, INFO_CHAT_ID, sourceMessageId);
  }
  if (!sentViaAnnouncementCopy && enqueueZoomMessages && getZoomMeetingMessages) {
    await enqueueZoomMessages(env, getZoomMeetingMessages(key)).catch(() => null);
  }
  await answerCallback(env, callbackQuery.id, "\u0421\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0435 \u0443\u0442\u0430\u0449\u0435\u043D\u043E \u0432 \u0447\u0430\u0442 \u0433\u0440\u0443\u043F\u043F\u044B.");
  return okResponse();
}

async function handleQueueCallback(env, callbackQuery, chatId, threadId, key, deps) {
  const {
    answerCallback,
    callQueueState,
    applyQueueResponse,
    QUEUE_CALLBACK_TEXTS
  } = deps;
  try {
    if (key === "open_bill") {
      const result = await callQueueState(env, "open", { mode: "bill" });
      await applyQueueResponse(env, result);
      await answerCallback(env, callbackQuery.id, "\u041E\u0447\u0435\u0440\u0435\u0434\u044C \u0411\u0438\u043B\u043B \u043E\u0442\u043A\u0440\u044B\u0442\u0430.");
      return okResponse();
    }
    if (key === "open_bk") {
      const result = await callQueueState(env, "open", { mode: "bk" });
      await applyQueueResponse(env, result);
      await answerCallback(env, callbackQuery.id, "\u041E\u0447\u0435\u0440\u0435\u0434\u044C \u0411\u041A \u043E\u0442\u043A\u0440\u044B\u0442\u0430.");
      return okResponse();
    }
    if (key === "open_rs") {
      const result = await callQueueState(env, "open", { mode: "rs" });
      await applyQueueResponse(env, result);
      await answerCallback(env, callbackQuery.id, "\u041E\u0447\u0435\u0440\u0435\u0434\u044C \u0420\u0430\u0431\u043E\u0447\u043A\u0430 \u043E\u0442\u043A\u0440\u044B\u0442\u0430.");
      return okResponse();
    }
    if (key === "done") {
      const result = await callQueueState(env, "done");
      await applyQueueResponse(env, result);
      await answerCallback(env, callbackQuery.id, QUEUE_CALLBACK_TEXTS.markedDone);
      return okResponse();
    }
    if (key === "skip") {
      const result = await callQueueState(env, "skip");
      await applyQueueResponse(env, result);
      await answerCallback(env, callbackQuery.id, QUEUE_CALLBACK_TEXTS.skipped);
      return okResponse();
    }
    if (key === "remove") {
      const result = await callQueueState(env, "remove");
      await applyQueueResponse(env, result);
      await answerCallback(env, callbackQuery.id, QUEUE_CALLBACK_TEXTS.removed);
      return okResponse();
    }
    if (key === "undo") {
      const result = await callQueueState(env, "undo");
      await applyQueueResponse(env, result);
      await answerCallback(env, callbackQuery.id, QUEUE_CALLBACK_TEXTS.undone);
      return okResponse();
    }
    if (key === "close") {
      const result = await callQueueState(env, "close");
      await applyQueueResponse(env, result);
      await answerCallback(env, callbackQuery.id, QUEUE_CALLBACK_TEXTS.queueClosed);
      return okResponse();
    }
    await answerCallback(env, callbackQuery.id, QUEUE_CALLBACK_TEXTS.unknownQueueButton);
  } catch (error) {
    await answerCallback(env, callbackQuery.id, `${QUEUE_CALLBACK_TEXTS.queueErrorPrefix}: ${error.message}`, true);
  }
  return okResponse();
}

async function handleTimerCallback(env, callbackQuery, chatId, threadId, key, deps) {
  const {
    isChatGroup,
    answerCallback,
    callTimerState,
    TIMER_CALLBACK_TEXTS,
    TIMER_DEFAULT_SECONDS
  } = deps;
  try {
    const timerMessageId = isChatGroup(chatId, threadId) ? callbackQuery.message?.message_id ?? null : null;
    if (key === "start") {
      await callTimerState(env, "start", { durationSec: TIMER_DEFAULT_SECONDS, messageId: timerMessageId });
      await answerCallback(env, callbackQuery.id, TIMER_CALLBACK_TEXTS.started);
      return okResponse();
    }
    if (key === "stop") {
      await callTimerState(env, "stop", { messageId: timerMessageId });
      await answerCallback(env, callbackQuery.id, TIMER_CALLBACK_TEXTS.stopped);
      return okResponse();
    }
    await answerCallback(env, callbackQuery.id, TIMER_CALLBACK_TEXTS.unknownTimerButton);
  } catch (error) {
    await answerCallback(env, callbackQuery.id, `${TIMER_CALLBACK_TEXTS.timerErrorPrefix}: ${error.message}`, true);
  }
  return okResponse();
}

export async function handleCallbackQuery(env, callbackQuery, deps) {
  const {
    isUserAdmin,
    answerCallback,
    QUEUE_CALLBACK_TEXTS,
    TIMER_CALLBACK_TEXTS
  } = deps;
  const data = callbackQuery.data ?? "";
  const userId = callbackQuery.from?.id;
  const message = callbackQuery.message;
  const chatId = message?.chat?.id ?? null;
  const threadId = message?.message_thread_id ?? null;
  const chatType = message?.chat?.type ?? "";
  if (data.startsWith("srv:")) {
    const [, action, dateKey, roleKey] = data.split(":");
    if ((action === "ok" || action === "replace") && dateKey && roleKey) {
      return handleServiceReminderCallback(env, callbackQuery, action, dateKey, roleKey, deps);
    }
  }
  if (data.startsWith("repl:")) {
    const [, action, requestId, responderId] = data.split(":");
    if (action === "offer" && requestId) {
      return handleReplacementOfferCallback(env, callbackQuery, requestId, deps);
    }
    if (action === "close" && requestId) {
      return handleReplacementCloseCallback(env, callbackQuery, requestId, deps);
    }
    if (action === "select" && requestId && responderId) {
      return handleReplacementSelectCallback(env, callbackQuery, requestId, responderId, deps);
    }
    if (action === "ack" && requestId) {
      return handleReplacementAckCallback(env, callbackQuery, requestId, deps);
    }
  }
  if (data === ADMIN_DM_CALLBACKS.send) {
    return handleAdminDmCallback(env, callbackQuery, "send", deps);
  }
  if (data === ADMIN_DM_CALLBACKS.cancel) {
    return handleAdminDmCallback(env, callbackQuery, "cancel", deps);
  }
  if (data.startsWith("owner_admin:")) {
    const [, action, targetUserId] = data.split(":");
    if ((action === "add" || action === "remove") && targetUserId) {
      return handleOwnerAdminCallback(env, callbackQuery, action, targetUserId, deps);
    }
  }
  if (data.startsWith("meeting:")) {
    const isAdmin = await isUserAdmin(env, userId, chatId, chatType);
    if (!isAdmin) {
      await answerCallback(env, callbackQuery.id, QUEUE_CALLBACK_TEXTS.onlyAdmins);
      return okResponse();
    }
    return handleMeetingCallback(env, callbackQuery, chatId, threadId, data.replace("meeting:", ""), deps);
  }
  if (data.startsWith("queue:")) {
    const isAdmin = await isUserAdmin(env, userId, chatId, chatType);
    if (!isAdmin) {
      await answerCallback(env, callbackQuery.id, QUEUE_CALLBACK_TEXTS.onlyAdmins);
      return okResponse();
    }
    return handleQueueCallback(env, callbackQuery, chatId, threadId, data.replace("queue:", ""), deps);
  }
  if (data.startsWith("timer:")) {
    const isAdmin = await isUserAdmin(env, userId, chatId, chatType);
    if (!isAdmin) {
      await answerCallback(env, callbackQuery.id, TIMER_CALLBACK_TEXTS.onlyAdmins);
      return okResponse();
    }
    return handleTimerCallback(env, callbackQuery, chatId, threadId, data.replace("timer:", ""), deps);
  }
  return null;
}
