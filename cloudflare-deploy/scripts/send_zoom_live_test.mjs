import { readFileSync } from "node:fs";

for (const line of readFileSync(process.argv[2] || ".env", "utf8").replace(/\r/gu, "").split("\n")) {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/u);
  if (!match) continue;
  let value = match[2].trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
  process.env[match[1]] = value;
}

const healthUrl = "http://127.0.0.1:3097/health";
const before = await (await fetch(healthUrl)).json();
const actionResponse = await fetch("http://127.0.0.1:3098/zoom-only/app/action", {
  method: "POST",
  headers: { "x-nafanya-control-token": process.env.ZOOM_CONTROL_TOKEN, "content-type": "application/json" },
  body: JSON.stringify({ action: "test_message" })
});
const action = await actionResponse.json();
if (!actionResponse.ok || !action.ok) throw new Error(`Live test enqueue failed: ${action.error || actionResponse.status}`);
let health = before;
for (let attempt = 0; attempt < 35; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 1000));
  health = await (await fetch(healthUrl)).json();
  if (health.lastSuccessfulSendAt && health.lastSuccessfulSendAt !== before.lastSuccessfulSendAt) break;
}
if (!health.lastSuccessfulSendAt || health.lastSuccessfulSendAt === before.lastSuccessfulSendAt) throw new Error("Sender did not confirm the live test message");
console.log(JSON.stringify({ enqueued: true, sent: true, senderStatus: health.status, zoomJoined: health.zoomJoined, chatOpen: health.chatOpen, sentAt: health.lastSuccessfulSendAt }));
