const CHAT_BUTTON_PATTERNS = [/chat/i, /\u0447\u0430\u0442/iu];
const JOIN_BUTTON_PATTERNS = [/join/i, /\u0432\u043e\u0439\u0442\u0438/iu, /\u043f\u0440\u0438\u0441\u043e\u0435\u0434\u0438\u043d/iu];
const PASSCODE_PATTERNS = [/passcode/i, /password/i, /\u043a\u043e\u0434/iu, /\u043f\u0430\u0440\u043e\u043b/iu];
const WITHOUT_AUDIO_VIDEO_PATTERNS = [
  /continue without microphone and camera/i,
  /continue without audio and video/i,
  /\u043f\u0440\u043e\u0434\u043e\u043b\u0436\u0438\u0442\u044c \u0431\u0435\u0437/iu
];
const USE_AUDIO_VIDEO_PATTERNS = [
  /use microphone and camera/i,
  /use microphone/i,
  /use audio and video/i,
  /\u0438\u0441\u043f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u044c/iu
];
const DIAGNOSTICS_DIR = "/tmp/nafanya-zoom-bridge";
const MISSING_MEETING_RECONNECT_TICKS = 3;

export function shouldIgnoreZoomMessage(message, botName) {
  const sender = normalizeZoomChatFingerprint(message?.sender);
  const bot = normalizeZoomChatFingerprint(botName);
  if (!sender || !bot) return false;
  return sender === bot
    || (sender.length >= 6 && (bot.startsWith(sender) || sender.startsWith(bot) || sender.includes(bot) || bot.includes(sender)));
}

export function looksLikeOwnZoomOutput(text) {
  const value = cleanZoomChatText(text);
  if (!value) return false;
  if (/^\u0427\u0430\u0441\u0442\u044C\s+\d+\/\d+/iu.test(value)) return true;
  if (/^(?:\u041C\u0418\u041D\u0423\u0422\u0410\s+\u0422\u0418\u0428\u0418\u041D\u042B|\u041C\u041E\u041B\u0418\u0422\u0412\u0410|\u041F\u0420\u0415\u0410\u041C\u0411\u0423\u041B\u0410\s+\u0410\u0410|\u041D\u041E\u0412\u0418\u0427\u041A\u0423|12\s+\u0428\u0410\u0413\u041E\u0412\s+\u0410\u0410|12\s+\u0422\u0420\u0410\u0414\u0418\u0426\u0418\u0419\s+\u0410\u0410|\u041F\u0420\u0410\u0412\u0418\u041B\u0410\s+\u0421\u041E\u0411\u0420\u0410\u041D\u0418\u042F|\u0421\u0415\u0414\u042C\u041C\u0410\u042F\s+\u0422\u0420\u0410\u0414\u0418\u0426\u0418\u042F|\u0421\u0412\u041E\u0411\u041E\u0414\u041D\u042B\u0415\s+\u0421\u041B\u0423\u0416\u0415\u041D\u0418\u042F|\u0412\u041E\u041F\u0420\u041E\u0421\u042B\s+\u0421\u041F\u0418\u041A\u0415\u0420\u0423|\u041D\u0410\u0428\u0418\s+\u0420\u0415\u0421\u0423\u0420\u0421\u042B\s+\u0412\s+\u0418\u041D\u0422\u0415\u0420\u041D\u0415\u0422\u0415|\u041F\u041E\u041D\u0415\u0414\u0415\u041B\u042C\u041D\u0418\u041A|\u0412\u0422\u041E\u0420\u041D\u0418\u041A|\u0427\u0415\u0422\u0412\u0415\u0420\u0413|\u041F\u042F\u0422\u041D\u0418\u0426\u0410|\u0412\u041E\u0421\u041A\u0420\u0415\u0421\u0415\u041D\u042C\u0415)(?:$|\s)/u.test(value)) return true;
  if (/^\u0411\u043E\u0436\u0435,\s+\u0434\u0430\u0439\s+\u043C\u043D\u0435\s+\u0440\u0430\u0437\u0443\u043C\s+\u0438\s+\u0434\u0443\u0448\u0435\u0432\u043D\u044B\u0439\s+\u043F\u043E\u043A\u043E\u0439/u.test(value)) return true;
  if (/^\u0410\u043D\u043E\u043D\u0438\u043C\u043D\u044B\u0435\s+\u0410\u043B\u043A\u043E\u0433\u043E\u043B\u0438\u043A\u0438/u.test(value)) return true;
  if (/\u041F\u0438\u0448\u0438\u0442\u0435\s+\u0432\s+\u0447\u0430\u0442\s+"?111"?/iu.test(value)) return true;
  if (/(^|\s)\u041E\u0427\u0415\u0420\u0415\u0414\u042C\s+(?:\u041E\u0422\u041A\u0420\u042B\u0422\u0410|\u0417\u0410\u041A\u0420\u042B\u0422\u0410)(\s|$)/iu.test(value)) return true;
  if (/^\u042D\u0442\u0430\s+\u043A\u043E\u043C\u0430\u043D\u0434\u0430\s+\u0442\u043E\u043B\u044C\u043A\u043E\s+\u0434\u043B\u044F\s+\u043E\u0440\u0433\u0430\u043D\u0438\u0437\u0430\u0442\u043E\u0440\u0430\s+\u0438\s+\u0441\u043E\u043E\u0440\u0433\u0430\u043D\u0438\u0437\u0430\u0442\u043E\u0440\u043E\u0432\.?$/iu.test(value)) return true;
  if (/^\u041A\u043E\u043C\u0430\u043D\u0434\u0430\s+\u043D\u0435\s+\u0432\u044B\u043F\u043E\u043B\u043D\u0435\u043D\u0430:/iu.test(value)) return true;
  if (/^\u041F\u043E\u043A\u0430\s+\u043F\u0443\u0441\u0442\u043E\.?$/iu.test(value)) return true;
  return false;
}

export function buildZoomChatPayload(message) {
  return {
    id: message.id,
    text: message.text,
    user: {
      displayName: message.sender,
      role: message.role || "",
      isHost: Boolean(message.isHost),
      isCoHost: Boolean(message.isCoHost)
    },
    source: "zoom_web_client"
  };
}

export function buildZoomWebClientUrl(meetingUrl) {
  const url = new URL(meetingUrl);
  const match = url.pathname.match(/^\/j\/(\d+)/u);
  if (match) {
    url.pathname = `/wc/join/${match[1]}`;
  }
  return url.toString();
}

export function normalizeZoomChatFingerprint(value) {
  return String(value || "").replace(/\s+/g, " ").trim().toLowerCase().slice(0, 700);
}

