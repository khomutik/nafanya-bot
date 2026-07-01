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

export function shouldIgnoreZoomMessage(message, botName) {
  const sender = normalizeZoomChatFingerprint(message?.sender);
  const bot = normalizeZoomChatFingerprint(botName);
  if (!sender || !bot) return false;
  return sender === bot
    || (sender.length >= 6 && (bot.startsWith(sender) || sender.startsWith(bot) || sender.includes(bot) || bot.includes(sender)));
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

function stripLeadingZoomChatTime(value) {
  return cleanZoomChatText(String(value || "").replace(/^\d{1,2}:\d{2}(?:\s*(?:AM|PM))?\s*/iu, ""));
}

export function parseZoomChatMessageText(rawText, explicitSender = "") {
  const text = cleanZoomChatText(rawText);
  const sender = cleanZoomChatText(explicitSender).replace(/:$/u, "");
  if (!text) return { sender, text: "" };
  if (sender) {
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
    normalizeZoomChatFingerprint(message?.sender),
    normalizeZoomChatFingerprint(message?.text)
  ].join("\n");
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
        await locator.fill(value, { timeout });
        return true;
      }
    } catch {
      // Try next selector.
    }
  }
  return false;
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
    const elements = [...document.querySelectorAll("button, a, [role='button'], span, div")];
    for (const element of elements) {
      const text = String(element.textContent || "").replace(/\s+/g, " ").trim();
      if (!text || !expressions.some((expression) => expression.test(text))) continue;
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      const style = window.getComputedStyle(element);
      if (style.visibility === "hidden" || style.display === "none" || Number(style.opacity) === 0) continue;
      element.click();
      return true;
    }
    return false;
  }, { patternSources, flags });
}

