const DEFAULT_BOT_NAMES = ["\u043D\u0430\u0444\u0430\u043D\u044F", "\u043D\u0430\u0444\u0430\u043D", "nafanya", "\u0431\u043E\u0442", "bot"];

const NAME_ALIASES = new Map([
  ["\u043C\u0430\u043D\u044F", "\u041C\u0430\u0448\u0430"],
  ["\u043C\u0430\u043D\u0435\u0447\u043A\u0430", "\u041C\u0430\u0448\u0430"],
  ["\u043C\u0430\u0448\u0430", "\u041C\u0430\u0448\u0430"],
  ["\u043C\u0430\u0448\u0435\u043D\u044C\u043A\u0430", "\u041C\u0430\u0448\u0430"]
]);

const NON_NAME_OPENERS = new Set([
  "\u0432\u0441\u0435\u043C",
  "\u0432\u0441\u0435",
  "\u0434\u0440\u0443\u0437\u044C\u044F",
  "\u0440\u0435\u0431\u044F\u0442\u0430",
  "\u043A\u043E\u043B\u043B\u0435\u0433\u0438",
  "\u043F\u0440\u0438\u0432\u0435\u0442",
  "\u0437\u0434\u0440\u0430\u0432\u0441\u0442\u0432\u0443\u0439\u0442\u0435",
  "\u0434\u043E\u0431\u0440\u043E\u0435",
  "\u0434\u043E\u0431\u0440\u044B\u0439",
  "\u0434\u043E\u0431\u0440\u0430\u044F"
]);

function normalize(value) {
  return String(value || "").trim().toLowerCase().replace(/\u0451/gu, "\u0435").replace(/\s+/gu, " ");
}

function cleanUsername(value) {
  return normalize(value).replace(/^@/u, "");
}

function displayUser(user, fallback = null) {
  if (!user) return fallback;
  const name = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
  if (name) return name;
  if (user.username) return `@${user.username}`;
  return user.id ? String(user.id) : fallback;
}