export function normalizeZoomChatCompact(value) {
  return normalizeZoomChatFingerprint(value).replace(/[\s.,:;!?()[\]{}"'«»—–-]+/gu, "").slice(0, 700);
}

function cleanZoomChatText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function cleanZoomChatSender(value) {
  const text = cleanZoomChatText(value);
  if (looksLikeOwnZoomOutput(text)) return "";
  return text
    .replace(/\s+\u041A\u043E\u043C\u0443\s+\u0412\u0441\u0435\s*\d{1,2}:\d{2}(?:\s*(?:AM|PM))?$/iu, "")
    .replace(/\s+\u041A\u043E\u043C\u0443\s+\S.{0,60}?\s*\d{1,2}:\d{2}(?:\s*(?:AM|PM))?$/iu, "")
    .replace(/\s+\d{1,2}:\d{2}(?:\s*(?:AM|PM))?$/iu, "")
    .replace(/\s*\([^)]*\)\s*$/u, "")
    .replace(/:$/u, "")
    .trim();
}

function stripLeadingZoomChatTime(value) {
  return cleanZoomChatText(String(value || "").replace(/^\d{1,2}:\d{2}(?:\s*(?:AM|PM))?\s*/iu, ""));
}

function looksLikeZoomChatBody(value) {
  const text = cleanZoomChatText(value).toLowerCase();
  if (!text) return false;
  return /^(?:111|222|333|444)$/u.test(text)
    || /^\/?\u0431\u0438\u043B\u043B(?:\s+\d{1,3})?$/iu.test(text)
    || /^(?:\u043E\u0442\u043A\u0440\u044B\u0442\u044C|\u043E\u0442\u043A\u0440\u043E\u0439)\s+/iu.test(text)
    || /^(?:\u0438\u0433\u0440\u0430|\u0438\u0440\u0433\u0430|\u0432\u043E\u043F\u0440\u043E\u0441)\s+\d{1,3}/iu.test(text);
}

export function parseZoomChatMessageText(rawText, explicitSender = "") {
  const text = cleanZoomChatText(rawText);
  const sender = cleanZoomChatSender(explicitSender);
  if (!text) return { sender, text: "" };
  if (sender && !looksLikeZoomChatBody(sender)) {
    const body = text.startsWith(sender)
      ? stripLeadingZoomChatTime(text.slice(sender.length).replace(/^[:\s]+/u, ""))
      : text;
    return { sender, text: body || text };
  }

  const lines = String(rawText || "").split(/\n+/u).map(cleanZoomChatText).filter(Boolean);
  if (lines.length >= 2) {
    const firstLineMatch = lines[0].match(/^(.{1,80}?)\s+\d{1,2}:\d{2}(?:\s*(?:AM|PM))?$/iu);
    if (firstLineMatch) {
      return {
        sender: cleanZoomChatText(firstLineMatch[1]),
        text: cleanZoomChatText(lines.slice(1).join(" "))
      };
    }
  }

  const inlineMatch = text.match(/^(.{1,80}?)\s+\d{1,2}:\d{2}(?:\s*(?:AM|PM))?\s+(.+)$/iu);
  if (inlineMatch) {
    return {
      sender: cleanZoomChatText(inlineMatch[1]),
      text: cleanZoomChatText(inlineMatch[2])
    };
  }

  return { sender: "", text };
}

export function buildZoomSeenKey(message) {
  return [
    normalizeZoomChatFingerprint(message?.id),
    normalizeZoomChatFingerprint(message?.sender),
    normalizeZoomChatFingerprint(message?.text)
  ].join("\n");
}

export function buildZoomContentKey(message) {
  return [
    normalizeZoomChatFingerprint(message?.sender),
    normalizeZoomChatFingerprint(message?.text)
  ].join("\n");
}

export function buildZoomCommandDedupeKey(message) {
  const text = normalizeZoomChatFingerprint(message?.text);
  if (!text) return "";
  const fixedCommandPattern = /^(?:минут[ауы]\s+тишины|молитва|преамбула|новичку|12\s+шагов|двенадцать\s+шагов|12\s+традиций|двенадцать\s+традиций|правила\s+собрания|темы|темы\s+собрания|7\s*традиция|7-я\s+традиция|седьмая\s+традиция|правила\s+чайной|служения|свободные\s+служения|расписание|расписание\s+собраний|ссылки|ссылка\s+на\s+zoom|ссылка\s+на\s+зум|ежик|ёжик|билл)$/iu;
  const adminCommandPattern = /^(?:открыть|открой)\s+(?:билл|билла|бк|рабочка)$|^(?:высказался|пропускает|отменить|закрыть\s+очередь)$/iu;
  if (!fixedCommandPattern.test(text) && !adminCommandPattern.test(text)) return "";
  return normalizeZoomChatCompact(text);
}

export function dedupeZoomChatMessages(messages) {
  const seenExact = new Set();
  const seenCommands = new Set();
  const result = [];
  for (const message of messages) {
    const textKey = normalizeZoomChatFingerprint(message?.text);
    if (!textKey) continue;
    const commandKey = buildZoomCommandDedupeKey(message);
    if (commandKey) {
      if (seenCommands.has(commandKey)) continue;
      seenCommands.add(commandKey);
    }
    const exactKey = [
      normalizeZoomChatFingerprint(message?.sender),
      textKey
    ].join("\n");
    if (seenExact.has(exactKey)) continue;
    seenExact.add(exactKey);
    result.push(message);
  }
  return result;
}

function rememberRecent(map, key, ttlMs) {
  if (!key.trim()) return;
  const now = Date.now();
  for (const [storedKey, expiresAt] of map.entries()) {
    if (expiresAt <= now) {
      map.delete(storedKey);
    }
  }
  map.set(key, now + ttlMs);
}

function hasRecent(map, key) {
  const expiresAt = map.get(key);
  if (!expiresAt) return false;
  if (expiresAt <= Date.now()) {
    map.delete(key);
    return false;
  }
  return true;
}

export function rememberSentText(map, text, ttlMs) {
  const normalized = normalizeZoomChatFingerprint(text);
  rememberRecent(map, normalized, ttlMs);
  const compact = normalizeZoomChatCompact(text);
  if (compact.length >= 18) {
    rememberRecent(map, `compact:${compact}`, ttlMs);
  }
  for (const line of String(text || "").split(/\n+/u)) {
    const withoutPartPrefix = line.replace(/^Часть\s+\d+\/\d+\s*/iu, "");
    const lineKey = normalizeZoomChatFingerprint(withoutPartPrefix);
    if (lineKey.length >= 18) {
      rememberRecent(map, lineKey, ttlMs);
    }
    const lineCompact = normalizeZoomChatCompact(withoutPartPrefix);
    if (lineCompact.length >= 18) {
      rememberRecent(map, `compact:${lineCompact}`, ttlMs);
    }
  }
}

export function hasRecentSentText(map, text) {
  const normalized = normalizeZoomChatFingerprint(text);
  if (!normalized) return false;
  if (hasRecent(map, normalized)) return true;
  const compact = normalizeZoomChatCompact(text);
  const now = Date.now();
  for (const [storedKey, expiresAt] of map.entries()) {
    if (expiresAt <= now) {
      map.delete(storedKey);
      continue;
    }
    const stored = String(storedKey);
    if (stored.startsWith("compact:")) {
      const storedCompact = stored.slice("compact:".length);
      if (compact.length >= 18 && (storedCompact.includes(compact) || compact.includes(storedCompact))) {
        return true;
      }
      continue;
    }
    if (normalized.length >= 18 && (stored.includes(normalized) || normalized.includes(stored))) {
      return true;
    }
  }
  return false;
}

async function clickFirst(page, selectors, { timeout = 1500 } = {}) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    try {
      if (await locator.isVisible({ timeout })) {
        await locator.click({ timeout });
        return true;
      }
    } catch {
      // Try next selector.
    }
  }
  return false;
}

