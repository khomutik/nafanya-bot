import { readFileSync } from "node:fs";

for (const line of readFileSync(process.argv[2] || ".env", "utf8").replace(/\r/gu, "").split("\n")) {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/u);
  if (!match) continue;
  let value = match[2].trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
  process.env[match[1]] = value;
}

const throughControl = process.argv[3] === "control";
const target = throughControl ? "http://127.0.0.1:3098/worker-panel" : `${process.env.WORKER_BASE_URL.replace(/\/+$/u, "")}/zoom-only/app?diagnose=${Date.now()}`;
const headers = throughControl ? { "x-nafanya-control-token": process.env.ZOOM_CONTROL_TOKEN } : { "x-nafanya-zoom-panel-token": process.env.ZOOM_PANEL_TOKEN, "cache-control": "no-cache" };
const response = await fetch(target, { headers });
const html = await response.text();
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/giu)].map((match) => match[1]);
const result = { status: response.status, scriptCount: scripts.length, syntax: "ok" };
result.relevantLines = scripts.join("\n").split("\n").filter((line) => /function (?:addLog|normalizedPath|collectionForPath|entryKey)|join\(/u.test(line)).slice(0, 10);
try {
  for (const script of scripts) new Function(script);
} catch (error) {
  result.syntax = String(error?.message || error);
  const normalizedLine = scripts.join("\n").split("\n").find((line) => line.includes("normalizedPath"));
  result.normalizedPathLine = normalizedLine || null;
}
console.log(JSON.stringify(result));
