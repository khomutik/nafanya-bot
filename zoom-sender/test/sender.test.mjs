import test from "node:test";
import assert from "node:assert/strict";
import { Backoff } from "../src/backoff.mjs";
import { loadConfig } from "../src/config.mjs";
import { startHealthServer } from "../src/health-server.mjs";
import { HealthState } from "../src/health-state.mjs";
import { ZoomSenderService, buildZoomChatLogicalKey, extractZoomChatDomMessageId, selectZoomChatCodeIngestCandidates } from "../src/sender.mjs";
import { WorkerOutboxClient } from "../src/worker-client.mjs";
import { DEFAULT_BROWSER_ARGS, buildChatMessageFingerprint, buildZoomWebClientUrl, sanitizeDiagnosticText, sanitizePageUrl } from "../src/adapters/playwright-zoom-sender.mjs";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function makeConfig() {
  return {
    workerBaseUrl: "https://worker.example",
    zoomBridgeSecret: "secret",
    outboxLimit: 20,
    minIntervalMs: 1500,
    maxIntervalMs: 30000,
    errorIntervalMs: 10000
  };
}

test("outbox client pulls zoom-only messages and sends ackIds", async () => {
  const calls = [];
  const client = new WorkerOutboxClient(makeConfig(), async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body), secret: init.headers["x-nafanya-zoom-secret"] });
    return jsonResponse({ ok: true, messages: [{ id: 1, text: "hello" }] });
  });

  const pulled = await client.pull();
  assert.equal(pulled.messages[0].text, "hello");
  await client.ack([1, "bad", 2]);
  assert.equal(calls[0].url, "https://worker.example/zoom-only/outbox");
  assert.equal(calls[0].secret, "secret");
  assert.deepEqual(calls[1].body.ackIds, [1, 2]);
});

test("outbox client sends chat ingest to dedicated endpoint", async () => {
  const calls = [];
  const client = new WorkerOutboxClient(makeConfig(), async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body), secret: init.headers["x-nafanya-zoom-secret"] });
    return jsonResponse({ ok: true, handled: true });
  });

  await client.ingestChatMessage({
    authorName: "Маня Х.",
    text: "111",
    timestamp: "03:44 PM",
    sourceFingerprint: "fp-1",
    observedAt: "now"
  });
  assert.equal(calls[0].url, "https://worker.example/zoom-only/chat-ingest");
  assert.equal(calls[0].secret, "secret");
  assert.equal(calls[0].body.text, "111");
  assert.equal(calls[0].body.authorName, "Маня Х.");
});


test("config reads dry-run and polling intervals from env with safe fallbacks", () => {
  const config = loadConfig({
    WORKER_BASE_URL: "https://worker.example/",
    ZOOM_ONLY_SECRET: "safe-secret",
    ZOOM_MEETING_URL: "https://zoom.example/meeting",
    ZOOM_DISPLAY_NAME: "Display Name",
    ZOOM_SENDER_DRY_RUN: "true",
    ZOOM_SENDER_CHAT_READONLY_DIAGNOSTICS: "true",
    ZOOM_SENDER_CHAT_INGEST_ENABLED: "true",
    ZOOM_SENDER_MIN_POLL_MS: "2000",
    ZOOM_SENDER_MAX_POLL_MS: "25000",
    ZOOM_SENDER_ERROR_POLL_MS: "7000",
    ZOOM_SENDER_HEALTH_PORT: "4001",
    ZOOM_SENDER_DIAGNOSTICS_DIR: "/tmp/zoom-diagnostics",
    ZOOM_SENDER_BROWSER_ARGS: "--one --two",
    HEADLESS: "false"
  });
  assert.equal(config.workerBaseUrl, "https://worker.example");
  assert.equal(config.zoomBridgeSecret, "safe-secret");
  assert.equal(config.participantName, "Display Name");
  assert.equal(config.dryRun, true);
  assert.equal(config.chatReadonlyDiagnostics, true);
  assert.equal(config.chatIngestEnabled, true);
  assert.equal(config.minIntervalMs, 2000);
  assert.equal(config.maxIntervalMs, 25000);
  assert.equal(config.errorIntervalMs, 7000);
  assert.equal(config.healthPort, 4001);
  assert.equal(config.diagnosticsDir, "/tmp/zoom-diagnostics");
  assert.deepEqual(config.browserArgs, ["--one", "--two"]);
  assert.equal(config.headless, false);

  const fallback = loadConfig({
    ZOOM_SENDER_MIN_POLL_MS: "bad",
    ZOOM_SENDER_MAX_POLL_MS: "-10",
    ZOOM_SENDER_ERROR_POLL_MS: "also-bad"
  });
  assert.equal(fallback.minIntervalMs, 1500);
  assert.equal(fallback.maxIntervalMs, 1500);
  assert.equal(fallback.errorIntervalMs, 10000);
  assert.equal(fallback.chatReadonlyDiagnostics, false);
  assert.equal(fallback.chatIngestEnabled, false);
});