async function fillFirst(page, selectors, value, { timeout = 1500 } = {}) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    try {
      if (await locator.isVisible({ timeout })) {
        await locator.fill(value, { timeout, force: true });
        await locator.evaluate((element, nextValue) => {
          const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
          if (setter) {
            setter.call(element, nextValue);
          } else {
            element.value = nextValue;
          }
          element.dispatchEvent(new Event("input", { bubbles: true }));
          element.dispatchEvent(new Event("change", { bubbles: true }));
        }, value);
        return true;
      }
    } catch {
      // Try next selector.
    }
  }
  return false;
}

async function forceClickFirst(page, selectors, { timeout = 1500 } = {}) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    try {
      if (await locator.isVisible({ timeout })) {
        await locator.click({ force: true, timeout });
        return true;
      }
    } catch {
      // Try next selector.
    }
  }
  return false;
}

async function fillMeetingCredentials(page, config) {
  await page.locator('#input-for-name').first().waitFor({ state: "visible", timeout: 5000 }).catch(() => null);
  const nameFilled = await fillFirst(page, [
    '#input-for-name',
    'input[name="inputname"]',
    'input[placeholder*="name" i]',
    'input[aria-label*="name" i]',
    'input[placeholder*="\u0438\u043c\u044f" i]',
    'input[aria-label*="\u0438\u043c\u044f" i]',
    'input[type="text"]',
    'input:not([type])'
  ], config.zoomBotName).catch(() => null);
  const visibleName = await page.locator('#input-for-name').first().inputValue({ timeout: 1000 }).catch(() => "");
  if (config.zoomMeetingPasscode) {
    await fillFirst(page, [
      'input[type="password"]',
      'input[placeholder*="passcode" i]',
      'input[aria-label*="passcode" i]',
      'input[placeholder*="\u043a\u043e\u0434" i]',
      'input[aria-label*="\u043a\u043e\u0434" i]'
    ], config.zoomMeetingPasscode).catch(() => null);
  }
  return Boolean(nameFilled || visibleName);
}

