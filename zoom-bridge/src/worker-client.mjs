export class WorkerClient {
  constructor(config, fetchImpl = globalThis.fetch) {
    if (typeof fetchImpl !== "function") {
      throw new Error("fetch implementation is required");
    }
    this.config = config;
    this.fetch = fetchImpl;
    const zoomOnly = config.zoomWorkerMode === "zoom-only";
    this.webhookPath = zoomOnly ? "/zoom-only/webhook" : "/zoom/webhook";
    this.outboxPath = zoomOnly ? "/zoom-only/outbox" : "/zoom/outbox";
  }

  async postJson(path, payload) {
    const response = await this.fetch(`${this.config.workerBaseUrl}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-nafanya-zoom-secret": this.config.zoomBridgeSecret
      },
      body: JSON.stringify(payload || {})
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) {
      const error = data.error || `Worker request failed with HTTP ${response.status}`;
      throw new Error(error);
    }
    return data;
  }

  sendIncomingMessage(payload) {
    return this.postJson(this.webhookPath, payload);
  }

  pullOutbox({ ackIds = [], limit = this.config.outboxLimit } = {}) {
    return this.postJson(this.outboxPath, { ackIds, limit });
  }
}
