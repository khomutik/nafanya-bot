import test from "node:test";
import assert from "node:assert/strict";
import { ZoomControlService, publicHealth, safeError } from "../control-agent/service.mjs";
import { updateEnvText } from "../control-agent/docker-ops.mjs";
import { buildControlHtml } from "../control-agent/html.mjs";

function fakeOps(overrides = {}) {
  const calls = [];
  const ops = {
    calls,
    async isOldBridgeRunning() { return false; },
    async isSenderRunning() { return false; },
    async profileLocks() { return []; },
    async clearProfileLocks() { calls.push("clear-locks"); },
    async setRuntimeMode(mode) { calls.push(`mode:${mode}`); },
    async startSender() { calls.push("start-sender"); },
    async stopSender() { calls.push("stop-sender"); },
    async getSenderHealth() { return { status: "healthy", zoomJoined: true, chatOpen: true, lastError: null }; },
    async getQueueStatus() { return { queueOpen: false, outboxSize: 0 }; },
    async detectAuthRequired() { return false; },
    async startAuthSetup() { calls.push("auth-setup:start"); return "a".repeat(64); },
    async getAuthSetupState() { return { state: "completed" }; },
    async stopAuthSetup() { calls.push("auth-setup:stop"); },
    async sleep() {},
    ...overrides
  };
  return ops;
}

test("control status reports sender off", async () => {
  const service = new ZoomControlService(fakeOps());
  assert.deepEqual(await service.status(), { running: false, health: null, mode: "off", authSetupState: "auth_setup_idle", authViewAvailable: false, lastError: null });
});

test("control start uses only live mode and sender start", async () => {
  let running = false;
  const ops = fakeOps({
    async isSenderRunning() { return running; },
    async startSender() { ops.calls.push("start-sender"); running = true; }
  });
  const service = new ZoomControlService(ops, { startTimeoutMs: 20, pollMs: 1 });
  assert.equal(service.requestStart().accepted, true);
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.deepEqual(ops.calls, ["mode:live", "start-sender"]);
  assert.equal((await service.status()).mode, "ready");
  assert.ok(!ops.calls.some((call) => /bridge/iu.test(call)));
});

test("control start refuses to run while old bridge is active", async () => {
  const ops = fakeOps({ async isOldBridgeRunning() { return true; } });
  const service = new ZoomControlService(ops, { startTimeoutMs: 10, pollMs: 1 });
  service.requestStart();
  await new Promise((resolve) => setTimeout(resolve, 5));
  const status = await service.status();
  assert.equal(status.mode, "error");
  assert.match(status.lastError, /bridge/iu);
  assert.ok(!ops.calls.includes("start-sender"));
});

test("control stop blocks while queue is open", async () => {
  const ops = fakeOps({ async getQueueStatus() { return { queueOpen: true }; } });
  const service = new ZoomControlService(ops);
  const result = await service.stop();
  assert.equal(result.status, 409);
  assert.match(result.error, /Сначала закройте очередь/u);
  assert.ok(!ops.calls.includes("stop-sender"));
});

test("control stop uses only sender stop and safe mode", async () => {
  const ops = fakeOps();
  const service = new ZoomControlService(ops);
  const result = await service.stop();
  assert.equal(result.ok, true);
  assert.deepEqual(ops.calls, ["stop-sender", "mode:safe"]);
});

test("auth-required and safe public errors do not expose secrets", async () => {
  const ops = fakeOps({ async isSenderRunning() { return true; }, async detectAuthRequired() { return true; }, async getSenderHealth() { return { status: "warning", zoomJoined: false, chatOpen: false }; } });
  const service = new ZoomControlService(ops);
  assert.equal((await service.status()).mode, "auth_required");
  const error = safeError("token=abcd password=hunter2");
  assert.doesNotMatch(error, /abcd|hunter2/u);
  assert.deepEqual(publicHealth({ status: "unhealthy", lastError: { message: "secret=hidden" } }).lastError, "secret=[redacted]");
});

test("env mode updates only whitelisted values", () => {
  const result = updateEnvText("ZOOM_SENDER_DRY_RUN=true\nZOOM_MEETING_URL=private\n", { ZOOM_SENDER_DRY_RUN: "false", ZOOM_AUTH_SETUP: "false" });
  assert.match(result, /ZOOM_SENDER_DRY_RUN=false/u);
  assert.match(result, /ZOOM_AUTH_SETUP=false/u);
  assert.match(result, /ZOOM_MEETING_URL=private/u);
});

test("control page exposes human buttons and statuses without secrets", () => {
  const html = buildControlHtml();
  assert.match(html, /Включить Нафаню/u);
  assert.match(html, /Выключить Нафаню/u);
  assert.match(html, /В Zoom, чат открыт/u);
  assert.match(html, /Нужен вход в Zoom/u);
  assert.match(html, /Открыть окно Zoom для входа/u);
  assert.match(html, /Остановить восстановление входа/u);
  assert.match(html, /\.\/vnc\/vnc\.html/u);
  assert.match(html, /\.auth-help\[hidden\]\{display:none\}/u);
  assert.doesNotMatch(html, /ZOOM_CONTROL_TOKEN|ZOOM_PANEL_TOKEN|ZOOM_MEETING_URL/u);
});

