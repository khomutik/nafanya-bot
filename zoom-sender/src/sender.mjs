function normalizeChatAtom(value) {
  return String(value || "").replace(/\s+/gu, " ").trim();
}

const DEFAULT_CHAT_DEDUP_TTL_MS = 6 * 60 * 60 * 1000;

function normalizeLogicalPart(value) {
  return normalizeChatAtom(value).toLowerCase();
}

function isBillGameMessageText(value) {
  return /^\u0438\u0433\u0440\u0430\s+\d{1,3}$/iu.test(normalizeChatAtom(value));
}

function isSupportedZoomChatIngestText(value) {
  const text = normalizeChatAtom(value);
  return /^(?:111|222|333|444)$/u.test(text) || isBillGameMessageText(text);
}

function isAtomicQueueCodeMessage(message = {}) {
  return isSupportedZoomChatIngestText(message.text);
}

function isQueuePublicationText(value) {
  return /очередь|собрани|пишите в чат|рабочее собрание|очередь открыта|очередь закрыта|пока пусто|working meeting|queue open|queue closed|—\s*111|-\s*111/iu.test(normalizeChatAtom(value));
}

function extractZoomChatAriaLabel(value = "") {
  const raw = String(value || "").replace(/&quot;/giu, "\"").replace(/&#34;/giu, "\"");
  const match = raw.match(/\baria-label=["']([^"']+\bto\s+Everyone\b[^"']*)["']/iu);
  return normalizeChatAtom(match?.[1] || value);
}

function parseZoomChatAriaLabel(value = "") {
  const label = extractZoomChatAriaLabel(value);
  const labelMatch = label.match(/^(.+?)\s+to\s+Everyone,?\s+(\d{1,2}:\d{2}(?:\s?[AP]M)?),?\s+((?:111|222|333|444)|(?:\u0438\u0433\u0440\u0430\s+\d{1,3}))$/iu);
  if (!labelMatch) return null;
  const authorName = normalizeChatAtom(labelMatch[1]);
  const timestamp = normalizeChatAtom(labelMatch[2]);
  const text = normalizeChatAtom(labelMatch[3]);
  return {
    authorName,
    timestamp,
    text,
    canonicalLabel: `${authorName} to Everyone ${timestamp} ${text}`
  };
}

function parseZoomQueueCodeMessage(message = {}) {
  const text = normalizeChatAtom(message.text);
  const match = text.match(/^(.+?)\s+to\s+Everyone(?:\s+\d{1,2}:\d{2}(?:\s?[AP]M)?)?\s+((?:111|222|333|444)|(?:\u0438\u0433\u0440\u0430\s+\d{1,3}))$/iu);
  if (match) {
    const authorName = normalizeChatAtom(match[1]);
    if (!isValidChatAuthor(authorName)) return null;
    return { authorName, text: match[2], source: "line" };
  }
  if (!isAtomicQueueCodeMessage(message)) return null;
  const rawDomLabel = parseZoomChatAriaLabel(message.rawDom);
  const authorName = normalizeChatAtom(message.groupAuthorName || message.authorName || rawDomLabel?.authorName);
  const groupText = normalizeChatAtom(message.groupText || (rawDomLabel ? `${rawDomLabel.authorName} to Everyone ${rawDomLabel.timestamp} ${rawDomLabel.text}` : ""));
  const groupTimestamp = normalizeChatAtom(message.groupTimestamp || message.timestamp || rawDomLabel?.timestamp);
  if (rawDomLabel?.text && rawDomLabel.text !== text) return null;
  if (!isValidChatAuthor(authorName)) return null;
  if (!groupText || !groupTimestamp) return null;
  if (isQueuePublicationText(groupText)) return null;
  return { authorName, text, source: "group" };
}

function isValidChatAuthor(value) {
  const author = normalizeChatAtom(value);
  if (!author) return false;
  if (/^(?:\u043D\(|\u043D\u0430\u0444\u0430\u043D\u044F|nafanya|nafanya bot)$/iu.test(author)) return false;
  if (/^(?:111|222|333|444|\u0438\u0433\u0440\u0430\s+\d{1,3}|to|everyone|\d{1,2}:\d{2}(?:\s?[ap]m)?)$/iu.test(author)) return false;
  if (isQueuePublicationText(author)) return false;
  return !/\bto\s+everyone\b|\b\d{1,2}:\d{2}\b/iu.test(author);
}

function normalizeZoomMessageId(value) {
  const id = normalizeChatAtom(value);
  return /^1-\{[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\}$/iu.test(id) ? id : "";
}

export function extractZoomChatMessageId(message = {}) {
  const structuredCandidates = [
    message.sourceMessageId,
    message.itemDataId,
    message.messageBoxId,
    message.groupStableId
  ];
  for (const candidate of structuredCandidates) {
    const id = normalizeZoomMessageId(candidate);
    if (id) return id;
  }
  const html = String(message.rawDom || "");
  for (const match of html.matchAll(/\b(?:data-id|id)=["'](1-\{[0-9a-f-]+\})["']/giu)) {
    const id = normalizeZoomMessageId(match[1]);
    if (id) return id;
  }
  return "";
}

export function extractZoomChatDomMessageId(rawDom = "") {
  return extractZoomChatMessageId({ rawDom });
}

function buildZoomChatLogicalIdentities(message = {}, parsed = null) {
  const code = normalizeChatAtom(parsed?.text || message.text);
  const authorName = normalizeChatAtom(parsed?.authorName || message.authorName || message.groupAuthorName || message.displayName);
  if (!authorName || !isSupportedZoomChatIngestText(code)) return { primary: "", aliases: [], hasAriaIdentity: false, ariaCollisionKey: "" };
  const keys = [];
  const addKey = (key) => {
    const normalized = normalizeChatAtom(key);
    if (normalized && !keys.includes(normalized)) keys.push(normalized);
  };
  const ariaLabel = parseZoomChatAriaLabel(message.rawDom) || parseZoomChatAriaLabel(message.ariaLabel);
  const timestamp = normalizeChatAtom(ariaLabel?.timestamp || message.groupTimestamp || message.timestamp);
  const ariaCollisionKey = ["aria-collision", normalizeLogicalPart(authorName), normalizeLogicalPart(timestamp), code].join("|");
  const hasAriaIdentity = ariaLabel?.text === code && normalizeChatAtom(ariaLabel.authorName) === authorName;
  const zoomMessageId = extractZoomChatMessageId(message);
  if (zoomMessageId) {
    addKey(["zoom", normalizeLogicalPart(zoomMessageId), code].join("|"));
    return {
      primary: keys[0],
      aliases: keys,
      canonicalSourceMessageId: keys[0],
      zoomMessageId,
      hasAriaIdentity,
      ariaCollisionKey
    };
  }
  if (hasAriaIdentity) {
    addKey(["aria", normalizeLogicalPart(ariaLabel.canonicalLabel), code].join("|"));
    return {
      primary: keys[0],
      aliases: keys,
      canonicalSourceMessageId: keys[0],
      zoomMessageId: "",
      hasAriaIdentity,
      ariaCollisionKey
    };
  }
  const groupStableId = normalizeChatAtom(message.groupStableId);
  if (groupStableId) {
    addKey([
      "group",
      normalizeLogicalPart(authorName),
      normalizeLogicalPart(groupStableId),
      normalizeLogicalPart(message.groupTimestamp || message.timestamp),
      code,
      normalizeLogicalPart(message.childIndex)
    ].join("|"));
  }
  const rawLine = normalizeLogicalPart(message.text);
  if (!keys.length) {
    const sourceFingerprint = normalizeChatAtom(message.fingerprint);
    if (sourceFingerprint) addKey(["fingerprint", normalizeLogicalPart(sourceFingerprint), code].join("|"));
    else addKey(["line", normalizeLogicalPart(authorName), code, normalizeLogicalPart(message.timestamp), rawLine].join("|"));
  }
  return {
    primary: keys[0] || "",
    aliases: keys,
    canonicalSourceMessageId: keys[0] || "",
    zoomMessageId: "",
    hasAriaIdentity,
    ariaCollisionKey
  };
}

export function buildZoomChatLogicalKey(message = {}, parsed = null) {
  return buildZoomChatLogicalIdentities(message, parsed).primary;
}

export function selectZoomChatCodeIngestCandidates(messages = []) {
  const parsedCandidates = [];
  const ariaCollisionKeys = new Set();
  for (const message of messages) {
    const parsed = parseZoomQueueCodeMessage(message);
    if (!parsed) continue;
    const identities = buildZoomChatLogicalIdentities(message, parsed);
    const sourceFingerprint = normalizeChatAtom(message.fingerprint);
    if (!identities.primary || !sourceFingerprint) continue;
    if (identities.hasAriaIdentity) ariaCollisionKeys.add(identities.ariaCollisionKey);
    parsedCandidates.push({ message, parsed, identities, sourceFingerprint });
  }
  const candidates = [];
  const batchLogicalKeys = new Set();
  const batchFingerprints = new Set();
  for (const { message, parsed, identities, sourceFingerprint } of parsedCandidates) {
    const { primary: logicalKey, aliases: logicalAliases } = identities;
    if (!identities.hasAriaIdentity && ariaCollisionKeys.has(identities.ariaCollisionKey)) continue;
    if (logicalAliases.some((key) => batchLogicalKeys.has(key)) || batchFingerprints.has(sourceFingerprint)) continue;
    for (const key of logicalAliases) batchLogicalKeys.add(key);
    batchFingerprints.add(sourceFingerprint);
    candidates.push({
      authorName: parsed.authorName,
      text: parsed.text,
      timestamp: normalizeChatAtom(message.timestamp),
      sourceFingerprint,
      observedAt: normalizeChatAtom(message.observedAt),
      logicalKey,
      logicalAliases,
      canonicalSourceMessageId: identities.canonicalSourceMessageId,
      zoomMessageId: identities.zoomMessageId
    });
  }
  return candidates;
}

export class ZoomSenderService {
  constructor({ workerClient, zoomAdapter, backoff, health, logger = console, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), chatLogicalDedupTtlMs = DEFAULT_CHAT_DEDUP_TTL_MS }) {
    this.workerClient = workerClient;
    this.zoomAdapter = zoomAdapter;
    this.backoff = backoff;
    this.health = health;
    this.logger = logger;
    this.sleep = sleep;
    this.stopped = false;
    this.chatLogicalDedupTtlMs = chatLogicalDedupTtlMs;
    this.chatLogicalDedup = new Map();
    this.chatSourceFingerprintDedup = new Map();
  }

  pruneChatLogicalDedup(now = Date.now()) {
    for (const [key, lastSeenAt] of this.chatLogicalDedup) {
      if (now - lastSeenAt > this.chatLogicalDedupTtlMs) {
        this.chatLogicalDedup.delete(key);
      }
    }
    for (const [key, lastSeenAt] of this.chatSourceFingerprintDedup) {
      if (now - lastSeenAt > this.chatLogicalDedupTtlMs) {
        this.chatSourceFingerprintDedup.delete(key);
      }
    }
  }

  shouldIngestChatCandidate(candidate, now = Date.now()) {
    this.pruneChatLogicalDedup(now);
    const logicalKeys = [candidate?.logicalKey, ...(Array.isArray(candidate?.logicalAliases) ? candidate.logicalAliases : [])]
      .map(normalizeChatAtom)
      .filter(Boolean);
    if (logicalKeys.some((key) => this.chatLogicalDedup.has(key))) {
      this.logger.info?.("Zoom Sender skipped duplicate chat queue-code candidate by logical message key.");
      return false;
    }
    const sourceFingerprint = normalizeChatAtom(candidate?.sourceFingerprint);
    if (sourceFingerprint && this.chatSourceFingerprintDedup.has(sourceFingerprint)) {
      this.logger.info?.("Zoom Sender skipped duplicate chat queue-code candidate by source fingerprint.");
      return false;
    }
    for (const key of logicalKeys) this.chatLogicalDedup.set(key, now);
    if (sourceFingerprint) this.chatSourceFingerprintDedup.set(sourceFingerprint, now);
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
      this.health.markWorkerUnavailable?.(error);
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
