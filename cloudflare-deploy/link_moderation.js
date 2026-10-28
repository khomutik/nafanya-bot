const MODERATION_KEY_PREFIX = "link_moderation_enabled:";
const MODERATION_REFERENCE_URL = "https://t.me/c/3835668674/440/6155";

const TEXT = {
  enabled: "\u041c\u043e\u0434\u0435\u0440\u0430\u0446\u0438\u044f \u0441\u0441\u044b\u043b\u043e\u043a \u0432\u043a\u043b\u044e\u0447\u0435\u043d\u0430.",
  disabled: "\u041c\u043e\u0434\u0435\u0440\u0430\u0446\u0438\u044f \u0441\u0441\u044b\u043b\u043e\u043a \u0432\u044b\u043a\u043b\u044e\u0447\u0435\u043d\u0430.",
  alreadyEnabled: "\u041c\u043e\u0434\u0435\u0440\u0430\u0446\u0438\u044f \u0443\u0436\u0435 \u0432\u043a\u043b\u044e\u0447\u0435\u043d\u0430.",
  alreadyDisabled: "\u041c\u043e\u0434\u0435\u0440\u0430\u0446\u0438\u044f \u0443\u0436\u0435 \u0432\u044b\u043a\u043b\u044e\u0447\u0435\u043d\u0430.",
  statusOn: "\u041c\u043e\u0434\u0435\u0440\u0430\u0446\u0438\u044f \u0441\u0441\u044b\u043b\u043e\u043a: \u0432\u043a\u043b\u044e\u0447\u0435\u043d\u0430.",
  statusOff: "\u041c\u043e\u0434\u0435\u0440\u0430\u0446\u0438\u044f \u0441\u0441\u044b\u043b\u043e\u043a: \u0432\u044b\u043a\u043b\u044e\u0447\u0435\u043d\u0430.",
  permissionDenied: "\u0423\u043f\u0440\u0430\u0432\u043b\u044f\u0442\u044c \u0440\u0435\u0436\u0438\u043c\u043e\u043c \u043c\u043e\u0436\u0435\u0442 \u0442\u043e\u043b\u044c\u043a\u043e \u0430\u0434\u043c\u0438\u043d\u0438\u0441\u0442\u0440\u0430\u0442\u043e\u0440 \u0447\u0430\u0442\u0430.",
  botPermissionMissing: "\u041d\u0435 \u0432\u043a\u043b\u044e\u0447\u0430\u044e: \u0443 \u0431\u043e\u0442\u0430 \u043d\u0435\u0442 \u043f\u0440\u0430\u0432\u0430 \u0443\u0434\u0430\u043b\u044f\u0442\u044c \u0441\u043e\u043e\u0431\u0449\u0435\u043d\u0438\u044f \u0432 \u044d\u0442\u043e\u043c \u0447\u0430\u0442\u0435.",
  checkFailed: "\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u043f\u0440\u043e\u0432\u0435\u0440\u0438\u0442\u044c \u043f\u0440\u0430\u0432\u0430 \u0431\u043e\u0442\u0430. \u0420\u0435\u0436\u0438\u043c \u043e\u0441\u0442\u0430\u043b\u0441\u044f \u0432\u044b\u043a\u043b\u044e\u0447\u0435\u043d.",
  unavailable: "\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u043f\u0440\u043e\u0432\u0435\u0440\u0438\u0442\u044c \u0440\u0435\u0436\u0438\u043c. \u041d\u0438\u0447\u0435\u0433\u043e \u043d\u0435 \u0443\u0434\u0430\u043b\u0435\u043d\u043e.",
  cannotIdentify: "\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0431\u0435\u0437\u043e\u043f\u0430\u0441\u043d\u043e \u043e\u043f\u0440\u0435\u0434\u0435\u043b\u0438\u0442\u044c \u0430\u0432\u0442\u043e\u0440\u0430. \u0421\u043e\u043e\u0431\u0449\u0435\u043d\u0438\u0435 \u043e\u0441\u0442\u0430\u0432\u043b\u0435\u043d\u043e.",
  usage: "\u041a\u043e\u043c\u0430\u043d\u0434\u044b: /linkmod on, /linkmod off, /linkmod status"
};