test("diagnostics sanitize Zoom URLs before saving", () => {
  assert.equal(
    sanitizePageUrl("https://us06web.zoom.us/j/123456789?pwd=secret&zak=token#join"),
    "https://us06web.zoom.us/j/123456789"
  );
  assert.equal(sanitizePageUrl("not-a-url?pwd=secret"), "not-a-url");
  assert.equal(
    sanitizeDiagnosticText("go https://zoom.us/j/123?pwd=secret&zak=token and x-nafanya-zoom-secret abc"),
    "go https://zoom.us/j/123 and x-nafanya-zoom-secret [redacted]"
  );
  assert.equal(
    buildZoomWebClientUrl("https://us06web.zoom.us/j/123456789?pwd=secret"),
    "https://us06web.zoom.us/wc/join/123456789?pwd=secret"
  );
});

test("sender acks only messages successfully sent to Zoom", async () => {
  const acked = [];
  const workerClient = {
    async pull() {
      return { messages: [{ id: 1, text: "one" }, { id: 2, text: "two" }] };
    },
    async ack(ids) {
      acked.push(...ids);
      return { ok: true };
    }
  };
  const zoomAdapter = {
    async start() { return { zoomPageOpen: true, zoomJoined: true, chatOpen: true }; },
    async getPresence() { return { zoomPageOpen: true, zoomJoined: true, chatOpen: true }; },
    async sendMessage(text) {
      if (text === "two") throw new Error("send failed");
      return { sent: true, ack: true };
    }
  };
  const service = new ZoomSenderService({
    workerClient,
    zoomAdapter,
    backoff: new Backoff(makeConfig()),
    health: new HealthState(),
    logger: { info() {}, warn() {} }
  });

  const result = await service.runOnce();
  assert.deepEqual(acked, []);
  assert.equal(result.ackIds.length, 0);
  assert.match(result.error.message, /send failed/u);
});

test("sender does not ack failed individual sends that return no ack", async () => {
  const acked = [];
  const workerClient = {
    async pull() {
      return { messages: [{ id: 1, text: "one" }, { id: 2, text: "two" }] };
    },
    async ack(ids) {
      acked.push(...ids);
      return { ok: true };
    }
  };
  const zoomAdapter = {
    async getPresence() { return { zoomPageOpen: true, zoomJoined: true, chatOpen: true }; },
    async sendMessage(text) {
      return text === "one" ? { sent: true, ack: true } : { sent: false, ack: false };
    }
  };
  const service = new ZoomSenderService({
    workerClient,
    zoomAdapter,
    backoff: new Backoff(makeConfig()),
    health: new HealthState(),
    logger: { info() {}, warn() {} }
  });

  const result = await service.runOnce();
  assert.deepEqual(acked, [1]);
  assert.deepEqual(result.ackIds, [1]);
});

test("empty outbox increases backoff and does not hammer Worker every 1.5 seconds", async () => {
  const backoff = new Backoff(makeConfig());
  const service = new ZoomSenderService({
    workerClient: { async pull() { return { messages: [] }; } },
    zoomAdapter: { async getPresence() { return { zoomPageOpen: true, zoomJoined: true, chatOpen: true }; } },
    backoff,
    health: new HealthState(),
    logger: { info() {}, warn() {} }
  });

  assert.equal((await service.runOnce()).delayMs, 3000);
  assert.equal((await service.runOnce()).delayMs, 6000);
  assert.equal((await service.runOnce()).delayMs, 12000);
  assert.equal((await service.runOnce()).delayMs, 24000);
  assert.equal((await service.runOnce()).delayMs, 30000);
});

