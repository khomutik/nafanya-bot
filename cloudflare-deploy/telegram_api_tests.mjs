import test from "node:test";
import assert from "node:assert/strict";
import {
  TelegramApiError,
  callTelegram,
  copyTechMessageToChat,
  isTransientTelegramError
} from "./telegram_api.js";

const ENV = { BOT_TOKEN: "test-token" };

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" }
  });
}

async function withMockFetch(responses, run) {
  const originalFetch = globalThis.fetch;
  const queue = [...responses];
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    const next = queue.shift();
    if (next instanceof Error) throw next;
    if (!next) throw new Error("Unexpected fetch call");
    return next;
  };
  try {
    return await run(calls);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("HTTP 520 \u0432 \u0432\u0438\u0434\u0435 \u0442\u0435\u043a\u0441\u0442\u0430 \u0441\u0442\u0430\u043d\u043e\u0432\u0438\u0442\u0441\u044f \u043f\u043e\u043d\u044f\u0442\u043d\u043e\u0439 \u0432\u0440\u0435\u043c\u0435\u043d\u043d\u043e\u0439 \u043e\u0448\u0438\u0431\u043a\u043e\u0439", async () => {
  await withMockFetch([
    new Response("error code: 520", { status: 520, headers: { "content-type": "text/plain" } })
  ], async (calls) => {
    await assert.rejects(
      callTelegram(ENV, "copyMessage", { chat_id: 1 }),
      (error) => {
        assert.ok(error instanceof TelegramApiError);
        assert.equal(error.httpStatus, 520);
        assert.equal(error.errorCode, 520);
        assert.equal(isTransientTelegramError(error), true);
        assert.match(error.message, /HTTP 520; non-JSON response: error code: 520/u);
        assert.doesNotMatch(error.message, /Unexpected token/iu);
        return true;
      }
    );
    assert.equal(calls.length, 1);
  });
});

test("copyMessage \u043e\u0434\u0438\u043d \u0440\u0430\u0437 \u043f\u043e\u0432\u0442\u043e\u0440\u044f\u0435\u0442\u0441\u044f \u043f\u043e\u0441\u043b\u0435 \u0432\u0440\u0435\u043c\u0435\u043d\u043d\u043e\u0433\u043e 520", async () => {
  await withMockFetch([
    new Response("error code: 520", { status: 520 }),
    jsonResponse({ ok: true, result: { message_id: 77 } })
  ], async (calls) => {
    const result = await copyTechMessageToChat(ENV, 10, 20, 30);
    assert.equal(result.result.message_id, 77);
    assert.equal(calls.length, 2);
    assert.equal(JSON.parse(calls[0].init.body).message_id, 30);
  });
});

test("\u043e\u0431\u044b\u0447\u043d\u0430\u044f JSON-\u043e\u0448\u0438\u0431\u043a\u0430 Telegram \u0441\u043e\u0445\u0440\u0430\u043d\u044f\u0435\u0442 \u043a\u043e\u0434 \u0438 \u043e\u043f\u0438\u0441\u0430\u043d\u0438\u0435", async () => {
  await withMockFetch([
    jsonResponse({ ok: false, error_code: 400, description: "Bad Request: chat not found" }, 400)
  ], async () => {
    await assert.rejects(
      callTelegram(ENV, "sendMessage", { chat_id: 1, text: "test" }),
      (error) => {
        assert.equal(error.errorCode, 400);
        assert.equal(isTransientTelegramError(error), false);
        assert.match(error.message, /chat not found/u);
        return true;
      }
    );
  });
});

test("\u0434\u043b\u0438\u043d\u043d\u044b\u0439 retry_after \u043d\u0435 \u043e\u0431\u0445\u043e\u0434\u0438\u0442\u0441\u044f \u0431\u044b\u0441\u0442\u0440\u044b\u043c \u043f\u043e\u0432\u0442\u043e\u0440\u043e\u043c", async () => {
  await withMockFetch([
    jsonResponse({ ok: false, error_code: 429, description: "Too Many Requests", parameters: { retry_after: 60 } }, 429)
  ], async (calls) => {
    await assert.rejects(
      callTelegram(ENV, "copyMessage", { chat_id: 1 }, { retryTransient: true, transientRetryDelayMs: 0 }),
      (error) => error.errorCode === 429
    );
    assert.equal(calls.length, 1);
  });
});

test("\u0441\u0435\u0442\u0435\u0432\u043e\u0439 \u0441\u0431\u043e\u0439 \u043d\u0435 \u0440\u0430\u0441\u043a\u0440\u044b\u0432\u0430\u0435\u0442 token \u0438 \u043f\u043e\u043c\u0435\u0447\u0430\u0435\u0442\u0441\u044f \u043a\u0430\u043a \u0432\u0440\u0435\u043c\u0435\u043d\u043d\u044b\u0439", async () => {
  await withMockFetch([
    new TypeError("connection reset")
  ], async () => {
    await assert.rejects(
      callTelegram(ENV, "sendMessage", { chat_id: 1, text: "test" }),
      (error) => {
        assert.equal(isTransientTelegramError(error), true);
        assert.match(error.message, /network error: connection reset/u);
        assert.doesNotMatch(error.message, /test-token/u);
        return true;
      }
    );
  });
});