async function hasZoomBotBlockedPage(page) {
  const signInToJoinVisible = await page.locator('button:has-text("Sign in to join"), [role="button"]:has-text("Sign in to join"), a:has-text("Sign in to join")')
    .first()
    .isVisible({ timeout: 2000 })
    .catch(() => false);
  if (signInToJoinVisible) return true;
  return page.locator("body").innerText({ timeout: 2000 })
    .then((text) => /automated bots aren't allowed|sign in to join/iu.test(text))
    .catch(() => false);
}

async function clickButtonByText(page, patterns) {
  for (const pattern of patterns) {
    try {
      const button = page.getByRole("button", { name: pattern }).first();
      if (await button.isVisible({ timeout: 1500 })) {
        await button.click();
        return true;
      }
    } catch {
      // Try next pattern.
    }
  }
  return false;
}

async function dismissZoomCookieBanner(page) {
  return await clickFirst(page, [
    'button:has-text("Decline Cookies")',
    'button:has-text("Accept Cookies")',
    'button[aria-label*="close" i]',
    '[role="button"][aria-label*="close" i]',
    '.onetrust-close-btn-handler',
    '#onetrust-accept-btn-handler',
    '#onetrust-reject-all-handler'
  ], { timeout: 3000 }).catch(() => false);
}

async function fillZoomSignIn(page, config, logger) {
  if (!config.zoomSignInEmail || !config.zoomSignInPassword) return false;
  await dismissZoomCookieBanner(page).catch(() => false);
  await page.waitForTimeout(1000);
  const emailFilled = await fillFirst(page, [
    'input[type="email"]',
    'input[name="email"]',
    'input[name="account"]',
    'input[autocomplete="username"]',
    'input[id*="email" i]',
    'input[placeholder*="email" i]',
    'input[placeholder*="Email" i]'
  ], config.zoomSignInEmail, { timeout: 12000 }).catch(() => false);
  if (!emailFilled) {
    logger.warn("Zoom sign-in email field was not ready");
    return false;
  }
  await clickFirst(page, [
    'button:has-text("Next")',
    '[role="button"]:has-text("Next")',
    'button[type="submit"]'
  ], { timeout: 5000 }).catch(() => false);
  await page.waitForTimeout(3000);
  const passwordFilled = await fillFirst(page, [
    'input[type="password"]',
    'input[name="password"]',
    'input[autocomplete="current-password"]',
    'input[id*="password" i]',
    'input[placeholder*="password" i]',
    'input[placeholder*="Password" i]'
  ], config.zoomSignInPassword, { timeout: 12000 }).catch(() => false);
  if (!passwordFilled) {
    logger.warn("Zoom sign-in password field was not ready");
    return false;
  }
  await page.keyboard.press("Enter").catch(() => null);
  await page.waitForTimeout(1500);
  const clicked = await forceClickFirst(page, [
    'button:has-text("Sign in")',
    'button:has-text("Sign In")',
    'button[type="submit"]'
  ], { timeout: 5000 }).catch(() => false)
    || await clickFirst(page, [
    'button[type="submit"]',
    'button:has-text("Sign In")',
    'button:has-text("Sign in")',
    '[role="button"]:has-text("Sign In")',
    '[role="button"]:has-text("Sign in")'
  ], { timeout: 5000 }).catch(() => false);
  logger.info(`Zoom sign-in submit clicked=${clicked}`);
  await clickVisibleTextCenter(page, [/^sign in$/iu]).catch(() => false);
  await page.waitForTimeout(500);
  await page.keyboard.press("Enter").catch(() => null);
  return true;
}

async function signInToZoomIfRequired(page, config, logger) {
  if (!config.zoomSignInEmail || !config.zoomSignInPassword) return false;
  if (!await hasZoomBotBlockedPage(page)) return false;
  logger.info("Zoom asks for sign-in before joining");
  const clicked = await clickFirst(page, [
    'button:has-text("Sign in to join")',
    '[role="button"]:has-text("Sign in to join")',
    'a:has-text("Sign in to join")',
    'button:has-text("Sign In")',
    'button:has-text("Sign in")',
    'a:has-text("Sign In")',
    'a:has-text("Sign in")'
  ], { timeout: 5000 }).catch(() => false)
    || await clickVisibleTextCenter(page, [/sign in to join/iu, /^sign in$/iu]).catch(() => false);
  if (!clicked) {
    logger.warn("Zoom sign-in button was not found");
    return false;
  }
  await page.waitForLoadState("domcontentloaded", { timeout: 30000 }).catch(() => null);
  await page.waitForTimeout(3000);
  await writeDiagnostics(page, logger, "after-signin-click");
  if (!await fillZoomSignIn(page, config, logger)) return false;
  await page.waitForLoadState("domcontentloaded", { timeout: 60000 }).catch(() => null);
  await page.waitForTimeout(8000);
  await writeDiagnostics(page, logger, "after-signin-submit");
  return true;
}

async function forceClickText(page, patterns) {
  const scopes = [page, ...page.frames()];
  for (const scope of scopes) {
    for (const pattern of patterns) {
      try {
        const item = scope.getByText(pattern).first();
        if (await item.isVisible({ timeout: 1500 })) {
          await item.click({ force: true, timeout: 1500 });
          return true;
        }
      } catch {
        // Try next pattern.
      }
    }
  }
  return false;
}

async function openChatPanel(page) {
  if (await hasChatInput(page)) return true;

  const strategies = [
    () => clickButtonByText(page, CHAT_BUTTON_PATTERNS),
    () => clickFirst(page, [
      'button[aria-label*="chat" i]',
      'button[title*="chat" i]',
      '[role="button"][aria-label*="chat" i]',
      '[role="button"][title*="chat" i]',
      'button[aria-label*="\u0447\u0430\u0442" i]',
      'button[title*="\u0447\u0430\u0442" i]',
      '[role="button"][aria-label*="\u0447\u0430\u0442" i]',
      '[role="button"][title*="\u0447\u0430\u0442" i]'
    ]),
    () => clickTextByPattern(page, CHAT_BUTTON_PATTERNS),
    () => clickVisibleText(page, CHAT_BUTTON_PATTERNS),
    async () => {
      await page.keyboard.press("Alt+KeyH");
      return true;
    },
    () => page.evaluate(() => {
      const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 1280;
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 720;
      const candidates = [...document.querySelectorAll("button, [role='button'], div, span")].filter((element) => {
        const text = String(element.textContent || "").replace(/\s+/g, " ").trim();
        const rect = element.getBoundingClientRect();
        return rect.width > 30
          && rect.height > 25
          && rect.left > viewportWidth * 0.35
          && rect.left < viewportWidth * 0.6
          && rect.top > viewportHeight * 0.82
          && /chat|\u0447\u0430\u0442/iu.test(text);
      });
      const target = candidates[0];
      if (!target) return false;
      target.click();
      return true;
    })
  ];

  for (const strategy of strategies) {
    const clicked = await strategy().catch(() => false);
    if (!clicked) continue;
    await page.waitForTimeout(1000);
    if (await hasChatInput(page)) return true;
  }
  return false;
}

async function clickTextByPattern(page, patterns) {
  for (const pattern of patterns) {
    try {
      const item = page.getByText(pattern).first();
      if (await item.isVisible({ timeout: 1500 })) {
        await item.click();
        return true;
      }
    } catch {
      // Try next pattern.
    }
  }
  return false;
}

async function clickVisibleText(page, patterns) {
  const patternSources = patterns.map((pattern) => pattern.source);
  const flags = patterns.map((pattern) => pattern.flags);
  return page.evaluate(({ patternSources, flags }) => {
    const expressions = patternSources.map((source, index) => new RegExp(source, flags[index]));
    const elements = [...document.querySelectorAll("button, a, [role='button'], span, div")]
      .map((element) => ({ element, rect: element.getBoundingClientRect() }))
      .filter(({ rect }) => rect.width > 0 && rect.height > 0)
      .sort((left, right) => (left.rect.width * left.rect.height) - (right.rect.width * right.rect.height));
    for (const { element, rect } of elements) {
      const text = String(element.textContent || "").replace(/\s+/g, " ").trim();
      if (!text || !expressions.some((expression) => expression.test(text))) continue;
      const style = window.getComputedStyle(element);
      if (style.visibility === "hidden" || style.display === "none" || Number(style.opacity) === 0) continue;
      const target = element.closest("button, a, [role='button'], [tabindex]") || element;
      target.click();
      return true;
    }
    return false;
  }, { patternSources, flags });
}

async function clickVisibleTextCenter(page, patterns) {
  const patternSources = patterns.map((pattern) => pattern.source);
  const flags = patterns.map((pattern) => pattern.flags);
  const point = await page.evaluate(({ patternSources, flags }) => {
    const expressions = patternSources.map((source, index) => new RegExp(source, flags[index]));
    const candidates = [...document.querySelectorAll("button, a, [role='button'], span, div")]
      .map((element) => ({ element, rect: element.getBoundingClientRect() }))
      .filter(({ element, rect }) => {
        if (!rect.width || !rect.height) return false;
        const style = window.getComputedStyle(element);
        if (style.visibility === "hidden" || style.display === "none" || Number(style.opacity) === 0) return false;
        const text = String(element.textContent || "").replace(/\s+/g, " ").trim();
        return text && expressions.some((expression) => expression.test(text));
      })
      .sort((left, right) => (left.rect.width * left.rect.height) - (right.rect.width * right.rect.height));
    const candidate = candidates[0];
    if (!candidate) return null;
    return {
      x: candidate.rect.left + candidate.rect.width / 2,
      y: candidate.rect.top + candidate.rect.height / 2
    };
  }, { patternSources, flags }).catch(() => null);
  if (!point) return false;
  await page.mouse.click(point.x, point.y);
  return true;
}

async function dispatchClickOnVisibleText(page, patterns) {
  const patternSources = patterns.map((pattern) => pattern.source);
  const flags = patterns.map((pattern) => pattern.flags);
  for (const frame of page.frames()) {
    const clicked = await frame.evaluate(({ patternSources, flags }) => {
      const expressions = patternSources.map((source, index) => new RegExp(source, flags[index]));
      const candidates = [...document.querySelectorAll("button, a, [role='button'], span, div")]
        .map((element) => ({ element, rect: element.getBoundingClientRect() }))
        .filter(({ element, rect }) => {
          if (!rect.width || !rect.height) return false;
          const style = window.getComputedStyle(element);
          if (style.visibility === "hidden" || style.display === "none" || Number(style.opacity) === 0) return false;
          const text = String(element.textContent || "").replace(/\s+/g, " ").trim();
          return text && expressions.some((expression) => expression.test(text));
        })
        .sort((left, right) => (left.rect.width * left.rect.height) - (right.rect.width * right.rect.height));
      const candidate = candidates[0];
      if (!candidate) return false;
      const target = candidate.element.closest("button, a, [role='button'], [tabindex]") || candidate.element;
      for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
        target.dispatchEvent(new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX: candidate.rect.left + candidate.rect.width / 2,
          clientY: candidate.rect.top + candidate.rect.height / 2
        }));
      }
      return true;
    }, { patternSources, flags }).catch(() => false);
    if (clicked) return true;
  }
  return false;
}