test("messages reset backoff to minimum, errors back off without becoming frantic", async () => {
  const backoff = new Backoff(makeConfig());
  backoff.onMessages(0);
  backoff.onMessages(0);
  assert.equal(backoff.currentDelayMs, 6000);
  assert.equal(backoff.onMessages(1), 1500);
  assert.equal(backoff.onError(), 10000);
  assert.equal(backoff.onError(), 20000);
});

test("sender-only code does not import queue engine or call Worker webhook", async () => {
  const senderSources = await Promise.all([
    import("node:fs/promises").then((fs) => fs.readFile(new URL("../src/sender.mjs", import.meta.url), "utf8")),
    import("node:fs/promises").then((fs) => fs.readFile(new URL("../src/worker-client.mjs", import.meta.url), "utf8")),
    import("node:fs/promises").then((fs) => fs.readFile(new URL("../src/adapters/playwright-zoom-sender.mjs", import.meta.url), "utf8"))
  ]);
  const source = senderSources.join("\n");
  assert.doesNotMatch(source, /queue-engine|parseQueueEntry|parseZoomCommand/u);
  assert.match(source, /selectZoomChatCodeIngestCandidates/u);
  assert.doesNotMatch(source, /\/zoom-only\/webhook|sendIncomingMessage|parseZoomCommand/u);
  assert.match(source, /\/zoom-only\/outbox/u);
});

