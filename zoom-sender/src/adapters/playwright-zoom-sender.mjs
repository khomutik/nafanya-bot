const CHAT_BUTTON_PATTERNS = [/chat/i, /\u0447\u0430\u0442/iu];

async function clickFirst(page, selectors, { timeout = 1500 } = {}) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.isVisible({ timeout }).catch(() => false)) {
      await locator.click({ timeout }).catch(() => null);
      return true;
    }
  }
  return false;
}

async function clickButtonByText(page, patterns) {
  for (const pattern of patterns) {
    const button = page.getByRole("button", { name: pattern }).first();
    if (await button.isVisible({ timeout: 1200 }).catch(() => false)) {
      await button.click().catch(() => null);
      return true;
    }
  }
  return false;
}

async function hasChatInput(page) {
  return page.evaluate(() => {
    const selectors = [
      'textarea[aria-label*="chat" i]',
      'textarea[placeholder*="chat" i]',
      'input[aria-label*="chat" i]',
      'div[contenteditable="true"][aria-label*="chat" i]',
      'div[contenteditable="true"]'
    ];
    return selectors.some((selector) => [...document.querySelectorAll(selector)].some((element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.visibility !== "hidden" && style.display !== "none" && rect.width > 20 && rect.height > 10;
    }));
  }).catch(() => false);
}

async function openChatPanel(page) {
  if (await hasChatInput(page)) return true;
  await clickButtonByText(page, CHAT_BUTTON_PATTERNS).catch(() => false);
  if (await hasChatInput(page)) return true;
  await clickFirst(page, [
    'button[aria-label*="chat" i]',
    'button[title*="chat" i]',
    '[role="button"][aria-label*="chat" i]',
    '[role="button"][title*="chat" i]'
  ]).catch(() => false);
  if (await hasChatInput(page)) return true;
  await page.keyboard.press("Alt+KeyH").catch(() => null);
  await page.waitForTimeout(800).catch(() => null);
  return hasChatInput(page);
}

async function fillMeetingName(page, name) {
  const selectors = [
    "#input-for-name",
    'input[name="name"]',
    'input[placeholder*="name" i]',
    'input[aria-label*="name" i]'
  ];
  for (const selector of selectors) {
    const input = page.locator(selector).first();
    if (await input.isVisible({ timeout: 1200 }).catch(() => false)) {
      await input.fill(name).catch(() => null);
      return true;
    }
  }
  return false;
}

async function sendChatText(page, text) {
  if (!await openChatPanel(page)) return { sent: false, ack: false };
  const selectors = [
    'textarea[aria-label*="chat" i]',
    'textarea[placeholder*="chat" i]',
    'div[contenteditable="true"][aria-label*="chat" i]',
    'div[contenteditable="true"]'
  ];
  for (const selector of selectors) {
    const input = page.locator(selector).last();
    if (await input.isVisible({ timeout: 1500 }).catch(() => false)) {
      await input.click().catch(() => null);
      await page.keyboard.insertText(String(text || ""));
      await page.keyboard.press("Enter");
      await page.waitForTimeout(700);
      return { sent: true, ack: true };
    }
  }
  return { sent: false, ack: false };
}

export class PlaywrightZoomSender {
  constructor(config, { logger = console } = {}) {
    this.config = config;
    this.logger = logger;
    this.browser = null;
    this.page = null;
    this.presence = {
      zoomPageOpen: false,
      zoomJoined: false,
      waitingRoom: false,
      chatOpen: false
    };
  }

  async start() {
    const { chromium } = await import("playwright");
    const launchOptions = { headless: this.config.headless };
    const userDataDir = this.config.userDataDir || "/app/profile";
    this.browser = await chromium.launchPersistentContext(userDataDir, launchOptions);
    this.page = await this.browser.newPage();
    await this.page.goto(this.config.zoomMeetingUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    this.presence.zoomPageOpen = true;
    await fillMeetingName(this.page, this.config.participantName).catch(() => false);
    await clickButtonByText(this.page, [/join/i, /\u0432\u043e\u0439\u0442\u0438/iu, /\u043f\u0440\u0438\u0441\u043e\u0435\u0434\u0438\u043d/iu]).catch(() => false);
    await this.page.waitForTimeout(3000);
    await openChatPanel(this.page).catch(() => false);
    this.presence = await this.getPresence();
    this.logger.info?.("Zoom Sender browser adapter started.");
    return this.presence;
  }

  async getPresence() {
    if (!this.page) return { ...this.presence };
    const chatOpen = await hasChatInput(this.page);
    const bodyText = await this.page.locator("body").innerText({ timeout: 1500 }).catch(() => "");
    const waitingRoom = /waiting room|host.*let you in|\u043e\u0436\u0438\u0434\u0430/iu.test(bodyText);
    const zoomJoined = chatOpen || /leave|mute|unmute|participants|chat|\u0447\u0430\u0442|\u043c\u0438\u043a\u0440\u043e\u0444\u043e\u043d/iu.test(bodyText);
    this.presence = {
      zoomPageOpen: !this.page.isClosed(),
      zoomJoined,
      waitingRoom,
      chatOpen
    };
    return { ...this.presence };
  }

  async sendMessage(text) {
    if (!this.page) return { sent: false, ack: false };
    const result = await sendChatText(this.page, text);
    this.presence = await this.getPresence();
    return result;
  }

  async stop() {
    await this.browser?.close().catch(() => null);
  }
}
