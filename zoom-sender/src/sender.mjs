function normalizeChatAtom(value) {
  return String(value || "").replace(/\s+/gu, " ").trim();
}

function normalizeLogicalPart(value) {
  return normalizeChatAtom(value).toLowerCase();
}

function isAtomicQueueCodeMessage(message = {}) {
  return /^(?:111|222|333|444)$/u.test(normalizeChatAtom(message.text));
}

function parseZoomQueueCodeMessage(message = {}) {
  const text = normalizeChatAtom(message.text);
  const match = text.match(/^(.+?)\s+to\s+Everyone(?:\s+\d{1,2}:\d{2}(?:\s?[AP]M)?)?\s+(111|222|333|444)$/iu);
  if (!match) return null;
  const authorName = normalizeChatAtom(match[1]);
  if (!isValidChatAuthor(authorName)) return null;
  return { authorName, text: match[2] };
}

function isValidChatAuthor(value) {
  const author = normalizeChatAtom(value);
  if (!author) return false;
  if (/^(?:you|вы|\u0432\u044b|\u043d\()$/iu.test(author)) return false;
  if (/^(?:111|222|333|444|to|everyone|\d{1,2}:\d{2}(?:\s?[ap]m)?)$/iu.test(author)) return false;
  if (/очередь|собрани|пишите в чат|working meeting|queue open/iu.test(author)) return false;
  return !/\bto\s+everyone\b|\b\d{1,2}:\d{2}\b/iu.test(author);
}

export function extractZoomChatDomMessageId(rawDom = "") {
  const html = String(rawDom || "");
  const rtfId = html.match(/\bid=["']([^"']*-\{[0-9a-f-]{24,}\})["']/iu);
  if (rtfId) return normalizeChatAtom(rtfId[1]);
  const contentId = html.match(/\bid=["'](chat-message-content-[^"']+)["']/iu);
  if (contentId) return normalizeChatAtom(contentId[1]);
  const ariaLabel = html.match(/\baria-label=["']([^"']+\bto\s+Everyone\b[^"']+)["']/iu);
  if (ariaLabel) return normalizeChatAtom(ariaLabel[1]);
  return "";
}

export function buildZoomChatLogicalKey(message = {}, parsed = null) {
  const code = normalizeChatAtom(parsed?.text || message.text);
  const authorName = normalizeChatAtom(parsed?.authorName || message.authorName || message.displayName);
  if (!authorName || !/^(?:111|222|333|444)$/u.test(code)) return "";
  const domMessageId = extractZoomChatDomMessageId(message.rawDom);
  if (domMessageId) {
    return ["dom", normalizeLogicalPart(authorName), code, normalizeLogicalPart(domMessageId)].join("|");
  }
  const rawLine = normalizeLogicalPart(message.text);
  const timestamp = normalizeLogicalPart(message.timestamp);
  return ["line", normalizeLogicalPart(authorName), code, timestamp, rawLine].join("|");
}

export function selectZoomChatCodeIngestCandidates(messages = []) {
  const candidates = [];
  const batchLogicalKeys = new Set();
  for (const message of messages) {
    const parsed = parseZoomQueueCodeMessage(message);
    if (!parsed && !isAtomicQueueCodeMessage(message)) continue;
    if (!parsed) continue;
    const logicalKey = buildZoomChatLogicalKey(message, parsed);
    if (!logicalKey || batchLogicalKeys.has(logicalKey)) continue;
    batchLogicalKeys.add(logicalKey);
    candidates.push({
      authorName: parsed.authorName,
      text: parsed.text,
      timestamp: normalizeChatAtom(message.timestamp),
      sourceFingerprint: normalizeChatAtom(message.fingerprint),
      observedAt: normalizeChatAtom(message.observedAt),
      logicalKey
    });
  }
  return candidates.filter((candidate) => candidate.sourceFingerprint);
}

export class ZoomSenderService {
  constructor({ workerClient, zoomAdapter, backoff, health, logger = console, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), chatLogicalDedupTtlMs = 120000 }) {
    this.workerClient = workerClient;
    this.zoomAdapter = zoomAdapter;
    this.backoff = backoff;
    this.health = health;
    this.logger = logger;
    this.sleep = sleep;
    this.stopped = false;
    this.chatLogicalDedupTtlMs = chatLogicalDedupTtlMs;
    this.chatLogicalDedup = new Map();
  }

  pruneChatLogicalDedup(now = Date.now()) {
    for (const [key, lastSeenAt] of this.chatLogicalDedup) {
      if (now - lastSeenAt > this.chatLogicalDedupTtlMs) {
        this.chatLogicalDedup.delete(key);
      }
    }
  }

  shouldIngestChatCandidate(candidate, now = Date.now()) {
    this.pruneChatLogicalDedup(now);
    const logicalKey = normalizeChatAtom(candidate?.logicalKey);
    if (!logicalKey) return true;
    if (this.chatLogicalDedup.has(logicalKey)) {
      this.logger.info?.("Zoom Sender skipped duplicate chat queue-code candidate by logical message key.");
      return false;
    }
    this.chatLogicalDedup.set(logicalKey, now);
    return true;
  }

  async start() {
    const presence = await this.zoomAdapter.start();
    this.health.updateZoom(presence);
    this.health.updateBackoff(this.backoff);
  }

  async runOnce() {
    try {
      this.health.updateZoom(await this.zoomAdapter.getPresence());
      const chatDiagnostics = await this.zoomAdapter.observeChatDiagnostics?.();
      if (this.zoomAdapter.config?.chatIngestEnabled) {
        const candidates = selectZoomChatCodeIngestCandidates(chatDiagnostics?.messages || []);
        for (const candidate of candidates) {
          if (!this.shouldIngestChatCandidate(candidate)) continue;
          await this.workerClient.ingestChatMessage(candidate);
          this.logger.info?.("Zoom Sender forwarded one read-only chat queue-code candidate to Worker ingest.");
        }
      }
      const pulled = await this.workerClient.pull();
      this.health.markWorkerPoll();
      const messages = Array.isArray(pulled.messages) ? pulled.messages : [];
      if (!messages.length) {
        const delay = this.backoff.onMessages(0);
        this.health.updateBackoff(this.backoff);
        this.health.clearError();
        this.logger.info?.(`Zoom Sender outbox empty; next poll in ${delay}ms`);
        return { messages: 0, ackIds: [], delayMs: delay };
      }

      const ackIds = [];
      for (const message of messages) {
        const id = Number(message.id);
        const text = String(message.text || "").trim();
        if (!id || !text) continue;
        const result = await this.zoomAdapter.sendMessage(text);
        this.health.updateZoom(await this.zoomAdapter.getPresence());
        if (result?.sent && result?.ack) {
          ackIds.push(id);
          this.health.markSend();
        } else {
          this.logger.warn?.(`Zoom Sender did not ack message ${id}: send result was not successful`);
        }
      }

      if (ackIds.length) {
        await this.workerClient.ack(ackIds);
        this.logger.info?.(`Zoom Sender acknowledged ${ackIds.length} outbox message(s)`);
      }
      const delay = this.backoff.onMessages(messages.length);
      this.health.updateBackoff(this.backoff);
      this.health.clearError();
      return { messages: messages.length, ackIds, delayMs: delay };
    } catch (error) {
      const delay = this.backoff.onError();
      this.health.workerAvailable = false;
      this.health.markError(error);
      this.health.updateBackoff(this.backoff);
      this.logger.warn?.(`Zoom Sender cycle failed; next poll in ${delay}ms: ${this.health.lastError?.message || "unknown error"}`);
      return { error, ackIds: [], delayMs: delay };
    }
  }

  async runForever() {
    await this.start();
    while (!this.stopped) {
      const result = await this.runOnce();
      await this.sleep(result.delayMs || this.backoff.currentDelayMs);
    }
  }

  async stop() {
    this.stopped = true;
    await this.zoomAdapter.stop?.();
  }
}