test("Zoom browser adapter handles the Zoom web landing gate and read-only diagnostics stays isolated", async () => {
  const fs = await import("node:fs/promises");
  const source = await fs.readFile(new URL("../src/adapters/playwright-zoom-sender.mjs", import.meta.url), "utf8");
  assert.match(source, /join from browser/iu);
  assert.match(source, /decline cookies|accept cookies/iu);
  assert.match(source, /continue without microphone and camera/iu);
  assert.match(source, /getByText\(pattern\)/u);
  assert.match(source, /button, a, \[role='button'\]/u);
  assert.match(source, /input\[type="text"\]:visible/u);
  assert.match(source, /after-fill-name/u);
  assert.match(source, /nameFilled/u);
  assert.match(source, /page\.on\("console"/u);
  assert.match(source, /page\.on\("requestfailed"/u);
  assert.match(source, /chat-readonly-diagnostics\.jsonl/u);
  assert.doesNotMatch(source, /\/zoom-only\/webhook|parseQueueEntry|parseZoomCommand/u);
});

test("read-only chat diagnostics observes without sending or calling webhook", async () => {
  let observed = 0;
  let sent = 0;
  const workerUrls = [];
  const service = new ZoomSenderService({
    workerClient: {
      async pull() {
        workerUrls.push("/zoom-only/outbox");
        return { messages: [] };
      }
    },
    zoomAdapter: {
      async getPresence() { return { zoomPageOpen: true, zoomJoined: true, chatOpen: true }; },
      async observeChatDiagnostics() {
        observed += 1;
        return { enabled: true, newMessages: 1 };
      },
      async sendMessage() {
        sent += 1;
        return { sent: true, ack: true };
      }
    },
    backoff: new Backoff(makeConfig()),
    health: new HealthState(),
    logger: { info() {}, warn() {} }
  });

  const result = await service.runOnce();
  assert.equal(observed, 1);
  assert.equal(sent, 0);
  assert.equal(result.messages, 0);
  assert.deepEqual(workerUrls, ["/zoom-only/outbox"]);
  assert.ok(workerUrls.every((url) => url !== "/zoom-only/webhook"));
});

test("chat diagnostics fingerprint is stable and separates duplicates from different authors", () => {
  const first = buildChatMessageFingerprint({ displayName: "Маша", text: "111", timestamp: "10:00", domPath: "div:1" });
  const duplicate = buildChatMessageFingerprint({ displayName: "Маша", text: "111", timestamp: "10:00", domPath: "div:1" });
  const sameTextOtherNode = buildChatMessageFingerprint({ displayName: "Маша", text: "111", timestamp: "10:00", domPath: "div:2" });
  const otherAuthor = buildChatMessageFingerprint({ displayName: "Маня", text: "111", timestamp: "10:00", domPath: "div:1" });
  assert.equal(first, duplicate);
  assert.notEqual(first, sameTextOtherNode);
  assert.notEqual(first, otherAuthor);
  assert.match(first, /^chat-[0-9a-f]{8}$/u);
});

test("chat ingest candidates include only atomic queue codes and ignore aggregates", () => {
  const messages = [
    { displayName: "Маня Х.", text: "Маня Х. to Everyone 03:44 PM 111 111 привет 222", timestamp: "03:44 PM", fingerprint: "agg" },
    { displayName: "Маня Х.", text: "Маня Х. to Everyone 03:44 PM 111", timestamp: "03:44 PM", fingerprint: "full-111" },
    { displayName: "привет", text: "привет", timestamp: "", fingerprint: "hi" },
    { displayName: "Рабочее собрание", text: "Рабочее собрание Пишите в чат \"111\" для высказывания ОЧЕРЕДЬ ОТКРЫТА • 1. Маня Х. — 111", timestamp: "", fingerprint: "own-queue" },
    { displayName: "222", text: "222", timestamp: "", fingerprint: "two" },
    { displayName: "Маня Х.", text: "Маня Х. to Everyone 03:44 PM 222", timestamp: "03:44 PM", fingerprint: "full-222" },
    { displayName: "Маня Х.", text: "Маня Х. to Everyone 03:45 PM 333", timestamp: "03:45 PM", fingerprint: "full-333" },
    { displayName: "Маня Х.", text: "Маня Х. to Everyone 03:46 PM 444", timestamp: "03:46 PM", fingerprint: "full-444" },
    { displayName: "Маня Х.", text: "111 111 привет 222", timestamp: "", fingerprint: "words" }
  ];
  const candidates = selectZoomChatCodeIngestCandidates(messages);
  assert.equal(candidates.length, 4);
  assert.deepEqual(candidates.map((candidate) => candidate.authorName), ["Маня Х.", "Маня Х.", "Маня Х.", "Маня Х."]);
  assert.deepEqual(candidates.map((candidate) => candidate.text), ["111", "222", "333", "444"]);
  assert.deepEqual(candidates.map((candidate) => candidate.sourceFingerprint), ["full-111", "full-222", "full-333", "full-444"]);
});

test("chat ingest candidates parse atomic child codes from one Zoom message group", () => {
  const messages = ["111", "222", "333", "444"].map((code, index) => ({
    displayName: "Маня Х.",
    text: code,
    timestamp: "07:36 PM",
    fingerprint: `group-${code}`,
    rawDom: `<span id="chat-message-content-fast-${index}">${code}</span>`,
    groupAuthorName: "Маня Х.",
    groupTimestamp: "07:36 PM",
    groupText: "Маня Х. to Everyone 07:36 PM 111 222 333 444",
    groupStableId: "chat-message-content-fast-group",
    childIndex: String(index)
  }));

  const candidates = selectZoomChatCodeIngestCandidates(messages);
  assert.equal(candidates.length, 4);
  assert.deepEqual(candidates.map((candidate) => candidate.authorName), ["Маня Х.", "Маня Х.", "Маня Х.", "Маня Х."]);
  assert.deepEqual(candidates.map((candidate) => candidate.text), ["111", "222", "333", "444"]);
});

test("chat ingest candidates ignore unsafe bare chunks and queue publications", () => {
  const messages = [
    { displayName: "222", text: "222", timestamp: "", fingerprint: "bare-222" },
    {
      displayName: "Маня Х.",
      text: "111 222 333",
      timestamp: "07:36 PM",
      fingerprint: "aggregate",
      groupAuthorName: "Маня Х.",
      groupTimestamp: "07:36 PM",
      groupText: "Маня Х. to Everyone 07:36 PM 111 222 333",
      groupStableId: "group-aggregate",
      childIndex: "0"
    },
    {
      displayName: "Нафаня",
      text: "111",
      timestamp: "07:36 PM",
      fingerprint: "own-code",
      groupAuthorName: "Нафаня",
      groupTimestamp: "07:36 PM",
      groupText: "Рабочее собрание ОЧЕРЕДЬ ОТКРЫТА 1. Маня Х. — 111",
      groupStableId: "own-publication",
      childIndex: "1"
    }
  ];

  assert.equal(selectZoomChatCodeIngestCandidates(messages).length, 0);
});

test("chat ingest candidates deduplicate cloned child codes but allow a new group", () => {
  const base = {
    displayName: "Маня Х.",
    text: "111",
    timestamp: "07:36 PM",
    rawDom: '<span id="7-{9d167db1-997c-444c-844d-ba7195fc4412}">111</span>',
    groupAuthorName: "Маня Х.",
    groupTimestamp: "07:36 PM",
    groupText: "Маня Х. to Everyone 07:36 PM 111",
    groupStableId: "fast-group-a",
    childIndex: "0"
  };
  const candidates = selectZoomChatCodeIngestCandidates([
    { ...base, fingerprint: "clone-a" },
    { ...base, fingerprint: "clone-b" },
    {
      ...base,
      fingerprint: "new-real-message",
      rawDom: '<span id="8-{9d167db1-997c-444c-844d-ba7195fc4413}">111</span>',
      groupStableId: "fast-group-b"
    }
  ]);

  assert.equal(candidates.length, 2);
  assert.deepEqual(candidates.map((candidate) => candidate.sourceFingerprint), ["clone-a", "new-real-message"]);
});

test("chat ingest candidates use Zoom aria-label from raw DOM when group fields are empty", () => {
  const candidates = selectZoomChatCodeIngestCandidates([
    {
      displayName: "333",
      text: "333",
      timestamp: "",
      fingerprint: "raw-dom-333",
      rawDom: '<div class="new-chat-message__container" id="chat-message-content-3" aria-label="Маня Х. to Everyone, 03:43 PM, 333" role="row"><p>333</p></div>',
      groupAuthorName: "",
      groupTimestamp: "",
      groupText: "333",
      groupStableId: "group-35",
      childIndex: "0"
    }
  ]);

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].authorName, "Маня Х.");
  assert.equal(candidates[0].text, "333");
  assert.equal(candidates[0].sourceFingerprint, "raw-dom-333");
});

