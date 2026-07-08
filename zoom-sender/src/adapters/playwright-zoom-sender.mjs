const CHAT_BUTTON_PATTERNS = [/chat/i, /\u0447\u0430\u0442/iu];
const COOKIE_BUTTON_PATTERNS = [/decline cookies/i, /accept cookies/i, /\u043e\u0442\u043a\u043b\u043e\u043d\u0438\u0442\u044c/iu, /\u043f\u0440\u0438\u043d\u044f\u0442\u044c/iu];
const JOIN_FROM_BROWSER_PATTERNS = [/join from browser/i, /\u0432\u043e\u0439\u0442\u0438.*\u0431\u0440\u0430\u0443\u0437\u0435\u0440/iu];
const CONTINUE_WITHOUT_MEDIA_PATTERNS = [/continue without microphone and camera/i, /\u043f\u0440\u043e\u0434\u043e\u043b\u0436\u0438\u0442\u044c.*\u043c\u0438\u043a\u0440\u043e\u0444\u043e\u043d/iu];
const JOIN_MEETING_PATTERNS = [/join/i, /join meeting/i, /\u0432\u043e\u0439\u0442\u0438/iu, /\u043f\u0440\u0438\u0441\u043e\u0435\u0434\u0438\u043d/iu];
const DIAGNOSTIC_TEXT_LIMIT = 12000;
const DIAGNOSTIC_BODY_TEXT_LIMIT = 2000;
const DIAGNOSTIC_HTML_LIMIT = 5000;
const DEFAULT_BROWSER_ARGS = [
  "--no-sandbox",
  "--disable-dev-shm-usage",
  "--use-fake-ui-for-media-stream",
  "--use-fake-device-for-media-stream",
  "--autoplay-policy=no-user-gesture-required",
  "--disable-blink-features=AutomationControlled",
  "--disable-infobars"
];
const ZOOM_RESPONSE_RE = /(?:^|\.)zoom\.us$|zoomcdn\.com$|zmdownload\.zoom\.us$/iu;

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
  return clickVisibleControlByText(page, patterns);
}

async function clickTextByPattern(page, patterns) {
  for (const pattern of patterns) {
    const text = page.getByText(pattern).first();
    if (await text.isVisible({ timeout: 1200 }).catch(() => false)) {
      await text.click().catch(() => null);
      await page.waitForTimeout(1200).catch(() => null);
      return true;
    }
  }
  return false;
}

