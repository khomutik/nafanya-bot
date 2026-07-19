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
  assert.match(html, /Пульт Нафани в Zoom/u);
  assert.match(html, /Сообщения собрания/u);
  assert.match(html, /Ежедневные публикации/u);
  assert.match(html, /Быстрое управление очередью/u);
  assert.match(html, /Текущая очередь/u);
  assert.match(html, /class="panel-status compact-status-bar"/u);
  assert.match(html, /<main class="panel-compact">/u);
  assert.match(html, /class="metric-row"/u);
  assert.match(html, /id="entriesStatus"/u);
  assert.match(html, /id="entriesMetric"/u);
  assert.match(html, /class="quick-queue-section"/u);
  assert.match(html, /class="grid quick-queue-actions"/u);
  assert.match(html, /class="meeting-section accordion"/u);
  assert.match(html, /class="publication-section accordion"/u);
  assert.match(html, /class="queue-control-section accordion" data-accordion="currentQueue"/u);
  assert.match(html, /data-accordion-toggle="meeting" aria-expanded="false"/u);
  assert.match(html, /data-accordion-toggle="publications" aria-expanded="false"/u);
  assert.match(html, /data-accordion-toggle="currentQueue" aria-expanded="true"/u);
  assert.match(html, /id="accordion-meeting" hidden/u);
  assert.match(html, /id="accordion-publications" hidden/u);
  assert.match(html, /function setAccordion/u);
  assert.match(html, /localStorage\.getItem\(key\)/u);
  assert.match(html, /localStorage\.setItem\(key, isOpen \? "open" : "closed"\)/u);
  assert.match(html, /data-key="prayer"/u);
  assert.match(html, /data-key="meeting_schedule"/u);
  assert.match(html, /data-type="test_message"/u);
  assert.match(html, /data-type="add_test_participant"/u);
  assert.match(html, /data-key="done"/u);
  assert.match(html, /data-key="skip"/u);
  assert.match(html, /data-key="undo"/u);
  assert.match(html, /id="removeNumber"/u);
  assert.match(html, /id="removeButton"/u);
  assert.match(html, /id="manualQueueInput"/u);
  assert.match(html, /id="manualQueueButton"/u);
  assert.match(html, /id="queueWorkbench" hidden/u);
  assert.match(html, /id="closedQueueNote" hidden/u);
  assert.match(html, /class="queue-toolbar"/u);
  assert.match(html, /class="queue-toolbar-row add-row"/u);
  assert.match(html, /class="queue-toolbar-row actions-row"/u);
  assert.match(html, /class="queue-toolbar-row remove-row"/u);
  assert.match(html, /class="input-sm" id="manualQueueInput"/u);
  assert.match(html, /class="input-sm" id="removeNumber"/u);
  assert.match(html, /placeholder="Саша 111"/u);
  assert.match(html, /Без кода добавится как 111\./u);
  assert.match(html, /action: "add_manual_queue_entry"/u);
  assert.match(html, /data-key="show_queue"/u);
  assert.match(html, /data-key="close_queue"/u);
  assert.match(html, /button-action \{ width: auto/u);
  assert.match(html, /button-danger \{ width: auto/u);
  assert.match(html, /queueWorkbench"\)\.hidden = !isQueueOpen/u);
  assert.match(html, /entriesMetric"\)\.hidden = !isQueueOpen/u);
  assert.match(html, /История закрытой очереди/u);
  assert.doesNotMatch(html, /Очередь закрыта\. Заявок/u);
  assert.match(html, /setInterval\(\(\) => refreshStatus/u);
  assert.match(html, /data-key="yozhik"/u);
  assert.match(html, /<h3>Ёжик<\/h3>/u);
  assert.match(html, /<h3>Отрывок Билла<\/h3>/u);
  assert.match(html, /<h3>Вопрос игры<\/h3>/u);
  assert.match(html, /id="billExcerptNumber"/u);
  assert.match(html, /id="billExcerptButton"/u);
  assert.match(html, /id="gameQuestionNumber"/u);
  assert.match(html, /id="gameQuestionButton"/u);
  assert.match(html, /meeting-action/u);
  assert.match(html, /publication-action/u);
  assert.match(html, /queue-open-action/u);
  assert.match(html, /queue-control-action/u);
  assert.match(html, /queue-danger-action/u);
  assert.match(html, /@media \(max-width: 640px\)[\s\S]*queue-toolbar-row\.add-row[\s\S]*queue-toolbar-row\.remove-row/u);
  assert.match(html, /min-height: 34px/u);
  assert.doesNotMatch(html, /data-key="open_(?:yozhik|game|excerpt)"/u);

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
      authorName: "Vladimir",
      text: "222",
      sourceFingerprint: "fp-bill-222"
    });
    data = await json(response);
    assert.equal(data.ok, true);
    assert.equal(data.handled, true);
    assert.equal(data.duplicate, false);
    status = await getZoomOnlyStatus(env);
    assert.equal(status.queue.entries.length, 3);
    assert.equal(status.queue.entries[2].label, "222");
    await ackOutbox(env, (await pullOutbox(env)).map((message) => message.id));

    response = await postChatIngest(env, {
      authorName: "Вы",
      text: "111",
      sourceFingerprint: "fp-bill-you-111"
    });
    data = await json(response);
    assert.equal(data.ok, true);
    assert.equal(data.handled, true);
    assert.equal(data.duplicate, false);
    status = await getZoomOnlyStatus(env);
    assert.ok(status.queue.entries.some((entry) => entry.author === "Вы" && entry.label === "111"));
    await ackOutbox(env, (await pullOutbox(env)).map((message) => message.id));

    response = await postChatIngest(env, {
      authorName: "Вы",
      text: "игра 55",
      sourceFingerprint: "fp-bill-you-game-55"
    });
    data = await json(response);
    assert.equal(data.ok, true);
    assert.equal(data.handled, true);
    assert.equal(data.duplicate, false);
    assert.equal(data.gameNumber, 55);
    status = await getZoomOnlyStatus(env);
    assert.ok(status.queue.entries.some((entry) => entry.author === "Вы" && entry.label === "игра 55"));
    outbox = await pullOutbox(env);
    assert.ok(outbox.length >= 2);
    assert.match(outbox[0].text, /Вопрос 55:[\s\S]*Тестовый вопрос 55/u);
    assert.match(outbox.at(-1).text, /Вы — игра 55/u);
    await ackOutbox(env, outbox.map((message) => message.id));

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

await testAccess();
await testSafeTestMessageAction();
await testSafeAddTestParticipantAction();
await testManualQueueEntryAction();
await testSafeZoomChatCodeIngest();
await testZoomBillChatIngest();
await testMessageButtonsAndOutbox();
await testStatusAndQueueActions();
await testQueueControlActions();
await testYozhikBillAndGameActions();

console.log("zoom panel tests passed");