test("chat ingest candidates deduplicate DOM clones of one Zoom message", () => {
  const rawDom = '<div id="chat-message-content-17" aria-label="Маня Х. to Everyone, 09:06 PM, 111"><div id="6-{9d167db1-997c-444c-844d-ba7195fc4412}">111</div></div>';
  const messages = [
    {
      displayName: "Маня Х.",
      text: "Маня Х. to Everyone 09:06 PM 111",
      timestamp: "Маня Х. to Everyone 09:06 PM 111",
      fingerprint: "clone-a",
      rawDom
    },
    {
      displayName: "Маня Х.",
      text: "Маня Х. to Everyone 09:06 PM 111",
      timestamp: "Маня Х. to Everyone 09:06 PM 111",
      fingerprint: "clone-b",
      rawDom: '<div class="child"><div id="6-{9d167db1-997c-444c-844d-ba7195fc4412}">111</div></div>'
    }
  ];
  const candidates = selectZoomChatCodeIngestCandidates(messages);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].sourceFingerprint, "clone-a");
  assert.match(candidates[0].logicalKey, /^aria\|/u);
  assert.ok(candidates[0].logicalAliases.some((key) => /9d167db1-997c-444c-844d-ba7195fc4412/u.test(key)));
});

test("chat ingest candidates deduplicate clones by canonical aria label before DOM ids", () => {
  const messages = [
    {
      displayName: "444",
      text: "444",
      timestamp: "",
      fingerprint: "clone-a",
      rawDom: '<div id="chat-item-container-4" aria-label="Маня Х. to Everyone, 03:51 PM, 444">444</div>',
      groupStableId: "chat-item-container-4"
    },
    {
      displayName: "444",
      text: "444",
      timestamp: "",
      fingerprint: "clone-b",
      rawDom: '<div id="group-18" aria-label="Маня Х. to Everyone, 03:51 PM, 444">444</div>',
      groupStableId: "group-18"
    },
    {
      displayName: "444",
      text: "444",
      timestamp: "",
      fingerprint: "clone-c",
      rawDom: '<div id="group-19" aria-label="Маня Х. to Everyone, 03:51 PM, 444">444</div>',
      groupStableId: "group-19"
    }
  ];

  const candidates = selectZoomChatCodeIngestCandidates(messages);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].text, "444");
  assert.equal(candidates[0].authorName, "Маня Х.");
  assert.match(candidates[0].logicalKey, /^aria\|/u);
});

test("chat ingest candidates keep fast 111/222/333/444 as four real messages", () => {
  const messages = ["111", "222", "333", "444"].map((code, index) => ({
    displayName: code,
    text: code,
    timestamp: "",
    fingerprint: `fast-${code}`,
    rawDom: `<div id="chat-item-container-${index + 1}" aria-label="Маня Х. to Everyone, 03:52 PM, ${code}">${code}</div>`,
    groupStableId: `chat-item-container-${index + 1}`
  }));

  const candidates = selectZoomChatCodeIngestCandidates(messages);
  assert.equal(candidates.length, 4);
  assert.deepEqual(candidates.map((candidate) => candidate.text), ["111", "222", "333", "444"]);
  assert.ok(candidates.every((candidate) => candidate.logicalKey.startsWith("aria|")));
});

