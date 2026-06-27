const DEFAULT_WORKER_BASE_URL = "https://pochti-normalnye-bot.pochtinormalnye.workers.dev";
const DEFAULT_ZOOM_MEETING_URL = "https://us06web.zoom.us/j/5487249245?pwd=UE3buqca6pTDt8kGPJDW9pRoaC7gkt.1";
const DEFAULT_ZOOM_BOT_NAME = "\u041d\u0430\u0444\u0430\u043d\u044f (\u0434\u043e\u043c\u043e\u0432\u043e\u0439 \u0431\u043e\u0442)";
const SUPPORTED_ZOOM_ADAPTERS = new Set(["stub", "meeting-sdk-process"]);

function readPositiveInt(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  const integer = Math.trunc(number);
  if (integer < min) return fallback;
  return Math.min(integer, max);
}

function requireUrl(value, name) {
  try {
    return new URL(value).toString().replace(/\/+$/u, "");
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }
}

export function loadConfig(env = process.env) {
  const workerBaseUrl = requireUrl(env.WORKER_BASE_URL || DEFAULT_WORKER_BASE_URL, "WORKER_BASE_URL");
  const zoomMeetingUrl = requireUrl(env.ZOOM_MEETING_URL || DEFAULT_ZOOM_MEETING_URL, "ZOOM_MEETING_URL");
  const zoomBridgeSecret = String(env.ZOOM_BRIDGE_SECRET || "").trim();
  if (!zoomBridgeSecret) {
    throw new Error("ZOOM_BRIDGE_SECRET is required");
  }
  const zoomAdapter = String(env.ZOOM_ADAPTER || "stub").trim().toLowerCase();
  if (!SUPPORTED_ZOOM_ADAPTERS.has(zoomAdapter)) {
    throw new Error(`ZOOM_ADAPTER must be one of: ${[...SUPPORTED_ZOOM_ADAPTERS].join(", ")}`);
  }
  return {
    workerBaseUrl,
    zoomBridgeSecret,
    zoomMeetingUrl,
    zoomBotName: String(env.ZOOM_BOT_NAME || DEFAULT_ZOOM_BOT_NAME).trim() || DEFAULT_ZOOM_BOT_NAME,
    zoomAdapter,
    zoomSdkBotCommand: String(env.ZOOM_SDK_BOT_COMMAND || "").trim(),
    zoomSdkBotArgs: String(env.ZOOM_SDK_BOT_ARGS || "").trim(),
    zoomSdkReadyTimeoutMs: readPositiveInt(env.ZOOM_SDK_READY_TIMEOUT_MS, 60000, { min: 1000, max: 300000 }),
    zoomSdkSendTimeoutMs: readPositiveInt(env.ZOOM_SDK_SEND_TIMEOUT_MS, 15000, { min: 1000, max: 120000 }),
    pollIntervalMs: readPositiveInt(env.POLL_INTERVAL_MS, 1500, { min: 250, max: 60000 }),
    outboxLimit: readPositiveInt(env.OUTBOX_LIMIT, 20, { min: 1, max: 50 }),
    zoomMessageLimit: readPositiveInt(env.ZOOM_MESSAGE_LIMIT, 950, { min: 200, max: 4000 }),
    healthHost: String(env.HEALTH_HOST || "127.0.0.1").trim() || "127.0.0.1",
    healthPort: readPositiveInt(env.HEALTH_PORT, 3087, { min: 1, max: 65535 }),
    logLevel: String(env.LOG_LEVEL || "info").trim().toLowerCase()
  };
}
