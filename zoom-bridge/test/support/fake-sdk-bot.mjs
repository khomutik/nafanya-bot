import { createInterface } from "node:readline";

const input = createInterface({ input: process.stdin });

input.on("line", (line) => {
  const payload = JSON.parse(line);
  if (payload.type === "start") {
    process.stdout.write(`${JSON.stringify({ id: payload.id, type: "ready", ok: true })}\n`);
    return;
  }
  if (payload.type === "sendMessage") {
    process.stdout.write(`${JSON.stringify({ id: payload.id, type: "sent", ok: true })}\n`);
    return;
  }
  if (payload.type === "stop") {
    process.exit(0);
  }
});