test("chat logical dedup keeps separate real repeated messages from same author", () => {
  const first = {
    displayName: "Маня Х.",
    text: "Маня Х. to Everyone 09:06 PM 111",
    timestamp: "09:06 PM",
    rawDom: '<div id="chat-message-content-21" aria-label="Маня Х. to Everyone, 09:06 PM, 111">111</div>'
  };
  const second = {
    displayName: "Маня Х.",
    text: "Маня Х. to Everyone 09:07 PM 111",
    timestamp: "09:07 PM",
    rawDom: '<div id="chat-message-content-22" aria-label="Маня Х. to Everyone, 09:07 PM, 111">111</div>'
  };
  assert.equal(extractZoomChatDomMessageId(first.rawDom), "chat-message-content-21");
  assert.equal(extractZoomChatDomMessageId(second.rawDom), "chat-message-content-22");
  assert.notEqual(buildZoomChatLogicalKey(first, { authorName: "Маня Х.", text: "111" }), buildZoomChatLogicalKey(second, { authorName: "Маня Х.", text: "111" }));
});

test("chat ingest logical memory skips clones across cycles but allows new message ids", async () => {
  const ingested = [];
  const logs = [];
  const service = new ZoomSenderService({
    workerClient: {
      async ingestChatMessage(message) {
        ingested.push(message);
        return { ok: true, handled: true };
      },
      async pull() {
        return { messages: [] };
      }
    },
    zoomAdapter: {
      config: { chatIngestEnabled: true },
      async getPresence() { return { zoomPageOpen: true, zoomJoined: true, chatOpen: true }; },
      async observeChatDiagnostics() {
        return {
          messages: [
            {
              displayName: "Маня Х.",
              text: "Маня Х. to Everyone 09:06 PM 111",
              timestamp: "09:06 PM",
              fingerprint: `fp-${ingested.length}-clone-a`,
              rawDom: '<div id="chat-message-content-31">111</div>'
            },
            {
              displayName: "Маня Х.",
              text: "Маня Х. to Everyone 09:06 PM 111",
              timestamp: "09:06 PM",
              fingerprint: `fp-${ingested.length}-clone-b`,
              rawDom: '<div><div id="chat-message-content-31">111</div></div>'
            }
          ]
        };
      }
    },
    backoff: new Backoff(makeConfig()),
    health: new HealthState(),
    logger: { info(message) { logs.push(String(message)); }, warn() {} }
  });

  await service.runOnce();
  await service.runOnce();
  assert.equal(ingested.length, 1);
  assert.ok(logs.some((message) => /skipped duplicate chat queue-code candidate/u.test(message)));

  service.zoomAdapter.observeChatDiagnostics = async () => ({
    messages: [{
      displayName: "Маня Х.",
      text: "Маня Х. to Everyone 09:06 PM 111",
      timestamp: "09:06 PM",
      fingerprint: "new-real-message",
      rawDom: '<div id="chat-message-content-32">111</div>'
    }]
  });
  await service.runOnce();
  assert.equal(ingested.length, 2);
});

test("chat ingest logical memory also skips repeated source fingerprints", async () => {
  const ingested = [];
  const logs = [];
  const service = new ZoomSenderService({
    workerClient: {
      async ingestChatMessage(message) {
        ingested.push(message);
        return { ok: true, handled: true };
      },
      async pull() {
        return { messages: [] };
      }
    },
    zoomAdapter: {
      config: { chatIngestEnabled: true },
      async getPresence() { return { zoomPageOpen: true, zoomJoined: true, chatOpen: true }; },
      async observeChatDiagnostics() {
        return {
          messages: [{
            displayName: "Маня Х.",
            text: "Маня Х. to Everyone 09:06 PM 222",
            timestamp: "09:06 PM",
            fingerprint: "same-fp",
            rawDom: `<div id="chat-message-content-${31 + ingested.length}">222</div>`
          }]
        };
      }
    },
    backoff: new Backoff(makeConfig()),
    health: new HealthState(),
    logger: { info(message) { logs.push(String(message)); }, warn() {} }
  });

  await service.runOnce();
  await service.runOnce();
  assert.equal(ingested.length, 1);
  assert.ok(logs.some((message) => /source fingerprint/u.test(message)));
});

