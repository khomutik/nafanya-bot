export class HealthState {
  constructor({ dryRun = false } = {}) {
    this.startedAt = Date.now();
    this.dryRun = dryRun;
    this.workerAvailable = false;
    this.zoomPageOpen = false;
    this.zoomJoined = false;
    this.waitingRoom = false;
    this.chatOpen = false;
    this.lastSuccessfulSendAt = null;
    this.lastOutboxPollAt = null;
    this.lastError = null;
    this.currentDelayMs = null;
  }

  markWorkerPoll() {
    this.workerAvailable = true;
    this.lastOutboxPollAt = Date.now();
  }

  markSend() {
    this.lastSuccessfulSendAt = Date.now();
  }

  markError(error) {
    this.lastError = {
      message: redactSensitiveText(error?.message || String(error)),
      at: Date.now()
    };
  }

  clearError() {
    this.lastError = null;
  }

  updateZoom(presence = {}) {
    this.zoomPageOpen = Boolean(presence.zoomPageOpen);
    this.zoomJoined = Boolean(presence.zoomJoined);
    this.waitingRoom = Boolean(presence.waitingRoom);
    this.chatOpen = Boolean(presence.chatOpen);
  }

  updateBackoff(backoff) {
    this.currentDelayMs = backoff.currentDelayMs;
  }

  snapshot() {
    const ready = this.workerAvailable && this.zoomPageOpen && this.zoomJoined && this.chatOpen;
    const warning = this.workerAvailable && this.zoomPageOpen && !ready;
    return {
      ok: ready,
      status: ready ? "healthy" : warning ? "warning" : "unhealthy",
      processAlive: true,
      dryRun: this.dryRun,
      workerAvailable: this.workerAvailable,
      zoomPageOpen: this.zoomPageOpen,
      zoomJoined: this.zoomJoined,
      waitingRoom: this.waitingRoom,
      chatOpen: this.chatOpen,
      lastSuccessfulSendAt: this.lastSuccessfulSendAt,
      lastOutboxPollAt: this.lastOutboxPollAt,
      currentDelayMs: this.currentDelayMs,
      lastError: this.lastError,
      uptimeMs: Date.now() - this.startedAt
    };
  }
}

export function redactSensitiveText(text) {
  let result = String(text || "");
  const sensitiveValues = [
    process.env.ZOOM_ONLY_SECRET,
    process.env.ZOOM_BRIDGE_SECRET
  ].filter((value) => value && String(value).length >= 4);
  for (const value of sensitiveValues) {
    result = result.split(String(value)).join("[redacted]");
  }
  result = result.replace(/(x-nafanya-zoom-secret["'\s:=]+)[^"',\s]+/giu, "$1[redacted]");
  result = result.replace(/(secret|token|key)=([^&\s]+)/giu, "$1=[redacted]");
  return result;
}