async function clickVisibleControlByText(page, patterns) {
  const serialized = patterns.map((pattern) => ({ source: pattern.source, flags: pattern.flags }));
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const clicked = await page.evaluate((items) => {
      const regexes = items.map((item) => new RegExp(item.source, item.flags));
      const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
      const isVisible = (element) => {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.visibility !== "hidden" && style.display !== "none" && rect.width > 1 && rect.height > 1;
      };
      const controls = [...document.querySelectorAll("button, a, [role='button']")];
      const target = controls.find((element) => {
        if (!isVisible(element)) return false;
        const label = [
          clean(element.innerText || element.textContent),
          clean(element.getAttribute("aria-label")),
          clean(element.getAttribute("title"))
        ].filter(Boolean).join(" ");
        return regexes.some((regex) => regex.test(label));
      });
      if (!target) return false;
      target.click();
      return true;
    }, serialized).catch(() => false);
    if (clicked) {
      await page.waitForTimeout(1200).catch(() => null);
      return true;
    }
    await page.waitForTimeout(700).catch(() => null);
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

function sanitizePageUrl(value) {
  try {
    const url = new URL(String(value || ""));
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return String(value || "").replace(/[?#].*$/u, "");
  }
}

function sanitizeDiagnosticText(value) {
  return String(value || "")
    .replace(/([?&](?:pwd|zak|token|secret|code|signature|passcode)=)[^&\s"'<>]+/giu, "$1[redacted]")
    .replace(/(x-nafanya-zoom-secret["':\s]+)[^"'\s<>]+/giu, "$1[redacted]")
    .replace(/(authorization["':\s]+bearer\s+)[^"'\s<>]+/giu, "$1[redacted]")
    .replace(/https?:\/\/[^\s"'<>]+/giu, (match) => sanitizePageUrl(match));
}

function buildZoomWebClientUrl(meetingUrl) {
  try {
    const url = new URL(meetingUrl);
    const match = url.pathname.match(/^\/j\/(\d+)/u);
    if (match) {
      url.pathname = `/wc/join/${match[1]}`;
    }
    return url.toString();
  } catch {
    return meetingUrl;
  }
}

function safeEventText(value) {
  return sanitizeDiagnosticText(String(value || "")).slice(0, 1000);
}

function isZoomRelatedUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return ZOOM_RESPONSE_RE.test(url.hostname);
  } catch {
    return false;
  }
}

async function collectVisibleControls(page) {
  return page.evaluate(() => {
    const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const visible = (element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.visibility !== "hidden" && style.display !== "none" && rect.width > 1 && rect.height > 1;
    };
    const buttons = [...document.querySelectorAll("button, [role='button'], a")].filter(visible).slice(0, 80).map((element) => ({
      tag: element.tagName.toLowerCase(),
      role: element.getAttribute("role") || "",
      text: clean(element.innerText || element.textContent),
      ariaLabel: clean(element.getAttribute("aria-label")),
      title: clean(element.getAttribute("title")),
      type: clean(element.getAttribute("type"))
    }));
    const inputs = [...document.querySelectorAll("input, textarea, [contenteditable='true']")].filter(visible).slice(0, 60).map((element) => ({
      tag: element.tagName.toLowerCase(),
      type: clean(element.getAttribute("type")),
      name: clean(element.getAttribute("name")),
      placeholder: clean(element.getAttribute("placeholder")),
      ariaLabel: clean(element.getAttribute("aria-label")),
      valuePresent: Boolean(element.value)
    }));
    return { buttons, inputs };
  }).catch(() => ({ buttons: [], inputs: [] }));
}

async function collectPageDiagnostics(page) {
  return page.evaluate(() => {
    const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const scriptDomains = [...document.scripts].map((script) => {
      try {
        return script.src ? new URL(script.src).hostname : "";
      } catch {
        return "";
      }
    }).filter(Boolean);
    const iframes = [...document.querySelectorAll("iframe")].slice(0, 40).map((frame) => ({
      src: frame.src || "",
      title: frame.title || "",
      name: frame.name || "",
      ariaLabel: frame.getAttribute("aria-label") || ""
    }));
    return {
      readyState: document.readyState,
      bodyText: clean(document.body?.innerText || ""),
      bodyHtml: String(document.body?.innerHTML || ""),
      iframes,
      scriptDomains: [...new Set(scriptDomains)].slice(0, 80),
      userAgent: navigator.userAgent,
      webdriver: navigator.webdriver
    };
  }).catch((error) => ({
    readyState: "",
    bodyText: "",
    bodyHtml: "",
    iframes: [],
    scriptDomains: [],
    evaluateError: error?.message || String(error)
  }));
}

async function makeDiagnosticsDir(diagnosticsDir) {
  if (!diagnosticsDir) return null;
  const [{ mkdir, writeFile }, path] = await Promise.all([import("node:fs/promises"), import("node:path")]);
  const stamp = new Date().toISOString().replace(/[:.]/gu, "-");
  const dir = path.join(diagnosticsDir, stamp);
  await mkdir(dir, { recursive: true });
  return { dir, writeFile, path };
}

async function saveDiagnosticsSnapshot(page, presence, diagnosticsRun, label, details = {}, logger = console) {
  if (!diagnosticsRun || !page) return null;
  const safeLabel = String(label || "snapshot").replace(/[^a-z0-9_-]+/giu, "-").slice(0, 60);
  const controls = await collectVisibleControls(page);
  const visibleText = await page.locator("body").innerText({ timeout: 2000 }).catch(() => "");
  const pageData = await collectPageDiagnostics(page);
  const data = {
    capturedAt: new Date().toISOString(),
    label: safeLabel,
    url: sanitizePageUrl(page.url()),
    title: await page.title().catch(() => ""),
    readyState: pageData.readyState,
    visibleText: String(visibleText || "").slice(0, DIAGNOSTIC_TEXT_LIMIT),
    bodyText: sanitizeDiagnosticText(pageData.bodyText).slice(0, DIAGNOSTIC_BODY_TEXT_LIMIT),
    bodyHtml: sanitizeDiagnosticText(pageData.bodyHtml).slice(0, DIAGNOSTIC_HTML_LIMIT),
    iframes: pageData.iframes.map((frame) => ({
      ...frame,
      src: sanitizePageUrl(frame.src)
    })),
    scriptDomains: pageData.scriptDomains,
    userAgent: safeEventText(pageData.userAgent),
    webdriver: pageData.webdriver,
    buttons: controls.buttons,
    inputs: controls.inputs,
    presence,
    details
  };
  await diagnosticsRun.writeFile(diagnosticsRun.path.join(diagnosticsRun.dir, `${safeLabel}.json`), JSON.stringify(data, null, 2), "utf8");
  await page.screenshot({ path: diagnosticsRun.path.join(diagnosticsRun.dir, `${safeLabel}.png`), fullPage: true }).catch(() => null);
  logger.info?.(`Zoom Sender diagnostics snapshot saved: ${safeLabel}`);
  return diagnosticsRun.dir;
}

async function writeDiagnosticsSummary(diagnosticsRun, events, launchInfo) {
  if (!diagnosticsRun) return null;
  const data = {
    capturedAt: new Date().toISOString(),
    launchInfo,
    console: events.console.slice(-120),
    pageErrors: events.pageErrors.slice(-40),
    requestFailed: events.requestFailed.slice(-80),
    badResponses: events.badResponses.slice(-120)
  };
  await diagnosticsRun.writeFile(diagnosticsRun.path.join(diagnosticsRun.dir, "browser-events.json"), JSON.stringify(data, null, 2), "utf8");
  return diagnosticsRun.dir;
}

async function getSystemDiagnostics(config, browser, launchArgs) {
  const fs = await import("node:fs/promises");
  const devShm = await fs.stat("/dev/shm").then((stat) => ({ exists: true, size: stat.size })).catch(() => ({ exists: false }));
  return {
    headless: config.headless,
    launchArgs,
    userDataDir: config.userDataDir || "/app/profile",
    diagnosticsDir: Boolean(config.diagnosticsDir),
    display: Boolean(process.env.DISPLAY),
    nodeVersion: process.version,
    playwrightBrowserVersion: browser?.browser?.()?.version?.() || "",
    devShm
  };
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
    this.lastDiagnosticsDir = null;
    this.diagnosticsEvents = {
      console: [],
      pageErrors: [],
      requestFailed: [],
      badResponses: []
    };
  }

  attachPageDiagnostics(page) {
    page.on("console", (message) => {
      const type = message.type();
      if (!["error", "warning"].includes(type)) return;
      this.diagnosticsEvents.console.push({
        type,
        text: safeEventText(message.text()),
        location: message.location()
      });
    });
    page.on("pageerror", (error) => {
      this.diagnosticsEvents.pageErrors.push({
        message: safeEventText(error?.message || String(error)),
        stack: safeEventText(error?.stack || "")
      });
    });
    page.on("requestfailed", (request) => {
      if (!isZoomRelatedUrl(request.url())) return;
      this.diagnosticsEvents.requestFailed.push({
        url: sanitizePageUrl(request.url()),
        method: request.method(),
        failure: safeEventText(request.failure()?.errorText || "")
      });
    });
    page.on("response", (response) => {
      if (response.status() < 400 || !isZoomRelatedUrl(response.url())) return;
      this.diagnosticsEvents.badResponses.push({
        url: sanitizePageUrl(response.url()),
        status: response.status(),
        statusText: safeEventText(response.statusText())
      });
    });
  }

  async start() {
    const { chromium } = await import("playwright");
    const launchArgs = [...DEFAULT_BROWSER_ARGS, ...(this.config.browserArgs || [])];
    const launchOptions = {
      headless: this.config.headless,
      viewport: { width: 1280, height: 720 },
      ignoreDefaultArgs: ["--enable-automation"],
      args: launchArgs
    };
    const userDataDir = this.config.userDataDir || "/app/profile";
    const diagnosticsRun = await makeDiagnosticsDir(this.config.diagnosticsDir);
    this.browser = await chromium.launchPersistentContext(userDataDir, launchOptions);
    this.page = await this.browser.newPage();
    this.attachPageDiagnostics(this.page);
    await this.page.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });
    await this.page.goto(buildZoomWebClientUrl(this.config.zoomMeetingUrl), { waitUntil: "domcontentloaded", timeout: 60000 });
    this.presence.zoomPageOpen = true;
    await saveDiagnosticsSnapshot(this.page, this.presence, diagnosticsRun, "01-after-goto", {
      launchInfo: await getSystemDiagnostics(this.config, this.browser, launchArgs)
    }, this.logger).catch((error) => this.logger.warn?.(`Zoom Sender diagnostics failed: ${error?.message || String(error)}`));
    await clickButtonByText(this.page, COOKIE_BUTTON_PATTERNS).catch(() => false);
    if (await clickButtonByText(this.page, JOIN_FROM_BROWSER_PATTERNS).catch(() => false)) {
      await this.page.waitForTimeout(2500);
    }
    await saveDiagnosticsSnapshot(this.page, this.presence, diagnosticsRun, "02-after-join-from-browser", {}, this.logger).catch((error) => this.logger.warn?.(`Zoom Sender diagnostics failed: ${error?.message || String(error)}`));
    await clickTextByPattern(this.page, CONTINUE_WITHOUT_MEDIA_PATTERNS).catch(() => false);
    await saveDiagnosticsSnapshot(this.page, this.presence, diagnosticsRun, "03-after-continue-without-media", {}, this.logger).catch((error) => this.logger.warn?.(`Zoom Sender diagnostics failed: ${error?.message || String(error)}`));
    await fillMeetingName(this.page, this.config.participantName).catch(() => false);
    await clickButtonByText(this.page, JOIN_MEETING_PATTERNS).catch(() => false);
    await clickTextByPattern(this.page, CONTINUE_WITHOUT_MEDIA_PATTERNS).catch(() => false);
    await fillMeetingName(this.page, this.config.participantName).catch(() => false);
    await clickButtonByText(this.page, JOIN_MEETING_PATTERNS).catch(() => false);
    await this.page.waitForTimeout(3000);
    await openChatPanel(this.page).catch(() => false);
    this.presence = await this.getPresence();
    this.lastDiagnosticsDir = await saveDiagnosticsSnapshot(this.page, this.presence, diagnosticsRun, "04-after-final-join", {}, this.logger).catch((error) => {
      this.logger.warn?.(`Zoom Sender diagnostics failed: ${error?.message || String(error)}`);
      return null;
    });
    await writeDiagnosticsSummary(diagnosticsRun, this.diagnosticsEvents, await getSystemDiagnostics(this.config, this.browser, launchArgs)).catch((error) => {
      this.logger.warn?.(`Zoom Sender diagnostics summary failed: ${error?.message || String(error)}`);
    });
    if (diagnosticsRun) {
      this.lastDiagnosticsDir = diagnosticsRun.dir;
      this.logger.info?.(`Zoom Sender diagnostics saved to ${diagnosticsRun.dir}`);
    }
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

export { DEFAULT_BROWSER_ARGS, buildZoomWebClientUrl, collectVisibleControls, sanitizeDiagnosticText, sanitizePageUrl, saveDiagnosticsSnapshot };