function response() {
  return new Response("ok");
}

function moderationKey(chatId) {
  return `${MODERATION_KEY_PREFIX}${chatId}`;
}

export function hasMessageUrl(message) {
  const entities = [
    ...(Array.isArray(message?.entities) ? message.entities : []),
    ...(Array.isArray(message?.caption_entities) ? message.caption_entities : [])
  ];
  if (entities.some((entity) => entity?.type === "url" || entity?.type === "text_link")) return true;

  // Telegram normally supplies URL entities; this also catches plain URLs if an update lacks entities.
  const visibleText = `${message?.text || ""}\n${message?.caption || ""}`;
  return /(?:https?:\/\/|tg:\/\/|www\.)[^\s<>]+/iu.test(visibleText);
}

function isAnonymousAdminMessage(message, chatId) {
  return Number(message?.sender_chat?.id) === Number(chatId);
}

function commandFrom(message, botUsername = "") {
  const text = String(message?.text || "").trim();
  const match = text.match(/^\/linkmod(?:@([A-Za-z0-9_]+))?(?:\s+(on|off|status))?\s*$/iu);
  if (!match) return null;
  if (match[1] && (!botUsername || match[1].toLowerCase() !== botUsername.replace(/^@/u, "").toLowerCase())) return null;
  return String(match[2] || "").toLowerCase();
}

async function getEnabled(deps) {
  const current = await deps.callAnnouncementState(deps.env, "get", { key: moderationKey(deps.chatId) });
  return current?.messageId === true;
}

async function setEnabled(deps, enabled) {
  await deps.callAnnouncementState(deps.env, "set_message_id", {
    key: moderationKey(deps.chatId),
    messageId: enabled ? true : null
  });
}

function logError(operation, error, context = {}) {
  console.error("link_moderation_error", {
    module: "link_moderation",
    operation,
    chatId: context.chatId,
    messageId: context.messageId,
    userId: context.userId,
    error: String(error?.message || error || "unknown").slice(0, 300)
  });
}

async function isAdminOrOwner(deps, message) {
  if (isAnonymousAdminMessage(message, deps.chatId)) return true;
  const userId = message?.from?.id;
  if (userId === undefined || userId === null) return false;
  if (String(userId) === String(deps.env?.OWNER_USER_ID || "")) return true;
  const result = await deps.callTelegram(deps.env, "getChatMember", { chat_id: deps.chatId, user_id: userId });
  return result?.result?.status === "creator" || result?.result?.status === "administrator";
}

async function botCanDeleteMessages(deps) {
  const bot = await deps.callTelegram(deps.env, "getMe", {});
  const botId = bot?.result?.id;
  if (!botId) throw new Error("getMe did not return bot id");
  const member = await deps.callTelegram(deps.env, "getChatMember", { chat_id: deps.chatId, user_id: botId });
  const status = member?.result?.status;
  return status === "creator" || status === "administrator" && member?.result?.can_delete_messages === true;
}