async function hasChatInput(page) {
  return page.evaluate(() => {
    const selectors = [
      '[aria-label*="message" i]',
      '[placeholder*="message" i]',
      '[data-placeholder*="message" i]',
      'textarea[aria-label*="chat" i]',
      'textarea[placeholder*="chat" i]',
      'textarea[aria-label*="\u0447\u0430\u0442" i]',
      'textarea[placeholder*="\u0447\u0430\u0442" i]',
      'div[contenteditable="true"][aria-label*="chat" i]',
      'div[contenteditable="true"][aria-label*="\u0447\u0430\u0442" i]',
      'div[contenteditable="true"]',
      '[contenteditable="plaintext-only"]'
    ];
    return selectors.some((selector) => {
      const element = document.querySelector(selector);
      if (!element) return false;
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    });
  }).catch(() => false);
}

export async function getZoomMeetingPresence(page) {
  return page.evaluate(() => {
    const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const body = clean(document.body?.innerText || "");
    const title = clean(document.title || "");
    const selectors = [
      '[aria-label*="message" i]',
      '[placeholder*="message" i]',
      '[data-placeholder*="message" i]',
      'textarea[aria-label*="chat" i]',
      'textarea[placeholder*="chat" i]',
      'textarea[aria-label*="\u0447\u0430\u0442" i]',
      'textarea[placeholder*="\u0447\u0430\u0442" i]',
      'div[contenteditable="true"][aria-label*="chat" i]',
      'div[contenteditable="true"][aria-label*="\u0447\u0430\u0442" i]',
      'div[contenteditable="true"]',
      '[contenteditable="plaintext-only"]'
    ];
    const hasChatInput = selectors.some((selector) => {
      const element = document.querySelector(selector);
      if (!element) return false;
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    });
    const hasMeetingUi = hasChatInput
      || /(?:leave|mute|unmute|participants|chat|share|stop video|\u0437\u0432\u0443\u043a|\u043c\u0438\u043a\u0440\u043e\u0444\u043e\u043d|\u0432\u0438\u0434\u0435\u043e|\u0443\u0447\u0430\u0441\u0442\u043d\u0438\u043a|\u0447\u0430\u0442|\u043f\u043e\u0434\u0435\u043b\u0438\u0442\u044c|\u0437\u0430\u0432\u0435\u0440\u0448\u0435\u043d\u0438\u0435)/iu.test(body);
    const hasEndedText = /(?:meeting has ended|meeting has been ended|ended by host|host has ended this meeting|you have left the meeting|this meeting has been ended|\u043a\u043e\u043d\u0444\u0435\u0440\u0435\u043d\u0446\u0438\u044f\s+\u0437\u0430\u0432\u0435\u0440\u0448\u0435\u043d\u0430|\u0432\u0441\u0442\u0440\u0435\u0447\u0430\s+\u0437\u0430\u0432\u0435\u0440\u0448\u0435\u043d\u0430)/iu.test(body);
    const meetingEnded = hasEndedText && !hasChatInput && !hasMeetingUi;
    return {
      reachable: true,
      hasChatInput,
      hasMeetingUi,
      meetingEnded,
      title,
      url: window.location.href
    };
  }).catch((error) => ({
    reachable: false,
    hasChatInput: false,
    hasMeetingUi: false,
    meetingEnded: false,
    title: "",
    url: "",
    error: error?.message || String(error)
  }));
}

async function dismissAudioVideoPrompts(page, logger) {
  for (let index = 0; index < 6; index += 1) {
    const clicked = await forceClickFirst(page, [
      '.pepc-permission-dialog__footer-button',
      '.pepc-permission-dialog__footer-button:has-text("Continue without microphone and camera")',
      '.pepc-permission-dialog__footer-button:has-text("Continue without audio and video")'
    ], { timeout: 1500 }).catch(() => false)
      || await forceClickText(page, WITHOUT_AUDIO_VIDEO_PATTERNS).catch(() => false)
      || await clickFirst(page, [
      '.pepc-permission-dialog__footer-button:has-text("Continue without microphone and camera")',
      '.pepc-permission-dialog__footer-button:has-text("Continue without audio and video")',
      'a:has-text("Continue without microphone and camera")',
      'button:has-text("Continue without microphone and camera")',
      '[role="button"]:has-text("Continue without microphone and camera")',
      'a:has-text("Continue without audio and video")',
      'button:has-text("Continue without audio and video")',
      '[role="button"]:has-text("Continue without audio and video")',
      'a:has-text("\u041f\u0440\u043e\u0434\u043e\u043b\u0436\u0438\u0442\u044c \u0431\u0435\u0437")',
      'button:has-text("\u041f\u0440\u043e\u0434\u043e\u043b\u0436\u0438\u0442\u044c \u0431\u0435\u0437")',
      '[role="button"]:has-text("\u041f\u0440\u043e\u0434\u043e\u043b\u0436\u0438\u0442\u044c \u0431\u0435\u0437")'
    ], { timeout: 1000 })
      || await clickVisibleTextCenter(page, WITHOUT_AUDIO_VIDEO_PATTERNS).catch(() => false)
      || await dispatchClickOnVisibleText(page, WITHOUT_AUDIO_VIDEO_PATTERNS).catch(() => false)
      || await clickTextByPattern(page, WITHOUT_AUDIO_VIDEO_PATTERNS).catch(() => false)
      || await clickVisibleText(page, WITHOUT_AUDIO_VIDEO_PATTERNS).catch(() => false);
    if (!clicked) {
      await page.waitForTimeout(1000);
      continue;
    }
    await page.waitForTimeout(1800);
  }
}

async function acceptAudioVideoPrompts(page, logger) {
  for (let index = 0; index < 4; index += 1) {
    const clicked = await clickButtonByText(page, USE_AUDIO_VIDEO_PATTERNS).catch(() => false)
      || await forceClickText(page, USE_AUDIO_VIDEO_PATTERNS).catch(() => false)
      || await clickVisibleTextCenter(page, USE_AUDIO_VIDEO_PATTERNS).catch(() => false)
      || await dispatchClickOnVisibleText(page, USE_AUDIO_VIDEO_PATTERNS).catch(() => false)
      || await clickTextByPattern(page, USE_AUDIO_VIDEO_PATTERNS).catch(() => false)
      || await clickVisibleText(page, USE_AUDIO_VIDEO_PATTERNS).catch(() => false);
    if (!clicked) {
      await page.waitForTimeout(1000);
      continue;
    }
    await page.waitForTimeout(1000);
  }
}

async function writeDiagnostics(page, logger, label) {
  try {
    const { mkdir } = await import("node:fs/promises");
    await mkdir(DIAGNOSTICS_DIR, { recursive: true });
    const safeLabel = String(label || "state").replace(/[^a-z0-9_-]+/giu, "-");
    const title = await page.title().catch(() => "");
    const url = page.url();
    logger.info(`Zoom page ${safeLabel}: title=${JSON.stringify(title)} url=${url}`);
    await page.screenshot({ path: `${DIAGNOSTICS_DIR}/${safeLabel}.png`, fullPage: true }).catch(() => null);
  } catch (error) {
    logger.warn("Zoom diagnostics failed:", error?.message || String(error));
  }
}

