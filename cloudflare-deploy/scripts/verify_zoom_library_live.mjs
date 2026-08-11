import { readFileSync } from "node:fs";

for (const line of readFileSync(process.argv[2] || ".env", "utf8").replace(/\r/gu, "").split("\n")) {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/u);
  if (!match) continue;
  let value = match[2].trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
  process.env[match[1]] = value;
}

const base = String(process.env.WORKER_BASE_URL || "").replace(/\/+$/u, "");
if (!base || !process.env.ZOOM_PANEL_TOKEN || !(process.env.ZOOM_ONLY_SECRET || process.env.ZOOM_BRIDGE_SECRET)) throw new Error("Missing live verification configuration");
const panelHeaders = { "x-nafanya-zoom-panel-token": process.env.ZOOM_PANEL_TOKEN, "content-type": "application/json" };
const bridgeHeaders = { "x-nafanya-zoom-secret": process.env.ZOOM_ONLY_SECRET || process.env.ZOOM_BRIDGE_SECRET, "content-type": "application/json" };

const statusResponse = await fetch(`${base}/zoom-only/library/status`, { headers: panelHeaders });
const status = await statusResponse.json();
if (!statusResponse.ok || status.collections?.big_book?.count !== 484) throw new Error("Library status verification failed");
const panelResponse = await fetch(`${base}/zoom-only/app`, { headers: panelHeaders });
const panel = await panelResponse.text();
if (!panelResponse.ok || !panel.includes("\u0411\u043e\u043b\u044c\u0448\u0430\u044f \u043a\u043d\u0438\u0433\u0430") || panel.includes("\u0411\u044b\u0441\u0442\u0440\u043e\u0435 \u0443\u043f\u0440\u0430\u0432\u043b\u0435\u043d\u0438\u0435 \u043e\u0447\u0435\u0440\u0435\u0434\u044c\u044e")) throw new Error("Panel mode verification failed");
const pausedResponse = await fetch(`${base}/zoom-only/app/action`, { method: "POST", headers: panelHeaders, body: JSON.stringify({ type: "queue", queueAction: "show_queue" }) });
const paused = await pausedResponse.json();
if (pausedResponse.status !== 409 || paused.reason !== "queue_paused") throw new Error("Queue pause verification failed");

const controlHeaders = { "x-nafanya-control-token": process.env.ZOOM_CONTROL_TOKEN };
const controlPanelResponse = await fetch("http://127.0.0.1:3098/worker-panel", { headers: controlHeaders });
const controlPanel = await controlPanelResponse.text();
if (!controlPanelResponse.ok || !controlPanel.includes('libraryStatusPath="./zoom-only/library/status"') || !controlPanel.includes('libraryImportPath="./zoom-only/library/import"')) throw new Error("Control proxy panel verification failed");
const controlLibraryResponse = await fetch("http://127.0.0.1:3098/zoom-only/library/status", { headers: controlHeaders });
const controlLibrary = await controlLibraryResponse.json();
if (!controlLibraryResponse.ok || controlLibrary.collections?.big_book?.count !== 484) throw new Error("Control proxy library verification failed");

async function enqueueAndAck(body, expectedPattern) {
  const response = await fetch(`${base}/zoom-only/app/action`, { method: "POST", headers: panelHeaders, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok || !data.ok || !Array.isArray(data.queued) || !data.queued.length) throw new Error("Outbox enqueue verification failed");
  const created = data.queued.filter((item) => expectedPattern.test(String(item.text || "")));
  if (!created.length || created.some((item) => Array.from(String(item.text || "")).length > 950)) throw new Error("Outbox content verification failed");
  const ack = await fetch(`${base}/zoom-only/outbox`, { method: "POST", headers: bridgeHeaders, body: JSON.stringify({ ackIds: created.map((item) => item.id), limit: 1 }) });
  if (!ack.ok) throw new Error("Outbox acknowledgement verification failed");
  return created.length;
}

const meetingMessages = await enqueueAndAck({ type: "message", key: "prayer" }, /./u);
const bookMessages = await enqueueAndAck({ action: "book_excerpt", collectionId: "big_book", number: 1 }, /\u0411\u043e\u043b\u044c\u0448\u0430\u044f \u043a\u043d\u0438\u0433\u0430\. \u041e\u0442\u0440\u044b\u0432\u043e\u043a \u21161/u);
console.log(JSON.stringify({ library: status.collections.big_book.count, panelQueueUi: false, queueAction: paused.reason, controlProxy: true, meetingMessages, bookMessages, maxLimit: 950 }));