test("chat ingest forwards only safe candidates and never sends Zoom replies", async () => {
  const ingested = [];
  let sent = 0;
  const service = new ZoomSenderService({
    workerClient: {
      async ingestChatMessage(message) {
        ingested.push(message);
        return { ok: true, handled: true };
      },
      async pull() {
        return { messages: [] };
      }
    },
    zoomAdapter: {
      config: { chatIngestEnabled: true },
      async getPresence() { return { zoomPageOpen: true, zoomJoined: true, chatOpen: true }; },
      async observeChatDiagnostics() {
        return {
          messages: [
            { displayName: "Маня Х.", text: "Маня Х. to Everyone 03:44 PM 111 111 привет 222", timestamp: "03:44 PM", fingerprint: "agg" },
            { displayName: "Маня Х.", text: "Маня Х. to Everyone 03:44 PM 111", timestamp: "03:44 PM", fingerprint: "full-111" },
            { displayName: "222", text: "222", timestamp: "", fingerprint: "two" },
            { displayName: "Маня Х.", text: "Маня Х. to Everyone 03:45 PM 222", timestamp: "03:45 PM", fingerprint: "full-222" },
            { displayName: "Рабочее собрание", text: "Рабочее собрание Пишите в чат \"111\" для высказывания ОЧЕРЕДЬ ОТКРЫТА • 1. Маня Х. — 111", timestamp: "", fingerprint: "own-queue" },
            { displayName: "привет", text: "привет", timestamp: "", fingerprint: "hi" }
          ]
        };
      },
      async sendMessage() {
        sent += 1;
        return { sent: true, ack: true };
      }
    },
    backoff: new Backoff(makeConfig()),
    health: new HealthState(),
    logger: { info() {}, warn() {} }
  });

  await service.runOnce();
  assert.equal(ingested.length, 2);
  assert.equal(ingested[0].authorName, "Маня Х.");
  assert.equal(ingested[0].text, "111");
  assert.equal(ingested[1].authorName, "Маня Х.");
  assert.equal(ingested[1].text, "222");
  assert.equal(sent, 0);
});

test("real-mode browser launch uses safe Zoom Web Client flags", () => {
  assert.ok(DEFAULT_BROWSER_ARGS.includes("--no-sandbox"));
  assert.ok(DEFAULT_BROWSER_ARGS.includes("--disable-dev-shm-usage"));
  assert.ok(DEFAULT_BROWSER_ARGS.includes("--use-fake-ui-for-media-stream"));
  assert.ok(DEFAULT_BROWSER_ARGS.includes("--use-fake-device-for-media-stream"));
  assert.ok(DEFAULT_BROWSER_ARGS.includes("--disable-blink-features=AutomationControlled"));
});

test("docker packaging is sender-only and contains no obvious secrets", async () => {
  const fs = await import("node:fs/promises");
  const [dockerfile, compose, envExample, runbook] = await Promise.all([
    fs.readFile(new URL("../Dockerfile", import.meta.url), "utf8"),
    fs.readFile(new URL("../compose.example.yml", import.meta.url), "utf8"),
    fs.readFile(new URL("../.env.example", import.meta.url), "utf8"),
    fs.readFile(new URL("../RUNBOOK.md", import.meta.url), "utf8")
  ]);
  assert.match(dockerfile, /node src\/main\.mjs/u);
  assert.match(dockerfile, /ZOOM_AUTH_SETUP/u);
  assert.match(dockerfile, /node src\/auth-setup\.mjs/u);
  assert.match(dockerfile, /playwright install --with-deps chromium/u);
  assert.match(dockerfile, /xvfb xauth x11-utils/u);
  assert.match(dockerfile, /Xvfb :99/u);
  assert.match(compose, /service|zoom-sender/u);
  assert.match(compose, /healthcheck:/u);
  assert.match(compose, /zoom-sender-profile:\/app\/profile/u);
  assert.match(compose, /\.\/diagnostics:\/app\/diagnostics/u);
  assert.match(envExample, /ZOOM_ONLY_SECRET=/u);
  assert.match(envExample, /ZOOM_AUTH_SETUP=false/u);
  assert.match(envExample, /ZOOM_AUTH_EMAIL=\s*(?:\r?\n)/u);
  assert.match(envExample, /ZOOM_AUTH_PASSWORD=\s*(?:\r?\n)/u);
  assert.match(envExample, /ZOOM_AUTH_WAIT_FOR_MANUAL=false/u);
  assert.doesNotMatch(envExample, /replace-with-worker-secret|super-secret|sk-[a-z0-9]/iu);
  assert.match(runbook, /не запускать старый `zoom-bridge`/iu);
  assert.match(runbook, /не вызывает `\/zoom-only\/webhook`/iu);
});