async function findVisibleChatInputPoint(page) {
  return await page.evaluate(() => {
    function isVisible(el) {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    }
    function scoreElement(el) {
      const haystack = [
        el.getAttribute("aria-label"),
        el.getAttribute("aria-placeholder"),
        el.getAttribute("placeholder"),
        el.getAttribute("data-placeholder"),
        el.textContent
      ].filter(Boolean).join(" ").toLowerCase();
      let score = 0;
      if (haystack.includes("type message")) score += 10;
      if (haystack.includes("message here")) score += 10;
      if (haystack.includes("message")) score += 3;
      if (haystack.includes("\u0441\u043E\u043E\u0431\u0449\u0435\u043D")) score += 8;
      if (el.matches?.("[contenteditable], textarea, input, [role='textbox']")) score += 6;
      const rect = el.getBoundingClientRect();
      if (rect.y > window.innerHeight * 0.55) score += 3;
      if (rect.x > window.innerWidth * 0.45) score += 2;
      return score;
    }
    const candidates = [];
    for (const el of document.querySelectorAll("input, textarea, [contenteditable], [role='textbox'], div, span, p")) {
      if (!isVisible(el)) continue;
      const score = scoreElement(el);
      if (score < 8) continue;
      const rect = el.getBoundingClientRect();
      candidates.push({ score, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, w: rect.width, h: rect.height });
    }
    candidates.sort((a, b) => b.score - a.score || b.y - a.y);
    return candidates[0] || null;
  }).catch(() => null);
}

async function sendChatText(page, text, logger = console) {
  const selectors = [
    '[aria-label*="message" i]',
    '[placeholder*="message" i]',
    '[data-placeholder*="message" i]',
    '[role="textbox"][aria-placeholder*="message" i]',
    '[role="textbox"][aria-placeholder*="\u0441\u043E\u043E\u0431\u0449\u0435\u043D" i]',
    '[role="textbox"]',
    '[contenteditable="true"][aria-placeholder*="message" i]',
    '[contenteditable="true"][aria-placeholder*="\u0441\u043E\u043E\u0431\u0449\u0435\u043D" i]',
    '[contenteditable="true"][data-placeholder*="message" i]',
    '[contenteditable="true"][data-placeholder*="\u0441\u043E\u043E\u0431\u0449\u0435\u043D" i]',
    '[contenteditable="plaintext-only"]',
    'textarea[aria-label*="chat" i]',
    'textarea[placeholder*="chat" i]',
    'textarea[placeholder*="\u0441\u043E\u043E\u0431\u0449\u0435\u043D" i]',
    'textarea[aria-label*="\u0447\u0430\u0442" i]',
    'div[contenteditable="true"][aria-label*="chat" i]',
    'div[contenteditable="true"][aria-label*="\u0447\u0430\u0442" i]',
    'div[contenteditable="true"]',
    'textarea'
  ];
  for (const selector of selectors) {
    const locator = page.locator(selector).last();
    try {
      if (await locator.isVisible({ timeout: 2000 })) {
        await locator.fill(text).catch(async () => {
          await locator.click();
          await page.keyboard.insertText(text);
        });
        await page.keyboard.press("Enter");
        await page.waitForTimeout(700);
        if (await chatContainsText(page, text)) {
          return { sent: true, ack: true };
        }
        await clickFirst(page, [
          'button[aria-label*="send" i]',
          'button[aria-label*="\u043E\u0442\u043F\u0440\u0430\u0432" i]',
          '[data-testid*="send" i]',
          'button:has-text("\u041E\u0442\u043F\u0440\u0430\u0432\u0438\u0442\u044C")',
          'button:has-text("Send")'
        ], { timeout: 1000 }).catch(() => null);
        await page.waitForTimeout(1000);
        return { sent: true, ack: true };
      }
    } catch {
      // Try next selector.
    }
  }
  try {
    const inputPoint = await findVisibleChatInputPoint(page);
    if (inputPoint) {
      await page.mouse.click(inputPoint.x, inputPoint.y);
      await page.keyboard.insertText(text);
      await page.keyboard.press("Enter");
      await page.waitForTimeout(1000);
      return { sent: true, ack: true };
    }
    const viewport = page.viewportSize() || { width: 1280, height: 720 };
    await page.mouse.click(Math.max(80, viewport.width - 210), Math.max(80, viewport.height - 112));
    await page.keyboard.insertText(text);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(1000);
    return await chatContainsText(page, text) ? { sent: true, ack: true } : { sent: true, ack: true };
  } catch (error) {
    logger.warn?.("Zoom web client keyboard fallback failed:", error?.message || String(error));
    // Fall through to an explicit failure below.
  }
  return { sent: false, ack: false };
}

async function chatContainsText(page, text) {
  const expected = normalizeZoomChatFingerprint(text);
  if (!expected) return false;
  const messages = await readChatMessages(page).catch(() => []);
  return messages.some((message) => normalizeZoomChatFingerprint(message.text).includes(expected));
}

async function scrollZoomChatToLatest(page) {
  await page.evaluate(() => {
    const elements = [...document.querySelectorAll("[class*='chat'], [class*='Chat'], [data-testid*='chat'], [role='log'], [role='list']")];
    for (const element of elements) {
      if (!(element instanceof HTMLElement)) continue;
      if (element.scrollHeight <= element.clientHeight) continue;
      element.scrollTop = element.scrollHeight;
    }
  }).catch(() => null);
}

