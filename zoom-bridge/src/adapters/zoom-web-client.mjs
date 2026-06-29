const CHAT_BUTTON_PATTERNS = [/chat/i, /\u0447\u0430\u0442/iu];
const JOIN_BUTTON_PATTERNS = [/join/i, /\u0432\u043e\u0439\u0442\u0438/iu, /\u043f\u0440\u0438\u0441\u043e\u0435\u0434\u0438\u043d/iu];
const PASSCODE_PATTERNS = [/passcode/i, /password/i, /\u043a\u043e\u0434/iu, /\u043f\u0430\u0440\u043e\u043b/iu];
const WITHOUT_AUDIO_VIDEO_PATTERNS = [
  /continue without microphone and camera/i,
  /continue without audio and video/i,
  /\u043f\u0440\u043e\u0434\u043e\u043b\u0436\u0438\u0442\u044c \u0431\u0435\u0437/iu
];
const DIAGNOSTICS_DIR = "/tmp/nafanya-zoom-bridge";

export function shouldIgnoreZoomMessage(message, botName) {
  const sender = String(message?.sender || "").trim().toLowerCase();
  return Boolean(sender && sender === String(botName || "").trim().toLowerCase());
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
  return page.evaluate(() => {
    const nodes = [
      ...document.querySelectorAll('[class*="chat"] [class*="message"], [class*="Chat"] [class*="message"], [data-testid*="chat"] *')
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
}

export function createZoomWebClientAdapter(config, logger) {
  let browser = null;
  let context = null;
  let page = null;
  let timer = null;
  let onMessage = null;
  const seen = new Set();
  let reconnecting = false;

  async function joinMeeting() {
    const { chromium } = await import("playwright");
    context = await chromium.launchPersistentContext(config.zoomBrowserProfileDir, {
      headless: config.zoomHeadless,
      slowMo: config.zoomBrowserSlowMoMs || 0,
      viewport: { width: 1280, height: 720 },
      ignoreDefaultArgs: ["--enable-automation"],
      args: [
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
        "--disable-blink-features=AutomationControlled",
        "--disable-infobars",
        "--no-sandbox"
      ]
    });
    browser = context.browser();
    page = context.pages()[0] || await context.newPage();
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });
    await page.goto(buildZoomWebClientUrl(config.zoomMeetingUrl), { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(2000);
    await writeDiagnostics(page, logger, "after-goto");
    await dismissAudioVideoPrompts(page);
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
    await clickButtonByText(page, CHAT_BUTTON_PATTERNS);
    await writeDiagnostics(page, logger, "after-chat");
    logger.info("Zoom web client adapter joined or is waiting for admission");
  }

  async function reconnect() {
    if (reconnecting) return;
    reconnecting = true;
    logger.warn("Zoom web client reconnecting");
    try {
      await page?.close().catch(() => null);
      await context?.close().catch(() => null);
      await browser?.close().catch(() => null);
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
      for (const message of messages) {
        if (seen.has(message.id)) continue;
        seen.add(message.id);
        if (seen.size > 1000) {
          seen.clear();
        }
        if (shouldIgnoreZoomMessage(message, config.zoomBotName)) continue;
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
      await clickButtonByText(page, CHAT_BUTTON_PATTERNS).catch(() => null);
      const result = await sendChatText(page, text);
      if (!result.sent) {
        logger.warn("Zoom web client could not find chat input");
      }
      return result;
    },
    async stop() {
      if (timer) clearInterval(timer);
      await page?.close().catch(() => null);
      await context?.close().catch(() => null);
      await browser?.close().catch(() => null);
    }
  };
}
