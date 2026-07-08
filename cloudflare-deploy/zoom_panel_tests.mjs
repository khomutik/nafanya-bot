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

async function ackOutbox(env, ids) {
  const response = await worker.fetch(bridgeRequest("/zoom-only/outbox", {
    body: JSON.stringify({ ackIds: ids, limit: 50 })
  }), env);
  assert.equal(response.status, 200);
  return await json(response);
}

async function getZoomOnlyStatus(env) {
  const response = await worker.fetch(panelRequest("/zoom-only/status"), env);
  assert.equal(response.status, 200);
  return await json(response);
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

async function postChatIngest(env, body, token = true) {
  const headers = { "content-type": "application/json" };
  if (token) headers["x-nafanya-zoom-secret"] = "bridge-token";
  return worker.fetch(new Request("https://example.com/zoom-only/chat-ingest", {
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
  assert.match(html, /data-type="test_message"/u);
  assert.match(html, /data-type="add_test_participant"/u);

  const deniedAction = await postPanelAction(env, { type: "message", key: "prayer" }, false);
  assert.equal(deniedAction.status, 401);

  const allowedAction = await postPanelAction(env, { type: "message", key: "prayer" });
  assert.equal(allowedAction.status, 200);
  assert.equal((await json(allowedAction)).ok, true);
}

async function testSafeTestMessageAction() {
  const env = makeEnv();
  const expected = "Тест Нафани. Сообщение можно игнорировать.";

  let denied = await postPanelAction(env, { action: "test_message" }, false);
  assert.equal(denied.status, 401);

  let response = await postPanelAction(env, {
    action: "test_message",
    text: "МОЛИТВА\n\nэтот текст должен быть проигнорирован",
    messages: ["темы", "расписание"]
  });
  let data = await json(response);
  assert.equal(response.status, 200);
  assert.equal(data.ok, true);
  assert.equal(data.key, "test_message");
  assert.equal(data.queued.length, 1);
  assert.equal(data.queued[0].text, expected);

  let outbox = await pullOutbox(env);
  assert.equal(outbox.length, 1);
  assert.equal(outbox[0].text, expected);
  assert.doesNotMatch(outbox[0].text, /МОЛИТВА|темы|расписание/u);

  await ackOutbox(env, [outbox[0].id]);
  outbox = await pullOutbox(env);
  assert.equal(outbox.length, 0);

  response = await postPanelAction(env, { type: "test_message", text: "чужой текст" });
  data = await json(response);
  assert.equal(data.ok, true);
  outbox = await pullOutbox(env);
  assert.equal(outbox.length, 1);
  assert.equal(outbox[0].text, expected);
}

async function testSafeAddTestParticipantAction() {
  const env = makeEnv();
  const expectedName = "Тестовый участник";

  let denied = await postPanelAction(env, { action: "add_test_participant" }, false);
  assert.equal(denied.status, 401);

  let response = await postPanelAction(env, {
    action: "add_test_participant",
    name: "Не тот человек",
    text: "111 Не тот человек",
    displayName: "Не тот человек"
  });
  let data = await json(response);
  assert.equal(response.status, 200);
  assert.equal(data.ok, false);
  assert.match(data.error, /откройте Zoom-only очередь/u);
  let outbox = await pullOutbox(env);
  assert.equal(outbox.length, 0);
  let status = await getZoomOnlyStatus(env);
  assert.equal(status.queue.isOpen, false);

  response = await postPanelAction(env, { type: "queue", queueAction: "open_rs" });
  data = await json(response);
  assert.equal(data.ok, true);
  status = await getZoomOnlyStatus(env);
  assert.equal(status.queue.isOpen, true);
  assert.equal(status.queue.mode, "rs");
  outbox = await pullOutbox(env);
  assert.equal(outbox.length, 1);
  await ackOutbox(env, outbox.map((message) => message.id));
  outbox = await pullOutbox(env);
  assert.equal(outbox.length, 0);

  response = await postPanelAction(env, {
    action: "add_test_participant",
    name: "Не тот человек",
    text: "111 Не тот человек",
    displayName: "Не тот человек"
  });
  data = await json(response);
  assert.equal(data.ok, true);
  assert.equal(data.key, "add_test_participant");
  assert.equal(data.queue.mode, "rs");
  assert.equal(data.queue.entries.length, 1);
  assert.equal(data.queue.entries[0].author, expectedName);
  assert.doesNotMatch(JSON.stringify(data.queue.entries), /Не тот человек/u);

  status = await getZoomOnlyStatus(env);
  assert.equal(status.queue.isOpen, true);
  assert.equal(status.queue.mode, "rs");
  assert.equal(status.queue.entries.length, 1);
  assert.equal(status.queue.entries[0].author, expectedName);
  assert.doesNotMatch(JSON.stringify(status.queue.entries), /Не тот человек/u);

  outbox = await pullOutbox(env);
  assert.equal(outbox.length, 1);
  assert.match(outbox[0].text, /Тестовый участник/u);
  assert.doesNotMatch(outbox[0].text, /Не тот человек/u);
  await ackOutbox(env, [outbox[0].id]);
  outbox = await pullOutbox(env);
  assert.equal(outbox.length, 0);

  response = await postPanelAction(env, { type: "queue", queueAction: "close_queue" });
  data = await json(response);
  assert.equal(data.ok, true);
  status = await getZoomOnlyStatus(env);
  assert.equal(status.queue.isOpen, false);
}

async function testSafeZoomChatCodeIngest() {
  const env = makeEnv();
  const authorName = "Маня Х.";

  let denied = await postChatIngest(env, {
    authorName,
    text: "111",
    sourceFingerprint: "fp-denied"
  }, false);
  assert.equal(denied.status, 401);

  let response = await postChatIngest(env, {
    authorName,
    text: "111",
    timestamp: "03:44 PM",
    sourceFingerprint: "fp-closed",
    observedAt: "2026-07-08T15:44:00.000Z"
  });
  let data = await json(response);
  assert.equal(response.status, 200);
  assert.equal(data.ok, true);
  assert.equal(data.handled, false);
  assert.equal(data.ignored, "queue_closed");
  for (const code of ["222", "333", "444"]) {
    response = await postChatIngest(env, {
      authorName,
      text: code,
      sourceFingerprint: `fp-closed-${code}`
    });
    data = await json(response);
    assert.equal(data.ok, true);
    assert.equal(data.handled, false);
    assert.equal(data.ignored, "queue_closed");
  }
  let outbox = await pullOutbox(env);
  assert.equal(outbox.length, 0);

  response = await postPanelAction(env, { type: "queue", queueAction: "open_rs" });
  data = await json(response);
  assert.equal(data.ok, true);
  outbox = await pullOutbox(env);
  assert.equal(outbox.length, 1);
  await ackOutbox(env, outbox.map((message) => message.id));

  const ignoredInputs = [
    ["привет", "fp-hi"],
    ["", "fp-empty-text"],
    ["111 111 привет 222", "fp-aggregate-words"],
    ["Маня Х. to Everyone 03:44 PM 111 111 привет 222", "fp-aggregate-zoom"],
    ["111", "fp-empty-author", ""]
  ];
  for (const [text, fingerprint, name = authorName] of ignoredInputs) {
    response = await postChatIngest(env, {
      authorName: name,
      text,
      sourceFingerprint: fingerprint
    });
    data = await json(response);
    assert.equal(response.status, 200);
    assert.equal(data.ok, true);
    assert.equal(data.handled, false);
  }
  let status = await getZoomOnlyStatus(env);
  assert.equal(status.queue.entries.length, 0);
  outbox = await pullOutbox(env);
  assert.equal(outbox.length, 0);

  for (const [index, code] of ["111", "222", "333", "444"].entries()) {
    response = await postChatIngest(env, {
      authorName,
      text: code,
      timestamp: "03:44 PM",
      sourceFingerprint: `fp-rs-${code}`,
      observedAt: "2026-07-08T15:44:30.000Z"
    });
    data = await json(response);
    assert.equal(response.status, 200);
    assert.equal(data.ok, true);
    assert.equal(data.handled, true);
    assert.equal(data.duplicate, false);
    assert.equal(data.queue.entries.length, index + 1);
    assert.equal(data.queue.entries.at(-1).author, authorName);
    assert.equal(data.queue.entries.at(-1).label, "111");

    outbox = await pullOutbox(env);
    assert.ok(outbox.length >= 1);
    assert.match(outbox.at(-1).text, /Маня Х\./u);
    await ackOutbox(env, outbox.map((message) => message.id));
    outbox = await pullOutbox(env);
    assert.equal(outbox.length, 0);
  }
  status = await getZoomOnlyStatus(env);
  assert.equal(status.queue.entries.length, 4);
  assert.deepEqual(status.queue.entries.map((entry) => entry.author), [authorName, authorName, authorName, authorName]);
  assert.deepEqual(status.queue.entries.map((entry) => entry.label), ["111", "111", "111", "111"]);

  response = await postChatIngest(env, {
    authorName,
    text: "222",
    sourceFingerprint: "fp-rs-222"
  });
  data = await json(response);
  assert.equal(data.ok, true);
  assert.equal(data.duplicate, true);
  outbox = await pullOutbox(env);
  assert.equal(outbox.length, 0);

  response = await postChatIngest(env, {
    authorName,
    text: "111",
    sourceFingerprint: "fp-rs-111-new"
  });
  data = await json(response);
  assert.equal(data.ok, true);
  assert.equal(data.duplicate, false);
  status = await getZoomOnlyStatus(env);
  assert.equal(status.queue.entries.length, 5);
  assert.equal(status.queue.entries.at(-1).author, authorName);
  assert.equal(status.queue.entries.at(-1).label, "111");
  outbox = await pullOutbox(env);
  assert.ok(outbox.length >= 1);
  await ackOutbox(env, outbox.map((message) => message.id));

  response = await postPanelAction(env, { type: "queue", queueAction: "close_queue" });
  data = await json(response);
  assert.equal(data.ok, true);
  outbox = await pullOutbox(env);
  assert.ok(outbox.length >= 1);
  await ackOutbox(env, outbox.map((message) => message.id));
  status = await getZoomOnlyStatus(env);
  assert.equal(status.queue.isOpen, false);

  response = await postPanelAction(env, { type: "queue", queueAction: "open_bk" });
  data = await json(response);
  assert.equal(data.ok, true);
  outbox = await pullOutbox(env);
  assert.ok(outbox.length >= 1);
  await ackOutbox(env, outbox.map((message) => message.id));
  for (const code of ["111", "222", "333", "444"]) {
    response = await postChatIngest(env, {
      authorName,
      text: code,
      sourceFingerprint: `fp-bk-${code}`
    });
    data = await json(response);
    assert.equal(data.ok, true);
    assert.equal(data.handled, true);
  }
  status = await getZoomOnlyStatus(env);
  assert.equal(status.queue.mode, "bk");
  assert.equal(status.queue.entries.length, 4);
  assert.deepEqual(status.queue.entries.map((entry) => entry.label), ["111", "111", "111", "111"]);
  outbox = await pullOutbox(env);
  assert.ok(outbox.length >= 1);
  await ackOutbox(env, outbox.map((message) => message.id));
  response = await postChatIngest(env, {
    authorName,
    text: "333",
    sourceFingerprint: "fp-bk-333"
  });
  data = await json(response);
  assert.equal(data.duplicate, true);
  status = await getZoomOnlyStatus(env);
  assert.equal(status.queue.entries.length, 4);
  response = await postPanelAction(env, { type: "queue", queueAction: "close_queue" });
  data = await json(response);
  assert.equal(data.ok, true);
  outbox = await pullOutbox(env);
  assert.ok(outbox.length >= 1);
  await ackOutbox(env, outbox.map((message) => message.id));
  outbox = await pullOutbox(env);
  assert.equal(outbox.length, 0);
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
await testSafeTestMessageAction();
await testSafeAddTestParticipantAction();
await testSafeZoomChatCodeIngest();
await testMessageButtonsAndOutbox();
await testStatusAndQueueActions();

console.log("zoom panel tests passed");