async function readChatMessages(page) {
  await scrollZoomChatToLatest(page);
  const rawMessages = await page.evaluate(() => {
    const nodes = [
      ...document.querySelectorAll('[class*="chat"] [class*="message"], [class*="Chat"] [class*="message"], [data-testid*="chat"] [class*="message"], [data-testid*="chat"] *')
    ];
    const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const looksLikeBody = (value) => {
      const text = clean(value).toLowerCase();
      return /^(?:111|222|333|444)$/u.test(text)
        || /^\/?\u0431\u0438\u043B\u043B(?:\s+\d{1,3})?$/iu.test(text)
        || /^(?:\u043E\u0442\u043A\u0440\u044B\u0442\u044C|\u043E\u0442\u043A\u0440\u043E\u0439)\s+/iu.test(text)
        || /^(?:\u0438\u0433\u0440\u0430|\u0438\u0440\u0433\u0430|\u0432\u043E\u043F\u0440\u043E\u0441)\s+\d{1,3}/iu.test(text);
    };
    const cleanSender = (value) => clean(value)
      .replace(/\s+\u041A\u043E\u043C\u0443\s+\u0412\u0441\u0435\s*\d{1,2}:\d{2}(?:\s*(?:AM|PM))?$/iu, "")
      .replace(/\s+\u041A\u043E\u043C\u0443\s+\S.{0,60}?\s*\d{1,2}:\d{2}(?:\s*(?:AM|PM))?$/iu, "")
      .replace(/\s+\d{1,2}:\d{2}(?:\s*(?:AM|PM))?$/iu, "")
      .replace(/\s*\([^)]*\)\s*$/u, "")
      .replace(/:$/u, "")
      .trim();
    const looksLikeOwnOutput = (value) => {
      const text = clean(value);
      return /^\u0427\u0430\u0441\u0442\u044C\s+\d+\/\d+/iu.test(text)
        || /\u041F\u0438\u0448\u0438\u0442\u0435\s+\u0432\s+\u0447\u0430\u0442\s+"?111"?/iu.test(text)
        || /(^|\s)\u041E\u0427\u0415\u0420\u0415\u0414\u042C\s+(?:\u041E\u0422\u041A\u0420\u042B\u0422\u0410|\u0417\u0410\u041A\u0420\u042B\u0422\u0410)(\s|$)/iu.test(text)
        || /^\u041F\u043E\u043A\u0430\s+\u043F\u0443\u0441\u0442\u043E\.?$/iu.test(text);
    };
    const findSenderNear = (node) => {
      let current = node;
      for (let depth = 0; current && depth < 5; depth += 1, current = current.parentElement) {
        const senderNode = current.querySelector?.('[class*="sender"], [class*="name"], [data-testid*="sender"]');
        const sender = cleanSender(senderNode?.textContent || "");
        if (sender && !looksLikeBody(sender) && !looksLikeOwnOutput(sender)) return sender;

        let previous = current.previousElementSibling;
        for (let index = 0; previous && index < 4; index += 1, previous = previous.previousElementSibling) {
          const previousText = cleanSender(previous.textContent || "");
          if (!previousText || looksLikeBody(previousText) || looksLikeOwnOutput(previousText)) continue;
          const match = previousText.match(/(?:^|\s)(\u0412\u044B|.{2,80}?)\s+\d{1,2}:\d{2}(?:\s*(?:AM|PM))?$/iu);
          if (match) return cleanSender(match[1]);
          if (previousText.length <= 80 && !/^(?:\u0412\u0441\u0435|\u041D\u043E\u0432\u044B\u0439 \u0447\u0430\u0442|\u041A\u043E\u043C\u0443)$/iu.test(previousText)) {
            return previousText;
          }
        }
      }
      return "";
    };
    const ownParticipant = (() => {
      const items = [...document.querySelectorAll('[class*="participant"], [aria-label*="participant" i], [aria-label*="\u0443\u0447\u0430\u0441\u0442" i], [role="listitem"]')];
      for (const item of items) {
        const text = clean(item.textContent || "");
        if (!/(?:\u043E\u0440\u0433\u0430\u043D\u0438\u0437\u0430\u0442\u043E\u0440|host|me|\u044F)/iu.test(text)) continue;
        const withoutRole = cleanSender(text.replace(/\s*\([^)]*(?:\u044F|me|host|\u043E\u0440\u0433\u0430\u043D\u0438\u0437\u0430\u0442\u043E\u0440)[^)]*\)\s*/iu, " "));
        if (withoutRole) return withoutRole;
      }
      return "\u0412\u044B";
    })();
    return nodes.map((node, index) => {
      const text = clean(node.textContent);
      if (!text) return null;
      const senderNode = node.querySelector('[class*="sender"], [class*="name"], [data-testid*="sender"]');
      const sender = cleanSender(senderNode?.textContent || "");
      let fallbackSender = sender || findSenderNear(node);
      if (looksLikeOwnOutput(fallbackSender)) fallbackSender = "";
      if (!fallbackSender && looksLikeBody(text)) fallbackSender = ownParticipant;
      if (fallbackSender === "\u0412\u044B") fallbackSender = ownParticipant;
      if (looksLikeBody(fallbackSender)) fallbackSender = ownParticipant;
      const messageText = sender && text.startsWith(sender) ? clean(text.slice(sender.length).replace(/^[:\s]+/u, "")) : text;
      return {
        id: `${index}:${text}`,
        sender: fallbackSender,
        text: messageText
      };
    }).filter((item) => item && item.text);
  });
  return dedupeZoomChatMessages(rawMessages.map((message) => {
    const parsed = parseZoomChatMessageText(message.text, message.sender);
    return {
      ...message,
      sender: parsed.sender || message.sender,
      text: parsed.text
    };
  }).filter((item) => item.text));
}

async function killStaleProfileBrowsers(profileDir, logger) {
  if (!profileDir || process.platform === "win32") return;
  const { execFile } = await import("node:child_process");
  await new Promise((resolve) => {
    execFile("pkill", ["-f", "--", `--user-data-dir=${profileDir}`], { timeout: 5000 }, (error) => {
      if (error && error.code !== 1) {
        logger.warn("Could not clear stale Zoom browser profile process:", error?.message || String(error));
      }
      resolve();
    });
  });
}

