import assert from "node:assert/strict";
import worker, { AnnouncementStateDurableObject, ZoomMeetingStateDurableObject, ZoomSharedTimerStateDurableObject } from "./worker.mjs";
import { splitBoardZoomMessages, unicodeLength } from "./zoom_meeting_board.js";

class MemoryStorage {
  constructor() {
    this.data = new Map();
    this.getCount = 0;
    this.putCount = 0;
  }

  async get(key) {
    this.getCount += 1;
    return this.data.get(key);
  }

  async put(key, value) {
    this.putCount += 1;
    this.data.set(key, value);
  }

  async delete(key) {
    this.data.delete(key);
  }
}

class MemoryR2 {
  constructor() { this.data = new Map(); }
  async get(key) {
    if (!this.data.has(key)) return null;
    const value = this.data.get(key);
    return {
      body: new Blob([value]).stream(),
      async json() { return JSON.parse(value); },
      async text() { return value; }
    };
  }
  async put(key, value) {
    this.data.set(key, value instanceof ReadableStream ? await new Response(value).text() : String(value));
  }
}

function makeEnv(overrides = {}) {
  const makeNamespace = (DurableObjectClass) => {
    const objects = new Map();
    return {
      objects,
      binding: {
        getByName(name) {
          if (!objects.has(name)) {
            const storage = new MemoryStorage();
            const durableObject = new DurableObjectClass({ storage });
            let previous = Promise.resolve();
            const record = {
              durableObject,
              storage,
              fetchCount: 0,
              fetch(url, init = {}) {
                record.fetchCount += 1;
                const run = () => durableObject.fetch(new Request(url, init));
                const response = previous.then(run, run);
                previous = response.then(() => undefined, () => undefined);
                return response;
              }
            };
            objects.set(name, record);
          }
          return objects.get(name);
        }
      }
    };
  };
  const announcements = makeNamespace(AnnouncementStateDurableObject);
  const zoomMeeting = makeNamespace(ZoomMeetingStateDurableObject);
  const zoomTimer = makeNamespace(ZoomSharedTimerStateDurableObject);
  return {
    ZOOM_PANEL_TOKEN: "panel-token",
    ZOOM_BRIDGE_SECRET: "bridge-token",
    ANNOUNCEMENT_STATE: announcements.binding,
    ZOOM_MEETING_STATE: zoomMeeting.binding,
    ZOOM_SHARED_TIMER_STATE: zoomTimer.binding,
    __testing: { announcements, zoomMeeting, zoomTimer },
    ...overrides
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

function outboxTexts(outbox) {
  return outbox.map((item) => item?.text).filter((text) => typeof text === "string" && text.length > 0);
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

async function postPanelAction(env, body, token = true, extraHeaders = {}) {
  const headers = { "content-type": "application/json" };
  if (token) headers["x-nafanya-zoom-panel-token"] = "panel-token";
  Object.assign(headers, extraHeaders);
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
  assert.match(html, /<title>Пульт техведа<\/title>/u);
  assert.match(html, /data-day="monday"/u);
  assert.match(html, /data-day="tuesday"/u);
  assert.match(html, /data-speaker/u);
  assert.match(html, /data-add-entry/u);
  assert.match(html, /data-board-clear/u);
  assert.match(html, /meeting_board_clear_all/u);
  assert.match(html, /\u041e\u0447\u0438\u0441\u0442\u0438\u0442\u044c \u0432\u0441\u0451/u);
  assert.doesNotMatch(html, /confirm\(/u, "Zoom panel must not rely on browser confirmation dialogs");
  assert.doesNotMatch(html, /meeting_board_replay/u);
  assert.match(html, /data-message-key="prayer"/u);
  assert.match(html, /async function requestAction\(body\)[\s\S]*attempt<2/u,
    "Every panel action should reuse one idempotency key for one delayed retry after a transient 5xx");
  assert.match(html, /if\(refreshPromise\)return refreshPromise/u,
    "Concurrent panel refreshes must share one Worker request");
  assert.match(html, /startupRefreshTimer=setTimeout/u,
    "The initial board refresh should coalesce with the timer-client handshake");
  assert.match(html, /\u041e\u0442\u043f\u0440\u0430\u0432\u043b\u044f\u044e\u2026/u,
    "Ordinary message buttons should not pretend that they are clearing queues");
  assert.doesNotMatch(html, /const data=await requestJson\(actionPath[\s\S]{0,300}await refreshState/u,
    "A successful one-shot action must not trigger an immediate duplicate status request");
  assert.doesNotMatch(html, /add_test_participant|manualQueueInput|queueWorkbench/u);
  const deniedAction = await postPanelAction(env, { type: "message", key: "prayer" }, false);
  assert.equal(deniedAction.status, 401);

  const allowedAction = await postPanelAction(env, { type: "message", key: "prayer" });
  assert.equal(allowedAction.status, 200);
  assert.equal((await json(allowedAction)).ok, true);
}

async function testRetiredLegacyZoomSurface() {
  const env = makeEnv();

  for (const path of ["/zoom/outbox", "/zoom/debug", "/zoom/app/action", "/zoom-only/reset"]) {
    const response = await worker.fetch(bridgeRequest(path), env);
    assert.equal(response.status, 404, `${path} must stay retired`);
  }

  for (const path of ["/zoom-only/webhook", "/zoom-only/chat-ingest"]) {
    const response = await worker.fetch(bridgeRequest(path), env);
    assert.equal(response.status, 200);
    const data = await json(response);
    assert.equal(data.handled, false);
    assert.equal(data.ignored, "queue_paused");
  }
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

async function testManualQueueEntryAction() {
  const env = makeEnv();

  let denied = await postPanelAction(env, { action: "add_manual_queue_entry", rawInput: "Саша 111" }, false);
  assert.equal(denied.status, 401);

  let response = await postPanelAction(env, {
    action: "add_manual_queue_entry",
    rawInput: "Саша 111",
    text: "произвольный текст в outbox"
  });
  let data = await json(response);
  assert.equal(response.status, 200);
  assert.equal(data.ok, false);
  assert.match(data.error, /Сначала откройте очередь/u);
  assert.equal((await pullOutbox(env)).length, 0);

  response = await postPanelAction(env, { type: "queue", queueAction: "open_rs" });
  data = await json(response);
  assert.equal(data.ok, true);
  await ackOutbox(env, (await pullOutbox(env)).map((message) => message.id));

  response = await postPanelAction(env, { action: "add_manual_queue_entry", rawInput: "Саша" });
  data = await json(response);
  assert.equal(data.ok, true);
  assert.equal(data.key, "add_manual_queue_entry");
  assert.match(data.message, /Добавлено: Саша/u);
  assert.equal(data.queue.mode, "rs");
  assert.equal(data.queue.entries.length, 1);
  assert.equal(data.queue.entries[0].author, "Саша");
  assert.equal(data.queue.entries[0].label, "111");
  let outbox = await pullOutbox(env);
  assert.equal(outbox.length, 1);
  assert.match(outbox[0].text, /Саша — 111/u);
  await ackOutbox(env, outbox.map((message) => message.id));

  response = await postPanelAction(env, { action: "add_manual_queue_entry", rawInput: "Саша 111 высказаться" });
  data = await json(response);
  assert.equal(data.ok, true);
  assert.equal(data.queue.entries.length, 2);
  assert.equal(data.queue.entries.filter((entry) => entry.author === "Саша" && entry.label === "111").length, 2);
  await ackOutbox(env, (await pullOutbox(env)).map((message) => message.id));

  response = await postPanelAction(env, { action: "add_manual_queue_entry", rawInput: "Саша 222" });
  data = await json(response);
  assert.equal(data.ok, true);
  assert.equal(data.queue.entries.length, 3);
  assert.equal(data.queue.entries.filter((entry) => entry.author === "Саша" && entry.label === "111").length, 3);
  outbox = await pullOutbox(env);
  assert.match(outbox[0].text, /Саша — 111/u);
  assert.doesNotMatch(outbox[0].text, /Саша — 222/u);
  await ackOutbox(env, outbox.map((message) => message.id));

  response = await postPanelAction(env, { action: "add_manual_queue_entry", rawInput: "Анна Мария 333" });
  data = await json(response);
  assert.equal(data.ok, true);
  assert.equal(data.queue.entries.length, 4);
  assert.ok(data.queue.entries.some((entry) => entry.author === "Анна Мария" && entry.label === "111"));
  await ackOutbox(env, (await pullOutbox(env)).map((message) => message.id));

  const entriesBeforeInvalid = (await getZoomOnlyStatus(env)).queue.entries.length;
  for (const [rawInput, errorPattern] of [
    ["", /Введите имя участника/u],
    ["111", /Введите имя участника/u],
    ["Саша 0", /Код должен быть 111, 222, 333 или 444/u],
    ["Саша 555", /Код должен быть 111, 222, 333 или 444/u],
    ["Саша <script>", /Введите имя участника/u],
    ["А".repeat(81), /Слишком длинное имя/u]
  ]) {
    response = await postPanelAction(env, {
      action: "add_manual_queue_entry",
      rawInput,
      text: "произвольный текст в outbox"
    });
    data = await json(response);
    assert.equal(response.status, 200);
    assert.equal(data.ok, false);
    assert.match(data.error, errorPattern);
    assert.equal((await getZoomOnlyStatus(env)).queue.entries.length, entriesBeforeInvalid);
    assert.equal((await pullOutbox(env)).length, 0);
    assert.doesNotMatch(JSON.stringify(data), /panel-token|bridge-token/u);
  }

  response = await postPanelAction(env, { type: "queue", queueAction: "close_queue" });
  assert.equal((await json(response)).ok, true);
  await ackOutbox(env, (await pullOutbox(env)).map((message) => message.id));
  assert.equal((await getZoomOnlyStatus(env)).queue.isOpen, false);
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

async function testZoomBillChatIngest() {
  const env = makeEnv();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const value = String(url || "");
    if (value.includes("speaker_questions.json")) return Response.json({ "17": "Тестовый вопрос игры", "55": "Тестовый вопрос 55", "415": "Тестовый вопрос 415" });
    return originalFetch(url, init);
  };
  try {
    let response = await postPanelAction(env, { type: "queue", queueAction: "open_bill" });
    let data = await json(response);
    assert.equal(data.ok, true);
    await ackOutbox(env, (await pullOutbox(env)).map((message) => message.id));

    response = await postChatIngest(env, {
      authorName: "Vladimir",
      text: "111",
      sourceFingerprint: "fp-bill-111"
    });
    data = await json(response);
    assert.equal(data.ok, true);
    assert.equal(data.handled, true);
    assert.equal(data.duplicate, false);
    assert.equal(data.queue.entries.length, 1);
    assert.equal(data.queue.entries[0].author, "Vladimir");
    assert.equal(data.queue.entries[0].label, "111");
    let outbox = await pullOutbox(env);
    let status = null;
    assert.ok(outbox.length >= 1);
    assert.match(outbox.at(-1).text, /Vladimir — 111/u);
    await ackOutbox(env, outbox.map((message) => message.id));

    response = await postChatIngest(env, {
      authorName: "Vladimir",
      text: "111",
      sourceFingerprint: "fp-bill-111"
    });
    data = await json(response);
    assert.equal(data.ok, true);
    assert.equal(data.duplicate, true);
    assert.equal((await pullOutbox(env)).length, 0);

    response = await postChatIngest(env, {
      authorName: "Vladimir",
      text: "111",
      sourceFingerprint: "fp-bill-111-new"
    });
    data = await json(response);
    assert.equal(data.ok, true);
    assert.equal(data.handled, true);
    assert.equal(data.duplicate, false);
    status = await getZoomOnlyStatus(env);
    assert.equal(status.queue.entries.length, 2);
    assert.equal(status.queue.entries[1].label, "222");
    outbox = await pullOutbox(env);
    assert.match(outbox.at(-1).text, /Vladimir — 222/u);
    await ackOutbox(env, outbox.map((message) => message.id));

    response = await postChatIngest(env, {
      authorName: "Маня Х.",
      text: "игра 55",
      sourceFingerprint: "fp-bill-manya-game-55"
    });
    data = await json(response);
    assert.equal(data.ok, true);
    assert.equal(data.handled, true);
    assert.equal(data.duplicate, false);
    assert.equal(data.gameNumber, 55);
    status = await getZoomOnlyStatus(env);
    assert.equal(status.queue.entries.length, 3);
    assert.equal(status.queue.entries[2].label, "222");
    assert.ok(status.queue.entries.slice(0, 2).some((entry) => entry.label === "111"));
    assert.ok(status.queue.entries.slice(0, 2).some((entry) => entry.label === "игра 55"));
    outbox = await pullOutbox(env);
    assert.ok(outbox.length >= 2);
    assert.match(outbox[0].text, /Вопрос 55:[\s\S]*Тестовый вопрос 55/u);
    assert.match(outbox.at(-1).text, /Маня Х\. — игра 55/u);
    await ackOutbox(env, outbox.map((message) => message.id));

    response = await postChatIngest(env, {
      authorName: "Маня Х.",
      text: "111",
      sourceFingerprint: "fp-bill-manya-111"
    });
    data = await json(response);
    assert.equal(data.ok, true);
    assert.equal(data.handled, true);
    assert.equal(data.duplicate, false);
    status = await getZoomOnlyStatus(env);
    assert.equal(status.queue.entries.length, 4);
    assert.equal(status.queue.entries[3].label, "222");
    assert.equal(status.queue.entries.slice(0, 3).filter((entry) => entry.label === "111").length, 2);
    assert.ok(status.queue.entries.slice(0, 3).some((entry) => entry.author === "Маня Х." && entry.label === "игра 55"));
    await ackOutbox(env, (await pullOutbox(env)).map((message) => message.id));

    response = await postChatIngest(env, {
      authorName: "Маня Х.",
      text: "111",
      sourceFingerprint: "fp-bill-manya-111-repeat"
    });
    data = await json(response);
    assert.equal(data.ok, true);
    assert.equal(data.handled, true);
    assert.equal(data.duplicate, false);
    status = await getZoomOnlyStatus(env);
    assert.equal(status.queue.entries.length, 5);
    assert.deepEqual(status.queue.entries.slice(3).map((entry) => entry.label), ["222", "222"]);
    assert.equal(status.queue.entries.slice(0, 3).filter((entry) => entry.label === "111").length, 2);
    assert.ok(status.queue.entries.slice(0, 3).some((entry) => entry.author === "Маня Х." && entry.label === "игра 55"));
    assert.ok(status.queue.entries.slice(3).some((entry) => entry.author === "Маня Х." && entry.label === "222"));
    await ackOutbox(env, (await pullOutbox(env)).map((message) => message.id));

    response = await postChatIngest(env, {
      authorName: "Vladimir",
      text: "222",
      sourceFingerprint: "fp-bill-222"
    });
    data = await json(response);
    assert.equal(data.ok, true);
    assert.equal(data.handled, true);
    assert.equal(data.duplicate, false);
    status = await getZoomOnlyStatus(env);
    assert.equal(status.queue.entries.length, 6);
    assert.deepEqual(status.queue.entries.slice(3).map((entry) => entry.label), ["222", "222", "222"]);
    await ackOutbox(env, (await pullOutbox(env)).map((message) => message.id));

    response = await postChatIngest(env, {
      authorName: "Вы",
      text: "111",
      sourceFingerprint: "fp-bill-you-111"
    });
    data = await json(response);
    assert.equal(data.ok, true);
    assert.equal(data.handled, false);
    assert.equal(data.ignored, "self");
    status = await getZoomOnlyStatus(env);
    assert.equal(status.queue.entries.length, 6);
    assert.equal((await pullOutbox(env)).length, 0);

    response = await postChatIngest(env, {
      authorName: "Вы",
      text: "игра 55",
      sourceFingerprint: "fp-bill-you-game-55"
    });
    data = await json(response);
    assert.equal(data.ok, true);
    assert.equal(data.handled, false);
    assert.equal(data.ignored, "self");
    status = await getZoomOnlyStatus(env);
    assert.equal(status.queue.entries.length, 6);
    assert.equal((await pullOutbox(env)).length, 0);

    response = await postChatIngest(env, {
      authorName: "Vladimir",
      text: "Игра   415",
      sourceFingerprint: "fp-bill-game-415"
    });
    data = await json(response);
    assert.equal(data.ok, true);
    assert.equal(data.handled, true);
    assert.equal(data.duplicate, false);
    assert.equal(data.gameNumber, 415);
    status = await getZoomOnlyStatus(env);
    assert.ok(status.queue.entries.some((entry) => entry.author === "Vladimir" && entry.label === "игра 415"));
    outbox = await pullOutbox(env);
    assert.ok(outbox.length >= 2);
    assert.match(outbox[0].text, /Вопрос 415:[\s\S]*Тестовый вопрос 415/u);
    assert.match(outbox.at(-1).text, /Vladimir — игра 415/u);
    await ackOutbox(env, outbox.map((message) => message.id));

    const entriesBeforeInvalid = (await getZoomOnlyStatus(env)).queue.entries.length;
    for (const [text, fingerprint] of [
      ["игра 0", "fp-bill-game-0"],
      ["игра 501", "fp-bill-game-501"],
      ["игра abc", "fp-bill-game-abc"],
      ["игра 415 привет", "fp-bill-game-extra"]
    ]) {
      response = await postChatIngest(env, {
        authorName: "Vladimir",
        text,
        sourceFingerprint: fingerprint
      });
      data = await json(response);
      assert.equal(data.ok, true);
      assert.equal(data.handled, false);
      assert.equal((await getZoomOnlyStatus(env)).queue.entries.length, entriesBeforeInvalid);
      assert.equal((await pullOutbox(env)).length, 0);
    }

    response = await postChatIngest(env, {
      authorName: "Нафаня",
      text: "111",
      sourceFingerprint: "fp-bill-self"
    });
    data = await json(response);
    assert.equal(data.ok, true);
    assert.equal(data.handled, false);
    assert.equal(data.ignored, "self");
    assert.equal((await getZoomOnlyStatus(env)).queue.entries.length, entriesBeforeInvalid);

    response = await postPanelAction(env, { type: "queue", queueAction: "close_queue" });
    assert.equal((await json(response)).ok, true);
    await ackOutbox(env, (await pullOutbox(env)).map((message) => message.id));
    response = await postPanelAction(env, { type: "queue", queueAction: "open_rs" });
    assert.equal((await json(response)).ok, true);
    await ackOutbox(env, (await pullOutbox(env)).map((message) => message.id));
    response = await postChatIngest(env, {
      authorName: "Vladimir",
      text: "игра 415",
      sourceFingerprint: "fp-rs-game-415"
    });
    data = await json(response);
    assert.equal(data.ok, true);
    assert.equal(data.handled, false);
    assert.equal(data.ignored, "unsupported_mode");
    assert.equal((await pullOutbox(env)).length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
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

  response = await postPanelAction(env, { type: "message", key: "tea_rules" });
  data = await json(response);
  assert.equal(data.ok, true);
  outbox = await pullOutbox(env);
  const teaRulesText = outbox.at(-1).text;
  assert.match(teaRulesText, /чайную|чайной/iu);

  response = await postPanelAction(env, { type: "message", key: "chat_cleanliness" });
  data = await json(response);
  assert.equal(data.ok, true);
  outbox = await pullOutbox(env);
  const chatCleanlinessText = outbox.at(-1).text;
  assert.match(chatCleanlinessText, /чистот[ауы]\s+чата|чат должен|без флуда|оскорб/iu);
  assert.notEqual(chatCleanlinessText, teaRulesText);

  response = await postPanelAction(env, { type: "message", key: "meeting_rules" });
  data = await json(response);
  assert.equal(data.ok, true);
  outbox = await pullOutbox(env);
  const meetingRulesText = outbox.at(-1).text;
  assert.match(meetingRulesText, /ПРАВИЛА СОБРАНИЯ/u);
  assert.notEqual(chatCleanlinessText, meetingRulesText);

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

  const beforeTraditions = outbox.length;
  response = await postPanelAction(env, { type: "message", key: "traditions12" });
  data = await json(response);
  assert.equal(data.ok, true);
  outbox = await pullOutbox(env);
  const traditionMessages = outbox.slice(beforeTraditions);
  assert.equal(traditionMessages.length, 2);
  assert.match(traditionMessages[0].text, /12 ТРАДИЦИЙ АА/u);
  assert.ok(traditionMessages.every((message) => Array.from(message.text).length <= 950));
  assert.ok(traditionMessages.every((message) => !/Часть \d+\/\d+/u.test(message.text)));
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

async function testQueueControlActions() {
  const env = makeEnv();
  let response = await postPanelAction(env, { type: "queue", queueAction: "open_rs" });
  assert.equal((await json(response)).ok, true);
  await ackOutbox(env, (await pullOutbox(env)).map((message) => message.id));

  response = await postPanelAction(env, { action: "add_test_participant" });
  assert.equal((await json(response)).ok, true);
  await ackOutbox(env, (await pullOutbox(env)).map((message) => message.id));
  response = await postChatIngest(env, {
    authorName: "Второй участник",
    text: "111",
    sourceFingerprint: "queue-control-second"
  });
  assert.equal((await json(response)).ok, true);
  await ackOutbox(env, (await pullOutbox(env)).map((message) => message.id));
  assert.equal((await getZoomOnlyStatus(env)).queue.entries.length, 2);

  response = await postPanelAction(env, { type: "queue", queueAction: "skip" });
  const skipped = await json(response);
  if (skipped.ok) {
    await ackOutbox(env, (await pullOutbox(env)).map((message) => message.id));
  } else {
    assert.match(skipped.error, /ниже в очереди/iu);
  }

  response = await postPanelAction(env, { type: "queue", queueAction: "done" });
  assert.equal((await json(response)).ok, true);
  await ackOutbox(env, (await pullOutbox(env)).map((message) => message.id));

  response = await postPanelAction(env, { type: "queue", queueAction: "undo" });
  assert.equal((await json(response)).ok, true);
  await ackOutbox(env, (await pullOutbox(env)).map((message) => message.id));

  response = await postPanelAction(env, { type: "queue", queueAction: "remove_by_number", queuePayload: { index: 2 } });
  assert.equal((await json(response)).ok, true);
  let status = await getZoomOnlyStatus(env);
  assert.equal(status.queue.entries.length, 1);
  await ackOutbox(env, (await pullOutbox(env)).map((message) => message.id));

  response = await postPanelAction(env, { type: "queue", queueAction: "remove_by_number", queuePayload: { index: 0 } });
  const invalid = await json(response);
  assert.equal(invalid.ok, false);
  assert.match(invalid.error, /от 1 до 999/u);
  assert.equal((await getZoomOnlyStatus(env)).queue.entries.length, 1);
}

async function testYozhikBillAndGameActions() {
  const env = makeEnv();
  const originalFetch = globalThis.fetch;
  const dateKey = new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", day: "2-digit", month: "2-digit" }).format(new Date());
  globalThis.fetch = async (url, init) => {
    const value = String(url || "");
    if (value.includes("yozhik.json")) return Response.json({ [dateKey]: "Тестовый текст Ёжика" });
    if (value.includes("bill.json")) return Response.json({ "17": "Заголовок\n\nТекст отрывка" });
    if (value.includes("speaker_questions.json")) return Response.json({ "17": "Тестовый вопрос игры" });
    return originalFetch(url, init);
  };
  try {
    let response = await postPanelAction(env, { action: "yozhik" }, false);
    assert.equal(response.status, 401);

    response = await postPanelAction(env, { action: "yozhik", text: "чужой текст" });
    assert.equal((await json(response)).ok, true);
    let outbox = await pullOutbox(env);
    assert.match(outbox[0].text, /Ежедневные размышления/u);
    assert.doesNotMatch(outbox[0].text, /чужой текст/u);
    await ackOutbox(env, outbox.map((message) => message.id));

    response = await postPanelAction(env, { action: "bill_excerpt", number: 17, text: "чужой текст" });
    assert.equal((await json(response)).ok, true);
    outbox = await pullOutbox(env);
    assert.match(outbox[0].text, /Как это видит Билл\. №17/u);
    assert.doesNotMatch(outbox[0].text, /чужой текст/u);
    await ackOutbox(env, outbox.map((message) => message.id));

    response = await postPanelAction(env, { action: "game_question", number: 17, text: "чужой текст" });
    assert.equal((await json(response)).ok, true);
    outbox = await pullOutbox(env);
    assert.match(outbox[0].text, /Вопрос 17:[\s\S]*Тестовый вопрос игры/u);
    assert.doesNotMatch(outbox[0].text, /чужой текст/u);
    await ackOutbox(env, outbox.map((message) => message.id));

    for (const body of [
      { action: "bill_excerpt", number: 0 },
      { action: "bill_excerpt", number: 333 },
      { action: "game_question", number: 501 }
    ]) {
      response = await postPanelAction(env, body);
      assert.equal((await json(response)).ok, false);
      assert.equal((await pullOutbox(env)).length, 0);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function testQueuePausedLibraryPanelAndActions() {
  const env = makeEnv({ ZOOM_LIBRARY: new MemoryR2() });
  let response = await worker.fetch(panelRequest("/zoom-only/app"), env);
  assert.equal(response.status, 200);
  const html = await response.text();
  const embeddedScripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/giu)].map((match) => match[1]);
  assert.ok(embeddedScripts.length > 0);
  assert.doesNotThrow(() => embeddedScripts.forEach((script) => new Function(script)));
  assert.match(html, /Сообщения собрания/u);
  assert.match(html, /Большая книга/u);
  assert.match(html, /12 шагов и 12 традиций/u);
  assert.match(html, /Жить трезвыми/u);
  assert.match(html, /Как это видит Билл/u);
  assert.match(html, /Ежедневные размышления/u);
  assert.match(html, /500 вопросов/u);
  assert.match(html, /webkitdirectory/u);
  assert.match(html, /Тест Zoom/u);
  assert.match(html, /\.action:active\{transform:translateY\(2px\)/u);
  assert.match(html, /\.action\.is-success\{background:#19734a;color:#fff/u);
  assert.match(html, /button\.classList\.add\("is-success"\)/u);
  assert.match(html, /feedbackLabels\(button,"success"\)/u);
  assert.match(html, /setButtonFeedback\(targetButton,"success"\)/u);
  assert.match(html, /data-day="monday"/u);
  assert.match(html, /data-day="tuesday"/u);
  assert.match(html, /data-day="thursday"/u);
  assert.match(html, /data-day="friday"/u);
  assert.match(html, /data-day="sunday"/u);
  assert.match(html, /data-speaker/u);
  assert.match(html, /data-add-entry/u);
  assert.match(html, /data-speaker-add/u);
  assert.match(html, /meeting_board_defer_entry/u);
  assert.match(html, /\u041f\u0440\u043e\u043f\u0443\u0441\u043a\u0430\u0435\u0442/u);
  assert.match(html, /data-board-clear|meeting_board_clear_all/u);
  assert.doesNotMatch(html, /data-speaker-clear/u);
  assert.doesNotMatch(html, /data-clear-board/u);
  const speakerPanelHtml = html.match(/<details class="day-panel speaker" data-speaker>[\s\S]*?<\/details><button class="action danger clear-button" data-board-clear/u)?.[0] || "";
  assert.ok(speakerPanelHtml, "Speaker panel should be present");
  assert.doesNotMatch(speakerPanelHtml, /data-message-key="meeting_rules"|\u041f\u0440\u0430\u0432\u0438\u043b\u0430 \u0441\u043e\u0431\u0440\u0430\u043d\u0438\u044f/u);
  assert.match(html, /\.publication-row label\{[^}]*font-size:17px/u);
  assert.match(html, /\.meeting-action\{height:56px;min-height:56px/u);
  assert.match(html, /\.state-row \.action\.rare\{min-height:27px/u);
  assert.match(html, /row-actions/u);
  assert.match(html, /"danger rare"/u);
  assert.match(html, /aria-pressed/u);
  assert.match(html, /meeting_board_edit_entry|meeting_board_edit_topic/u);
  for (const panel of [...html.matchAll(/<details class="day-panel(?: speaker)?"[^>]*>[\s\S]*?<\/details>/gu)]) {
    const content = panel[0];
    assert.match(content, /data-message-group="start"[\s\S]*data-message-group="middle"[\s\S]*data-message-group="end"/u);
    const endKeys = [...content.slice(content.indexOf('data-message-group="end"')).matchAll(/data-message-key="([^"]+)"/gu)].map(match => match[1]);
    assert.deepEqual(endKeys, ['meeting_schedule', 'group_sponsors', 'free_services', 'tea_rules', 'telemost_link', 'chat_cleanliness']);
  }
  assert.match(speakerPanelHtml, /data-message-key="scam_warning"[\s\S]*data-speaker-publish[\s\S]*data-message-group="end"/u);
  assert.match(html, /publication-big_book/u);
  assert.match(html, /publication-twelve_twelve/u);
  assert.match(html, /publication-living_sober/u);
  assert.match(html, /publication-as_bill_sees_it/u);
  assert.match(html, /publication-daily_reflections/u);
  assert.match(html, /publication-game_questions/u);
  assert.doesNotMatch(html, /class="status"|id="statusText"/u);
  assert.match(html, /<details class="admin">[\s\S]*id="libraryStatusText"/u);
  assert.doesNotMatch(html, /Быстрое управление очередью|Текущая очередь|add_test_participant/u);

  response = await postPanelAction(env, { type: "queue", queueAction: "show_queue" });
  assert.equal(response.status, 409);
  assert.equal((await json(response)).reason, "queue_paused");
  response = await postChatIngest(env, { authorName: "Участник", text: "111", sourceFingerprint: "paused" });
  assert.equal(response.status, 200);
  assert.equal((await json(response)).ignored, "queue_paused");
  assert.equal((await pullOutbox(env)).length, 0);

  response = await worker.fetch(new Request("https://example.com/zoom-only/library/status"), env);
  assert.equal(response.status, 401);
  response = await worker.fetch(panelRequest("/zoom-only/library/status"), env);
  assert.equal(response.status, 200);
  assert.equal((await json(response)).available, false);

  const importPayload = { collections: { big_book: { entries: [
    { key: 1, text: "Первое длинное предложение закончено. ".repeat(30), sourcePath: "Большая книга/001.md" },
    { key: 2, text: "Второй отрывок", sourcePath: "Большая книга/002.md" }
  ] } } };
  response = await worker.fetch(panelRequest("/zoom-only/library/import?dryRun=1", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(importPayload)
  }), env);
  assert.equal(response.status, 200);
  const preview = await json(response);
  assert.equal(preview.validated, true);
  assert.equal(preview.preview.totalEntries, 2);
  assert.equal(preview.preview.totalMessages, 2);
  response = await worker.fetch(panelRequest("/zoom-only/library/status"), env);
  assert.equal((await json(response)).available, false);

  response = await worker.fetch(panelRequest("/zoom-only/library/import", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(importPayload)
  }), env);
  assert.equal(response.status, 200);
  const imported = await json(response);
  assert.equal(imported.collections.big_book.count, 2);
  assert.equal(imported.collections.as_bill_sees_it.available, false);

  response = await postPanelAction(env, { action: "book_excerpt", collectionId: "big_book", number: 1 });
  assert.equal((await json(response)).ok, true);
  let outbox = await pullOutbox(env);
  assert.ok(outbox.length >= 1);
  assert.ok(outbox.every((message) => Array.from(message.text).length <= 950));
  assert.match(outbox[0].text, /Большая книга\. Отрывок №1/u);
  assert.ok(outbox.slice(1).every((message) => !/Большая книга\. Отрывок №1|Часть \d+\/\d+/u.test(message.text)));
  await ackOutbox(env, outbox.map((message) => message.id));

  const todayKey = new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", day: "2-digit", month: "2-digit" }).format(new Date());
  const currentLibrary = JSON.parse(env.ZOOM_LIBRARY.data.get("zoom-library/current.json"));
  currentLibrary.collections.daily_reflections = {
    label: "Ежедневные размышления",
    kind: "dated",
    entries: { [todayKey]: { text: "Размышление на сегодня", sourcePath: `${todayKey}.md` } }
  };
  await env.ZOOM_LIBRARY.put("zoom-library/current.json", JSON.stringify(currentLibrary));
  response = await postPanelAction(env, { action: "daily_reflection" });
  assert.equal((await json(response)).ok, true);
  outbox = await pullOutbox(env);
  assert.equal(outbox.length, 1);
  assert.match(outbox[0].text, new RegExp(`Ежедневные размышления\\. ${todayKey.replace(".", "\\.")}`, "u"));
  assert.ok(Array.from(outbox[0].text).length <= 950);
  await ackOutbox(env, outbox.map((message) => message.id));

  response = await postPanelAction(env, { action: "book_excerpt", collectionId: "as_bill_sees_it", number: 1 });
  assert.equal((await json(response)).ok, false);
  assert.equal((await pullOutbox(env)).length, 0);
  response = await postPanelAction(env, { action: "book_excerpt", collectionId: "big_book", number: 1.5 });
  assert.equal((await json(response)).ok, false);
  assert.equal((await pullOutbox(env)).length, 0);
}

async function testMeetingBoardAndSpeakerState() {
  const env = makeEnv({ ZOOM_LIBRARY: new MemoryR2() });
  let response = await postPanelAction(env, {
    action: "meeting_board_add_entry",
    dayKey: "tuesday",
    text: "\u0412\u0430\u0441\u044f \u0447\u0438\u0442\u0430\u0435\u0442 \u043f\u043e\u0441\u043b\u0435 \u041c\u0430\u0448\u0438 \u2014 \u043a\u0430\u043a \u0434\u043e\u0433\u043e\u0432\u043e\u0440\u0438\u043b\u0438\u0441\u044c",
    requestId: "request-entry-1"
  });
  assert.equal(response.status, 200);
  let data = await json(response);
  assert.equal(data.state.entries.length, 1);
  assert.equal(data.state.entries[0].status, "waiting");
  const entryId = data.state.entries[0].id;
  let outbox = await pullOutbox(env);
  assert.equal(outbox.length, 1);
  assert.equal(outbox[0].kind, undefined,
    "The production meeting board must use ordinary outbox messages");
  assert.equal(typeof outbox[0].text, "string");
  assert.ok(outboxTexts(outbox).every((message) => Array.from(message).length <= 950));
  assert.match(outboxTexts(outbox).join("\n"), /\u0412\u0430\u0441\u044f \u0447\u0438\u0442\u0430\u0435\u0442/u);
  await ackOutbox(env, outbox.map((item) => item.id));

  response = await postPanelAction(env, {
    action: "meeting_board_add_entry",
    dayKey: "tuesday",
    text: "\u041c\u0430\u0448\u0430 111",
    requestId: "request-entry-2"
  });
  data = await json(response);
  const secondEntryId = data.state.entries[1].id;
  outbox = await pullOutbox(env);
  assert.equal(outbox.length, 1);
  assert.equal(outbox[0].kind, undefined);
  assert.equal(typeof outbox[0].text, "string");
  await ackOutbox(env, outbox.map((item) => item.id));

  response = await postPanelAction(env, { action: "meeting_board_defer_entry", dayKey: "tuesday", id: entryId, requestId: "request-defer-1" });
  data = await json(response);
  assert.equal(data.state.entries[0].id, secondEntryId);
  assert.equal(data.state.entries[1].id, entryId);
  outbox = await pullOutbox(env);
  await ackOutbox(env, outbox.map((item) => item.id));

  response = await postPanelAction(env, { action: "meeting_board_defer_entry", dayKey: "tuesday", id: secondEntryId, requestId: "request-defer-2" });
  data = await json(response);
  assert.equal(data.state.entries[0].id, entryId);
  assert.equal(data.state.entries[1].id, secondEntryId);
  outbox = await pullOutbox(env);
  await ackOutbox(env, outbox.map((item) => item.id));

  response = await postPanelAction(env, { action: "meeting_board_mark_spoken", dayKey: "tuesday", id: entryId, requestId: "request-spoken-1" });
  data = await json(response);
  assert.equal(data.state.entries[0].status, "spoken");
  outbox = await pullOutbox(env);
  assert.match(outboxTexts(outbox).join("\n"), /\u2705 \u0412\u0430\u0441\u044f/u);
  await ackOutbox(env, outbox.map((item) => item.id));

  response = await postPanelAction(env, { action: "meeting_board_mark_spoken", dayKey: "tuesday", id: entryId, requestId: "request-spoken-1" });
  data = await json(response);
  assert.equal(data.duplicate, true);
  assert.equal((await pullOutbox(env)).length, 0);

  response = await postPanelAction(env, {
    action: "meeting_board_add_topic",
    dayKey: "tuesday",
    text: "1. \u041c\u043e\u0436\u043d\u043e \u043b\u0438 \u0441\u0434\u0430\u0432\u0430\u0442\u044c \u043f\u044f\u0442\u044b\u0439 \u0448\u0430\u0433 \u043d\u0435 \u0441\u043f\u043e\u043d\u0441\u043e\u0440\u0443?",
    requestId: "request-topic-1"
  });
  data = await json(response);
  assert.equal(data.state.additionalTopics[0].text.startsWith("1."), false);
  outbox = await pullOutbox(env);
  await ackOutbox(env, outbox.map((item) => item.id));

  response = await postPanelAction(env, { action: "speaker_questions_add", text: "\u0421\u0430\u0448\u0430: \u043a\u0430\u043a \u0442\u044b \u043f\u0440\u0438\u0448\u0451\u043b \u0432 \u0410\u0410?", requestId: "speaker-1" });
  data = await json(response);
  assert.equal(data.state.entries.length, 1);
  outbox = await pullOutbox(env);
  assert.equal(outbox.length, 1);
  assert.equal(outbox[0].kind, undefined);
  assert.equal(typeof outbox[0].text, "string");
  assert.match(outboxTexts(outbox).join("\n"), /\u0412\u041e\u041f\u0420\u041e\u0421\u042b \u0421\u041f\u0418\u041a\u0415\u0420\u0423/u);
  assert.match(outboxTexts(outbox).join("\n"), /1\. \u0421\u0430\u0448\u0430:/u);
  await ackOutbox(env, outbox.map((item) => item.id));

  response = await postPanelAction(env, {
    action: "meeting_board_add_entry",
    dayKey: "thursday",
    text: "\u0412\u0438\u0442\u044f 111",
    requestId: "thursday-entry-before-clear"
  });
  data = await json(response);
  assert.equal(response.status, 200);
  assert.equal(data.state.entries.length, 1);
  outbox = await pullOutbox(env);
  await ackOutbox(env, outbox.map((item) => item.id));

  const statusBeforeClear = await getZoomOnlyStatus(env);
  assert.equal(statusBeforeClear.meetingBoards.tuesday.entries.length, 2,
    "Opening a different weekday must not replace the current weekday queue");
  assert.equal(statusBeforeClear.meetingBoards.thursday.entries.length, 1,
    "Every weekday must keep its own queue for all tech hosts");
  const boardVersionBeforeClear = statusBeforeClear.meetingBoards.friday?.version || 0;
  const speakerVersionBeforeClear = statusBeforeClear.speakerQuestions.version;
  response = await postPanelAction(env, {
    action: "meeting_board_clear_all",
    dayKey: "friday",
    requestId: "clear-all-1"
  });
  data = await json(response);
  assert.equal(response.status, 200);
  assert.equal(data.state.entries.length, 0);
  assert.equal(data.state.additionalTopics.length, 0);
  assert.equal(data.speakerQuestions.entries.length, 0);
  assert.ok(data.state.version > boardVersionBeforeClear);
  assert.ok(data.speakerQuestions.version > speakerVersionBeforeClear);
  for (const dayKey of ["monday", "tuesday", "thursday", "friday", "sunday"]) {
    assert.equal(data.meetingBoards[dayKey].entries.length, 0,
      "Global clear must remove every weekday queue even from a stale panel");
    assert.equal(data.meetingBoards[dayKey].additionalTopics.length, 0,
      "Global clear must remove every weekday additional-topic list");
  }
  assert.ok(data.queued.length >= 1);
  assert.ok(outboxTexts(data.queued).every((message) => Array.from(message).length <= 950));
  outbox = await pullOutbox(env);
  assert.equal(outbox.length, 2);
  assert.ok(outbox.every((item) => item.kind === undefined && typeof item.text === "string"));
  assert.ok(outboxTexts(outbox).every((message) => Array.from(message).length <= 950));
  await ackOutbox(env, outbox.map((item) => item.id));

  response = await postPanelAction(env, {
    action: "meeting_board_clear_all",
    dayKey: "friday",
    requestId: "clear-all-1"
  });
  data = await json(response);
  assert.equal(data.duplicate, true);
  assert.equal(data.state.entries.length, 0);
  assert.equal((await pullOutbox(env)).length, 0);

  const status = await getZoomOnlyStatus(env);
  assert.equal(status.meetingBoard.entries.length, 0);
  assert.equal(status.meetingBoard.additionalTopics.length, 0);
  assert.equal(status.speakerQuestions.entries.length, 0);
  assert.ok(Object.values(status.meetingBoards).every((board) => board.entries.length === 0 && board.additionalTopics.length === 0));
  assert.equal(status.activeMode, "meeting");

  response = await postPanelAction(env, { action: "meeting_board_add_entry", dayKey: "tuesday", text: "\n", requestId: "bad-1" });
  assert.equal(response.status, 400);
  assert.equal((await pullOutbox(env)).length, 0);
}

async function testOneShotActionUsesOneAtomicDurableObjectWrite() {
  const env = makeEnv();
  await getZoomOnlyStatus(env);
  const meeting = env.__testing.zoomMeeting.binding.getByName("main");
  meeting.fetchCount = 0;
  const writesBefore = meeting.storage.putCount;

  let response = await postPanelAction(env, {
    type: "message",
    key: "prayer",
    requestId: "atomic-prayer-click"
  });
  let data = await json(response);
  assert.equal(response.status, 200);
  assert.equal(data.ok, true);
  assert.equal(data.duplicate, false);
  assert.equal(data.queued.length, 1);
  assert.equal(meeting.fetchCount, 1,
    "A one-shot button must enqueue, record and answer through one Durable Object request");
  assert.equal(meeting.storage.putCount - writesBefore, 1,
    "A one-shot button must persist the outbox and idempotency marker in one write");

  response = await postPanelAction(env, {
    type: "message",
    key: "prayer",
    requestId: "atomic-prayer-click"
  });
  data = await json(response);
  assert.equal(response.status, 200);
  assert.equal(data.duplicate, true);
  assert.equal(data.queued.length, 0);
  assert.equal((await pullOutbox(env)).length, 1,
    "An ambiguous retry with the same requestId must not duplicate the Zoom message");
}

async function testZoomRouteReturnsStructuredTransientFailure() {
  const overloaded = new Error("Durable Object is overloaded");
  overloaded.overloaded = true;
  const env = makeEnv({
    ZOOM_MEETING_STATE: {
      getByName() {
        return {
          async fetch() {
            throw overloaded;
          }
        };
      }
    }
  });
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    const response = await postPanelAction(env, {
      type: "message",
      key: "prayer",
      requestId: "overloaded-prayer-click"
    });
    const data = await json(response);
    assert.equal(response.status, 503);
    assert.equal(data.ok, false);
    assert.equal(data.reason, "zoom_worker_transient");
    assert.match(data.error, /\u0421\u0432\u044f\u0437\u044c \u0441 Worker/u);
  } finally {
    console.error = originalConsoleError;
  }
}

async function testGlobalClearRemovesYesterdayState() {
  const env = makeEnv({ ZOOM_LIBRARY: new MemoryR2() });
  const yesterdayBoard = {
    sessionDate: "2026-08-27",
    dayKey: "tuesday",
    version: 7,
    entries: [{ id: "yesterday-entry", text: "\u0412\u0447\u0435\u0440\u0430\u0448\u043d\u044f\u044f \u043e\u0447\u0435\u0440\u0435\u0434\u044c", status: "waiting" }],
    additionalTopics: [{ id: "yesterday-topic", text: "\u0412\u0447\u0435\u0440\u0430\u0448\u043d\u044f\u044f \u0442\u0435\u043c\u0430" }],
    lastMessages: [],
    processedRequestIds: [],
    updatedAt: 0
  };
  const yesterdaySpeaker = {
    sessionDate: "2026-08-27",
    version: 4,
    entries: [{ id: "yesterday-speaker", text: "\u0412\u0447\u0435\u0440\u0430\u0448\u043d\u0438\u0439 \u0432\u043e\u043f\u0440\u043e\u0441" }],
    lastMessages: [],
    processedRequestIds: [],
    updatedAt: 0
  };
  const stateRecord = env.__testing.zoomMeeting.binding.getByName("main");
  await stateRecord.storage.put("zoom-meeting-state", {
    initialized: true,
    zoomOnlyOutbox: [],
    zoomOnlyOutboxNextId: 1,
    zoomMeetingBoard: yesterdayBoard,
    zoomMeetingBoards: { tuesday: yesterdayBoard },
    zoomMeetingClearRequestIds: [],
    zoomSpeakerQuestions: yesterdaySpeaker,
    zoomPanelActiveMode: "meeting"
  });

  const response = await postPanelAction(env, {
    action: "meeting_board_clear_all",
    dayKey: "monday",
    requestId: "clear-yesterday-state"
  });
  const data = await json(response);
  assert.equal(response.status, 200);
  assert.equal(data.meetingBoards.tuesday.entries.length, 0,
    "Global clear must remove yesterday's queue");
  assert.equal(data.meetingBoards.tuesday.additionalTopics.length, 0,
    "Global clear must remove yesterday's additional topics");
  assert.equal(data.speakerQuestions.entries.length, 0,
    "Global clear must remove yesterday's speaker questions");
}

async function testMeetingBoardAllowsRepeatedTextButDeduplicatesClicks() {
  const env = makeEnv({ ZOOM_LIBRARY: new MemoryR2() });
  const repeatedText = "111 \u0412\u043b\u0430\u0434\u0438\u043c\u0438\u0440";
  let response = await postPanelAction(env, {
    action: "meeting_board_add_entry",
    dayKey: "tuesday",
    text: repeatedText,
    requestId: "repeat-entry-1"
  });
  let data = await json(response);
  assert.equal(response.status, 200);
  assert.equal(data.state.entries.length, 1);
  await ackOutbox(env, (await pullOutbox(env)).map((item) => item.id));

  response = await postPanelAction(env, {
    action: "meeting_board_add_entry",
    dayKey: "tuesday",
    text: repeatedText,
    requestId: "repeat-entry-2"
  });
  data = await json(response);
  assert.equal(response.status, 200);
  assert.equal(data.duplicate, false);
  assert.equal(data.state.entries.length, 2);
  assert.deepEqual(data.state.entries.map((item) => item.text), [repeatedText, repeatedText]);
  assert.notEqual(data.state.entries[0].id, data.state.entries[1].id);
  await ackOutbox(env, (await pullOutbox(env)).map((item) => item.id));

  response = await postPanelAction(env, {
    action: "meeting_board_add_entry",
    dayKey: "tuesday",
    text: repeatedText,
    requestId: "repeat-entry-2"
  });
  data = await json(response);
  assert.equal(data.duplicate, true);
  assert.equal(data.state.entries.length, 2);
  assert.equal((await pullOutbox(env)).length, 0);
}

function testMeetingBoardUnicodeLimit() {
  const source = Array.from({ length: 18 }, (_, index) => `${index + 1}. ${"\u0416".repeat(280)} \uD83D\uDE4F`).join("\n");
  const messages = splitBoardZoomMessages(source);
  assert.ok(messages.length > 1);
  assert.ok(messages.every((message) => unicodeLength(message) <= 950));
  assert.ok(messages.every((message) => !/^\u0427\u0430\u0441\u0442\u044c \d+\/\d+\n/u.test(message)));
  const restored = messages.join("");
  assert.equal(restored.replace(/\s+/gu, ""), source.replace(/\s+/gu, ""));
}

async function testSharedZoomTimerState() {
  const env = makeEnv();
  let response = await worker.fetch(panelRequest("/zoom-only/status?includeTimer=1&instanceId=mobile-panel&product=mobile&indicatorSupported=0"), env);
  let data = await json(response);
  assert.equal(response.status, 200);
  assert.equal(data.sharedTimer.ok, true);
  assert.equal(data.sharedTimer.isExecutor, false);
  assert.equal(data.sharedTimer.state.status, "idle");

  const timerDownEnv = makeEnv({
    ZOOM_SHARED_TIMER_STATE: {
      getByName() { return { async fetch() { throw new Error("timer unavailable"); } }; }
    }
  });
  response = await worker.fetch(panelRequest("/zoom-only/status?includeTimer=1&instanceId=mobile-panel&product=mobile"), timerDownEnv);
  data = await json(response);
  assert.equal(response.status, 200);
  assert.equal(data.ok, true);
  assert.equal(data.sharedTimer, null);
  assert.equal(data.sharedTimerError, "timer_unavailable");

  response = await postPanelAction(env, {
    action: "zoom_timer_action",
    timerAction: "sync",
    instanceId: "android-1",
    product: "mobile"
  });
  data = await json(response);
  assert.equal(response.status, 200);
  assert.equal(data.executorActive, false);
  assert.equal(data.isExecutor, false);

  response = await postPanelAction(env, {
    action: "zoom_timer_action",
    timerAction: "sync",
    instanceId: "desktop-1",
    product: "desktop",
    indicatorSupported: false
  });
  data = await json(response);
  assert.equal(data.executorActive, false);
  assert.equal(data.isExecutor, false);

  response = await postPanelAction(env, {
    action: "zoom_timer_action",
    timerAction: "sync",
    instanceId: "desktop-1",
    product: "desktop",
    indicatorSupported: true
  });
  data = await json(response);
  assert.equal(data.executorActive, true);
  assert.equal(data.isExecutor, true);

  response = await postPanelAction(env, {
    action: "zoom_timer_action",
    timerAction: "start",
    instanceId: "android-1",
    product: "mobile",
    baseMs: 60000,
    remainingMs: 60000,
    requestId: "mobile-start-1"
  });
  data = await json(response);
  assert.equal(data.state.status, "running");
  assert.equal(data.state.running, true);
  assert.equal(data.executorActive, true);
  const startRevision = data.state.revision;

  response = await postPanelAction(env, {
    action: "zoom_timer_action",
    timerAction: "start",
    instanceId: "android-1",
    product: "mobile",
    baseMs: 60000,
    remainingMs: 60000,
    requestId: "mobile-start-1"
  });
  data = await json(response);
  assert.equal(data.duplicate, true);
  assert.equal(data.state.revision, startRevision);

  response = await postPanelAction(env, {
    action: "zoom_timer_action",
    timerAction: "extend",
    instanceId: "android-1",
    product: "mobile",
    deltaMs: 60000,
    requestId: "mobile-extend-1"
  });
  data = await json(response);
  assert.ok(data.state.remainingMs > 118000 && data.state.remainingMs <= 120000);

  response = await postPanelAction(env, {
    action: "zoom_timer_action",
    timerAction: "pause",
    instanceId: "android-1",
    product: "mobile",
    requestId: "mobile-pause-1"
  });
  data = await json(response);
  assert.equal(data.state.status, "paused");
  assert.equal(data.state.running, false);

  response = await postPanelAction(env, {
    action: "zoom_timer_action",
    timerAction: "reset",
    instanceId: "android-1",
    product: "mobile",
    baseMs: 60000,
    requestId: "mobile-reset-1"
  });
  data = await json(response);
  assert.equal(data.state.status, "idle");
  assert.equal(data.state.remainingMs, 60000);

  response = await postPanelAction(env, {
    action: "zoom_timer_action",
    timerAction: "claim_finish",
    instanceId: "desktop-1",
    product: "desktop",
    indicatorSupported: true
  });
  assert.equal(response.status, 400);
}

async function testZoomStateMigrationAndIsolation() {
  const env = makeEnv({ ZOOM_LIBRARY: new MemoryR2() });
  const legacy = env.ANNOUNCEMENT_STATE.getByName("main");
  await legacy.storage.put("announcement-state", {
    messageIds: { daily: 77 },
    personalSubscriptions: { user: { enabled: true } },
    adminDmDrafts: {},
    adminDmUsers: {},
    replacementRequests: {},
    zoomOnlyOutbox: [{ id: 7, text: "\u041d\u0435\u043e\u0442\u043f\u0440\u0430\u0432\u043b\u0435\u043d\u043d\u043e\u0435 \u0441\u043e\u043e\u0431\u0449\u0435\u043d\u0438\u0435", createdAt: 1 }],
    zoomOnlyOutboxNextId: 8,
    zoomOnlyPanelLastAction: { key: "legacy", label: "Legacy", ok: true, createdAt: 1 },
    zoomMeetingBoard: {
      sessionDate: "2026-08-01",
      dayKey: "tuesday",
      version: 3,
      entries: [{ id: "legacy-entry", text: "\u0412\u0430\u0441\u044f 111", status: "waiting", createdAt: 1, updatedAt: 1 }],
      additionalTopics: [],
      lastMessages: ["\u0421\u0442\u0430\u0440\u043e\u0435 \u0441\u043e\u0441\u0442\u043e\u044f\u043d\u0438\u0435"],
      processedRequestIds: [],
      updatedAt: 1
    },
    zoomSpeakerQuestions: { sessionDate: "2026-08-01", version: 0, entries: [], lastMessages: [], processedRequestIds: [], updatedAt: 0 },
    zoomPanelActiveMode: "meeting",
    zoomSharedTimer: {
      status: "paused",
      running: false,
      baseMs: 120000,
      remainingMs: 45000,
      endAt: 0,
      revision: 4,
      updatedAt: 1,
      finishedAt: 0,
      executor: null,
      soundClaimRevision: -1,
      processedRequestIds: []
    }
  });

  const status = await getZoomOnlyStatus(env);
  assert.equal(status.meetingBoard.entries[0].text, "\u0412\u0430\u0441\u044f 111");
  assert.equal(status.activeMode, "meeting");
  assert.equal((await pullOutbox(env))[0].id, 7);

  let response = await postPanelAction(env, { action: "zoom_timer_action", timerAction: "sync", instanceId: "mobile", product: "mobile" });
  let timer = await json(response);
  assert.equal(timer.state.status, "paused");
  assert.equal(timer.state.remainingMs, 45000);

  const announcementReadsAfterMigration = legacy.storage.getCount;
  for (let index = 0; index < 12; index += 1) {
    response = await postPanelAction(env, { action: "zoom_timer_action", timerAction: "sync", instanceId: "mobile", product: "mobile" });
    assert.equal(response.status, 200);
  }
  assert.equal(legacy.storage.getCount, announcementReadsAfterMigration, "Timer sync must not return to the announcement singleton after migration");

  const meeting = env.ZOOM_MEETING_STATE.getByName("main");
  const sharedTimer = env.ZOOM_SHARED_TIMER_STATE.getByName("main");
  assert.ok(meeting.storage.data.has("zoom-meeting-state"));
  assert.ok(sharedTimer.storage.data.has("zoom-shared-timer-state"));
  assert.equal(meeting.storage.data.has("announcement-state"), false);
  assert.equal(sharedTimer.storage.data.has("announcement-state"), false);

  response = await postPanelAction(env, {
    action: "meeting_board_add_entry",
    dayKey: "tuesday",
    text: "\u041c\u0438\u0433\u0440\u0430\u0446\u0438\u044f \u0436\u0438\u0432\u0430",
    requestId: "after-migration"
  });
  assert.equal(response.status, 200);
  const beforeSecondInitialization = await getZoomOnlyStatus(env);
  const secondInitialization = await meeting.fetch("https://state/initialize_from_legacy", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ state: createEmptyLegacyReplacementStateForTest() })
  });
  assert.equal(secondInitialization.status, 200);
  const afterSecondInitialization = await getZoomOnlyStatus(env);
  assert.deepEqual(afterSecondInitialization.meetingBoard.entries, beforeSecondInitialization.meetingBoard.entries,
    "A repeated migration request must not overwrite live Zoom state");
}

function createEmptyLegacyReplacementStateForTest() {
  return {
    zoomOnlyOutbox: [],
    zoomOnlyOutboxNextId: 1,
    zoomMeetingBoard: { sessionDate: "", dayKey: "", version: 0, entries: [], additionalTopics: [], lastMessages: [], processedRequestIds: [], updatedAt: 0 },
    zoomSpeakerQuestions: { sessionDate: "", version: 0, entries: [], lastMessages: [], processedRequestIds: [], updatedAt: 0 },
    zoomPanelActiveMode: "meeting"
  };
}

async function testConcurrentTechHostUpdatesAreSerialized() {
  const env = makeEnv();
  const requests = [
    postPanelAction(env, { action: "meeting_board_add_entry", dayKey: "tuesday", text: "\u0412\u0430\u0441\u044f 111", requestId: "parallel-1" }),
    postPanelAction(env, { action: "meeting_board_add_entry", dayKey: "tuesday", text: "\u0421\u0430\u0448\u0430 111", requestId: "parallel-2" })
  ];
  const responses = await Promise.all(requests);
  assert.ok(responses.every((response) => response.status === 200));
  const status = await getZoomOnlyStatus(env);
  assert.deepEqual(status.meetingBoard.entries.map((item) => item.text), ["\u0412\u0430\u0441\u044f 111", "\u0421\u0430\u0448\u0430 111"]);

  const duplicate = await postPanelAction(env, { action: "meeting_board_add_entry", dayKey: "tuesday", text: "\u0421\u0430\u0448\u0430 111", requestId: "parallel-2" });
  assert.equal((await json(duplicate)).duplicate, true);
  assert.equal((await getZoomOnlyStatus(env)).meetingBoard.entries.length, 2);
}

async function testRetiredTeamChatSurface() {
  const env = makeEnv();
  const response = await worker.fetch(panelRequest("/zoom-only/team-chat/status"), env);
  assert.equal(response.status, 410);
  assert.equal((await json(response)).error, "team_chat_test_retired");

  const panelResponse = await worker.fetch(panelRequest("/zoom-only/app"), env);
  const panelHtml = await panelResponse.text();
  assert.equal(panelResponse.status, 200);
  assert.doesNotMatch(panelHtml, /Team Chat|sendMessageToChat|data-speaker-clear/u);
  assert.match(panelHtml, /meeting_board_clear_all/u);
  assert.match(panelHtml, /\u041e\u0447\u0438\u0441\u0442\u0438\u0442\u044c \u0432\u0441\u0451/u);
  const inlineScript = [...panelHtml.matchAll(/<script>([\s\S]*?)<\/script>/gu)].at(-1)?.[1];
  assert.ok(inlineScript);
  assert.doesNotThrow(() => new Function(inlineScript));
}

testMeetingBoardUnicodeLimit();
async function testEditingAndCompactQueueActions() {
  const env = makeEnv();
  const act = async payload => {
    const response = await postPanelAction(env, { ...payload, requestId: crypto.randomUUID() });
    const data = await json(response);
    return { response, data };
  };
  let { data } = await act({ action: 'meeting_board_add_entry', dayKey: 'thursday', text: '111' });
  const id = data.state.entries[0].id;
  await act({ action: 'meeting_board_add_entry', dayKey: 'thursday', text: '222' });
  await act({ action: 'meeting_board_mark_spoken', dayKey: 'thursday', id });
  ({ data } = await act({ action: 'meeting_board_edit_entry', dayKey: 'thursday', id, expectedText: '111', text: '111 corrected' }));
  assert.equal(data.state.entries[0].id, id);
  assert.equal(data.state.entries[0].text, '111 corrected');
  assert.equal(data.state.entries[0].status, 'spoken');
  assert.equal(data.state.entries[1].text, '222');
  assert.match((await pullOutbox(env)).at(-1).text, /111 corrected/u);
  let result = await act({ action: 'meeting_board_edit_entry', dayKey: 'thursday', id, expectedText: '111', text: 'stale overwrite' });
  assert.equal(result.response.status, 400, 'Reject a stale edit from a second host');
  result = await act({ action: 'meeting_board_edit_entry', dayKey: 'thursday', id, expectedText: '111 corrected', text: '' });
  assert.equal(result.response.status, 400);
  await act({ action: 'meeting_board_restore_waiting', dayKey: 'thursday', id });
  ({ data } = await act({ action: 'meeting_board_defer_entry', dayKey: 'thursday', id }));
  assert.equal(data.state.entries[1].id, id);
  assert.equal(data.state.entries[1].status, 'waiting');
  ({ data } = await act({ action: 'meeting_board_add_topic', dayKey: 'thursday', text: 'Old topic' }));
  const topicId = data.state.additionalTopics[0].id;
  await act({ action: 'meeting_board_add_topic', dayKey: 'thursday', text: 'Another topic' });
  ({ data } = await act({ action: 'meeting_board_edit_topic', dayKey: 'thursday', id: topicId, expectedText: 'Old topic', text: '1. New topic' }));
  assert.equal(data.state.additionalTopics[0].id, topicId);
  assert.equal(data.state.additionalTopics[0].text, 'New topic');
  result = await act({ action: 'meeting_board_edit_topic', dayKey: 'thursday', id: topicId, expectedText: 'New topic', text: 'Another topic' });
  assert.equal(result.response.status, 400, 'Prevent duplicate additional topics');
  ({ data } = await act({ action: 'speaker_questions_add', text: 'First question' }));
  const speakerId = data.state.entries[0].id;
  await act({ action: 'speaker_questions_add', text: 'Second question' });
  ({ data } = await act({ action: 'speaker_questions_edit', id: speakerId, expectedText: 'First question', text: 'Corrected question' }));
  assert.equal(data.state.entries[0].id, speakerId);
  assert.equal(data.state.entries[0].text, 'Corrected question');
  ({ data } = await act({ action: 'speaker_questions_mark_spoken', id: speakerId }));
  assert.equal(data.state.entries[0].status, 'spoken');
  assert.match((await pullOutbox(env)).at(-1).text, /\u2705 Corrected question/u);
  await act({ action: 'speaker_questions_restore_waiting', id: speakerId });
  ({ data } = await act({ action: 'speaker_questions_defer', id: speakerId }));
  assert.equal(data.state.entries[1].id, speakerId);
  result = await act({ action: 'speaker_questions_edit', id: speakerId, expectedText: 'First question', text: 'stale' });
  assert.equal(result.response.status, 400);
  result = await act({ action: 'speaker_questions_edit', id: speakerId, expectedText: 'Corrected question', text: 'x'.repeat(301) });
  assert.equal(result.response.status, 400);
  result = await act({ action: 'speaker_questions_edit', id: speakerId, expectedText: 'Corrected question', text: 'Second question' });
  assert.equal(result.response.status, 400);
  assert.equal((await getZoomOnlyStatus(env)).speakerQuestions.entries[1].text, 'Corrected question');
  await ackOutbox(env, (await pullOutbox(env)).map(item => item.id));
  ({ data } = await act({ type: 'message', key: 'group_sponsors' }));
  assert.equal(data.ok, true);
  const sponsors = outboxTexts(await pullOutbox(env)).join('\n');
  for (const contact of ['@VladimirRingo', '@iddqd977', '@khomutik', '+971502729577', '@pifagor71', '@katukatun', '@Well2456']) assert.ok(sponsors.includes(contact));
  await ackOutbox(env, (await pullOutbox(env)).map(item => item.id));
  ({ data } = await act({ type: 'message', key: 'free_services' }));
  assert.equal(data.ok, true);
  const services = outboxTexts(await pullOutbox(env)).join('\n');
  assert.equal(services.split('\n').filter(line => line.startsWith('\u2022')).length, 10);
}

await testEditingAndCompactQueueActions();
await testAccess();
await testRetiredLegacyZoomSurface();
await testSafeTestMessageAction();
await testOneShotActionUsesOneAtomicDurableObjectWrite();
await testZoomRouteReturnsStructuredTransientFailure();
await testMessageButtonsAndOutbox();
await testYozhikBillAndGameActions();
await testQueuePausedLibraryPanelAndActions();
await testMeetingBoardAllowsRepeatedTextButDeduplicatesClicks();
await testMeetingBoardAndSpeakerState();
await testGlobalClearRemovesYesterdayState();
await testSharedZoomTimerState();
await testZoomStateMigrationAndIsolation();
await testConcurrentTechHostUpdatesAreSerialized();
await testRetiredTeamChatSurface();

console.log("zoom panel tests passed");
