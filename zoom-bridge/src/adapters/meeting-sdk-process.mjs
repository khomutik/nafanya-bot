import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

function splitArgs(value) {
  return String(value || "")
    .match(/(?:[^\s"]+|"[^"]*")+/gu)
    ?.map((part) => part.replace(/^"|"$/gu, "")) || [];
}

function makeDeferred(timeoutMs, timeoutMessage) {
  let timer = null;
  let settled = false;
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => {
    resolve = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      done(value);
    };
    reject = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fail(error);
    };
    timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
  });
  return { promise, resolve, reject };
}

function safeJson(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

export function createMeetingSdkProcessAdapter(config, logger = console) {
  if (!config.zoomSdkBotCommand) {
    throw new Error("ZOOM_SDK_BOT_COMMAND is required for ZOOM_ADAPTER=meeting-sdk-process");
  }

  let child = null;
  let childExit = null;
  let stdout = null;
  let nextId = 1;
  let ready = false;
  const pending = new Map();

  function sendEnvelope(envelope) {
    if (!child || child.killed || !child.stdin.writable) {
      throw new Error("Zoom SDK bot process is not running");
    }
    child.stdin.write(`${JSON.stringify(envelope)}\n`);
  }

  function settle(id, payload) {
    const item = pending.get(id);
    if (!item) return;
    pending.delete(id);
    if (payload.ok === false) {
      item.reject(new Error(payload.error || "Zoom SDK bot command failed"));
    } else {
      item.resolve(payload);
    }
  }

  async function request(type, payload, timeoutMs, timeoutMessage) {
    const id = nextId++;
    const deferred = makeDeferred(timeoutMs, timeoutMessage);
    pending.set(id, deferred);
    sendEnvelope({ id, type, ...payload });
    return deferred.promise;
  }

  return {
    name: "meeting-sdk-process",
    canAcknowledge: true,
    async start({ onMessage } = {}) {
      const args = splitArgs(config.zoomSdkBotArgs);
      child = spawn(config.zoomSdkBotCommand, args, {
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...process.env,
          ZOOM_MEETING_URL: config.zoomMeetingUrl,
          ZOOM_BOT_NAME: config.zoomBotName
        }
      });

      childExit = new Promise((resolve) => {
        child.once("close", () => resolve());
      });

      child.once("exit", (code, signal) => {
        ready = false;
        const error = new Error(`Zoom SDK bot exited with code=${code ?? ""} signal=${signal ?? ""}`);
        for (const item of pending.values()) item.reject(error);
        pending.clear();
      });

      child.stderr.on("data", (chunk) => {
        const text = String(chunk).trim();
        if (text) logger.warn(`Zoom SDK bot stderr: ${text}`);
      });

      stdout = createInterface({ input: child.stdout });
      stdout.on("line", (line) => {
        const payload = safeJson(line);
        if (!payload) {
          logger.debug(`Zoom SDK bot output: ${line}`);
          return;
        }
        if (payload.type === "ready") {
          ready = true;
          settle(payload.id, { ok: true, ready: true });
          return;
        }
        if (payload.type === "message" && payload.text) {
          onMessage?.({
            text: payload.text,
            senderName: payload.senderName || payload.sender || "Zoom",
            senderRole: payload.senderRole || "",
            source: "zoom"
          }).catch((error) => logger.warn("Incoming Zoom message failed:", error?.message || String(error)));
          return;
        }
        if (payload.id) settle(payload.id, payload);
      });

      logger.info(`Starting Zoom Meeting SDK bot process: ${config.zoomSdkBotCommand}`);
      await request(
        "start",
        { meetingUrl: config.zoomMeetingUrl, botName: config.zoomBotName },
        config.zoomSdkReadyTimeoutMs,
        "Zoom SDK bot did not become ready in time"
      );
      ready = true;
      logger.info("Zoom Meeting SDK bot is ready");
    },
    async sendMessage(text) {
      if (!ready) {
        throw new Error("Zoom SDK bot is not ready");
      }
      await request(
        "sendMessage",
        { text },
        config.zoomSdkSendTimeoutMs,
        "Zoom SDK bot did not acknowledge chat send in time"
      );
      return { sent: true, ack: true };
    },
    async stop() {
      if (!child || child.killed) return;
      try {
        sendEnvelope({ id: nextId++, type: "stop" });
        child.stdin.end();
      } catch {
        // Process may already be gone.
      }
      const timeout = setTimeout(() => {
        if (child && !child.killed) child.kill("SIGTERM");
      }, 1000);
      await Promise.race([
        childExit,
        new Promise((resolve) => setTimeout(resolve, 3000))
      ]).finally(() => {
        clearTimeout(timeout);
        stdout?.close();
      });
    }
  };
}