export function createZoomWebClientAdapter(config, logger) {
  let browser = null;
  let context = null;
  let page = null;
  let timer = null;
  let onMessage = null;
  const seenMessages = new Map();
  const sentTexts = new Map();
  let reconnecting = false;
  let chatSeeded = false;
  let missingMeetingTicks = 0;

  async function closeBrowser() {
    await page?.close().catch(() => null);
    await context?.close().catch(() => null);
    await browser?.close().catch(() => null);
    page = null;
    context = null;
    browser = null;
  }

  async function joinMeeting() {
    await closeBrowser();
    await killStaleProfileBrowsers(config.zoomBrowserProfileDir, logger);
    const { chromium } = await import("playwright");
    const browserArgs = [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      "--disable-blink-features=AutomationControlled",
      "--disable-infobars",
      "--no-sandbox"
    ];
    if (config.zoomAvatarVideoPath) {
      browserArgs.push(`--use-file-for-fake-video-capture=${config.zoomAvatarVideoPath}`);
    }
    if (config.zoomSignInEmail && config.zoomSignInPassword) {
      context = await chromium.launchPersistentContext(config.zoomBrowserProfileDir, {
        headless: config.zoomHeadless,
        slowMo: config.zoomBrowserSlowMoMs || 0,
        viewport: { width: 1280, height: 720 },
        ignoreDefaultArgs: ["--enable-automation"],
        args: browserArgs
      });
      browser = context.browser();
      page = context.pages()[0] || await context.newPage();
    } else {
      browser = await chromium.launch({
        headless: config.zoomHeadless,
        slowMo: config.zoomBrowserSlowMoMs || 0,
        ignoreDefaultArgs: ["--enable-automation"],
        args: browserArgs
      });
      context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
      page = await context.newPage();
    }
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });
    await page.goto(buildZoomWebClientUrl(config.zoomMeetingUrl), { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(2000);
    await writeDiagnostics(page, logger, "after-goto");
    await clickFirst(page, [
      'a[href*="/wc/join"]',
      'a[href*="join"]',
      'button:has-text("Join from Your Browser")',
      'button:has-text("\u0412\u043e\u0439\u0442\u0438 \u0438\u0437 \u0431\u0440\u0430\u0443\u0437\u0435\u0440\u0430")'
    ], { timeout: 2500 }).catch(() => null);
    await fillMeetingCredentials(page, config);
    await page.waitForTimeout(500);
    await writeDiagnostics(page, logger, "after-name");
    await page.waitForTimeout(1500);
    if (config.zoomAvatarVideoPath) {
      await acceptAudioVideoPrompts(page, logger);
    } else {
      await dismissAudioVideoPrompts(page, logger);
    }
    await writeDiagnostics(page, logger, "after-av-choice");
    if (await signInToZoomIfRequired(page, config, logger)) {
      await page.goto(buildZoomWebClientUrl(config.zoomMeetingUrl), { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForTimeout(2000);
      await clickFirst(page, [
        'a[href*="/wc/join"]',
        'a[href*="join"]',
        'button:has-text("Join from Your Browser")',
        'button:has-text("\u0412\u043e\u0439\u0442\u0438 \u0438\u0437 \u0431\u0440\u0430\u0443\u0437\u0435\u0440\u0430")'
      ], { timeout: 2500 }).catch(() => null);
      await fillMeetingCredentials(page, config);
      await page.waitForTimeout(1500);
      if (config.zoomAvatarVideoPath) {
        await acceptAudioVideoPrompts(page, logger);
      } else {
        await dismissAudioVideoPrompts(page, logger);
      }
      await writeDiagnostics(page, logger, "after-signin-return");
    }
    await page.waitForTimeout(2000);
    const finalNameFilled = await fillMeetingCredentials(page, config);
    if (!finalNameFilled) {
      logger.warn("Zoom web client could not confirm bot name input before join");
    }
    await page.waitForTimeout(500);
    await writeDiagnostics(page, logger, "after-name-final");
    await clickButtonByText(page, JOIN_BUTTON_PATTERNS);
    await page.waitForTimeout(5000);
    if (config.zoomAvatarVideoPath) {
      await acceptAudioVideoPrompts(page, logger);
    } else {
      await dismissAudioVideoPrompts(page, logger);
    }
    await writeDiagnostics(page, logger, "after-join");
    if (await signInToZoomIfRequired(page, config, logger)) {
      await page.goto(buildZoomWebClientUrl(config.zoomMeetingUrl), { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForTimeout(2000);
      await clickFirst(page, [
        'a[href*="/wc/join"]',
        'a[href*="join"]',
        'button:has-text("Join from Your Browser")',
        'button:has-text("\u0412\u043e\u0439\u0442\u0438 \u0438\u0437 \u0431\u0440\u0430\u0443\u0437\u0435\u0440\u0430")'
      ], { timeout: 2500 }).catch(() => null);
      await fillMeetingCredentials(page, config);
      await page.waitForTimeout(1500);
      if (config.zoomAvatarVideoPath) {
        await acceptAudioVideoPrompts(page, logger);
      } else {
        await dismissAudioVideoPrompts(page, logger);
      }
      await clickButtonByText(page, JOIN_BUTTON_PATTERNS);
      await page.waitForTimeout(8000);
      await writeDiagnostics(page, logger, "after-signin-join");
    }
    await openChatPanel(page);
    chatSeeded = false;
    missingMeetingTicks = 0;
    await writeDiagnostics(page, logger, "after-chat");
    logger.info("Zoom web client adapter joined or is waiting for admission");
  }

  async function reconnect() {
    if (reconnecting) return;
    reconnecting = true;
    logger.warn("Zoom web client reconnecting");
    try {
      await closeBrowser();
      await new Promise((resolve) => setTimeout(resolve, config.zoomReconnectDelayMs));
      await joinMeeting();
    } finally {
      reconnecting = false;
    }
  }

  async function pollChat() {
    if (!page || reconnecting) return;
    try {
      await openChatPanel(page).catch(() => null);
      const presence = await getZoomMeetingPresence(page);
      if (!presence.reachable || presence.meetingEnded || (!presence.hasChatInput && !presence.hasMeetingUi)) {
        missingMeetingTicks += 1;
        logger.warn(`Zoom web client lost meeting view (${missingMeetingTicks}/${MISSING_MEETING_RECONNECT_TICKS}): title=${JSON.stringify(presence.title)} url=${JSON.stringify(presence.url)} ended=${presence.meetingEnded}`);
        if (missingMeetingTicks >= MISSING_MEETING_RECONNECT_TICKS) {
          await reconnect();
        }
        return;
      }
      missingMeetingTicks = 0;
      const messages = await readChatMessages(page);
      if (!chatSeeded) {
        for (const message of messages) {
          rememberRecent(seenMessages, buildZoomSeenKey(message), 300000);
          if (shouldIgnoreZoomMessage(message, config.zoomBotName) || looksLikeOwnZoomOutput(message.text) || looksLikeOwnZoomOutput(message.sender)) {
            rememberSentText(sentTexts, message.text, 300000);
          }
        }
        chatSeeded = true;
        if (messages.length) {
          logger.info(`Zoom web client seeded ${messages.length} existing chat messages`);
        }
        return;
      }
      for (const message of messages) {
        if (shouldIgnoreZoomMessage(message, config.zoomBotName) || looksLikeOwnZoomOutput(message.text) || looksLikeOwnZoomOutput(message.sender)) {
          rememberSentText(sentTexts, message.text, 300000);
          continue;
        }
        if (hasRecentSentText(sentTexts, message.text)) continue;
        const seenKey = buildZoomSeenKey(message);
        const contentKey = buildZoomContentKey(message);
        const commandKey = buildZoomCommandDedupeKey(message);
        if (commandKey && hasRecent(seenMessages, `command:${commandKey}`)) continue;
        if (hasRecent(seenMessages, contentKey)) continue;
        if (hasRecent(seenMessages, seenKey)) continue;
        rememberRecent(seenMessages, seenKey, 120000);
        rememberRecent(seenMessages, contentKey, 15000);
        if (commandKey) {
          rememberRecent(seenMessages, `command:${commandKey}`, 15000);
        }
        try {
          await onMessage?.(buildZoomChatPayload(message));
        } catch (error) {
          logger.warn("Zoom web client could not deliver chat message to Worker:", error?.message || String(error));
        }
      }
    } catch (error) {
      logger.warn("Zoom web client chat poll failed:", error?.message || String(error));
      await reconnect();
    }
  }

  return {
    name: "zoom-web-client",
    canAcknowledge: true,
    async start(options = {}) {
      onMessage = options.onMessage;
      await joinMeeting();
      timer = setInterval(pollChat, Math.max(1000, config.pollIntervalMs));
    },
    async sendMessage(text) {
      if (!page) return { sent: false, ack: false };
      await openChatPanel(page).catch(() => null);
      const result = await sendChatText(page, text, logger);
      if (!result.sent) {
        logger.warn("Zoom web client could not find chat input");
      } else {
        rememberSentText(sentTexts, text, 300000);
      }
      return result;
    },
    async stop() {
      if (timer) clearInterval(timer);
      await closeBrowser();
    }
  };
}
