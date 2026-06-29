const CHAT_BUTTON_PATTERNS = [/chat/i, /\u0447\u0430\u0442/iu];
const JOIN_BUTTON_PATTERNS = [/join/i, /\u0432\u043e\u0439\u0442\u0438/iu, /\u043f\u0440\u0438\u0441\u043e\u0435\u0434\u0438\u043d/iu];
const PASSCODE_PATTERNS = [/passcode/i, /password/i, /\u043a\u043e\u0434/iu, /\u043f\u0430\u0440\u043e\u043b/iu];

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
  let page = null;
  let timer = null;
  let onMessage = null;
  const seen = new Set();
  let reconnecting = false;

  async function joinMeeting() {
    const { chromium } = await import("playwright");
    browser = await chromium.launch({
      headless: config.zoomHeadless,
      slowMo: config.zoomBrowserSlowMoMs || 0,
      args: ["--use-fake-ui-for-media-stream", "--no-sandbox"]
    });
    page = await browser.newPage();
    await page.goto(config.zoomMeetingUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(2000);
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
      'input[aria-label*="\u0438\u043c\u044f" i]'
    ], config.zoomBotName).catch(() => null);
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
    await clickButtonByText(page, CHAT_BUTTON_PATTERNS);
    logger.info("Zoom web client adapter joined or is waiting for admission");
  }

  async function reconnect() {
    if (reconnecting) return;
    reconnecting = true;
    logger.warn("Zoom web client reconnecting");
    try {
      await page?.close().catch(() => null);
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
      await browser?.close().catch(() => null);
    }
  };
}
