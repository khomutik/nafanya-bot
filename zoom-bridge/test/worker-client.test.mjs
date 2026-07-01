import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { WorkerClient } from "../src/worker-client.mjs";

function createTestServer(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        close: () => new Promise((done) => server.close(done))
      });
    });
  });
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

test("WorkerClient sends bridge secret and pulls outbox", async () => {
  const seen = [];
  const server = await createTestServer(async (request, response) => {
    seen.push({
      url: request.url,
      secret: request.headers["x-nafanya-zoom-secret"],
      body: await readJson(request)
    });
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true, messages: [{ id: 1, text: "hello" }] }));
  });
  try {
    const client = new WorkerClient({
      workerBaseUrl: server.url,
      zoomBridgeSecret: "secret",
      outboxLimit: 20
    });
    const result = await client.pullOutbox({ ackIds: [7], limit: 3 });
    assert.equal(result.messages[0].text, "hello");
    assert.equal(seen[0].url, "/zoom/outbox");
    assert.equal(seen[0].secret, "secret");
    assert.deepEqual(seen[0].body, { ackIds: [7], limit: 3 });
  } finally {
    await server.close();
  }
});

test("WorkerClient surfaces unauthorized responses", async () => {
  const server = await createTestServer((request, response) => {
    response.writeHead(401, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: false, error: "unauthorized" }));
  });
  try {
    const client = new WorkerClient({
      workerBaseUrl: server.url,
      zoomBridgeSecret: "wrong",
      outboxLimit: 20
    });
    await assert.rejects(() => client.pullOutbox(), /unauthorized/u);
  } finally {
    await server.close();
  }
});

test("WorkerClient can use zoom-only worker paths", async () => {
  const seen = [];
  const server = await createTestServer(async (request, response) => {
    seen.push({
      url: request.url,
      body: await readJson(request)
    });
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true, messages: [] }));
  });
  try {
    const client = new WorkerClient({
      workerBaseUrl: server.url,
      zoomBridgeSecret: "secret",
      zoomWorkerMode: "zoom-only",
      outboxLimit: 20
    });
    await client.sendIncomingMessage({ text: "111" });
    await client.pullOutbox({ ackIds: [1], limit: 2 });
    assert.equal(seen[0].url, "/zoom-only/webhook");
    assert.equal(seen[1].url, "/zoom-only/outbox");
  } finally {
    await server.close();
  }
});