function parsePersonMap(raw) {
  if (!raw) return {};
  if (typeof raw === "object") return raw;
  try {
    const parsed = JSON.parse(String(raw));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function knownPeople(rawMap) {
  const map = parsePersonMap(rawMap);
  const result = new Map();
  for (const [key, value] of Object.entries(map)) {
    const display = String(value?.display_name || key || "").trim();
    if (key && !String(key).startsWith("@")) result.set(normalize(key), display);
    if (display && !display.startsWith("@")) result.set(normalize(display), display);
    if (value?.username) result.set(`@${cleanUsername(value.username)}`, display || `@${cleanUsername(value.username)}`);
  }
  return result;
}

function botIdentity(message, botUsername = "") {
  const replyUser = message?.reply_to_message?.from;
  const usernames = new Set([
    cleanUsername(botUsername),
    replyUser?.is_bot ? cleanUsername(replyUser.username) : ""
  ].filter(Boolean));
  return {
    names: DEFAULT_BOT_NAMES,
    usernames
  };
}

function isBotName(value, identity) {
  const candidate = normalize(value).replace(/^@/u, "");
  return identity.names.includes(candidate) || identity.usernames.has(candidate);
}

function findLeadingAddressee(text, people, identity) {
  const source = String(text || "").trim();
  const usernameMatch = source.match(/^\s*(@[A-Za-z0-9_]{3,32})\s*[,!:\u2014-]\s*/u);
  if (usernameMatch) {
    const raw = usernameMatch[1];
    if (isBotName(raw, identity)) return { raw, canonical: "\u041D\u0430\u0444\u0430\u043D\u044F", isBot: true };
    return { raw, canonical: people.get(normalize(raw)) || raw, isBot: false };
  }

  const nameMatch = source.match(/^\s*([\p{L}][\p{L}-]{1,31}(?:\s+[\p{L}][\p{L}-]{1,31})?)\s*[,!:\u2014-]\s*/u);
  if (!nameMatch) return null;
  const raw = nameMatch[1].trim();
  const normalized = normalize(raw);
  const firstWord = normalized.split(" ")[0];
  if (NON_NAME_OPENERS.has(normalized) || NON_NAME_OPENERS.has(firstWord)) return null;
  if (isBotName(raw, identity)) return { raw, canonical: "\u041D\u0430\u0444\u0430\u043D\u044F", isBot: true };
  const canonical = people.get(normalized) || NAME_ALIASES.get(normalized);
  if (canonical || /^\p{Lu}/u.test(raw)) return { raw, canonical: canonical || raw, isBot: false };
  return null;
}

function botMentionState(text, identity) {
  const source = String(text || "");
  const normalized = normalize(source);
  const nameMention = identity.names.some((name) => new RegExp(`(?:^|[^\\p{L}])${name}(?=$|[^\\p{L}])`, "iu").test(normalized));
  const usernameMention = [...identity.usernames].some((username) => new RegExp(`@${username}(?=$|[^A-Za-z0-9_])`, "iu").test(source));
  return nameMention || usernameMention;
}

function looksLikeDirectBotOpening(text, identity) {
  const source = String(text || "").trim();
  const botNames = identity.names.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const nameOpening = new RegExp(`^(?:${botNames})\\s+(?:\u0442\u044B|\u0442\u0435\u0431\u0435|\u0442\u0435\u0431\u044F|\u0442\u0432\u043E[\u0439\u044F\u0435\u0438]|\u0441\u043A\u0430\u0436\u0438|\u043F\u043E\u0434\u0441\u043A\u0430\u0436\u0438|\u0434\u0430\u0439|\u043F\u043E\u043A\u0430\u0436\u0438|\u043D\u0430\u0439\u0434\u0438|\u043A\u0442\u043E|\u0447\u0442\u043E|\u0433\u0434\u0435|\u043A\u043E\u0433\u0434\u0430|\u043F\u043E\u0447\u0435\u043C\u0443|\u043A\u0430\u043A|\u0441\u043A\u043E\u043B\u044C\u043A\u043E|\u043C\u043E\u0436\u0435\u0448\u044C)(?:\\s|$)`, "iu");
  if (nameOpening.test(source)) return true;
  return [...identity.usernames].some((username) => new RegExp(`^@${username}(?:\\s|[,!:\u2014-])`, "iu").test(source));
}

function looksLikeReplyQuestion(text) {
  const source = normalize(text).replace(/[?!.,:;\u061F\u2014-]+/gu, " ").replace(/\s+/gu, " ").trim();
  if (!/[?\u061F]/u.test(String(text || ""))) return false;
  return /^(?:\u0430\s+)?(?:\u0442\u044B|\u0442\u0435\u0431\u0435|\u0442\u0435\u0431\u044F|\u0442\u0432\u043E[\u0439\u044F\u0435\u0438]|\u043A\u0442\u043E|\u0447\u0442\u043E|\u0433\u0434\u0435|\u043A\u043E\u0433\u0434\u0430|\u043F\u043E\u0447\u0435\u043C\u0443|\u0437\u0430\u0447\u0435\u043C|\u043A\u0430\u043A|\u0441\u043A\u043E\u043B\u044C\u043A\u043E|\u043C\u043E\u0436\u043D\u043E|\u043F\u0440\u0430\u0432\u0434\u0430\s+\u043B\u0438)(?:\s|$)/u.test(source);
}

function looksLikeBotCommand(text, explicitBotAddress) {
  const source = normalize(text);
  if (/^\/[a-z0-9_]+(?:@[a-z0-9_]+)?(?:\s|$)/u.test(source)) return true;
  if (!explicitBotAddress) return false;
  return /(?:^|\s)(?:\u0441\u043A\u0430\u0436\u0438|\u043F\u043E\u0434\u0441\u043A\u0430\u0436\u0438|\u0434\u0430\u0439|\u043F\u043E\u043A\u0430\u0436\u0438|\u043D\u0430\u0439\u0434\u0438|\u0434\u043E\u0431\u0430\u0432\u044C|\u0443\u0431\u0435\u0440\u0438|\u043E\u0442\u043A\u0440\u043E\u0439|\u0437\u0430\u043A\u0440\u043E\u0439)(?:\s|$)/u.test(source);
}

function chooseReason({ privateChat, explicitOther, explicitBotAddress, commandToBot, questionToBot, botThirdPerson, replyToBot }) {
  if (privateChat) return "\u043B\u0438\u0447\u043D\u044B\u0439 \u0447\u0430\u0442 \u0441 \u0431\u043E\u0442\u043E\u043C";
  if (explicitOther && !explicitBotAddress) return "reply \u0441\u0432\u044F\u0437\u0430\u043D \u0441 \u043F\u0440\u0435\u0434\u044B\u0434\u0443\u0449\u0438\u043C \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0435\u043C, \u043D\u043E \u0442\u0435\u043A\u0441\u0442 \u044F\u0432\u043D\u043E \u0430\u0434\u0440\u0435\u0441\u043E\u0432\u0430\u043D \u0434\u0440\u0443\u0433\u043E\u043C\u0443 \u0447\u0435\u043B\u043E\u0432\u0435\u043A\u0443";
  if (commandToBot) return "\u044F\u0432\u043D\u0430\u044F \u043A\u043E\u043C\u0430\u043D\u0434\u0430 \u0431\u043E\u0442\u0443";
  if (explicitBotAddress) return "\u041D\u0430\u0444\u0430\u043D\u044F \u044F\u0432\u043D\u043E \u043D\u0430\u0437\u0432\u0430\u043D \u0430\u0434\u0440\u0435\u0441\u0430\u0442\u043E\u043C";
  if (questionToBot) return "\u0432 reply \u0435\u0441\u0442\u044C \u044F\u0432\u043D\u044B\u0439 \u0432\u043E\u043F\u0440\u043E\u0441 \u043A \u0431\u043E\u0442\u0443";
  if (botThirdPerson) return "\u0431\u043E\u0442 \u0442\u043E\u043B\u044C\u043A\u043E \u0443\u043F\u043E\u043C\u044F\u043D\u0443\u0442 \u0432 \u0442\u0440\u0435\u0442\u044C\u0435\u043C \u043B\u0438\u0446\u0435";
  if (replyToBot) return "reply \u043F\u043E\u043A\u0430\u0437\u044B\u0432\u0430\u0435\u0442 \u0441\u0432\u044F\u0437\u044C, \u043D\u043E \u043D\u0435 \u0441\u043E\u0434\u0435\u0440\u0436\u0438\u0442 \u044F\u0432\u043D\u043E\u0433\u043E \u043E\u0431\u0440\u0430\u0449\u0435\u043D\u0438\u044F";
  return "\u043A \u0431\u043E\u0442\u0443 \u043D\u0435 \u043E\u0431\u0440\u0430\u0449\u0430\u044E\u0442\u0441\u044F";
}

export function classifyMessageAddressing(message, text, { chatType = "", botUsername = "", personMap = null } = {}) {
  const identity = botIdentity(message, botUsername);
  const people = knownPeople(personMap);
  const leadingAddressee = findLeadingAddressee(text, people, identity);
  const replyUser = message?.reply_to_message?.from || null;
  const replyToBot = Boolean(replyUser?.is_bot);
  const botMentioned = botMentionState(text, identity);
  const explicitBotAddress = Boolean(leadingAddressee?.isBot) || looksLikeDirectBotOpening(text, identity);
  const explicitOther = leadingAddressee && !leadingAddressee.isBot ? leadingAddressee.canonical : null;
  const botMentionedInThirdPerson = botMentioned && !explicitBotAddress;
  const commandToBot = looksLikeBotCommand(text, explicitBotAddress);
  const questionToBot = explicitBotAddress || (replyToBot && !explicitOther && !botMentionedInThirdPerson && looksLikeReplyQuestion(text));
  const privateChat = chatType === "private";
  const shouldBotReply = privateChat || commandToBot || explicitBotAddress || questionToBot;

  return {
    author: displayUser(message?.from, null),
    author_username: message?.from?.username ? `@${message.from.username}` : null,
    reply_target_author: displayUser(replyUser, null),
    reply_target_username: replyUser?.username ? `@${replyUser.username}` : null,
    reply_target_text: String(message?.reply_to_message?.text ?? message?.reply_to_message?.caption ?? "").trim() || null,
    explicit_addressee: explicitOther || (explicitBotAddress ? "\u041D\u0430\u0444\u0430\u043D\u044F" : null),
    bot_mentioned: botMentioned,
    bot_mentioned_as_addressee: explicitBotAddress,
    bot_mentioned_in_third_person: botMentionedInThirdPerson,
    question_to_bot: questionToBot,
    command_to_bot: commandToBot,
    reply_to_bot: replyToBot,
    should_bot_reply: shouldBotReply,
    reason: chooseReason({ privateChat, explicitOther, explicitBotAddress, commandToBot, questionToBot, botThirdPerson: botMentionedInThirdPerson, replyToBot })
  };
}

export function buildAddressingPrompt(classification) {
  const safe = classification || {};
  return [
    "\u041A\u043E\u043D\u0442\u0435\u043A\u0441\u0442 \u0430\u0434\u0440\u0435\u0441\u0430\u0446\u0438\u0438 \u0443\u0436\u0435 \u043E\u043F\u0440\u0435\u0434\u0435\u043B\u0451\u043D \u0434\u043E \u0433\u0435\u043D\u0435\u0440\u0430\u0446\u0438\u0438:",
    `- \u0430\u0432\u0442\u043E\u0440: ${safe.author || "\u043D\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043D\u043E"}`,
    `- \u0430\u0432\u0442\u043E\u0440 reply: ${safe.reply_target_author || "\u043D\u0435\u0442"}`,
    `- \u044F\u0432\u043D\u044B\u0439 \u0430\u0434\u0440\u0435\u0441\u0430\u0442 \u0442\u0435\u043A\u0441\u0442\u0430: ${safe.explicit_addressee || "\u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D"}`,
    `- \u041D\u0430\u0444\u0430\u043D\u044F \u044F\u0432\u043D\u044B\u0439 \u0430\u0434\u0440\u0435\u0441\u0430\u0442: ${safe.bot_mentioned_as_addressee ? "\u0434\u0430" : "\u043D\u0435\u0442"}`,
    `- \u041D\u0430\u0444\u0430\u043D\u044F \u0443\u043F\u043E\u043C\u044F\u043D\u0443\u0442 \u0432 \u0442\u0440\u0435\u0442\u044C\u0435\u043C \u043B\u0438\u0446\u0435: ${safe.bot_mentioned_in_third_person ? "\u0434\u0430" : "\u043D\u0435\u0442"}`,
    `- \u043F\u0440\u0438\u0447\u0438\u043D\u0430 \u043E\u0442\u0432\u0435\u0442\u0430: ${safe.reason || "\u043D\u0435 \u0443\u043A\u0430\u0437\u0430\u043D\u0430"}`,
    "reply \u043E\u0437\u043D\u0430\u0447\u0430\u0435\u0442 \u0441\u0432\u044F\u0437\u044C \u0441 \u043F\u0440\u0435\u0434\u044B\u0434\u0443\u0449\u0438\u043C \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0435\u043C, \u0430 \u043D\u0435 \u0430\u0432\u0442\u043E\u043C\u0430\u0442\u0438\u0447\u0435\u0441\u043A\u043E\u0435 \u043E\u0431\u0440\u0430\u0449\u0435\u043D\u0438\u0435 \u043A \u0430\u0432\u0442\u043E\u0440\u0443 reply. \u041D\u0435 \u043F\u0443\u0442\u0430\u0439 \u0438\u043C\u044F \u044F\u0432\u043D\u043E\u0433\u043E \u0430\u0434\u0440\u0435\u0441\u0430\u0442\u0430 \u0441 \u0438\u043C\u0435\u043D\u0435\u043C \u041D\u0430\u0444\u0430\u043D\u0438."
  ].join("\n");
}