async function hasChatInput(page) {
  return page.evaluate(() => {
    const selectors = [
      'textarea[aria-label*="chat" i]',
      'textarea[placeholder*="chat" i]',
      'textarea[aria-label*="\u0447\u0430\u0442" i]',
      'textarea[placeholder*="\u0447\u0430\u0442" i]',
      'div[contenteditable="true"][aria-label*="chat" i]',
      'div[contenteditable="true"][aria-label*="\u0447\u0430\u0442" i]',
      'div[contenteditable="true"]'
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

async function dismissAudioVideoPrompts(page) {
  for (let index = 0; index < 4; index += 1) {
    const clicked = await clickFirst(page, [
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
      || await clickTextByPattern(page, WITHOUT_AUDIO_VIDEO_PATTERNS).catch(() => false)
      || await clickVisibleText(page, WITHOUT_AUDIO_VIDEO_PATTERNS).catch(() => false);
    if (!clicked) return;
    await page.waitForTimeout(1000);
  }
}

async function acceptAudioVideoPrompts(page) {
  for (let index = 0; index < 4; index += 1) {
    const clicked = await clickButtonByText(page, USE_AUDIO_VIDEO_PATTERNS).catch(() => false)
      || await clickTextByPattern(page, USE_AUDIO_VIDEO_PATTERNS).catch(() => false)
      || await clickVisibleText(page, USE_AUDIO_VIDEO_PATTERNS).catch(() => false);
    if (!clicked) return;
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

async function sendChatText(page, text) {
  const selectors = [
    'textarea[aria-label*="chat" i]',
    'textarea[placeholder*="chat" i]',
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
        return { sent: true, ack: true };
      }
    } catch {
      // Try next selector.
    }
  }
  return { sent: false, ack: false };
}

async function readChatMessages(page) {
  const rawMessages = await page.evaluate(() => {
    const nodes = [
      ...document.querySelectorAll('[class*="chat"] [class*="message"], [class*="Chat"] [class*="message"], [data-testid*="chat"] [class*="message"], [data-testid*="chat"] *')
    ];
    const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
    return nodes.map((node, index) => {
      const text = clean(node.textContent);
      if (!text) return null;
      const senderNode = node.querySelector('[class*="sender"], [class*="name"], [data-testid*="sender"]');
      const sender = clean(senderNode?.textContent || "").replace(/:$/u, "");
      const fallbackSender = sender || clean(text.split(":")[0] || "");
      const messageText = sender && text.startsWith(sender) ? clean(text.slice(sender.length).replace(/^[:\s]+/u, "")) : text;
      return {
        id: `${index}:${text}`,
        sender: fallbackSender,
        text: messageText
      };
    }).filter((item) => item && item.text);
  });
  return rawMessages.map((message) => {
    const parsed = parseZoomChatMessageText(message.text, message.sender);
    return {
      ...message,
      sender: parsed.sender || message.sender,
      text: parsed.text
    };
  }).filter((item) => item.text);
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
    context = await chromium.launchPersistentContext(config.zoomBrowserProfileDir, {
      headless: config.zoomHeadless,
      slowMo: config.zoomBrowserSlowMoMs || 0,
      viewport: { width: 1280, height: 720 },
      ignoreDefaultArgs: ["--enable-automation"],
      args: browserArgs
    });
    browser = context.browser();
    page = context.pages()[0] || await context.newPage();
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });
    await page.goto(buildZoomWebClientUrl(config.zoomMeetingUrl), { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(2000);
    await writeDiagnostics(page, logger, "after-goto");
    if (config.zoomAvatarVideoPath) {
      await acceptAudioVideoPrompts(page);
    } else {
      await dismissAudioVideoPrompts(page);
    }
    await writeDiagnostics(page, logger, "after-av-choice");
    await clickFirst(page, [
      'a[href*="/wc/join"]',
      'a[href*="join"]',
      'button:has-text("Join from Your Browser")',
      'button:has-text("\u0412\u043e\u0439\u0442\u0438 \u0438\u0437 \u0431\u0440\u0430\u0443\u0437\u0435\u0440\u0430")'
    ], { timeout: 2500 }).catch(() => null);
    await fillFirst(page, [
      'input[name="inputname"]',
      'input[placeholder*="name" i]',
      'input[aria-label*="name" i]',
      'input[placeholder*="\u0438\u043c\u044f" i]',
      'input[aria-label*="\u0438\u043c\u044f" i]',
      'input[type="text"]',
      'input:not([type])'
    ], config.zoomBotName).catch(() => null);
    await page.waitForTimeout(500);
    await writeDiagnostics(page, logger, "after-name");
    if (config.zoomMeetingPasscode) {
      await fillFirst(page, [
        'input[type="password"]',
        'input[placeholder*="passcode" i]',
        'input[aria-label*="passcode" i]',
        'input[placeholder*="\u043a\u043e\u0434" i]',
        'input[aria-label*="\u043a\u043e\u0434" i]'
      ], config.zoomMeetingPasscode).catch(() => null);
    }
    await clickButtonByText(page, JOIN_BUTTON_PATTERNS);
    await page.waitForTimeout(5000);
    await writeDiagnostics(page, logger, "after-join");
    await openChatPanel(page);
    chatSeeded = false;
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
      const messages = await readChatMessages(page);
      if (!chatSeeded) {
        for (const message of messages) {
          rememberRecent(seenMessages, buildZoomSeenKey(message), 300000);
          if (shouldIgnoreZoomMessage(message, config.zoomBotName)) {
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
        if (shouldIgnoreZoomMessage(message, config.zoomBotName)) {
          rememberSentText(sentTexts, message.text, 300000);
          continue;
        }
        if (hasRecentSentText(sentTexts, message.text)) continue;
        const seenKey = buildZoomSeenKey(message);
        if (hasRecent(seenMessages, seenKey)) continue;
        rememberRecent(seenMessages, seenKey, 120000);
        await onMessage?.(buildZoomChatPayload(message));
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
      const result = await sendChatText(page, text);
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