async function commandResponse(deps, message, command) {
  let isAdmin;
  try {
    isAdmin = await isAdminOrOwner(deps, message);
  } catch (error) {
    logError("check_command_admin", error, { chatId: deps.chatId, messageId: message.message_id, userId: message.from?.id });
    await deps.sendMessage(deps.env, deps.chatId, TEXT.checkFailed, null, message.message_id);
    return response();
  }
  if (!isAdmin) {
    await deps.sendMessage(deps.env, deps.chatId, TEXT.permissionDenied, null, message.message_id);
    return response();
  }

  let enabled;
  try {
    enabled = await getEnabled(deps);
  } catch (error) {
    logError("read_mode", error, { chatId: deps.chatId, messageId: message.message_id, userId: message.from?.id });
    await deps.sendMessage(deps.env, deps.chatId, TEXT.unavailable, null, message.message_id);
    return response();
  }

  if (!command) {
    await deps.sendMessage(deps.env, deps.chatId, enabled ? TEXT.statusOn : TEXT.statusOff, null, message.message_id);
    return response();
  }
  if (command === "status") {
    await deps.sendMessage(deps.env, deps.chatId, enabled ? TEXT.statusOn : TEXT.statusOff, null, message.message_id);
    return response();
  }
  if (command === "off") {
    if (!enabled) {
      await deps.sendMessage(deps.env, deps.chatId, TEXT.alreadyDisabled, null, message.message_id);
      return response();
    }
    try {
      await setEnabled(deps, false);
      await deps.sendMessage(deps.env, deps.chatId, TEXT.disabled, null, message.message_id);
    } catch (error) {
      logError("disable_mode", error, { chatId: deps.chatId, messageId: message.message_id, userId: message.from?.id });
      await deps.sendMessage(deps.env, deps.chatId, TEXT.unavailable, null, message.message_id);
    }
    return response();
  }
  if (enabled) {
    await deps.sendMessage(deps.env, deps.chatId, TEXT.alreadyEnabled, null, message.message_id);
    return response();
  }

  try {
    if (!await botCanDeleteMessages(deps)) {
      await deps.sendMessage(deps.env, deps.chatId, TEXT.botPermissionMissing, null, message.message_id);
      return response();
    }
    await setEnabled(deps, true);
    await deps.sendMessage(deps.env, deps.chatId, TEXT.enabled, null, message.message_id);
  } catch (error) {
    logError("enable_mode_permission_check", error, { chatId: deps.chatId, messageId: message.message_id, userId: message.from?.id });
    await deps.sendMessage(deps.env, deps.chatId, TEXT.checkFailed, null, message.message_id);
  }
  return response();
}

export async function handleLinkModeration(env, message, deps) {
  const chatId = message?.chat?.id;
  if (Number(chatId) !== Number(deps.CHAT_GROUP_ID) || message?.from?.is_bot) return null;

  const command = commandFrom(message, deps.BOT_USERNAME);
  const context = { env, chatId, CHAT_GROUP_ID: deps.CHAT_GROUP_ID, callAnnouncementState: deps.callAnnouncementState, callTelegram: deps.callTelegram, sendMessage: deps.sendMessage };
  if (command !== null) return commandResponse(context, message, command);

  if (!hasMessageUrl(message)) return null;
  if (isAnonymousAdminMessage(message, chatId)) return null;
  if (message?.from?.id === undefined || message?.from?.id === null) {
    logError("identify_message_author", new Error("message has no sender user id"), { chatId, messageId: message.message_id });
    return null;
  }

  let enabled;
  try {
    enabled = await getEnabled(context);
  } catch (error) {
    logError("read_mode", error, { chatId, messageId: message.message_id, userId: message.from.id });
    return null;
  }
  if (!enabled) return null;
  if (String(message.from.id) === String(env?.OWNER_USER_ID || "")) return null;

  let member;
  try {
    member = await deps.callTelegram(env, "getChatMember", { chat_id: chatId, user_id: message.from.id });
  } catch (error) {
    logError("check_message_author", error, { chatId, messageId: message.message_id, userId: message.from.id });
    return null;
  }
  const status = member?.result?.status;
  if (status === "creator" || status === "administrator") return null;
  const ordinaryMember = status === "member" || status === "restricted" && member?.result?.is_member === true;
  if (!ordinaryMember) {
    logError("verify_message_author_status", new Error(`unexpected chat member status: ${String(status || "missing")}`), { chatId, messageId: message.message_id, userId: message.from.id });
    return null;
  }

  try {
    await deps.sendMessage(env, chatId, MODERATION_REFERENCE_URL, null, message.message_id);
  } catch (error) {
    logError("send_reference_reply", error, { chatId, messageId: message.message_id, userId: message.from.id });
    return response();
  }

  const deletion = await deps.deleteMessageSafe(env, chatId, message.message_id);
  if (!deletion) {
    logError("delete_link_message", new Error("deleteMessage returned false"), { chatId, messageId: message.message_id, userId: message.from.id });
  }
  return response();
}

export const linkModerationInternals = { commandFrom, moderationKey, isAnonymousAdminMessage, botCanDeleteMessages };
