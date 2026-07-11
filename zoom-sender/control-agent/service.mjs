const DEFAULT_START_TIMEOUT_MS = 90000;

function safeError(error) {
  const text = String(error?.message || error || "unknown error");
  return text
    .replace(/([?&](?:token|pwd|passcode)=)[^&\s]+/giu, "$1[redacted]")
    .replace(/(secret|token|password)\s*[:=]\s*\S+/giu, "$1=[redacted]")
    .slice(0, 500);
}

function publicHealth(health = null) {
  if (!health) return null;
  return {
    status: String(health.status || "unhealthy"),
    zoomJoined: Boolean(health.zoomJoined),
    chatOpen: Boolean(health.chatOpen),
    lastError: health.lastError ? safeError(health.lastError?.message || health.lastError) : null
  };
}

export class ZoomControlService {
  constructor(ops, { startTimeoutMs = DEFAULT_START_TIMEOUT_MS, pollMs = 2000 } = {}) {
    this.ops = ops;
    this.startTimeoutMs = startTimeoutMs;
    this.pollMs = pollMs;
    this.operation = null;
    this.lastMode = "off";
    this.lastError = null;
  }

  async status() {
    const running = await this.ops.isSenderRunning();
    const health = running ? await this.ops.getSenderHealth().catch(() => null) : null;
    let mode = running ? "starting" : "off";
    if (this.operation === "start") mode = "starting";
    else if (this.operation === "stop") mode = "stopping";
    else if (this.operation === "auth-setup") mode = "auth_setup";
    else if (running && health?.status === "healthy" && health?.zoomJoined && health?.chatOpen) mode = "ready";
    else if (running && await this.ops.detectAuthRequired().catch(() => false)) mode = "auth_required";
    else if (running && health?.status === "unhealthy") mode = "error";
    else if (!running && ["auth_required", "error"].includes(this.lastMode)) mode = this.lastMode;
    this.lastMode = mode;
    return { running, health: publicHealth(health), mode, lastError: this.lastError };
  }

  requestStart() {
    if (this.operation) return { accepted: false, reason: "operation_in_progress" };
    this.operation = "start";
    this.lastError = null;
    void this.#start().finally(() => { this.operation = null; });
    return { accepted: true, mode: "starting" };
  }

  async #start() {
    try {
      if (await this.ops.isOldBridgeRunning()) throw new Error("Старый Zoom bridge запущен. Позовите администратора.");
      if (!await this.ops.isSenderRunning()) {
        const locks = await this.ops.profileLocks();
        if (locks.length) await this.ops.clearProfileLocks();
        await this.ops.setRuntimeMode("live");
        await this.ops.startSender();
      }
      const deadline = Date.now() + this.startTimeoutMs;
      while (Date.now() < deadline) {
        const health = await this.ops.getSenderHealth().catch(() => null);
        if (health?.status === "healthy" && health.zoomJoined && health.chatOpen) {
          this.lastMode = "ready";
          return;
        }
        if (await this.ops.detectAuthRequired().catch(() => false)) {
          this.lastMode = "auth_required";
          return;
        }
        await this.ops.sleep(this.pollMs);
      }
      this.lastMode = "error";
      this.lastError = "Нафаня не успел войти в Zoom и открыть чат.";
    } catch (error) {
      this.lastMode = "error";
      this.lastError = safeError(error);
    }
  }

  async stop({ force = false } = {}) {
    if (this.operation) return { ok: false, status: 409, error: "Дождитесь завершения текущей операции." };
    const queue = await this.ops.getQueueStatus();
    if (queue?.queueOpen && !force) {
      return { ok: false, status: 409, error: "Сначала закройте очередь." };
    }
    this.operation = "stop";
    try {
      await this.ops.stopSender();
      await this.ops.setRuntimeMode("safe");
      this.lastMode = "off";
      this.lastError = null;
      return { ok: true, status: 200, mode: "off" };
    } catch (error) {
      this.lastMode = "error";
      this.lastError = safeError(error);
      return { ok: false, status: 500, error: this.lastError };
    } finally {
      this.operation = null;
    }
  }

  requestAuthSetup() {
    if (this.operation) return { accepted: false, reason: "operation_in_progress" };
    this.operation = "auth-setup";
    this.lastError = null;
    void this.#authSetup().finally(() => { this.operation = null; });
    return { accepted: true, mode: "auth_setup" };
  }

  async #authSetup() {
    try {
      await this.ops.stopSender();
      await this.ops.setRuntimeMode("auth");
      const result = await this.ops.runAuthSetup();
      await this.ops.setRuntimeMode("safe");
      if (result?.completed) {
        this.lastMode = "off";
        this.lastError = null;
      } else {
        this.lastMode = "auth_required";
        this.lastError = "Нужна ручная проверка Zoom. Позовите Машу или администратора.";
      }
    } catch (error) {
      await this.ops.setRuntimeMode("safe").catch(() => null);
      this.lastMode = "auth_required";
      this.lastError = "Нужна ручная проверка Zoom. Позовите Машу или администратора.";
    }
  }
}

export { publicHealth, safeError };