test("auth setup uses server env credentials without hardcoded secrets or artifacts", async () => {
  const fs = await import("node:fs/promises");
  const source = await fs.readFile(new URL("../src/auth-setup.mjs", import.meta.url), "utf8");
  assert.match(source, /ZOOM_AUTH_EMAIL/u);
  assert.match(source, /ZOOM_AUTH_PASSWORD/u);
  assert.match(source, /ZOOM_AUTH_WAIT_FOR_MANUAL/u);
  assert.match(source, /waiting for manual verification/u);
  assert.match(source, /\\\/wc\\\//u);
  assert.match(source, /join\|enter meeting info\|your name/u);
  assert.match(source, /Zoom auth profile setup completed/u);
  assert.match(source, /hasFirstVisible/u);
  assert.match(source, /launchPersistentContext/u);
  assert.match(source, /manual_verification_required/u);
  assert.doesNotMatch(source, /screenshot|storageState|cookies\(\)|console\.log\([^)]*email|console\.log\([^)]*password/iu);
});

test("health reports warning/unhealthy unless Zoom page and chat are ready", () => {
  const health = new HealthState();
  health.markWorkerPoll();
  health.updateBackoff({ currentDelayMs: 1500 });
  let snapshot = health.snapshot();
  assert.equal(snapshot.ok, false);
  assert.equal(snapshot.status, "unhealthy");

  health.updateZoom({ zoomPageOpen: true, zoomJoined: false, chatOpen: false, waitingRoom: true });
  snapshot = health.snapshot();
  assert.equal(snapshot.ok, false);
  assert.equal(snapshot.status, "warning");
  assert.equal(snapshot.waitingRoom, true);

  health.updateZoom({ zoomPageOpen: true, zoomJoined: true, chatOpen: false });
  snapshot = health.snapshot();
  assert.equal(snapshot.status, "warning");

  health.updateZoom({ zoomPageOpen: true, zoomJoined: true, chatOpen: true });
  health.markSend();
  health.clearError();
  snapshot = health.snapshot();
  assert.equal(snapshot.ok, true);
  assert.equal(snapshot.status, "healthy");
  assert.ok(snapshot.lastSuccessfulSendAt);

  health.markError(new Error("boom"));
  snapshot = health.snapshot();
  assert.match(snapshot.lastError.message, /boom/u);
});

test("health endpoint answers and dry-run does not pretend real Zoom is ready", async () => {
  const health = new HealthState({ dryRun: true });
  health.markWorkerPoll();
  health.updateBackoff({ currentDelayMs: 30000 });
  const server = startHealthServer(
    { healthHost: "127.0.0.1", healthPort: 0 },
    health,
    { info() {} }
  );
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/health`);
  const body = await response.json();
  await new Promise((resolve) => server.close(resolve));

  assert.equal(response.status, 503);
  assert.equal(body.dryRun, true);
  assert.equal(body.workerAvailable, true);
  assert.equal(body.zoomPageOpen, false);
  assert.equal(body.status, "unhealthy");
});

test("health lastError redacts secret-looking values", () => {
  const previousSecret = process.env.ZOOM_ONLY_SECRET;
  process.env.ZOOM_ONLY_SECRET = "super-secret-token";
  try {
    const health = new HealthState();
    health.markError(new Error("Worker rejected secret=super-secret-token and x-nafanya-zoom-secret super-secret-token"));
    const snapshot = health.snapshot();
    assert.doesNotMatch(snapshot.lastError.message, /super-secret-token/u);
    assert.match(snapshot.lastError.message, /\[redacted\]/u);
  } finally {
    if (previousSecret === undefined) {
      delete process.env.ZOOM_ONLY_SECRET;
    } else {
      process.env.ZOOM_ONLY_SECRET = previousSecret;
    }
  }
});
