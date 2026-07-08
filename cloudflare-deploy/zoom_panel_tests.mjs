import assert from "node:assert/strict";
import worker, { AnnouncementStateDurableObject } from "./worker.mjs";

class MemoryStorage {
  constructor() {
    this.data = new Map();
  }

  async get(key) {
    return this.data.get(key);
  }

  async put(key, value) {
    this.data.set(key, value);
  }

  async delete(key) {
    this.data.delete(key);
  }
}

function makeEnv() {
  const announcementObjects = new Map();
  return {
    ZOOM_PANEL_TOKEN: "panel-token",
    ZOOM_BRIDGE_SECRET: "bridge-token",
    ANNOUNCEMENT_STATE: {
      getByName(name) {
        if (!announcementObjects.has(name)) {
          const durableObject = new AnnouncementStateDurableObject({ storage: new MemoryStorage() });
          announcementObjects.set(name, {
            fetch(url, init = {}) {
              return durableObject.fetch(new Request(url, init));
            }
          });
        }
        return announcementObjects.get(name);
      }
    }
  };
}

function panelRequest(path, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("x-nafanya-zoom-panel-token", "panel-token");
  return new Request(`https://example.com${path}`, { ...init, headers });
}

function bridgeRequest(path, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("x-nafanya-zoom-secret", "bridge-token");
  headers.set("content-type", "application/json");
  return new Request(`https://example.com${path}`, { method: "POST", body: "{}", ...init, headers });
}

async function json(response) {
  return response.json();
}

async function pullOutbox(env) {
  const response = await worker.fetch(bridgeRequest("/zoom-only/outbox", {
    body: JSON.stringify({ limit: 50 })
  }), env);
  assert.equal(response.status, 200);
  return (await json(response)).messages || [];
}

async function postPanelAction(env, body, token = true) {
  const headers = { "content-type": "application/json" };
  if (token) headers["x-nafanya-zoom-panel-token"] = "panel-token";
  return worker.fetch(new Request("https://example.com/zoom-only/app/action", {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  }), env);
}

async function testAccess() {
  const env = makeEnv();
  const deniedPage = await worker.fetch(new Request("https://example.com/zoom-only/app"), env);
  assert.equal(deniedPage.status, 401);

  const allowedPage = await worker.fetch(panelRequest("/zoom-only/app?token=panel-token"), env);
  assert.equal(allowedPage.status, 200);
  const html = await allowedPage.text();
  assert.match(html, /Пульт Нафани для Zoom/u);
  assert.match(html, /data-key="prayer"/u);
  assert.match(html, /data-key="meeting_schedule"/u);

  const deniedAction = await postPanelAction(env, { type: "message", key: "prayer" }, false);
  assert.equal(deniedAction.status, 401);

  const allowedAction = await postPanelAction(env, { type: "message", key: "prayer" });
  assert.equal(allowedAction.status, 200);
  assert.equal((await json(allowedAction)).ok, true);
}

async function testMessageButtonsAndOutbox() {
  const env = makeEnv();

  let response = await postPanelAction(env, { type: "message", key: "prayer" });
  let data = await json(response);
  assert.equal(data.ok, true);
  assert.match(data.message, /Молитва/u);
  let outbox = await pullOutbox(env);
  assert.equal(outbox.length, 1);
  assert.match(outbox[0].text, /МОЛИТВА/u);

  response = await postPanelAction(env, { type: "message", key: "prayer" });
  data = await json(response);
  assert.equal(data.ok, true);
  outbox = await pullOutbox(env);
  assert.equal(outbox.length, 2);

  response = await postPanelAction(env, { type: "message", key: "meeting_schedule" });
  data = await json(response);
  assert.equal(data.ok, true);
  outbox = await pullOutbox(env);
  assert.match(outbox.at(-1).text, /Собрания в Zoom/u);

  response = await postPanelAction(env, { type: "message", key: "today_topic" });
  data = await json(response);
  assert.equal(data.ok, true);
  outbox = await pullOutbox(env);
  assert.ok(outbox.at(-1).text.length > 0);

  const beforeUnknown = outbox.length;
  response = await postPanelAction(env, { type: "message", key: "unknown_key" });
  data = await json(response);
  assert.equal(data.ok, false);
  assert.match(data.error, /Неизвестная кнопка/u);
  outbox = await pullOutbox(env);
  assert.equal(outbox.length, beforeUnknown);

  response = await postPanelAction(env, { type: "message", key: "steps12" });
  data = await json(response);
  assert.equal(data.ok, true);
  outbox = await pullOutbox(env);
  assert.ok(outbox.length > beforeUnknown);
  assert.ok(outbox.some((message) => /12 ШАГОВ/u.test(message.text)));
}

async function testStatusAndQueueActions() {
  const env = makeEnv();
  let status = await worker.fetch(panelRequest("/zoom-only/status"), env);
  assert.equal(status.status, 200);
  let data = await json(status);
  assert.equal(data.sender.connected, false);
  assert.equal(data.outboxSize, 0);
  assert.equal(data.queue.isOpen, false);

  const open = await postPanelAction(env, { type: "queue", queueAction: "open_bk" });
  assert.equal((await json(open)).ok, true);
  status = await worker.fetch(panelRequest("/zoom-only/status"), env);
  data = await json(status);
  assert.equal(data.queue.isOpen, true);
  assert.equal(data.queue.mode, "bk");
  assert.ok(data.outboxSize >= 1);

  const show = await postPanelAction(env, { type: "queue", queueAction: "show_queue" });
  assert.equal((await json(show)).ok, true);
  const close = await postPanelAction(env, { type: "queue", queueAction: "close_queue" });
  assert.equal((await json(close)).ok, true);
}

await testAccess();
await testMessageButtonsAndOutbox();
await testStatusAndQueueActions();

console.log("zoom panel tests passed");