test("control HTTP entrypoint uses protected cookie and fixed routes", async () => {
  const fs = await import("node:fs/promises");
  const source = await fs.readFile(new URL("../control-agent/main.mjs", import.meta.url), "utf8");
  assert.match(source, /timingSafeEqual/u);
  assert.match(source, /HttpOnly; Secure; SameSite=Strict/u);
  assert.match(source, /\/api\/start/u);
  assert.match(source, /\/api\/stop/u);
  assert.match(source, /\/api\/auth-setup/u);
  assert.match(source, /\/auth\/check/u);
  assert.match(source, /\/api\/auth-setup\/stop/u);
  assert.match(source, /const actionPath = "\.\/zoom-only\/app\/action"/u);
  assert.match(source, /const statusPath = "\.\/zoom-only\/status"/u);
  assert.doesNotMatch(source, /child_process|exec\(|spawn\(/u);
});

test("control compose binds localhost and keeps a separate service", async () => {
  const fs = await import("node:fs/promises");
  const compose = await fs.readFile(new URL("../control-agent.compose.example.yml", import.meta.url), "utf8");
  assert.match(compose, /127\.0\.0\.1:3098:3098/u);
  assert.match(compose, /nafanya-zoom-control/u);
  assert.match(compose, /\/var\/run\/docker\.sock/u);
  assert.doesNotMatch(compose, /ZOOM_CONTROL_TOKEN:\s*\S+/u);
});

test("auth setup exposes protected view state and closes it after completion", async () => {
  let authState = "waiting";
  const ops = fakeOps({
    async getAuthSetupState() { const state = authState; authState = "completed"; return { state }; },
    async sleep() { await new Promise((resolve) => setTimeout(resolve, 3)); }
  });
  const service = new ZoomControlService(ops, { authTimeoutMs: 50, pollMs: 1 });
  assert.equal(service.requestAuthSetup().accepted, true);
  assert.equal((await service.status()).authViewAvailable, false);
  await new Promise((resolve) => setTimeout(resolve, 2));
  assert.deepEqual(ops.calls.slice(0, 4), ["stop-sender", "clear-locks", "mode:auth", "auth-setup:start"]);
  const waiting = await service.status();
  assert.equal(waiting.authSetupState, "auth_setup_waiting_for_manual_action");
  assert.equal(waiting.authViewAvailable, true);
  await new Promise((resolve) => setTimeout(resolve, 5));
  const completed = await service.status();
  assert.equal(completed.mode, "auth_setup_completed");
  assert.equal(completed.authViewAvailable, false);
  assert.ok(ops.calls.includes("auth-setup:stop"));
  assert.ok(ops.calls.includes("mode:safe"));
});

test("stuck auth setup can be stopped and returns safe mode", async () => {
  const ops = fakeOps({ async getAuthSetupState() { return { state: "waiting" }; }, async sleep() { await new Promise((resolve) => setTimeout(resolve, 2)); } });
  const service = new ZoomControlService(ops, { authTimeoutMs: 100, pollMs: 1 });
  service.requestAuthSetup();
  await new Promise((resolve) => setTimeout(resolve, 4));
  const stopped = await service.stopAuthSetup();
  assert.equal(stopped.status, 202);
  await new Promise((resolve) => setTimeout(resolve, 5));
  const status = await service.status();
  assert.equal(status.mode, "auth_setup_failed");
  assert.match(status.lastError, /остановлено/iu);
  assert.ok(ops.calls.includes("mode:safe"));
});

test("auth view uses fixed docker compose commands without arbitrary shell", async () => {
  const fs = await import("node:fs/promises");
  const source = await fs.readFile(new URL("../control-agent/docker-ops.mjs", import.meta.url), "utf8");
  assert.match(source, /--service-ports/u);
  assert.match(source, /startAuthSetup/u);
  assert.match(source, /stopAuthSetup/u);
  assert.match(source, /import \{ execFile \} from "node:child_process"/u);
  assert.doesNotMatch(source, /import \{[^}]*\b(?:exec|spawn)\b[^}]*\} from "node:child_process"|shell:\s*true/u);
});

test("Docker auth view binds noVNC to localhost and has no embedded secret", async () => {
  const fs = await import("node:fs/promises");
  const compose = await fs.readFile(new URL("../compose.example.yml", import.meta.url), "utf8");
  const dockerfile = await fs.readFile(new URL("../Dockerfile", import.meta.url), "utf8");
  assert.match(compose, /127\.0\.0\.1:6080:6080/u);
  assert.match(dockerfile, /novnc|websockify/u);
  assert.match(dockerfile, /x11vnc/u);
  assert.doesNotMatch(dockerfile, /ZOOM_AUTH_(?:EMAIL|PASSWORD)=\S+/u);
});
