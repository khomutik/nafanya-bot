import { createStubZoomAdapter } from "./adapters/stub-zoom.mjs";
import { loadConfig } from "./config.mjs";
import { startHealthServer } from "./health-server.mjs";
import { splitZoomText } from "./text.mjs";
import { WorkerClient } from "./worker-client.mjs";

function createLogger(config) {
  const levels = { error: 0, warn: 1, info: 2, debug: 3 };
  const configured = levels[config.logLevel] ?? levels.info;
  const log = (level, ...args) => {
    if ((levels[level] ?? levels.info) <= configured) {
      console[level === "debug" ? "log" : level](new Date().toISOString(), level.toUpperCase(), ...args);
    }
  };
  return {
    error: (...args) => log("error", ...args),
    warn: (...args) => log("warn", ...args),
    info: (...args) => log("info", ...args),
    debug: (...args) => log("debug", ...args)
  };
}

function createZoomAdapter(config, logger) {
  if (config.zoomAdapter === "stub") {
    return createStubZoomAdapter(config, logger);
  }
  throw new Error(`Unsupported ZOOM_ADAPTER: ${config.zoomAdapter}`);
}

async function sendOutboxMessage(adapter, message, config, logger) {
  const parts = splitZoomText(message.text, config.zoomMessageLimit);
  if (!parts.length) return false;
  for (const part of parts) {
    const result = await adapter.sendMessage(part);
    if (!result?.sent && !result?.ack) {
      logger.debug(`Outbox item ${message.id} was not acknowledged by adapter`);
      return false;
    }
  }
  return true;
}

async function run() {
  const config = loadConfig();
  const logger = createLogger(config);
  const workerClient = new WorkerClient(config);
  const adapter = createZoomAdapter(config, logger);
  const state = {
    adapter: adapter.name,
    workerConnected: false,
    lastPollAt: null,
    lastErrorAt: null,
    lastError: null,
    pendingOutbox: 0,
    fatalError: null
  };
  const healthServer = startHealthServer(config, state, logger);
  const skippedOutboxIds = new Set();
  let stopped = false;
  let polling = false;

  async function pollOnce() {
    if (stopped || polling) return;
    polling = true;
    try {
      const pulled = await workerClient.pullOutbox({ limit: config.outboxLimit });
      state.workerConnected = true;
      state.lastPollAt = new Date().toISOString();
      state.lastError = null;
      state.pendingOutbox = Array.isArray(pulled.messages) ? pulled.messages.length : 0;
      const ackIds = [];
      for (const message of pulled.messages || []) {
        const messageId = Number(message.id);
        if (adapter.canAcknowledge === false && skippedOutboxIds.has(messageId)) {
          continue;
        }
        const sent = await sendOutboxMessage(adapter, message, config, logger);
        if (sent && Number.isInteger(messageId)) {
          ackIds.push(messageId);
        } else if (Number.isInteger(messageId)) {
          skippedOutboxIds.add(messageId);
        }
      }
      if (ackIds.length) {
        await workerClient.pullOutbox({ ackIds, limit: config.outboxLimit });
        logger.info(`Acknowledged ${ackIds.length} Zoom outbox message(s)`);
      }
    } catch (error) {
      state.workerConnected = false;
      state.lastErrorAt = new Date().toISOString();
      state.lastError = error?.message || String(error);
      logger.error("Zoom bridge poll failed:", state.lastError);
    } finally {
      polling = false;
    }
  }

  await adapter.start({
    onMessage: async (payload) => workerClient.sendIncomingMessage(payload)
  });
  logger.info("Nafanya Zoom bridge started");
  await pollOnce();
  const timer = setInterval(pollOnce, config.pollIntervalMs);

  async function shutdown(signal) {
    if (stopped) return;
    stopped = true;
    logger.info(`Stopping after ${signal}`);
    clearInterval(timer);
    await adapter.stop().catch((error) => logger.warn("Adapter stop failed:", error?.message || String(error)));
    await new Promise((resolve) => healthServer.close(resolve));
  }

  process.on("SIGINT", () => shutdown("SIGINT").finally(() => process.exit(0)));
  process.on("SIGTERM", () => shutdown("SIGTERM").finally(() => process.exit(0)));
}

run().catch((error) => {
  console.error(new Date().toISOString(), "ERROR", error?.message || String(error));
  process.exit(1);
});
