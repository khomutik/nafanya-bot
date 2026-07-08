export class WorkerOutboxClient {
  constructor(config, fetchImpl = globalThis.fetch) {
    if (typeof fetchImpl !== "function") {
      throw new Error("fetch implementation is required");
    }
    this.config = config;
    this.fetch = fetchImpl;
    this.outboxPath = "/zoom-only/outbox";
    this.chatIngestPath = "/zoom-only/chat-ingest";
  }

  async postOutbox(payload = {}) {
    const response = await this.fetch(`${this.config.workerBaseUrl}${this.outboxPath}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-nafanya-zoom-secret": this.config.zoomBridgeSecret
      },
      body: JSON.stringify(payload)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) {
      throw new Error(data.error || `Worker outbox request failed with HTTP ${response.status}`);
    }
    return data;
  }

  async pull({ limit = this.config.outboxLimit } = {}) {
    return this.postOutbox({ limit });
  }

  async ack(ids = []) {
    const ackIds = ids.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0);
    if (!ackIds.length) return { ok: true, remaining: null };
    return this.postOutbox({ ackIds, limit: this.config.outboxLimit });
  }

  async ingestChatMessage(message = {}) {
    const response = await this.fetch(`${this.config.workerBaseUrl}${this.chatIngestPath}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-nafanya-zoom-secret": this.config.zoomBridgeSecret
      },
      body: JSON.stringify({
        authorName: message.authorName,
        text: message.text,
        timestamp: message.timestamp,
        sourceFingerprint: message.sourceFingerprint,
        observedAt: message.observedAt
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) {
      throw new Error(data.error || `Worker chat ingest request failed with HTTP ${response.status}`);
    }
    return data;
  }
}
