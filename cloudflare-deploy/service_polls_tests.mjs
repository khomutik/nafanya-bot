import test from "node:test";
import assert from "node:assert/strict";
import { buildServicePollsForFriday } from "./service_polls.js";
import worker from "./worker.mjs";

test("first publication has the exact two questions and ten service dates", () => {
  const polls = buildServicePollsForFriday("2026-10-16");
  assert.deepEqual(polls.map(({ key }) => key), ["leader", "tech"]);
  assert.equal(polls[0].question, "\u0412\u0415\u0414\u0423\u0429\u0418\u0419 \u0441 19.10 \u043f\u043e 01.11 (\u043c\u043e\u0436\u043d\u043e \u0432\u044b\u0431\u0440\u0430\u0442\u044c \u041d\u0415\u0421\u041a\u041e\u041b\u042c\u041a\u041e \u0434\u043d\u0435\u0439)");
  assert.equal(polls[1].question, "\u0422\u0415\u0425\u0412\u0415\u0414 \u0441 19.10 \u043f\u043e 01.11 (\u043c\u043e\u0436\u043d\u043e \u0432\u044b\u0431\u0440\u0430\u0442\u044c \u041d\u0415\u0421\u041a\u041e\u041b\u042c\u041a\u041e \u0434\u043d\u0435\u0439)");
  const expected = ["\u043f\u043d 19.10", "\u0432\u0442 20.10", "\u0447\u0442 22.10", "\u043f\u0442 23.10", "\u0432\u0441 25.10", "\u043f\u043d 26.10", "\u0432\u0442 27.10", "\u0447\u0442 29.10", "\u043f\u0442 30.10", "\u0432\u0441 01.11"];
  assert.deepEqual(polls[0].options.map(({ text }) => text), expected);
  assert.deepEqual(polls[1].options.map(({ text }) => text), expected);
  polls[0].options[0].text = "changed";
  assert.equal(polls[1].options[0].text, expected[0]);
});

test("both polls expose names, multiple answers and revoting only", () => {
  for (const poll of buildServicePollsForFriday("2026-10-16")) {
    assert.equal(poll.is_anonymous, false);
    assert.equal(poll.type, "regular");
    assert.equal(poll.allows_multiple_answers, true);
    assert.equal(poll.allows_revoting, true);
    assert.equal(poll.shuffle_options, false);
    assert.equal(poll.allow_adding_options, false);
    assert.equal(poll.hide_results_until_closes, false);
    assert.equal(poll.is_closed, false);
    assert.equal("close_date" in poll, false);
    assert.equal("open_period" in poll, false);
  }
});

test("the schedule advances by fourteen days across months and years", () => {
  assert.equal(buildServicePollsForFriday("2026-10-23"), null);
  assert.equal(buildServicePollsForFriday("2026-10-15"), null);
  assert.equal(buildServicePollsForFriday("2026-10-17"), null);
  assert.equal(buildServicePollsForFriday("2026-02-30"), null);
  const next = buildServicePollsForFriday("2026-10-30");
  assert.match(next[0].question, /02\.11 \u043f\u043e 15\.11/u);
  assert.equal(next[0].options[0].text, "\u043f\u043d 02.11");
  assert.equal(next[0].options[9].text, "\u0432\u0441 15.11");
  const newYear = buildServicePollsForFriday("2026-12-25");
  assert.match(newYear[0].question, /28\.12 \u043f\u043e 10\.01/u);
  assert.equal(newYear[0].options[9].text, "\u0432\u0441 10.01");
});

test("a failed second poll retries without publishing the first one again", async () => {
  const RealDate = globalThis.Date;
  const originalFetch = globalThis.fetch;
  const fixedTime = RealDate.parse("2026-10-16T19:00:00Z");
  const markers = new Map([["scheduled_daily_22_00", "2026-10-16"]]);
  const telegramCalls = [];
  let failTechOnce = true;

  globalThis.Date = class extends RealDate {
    constructor(...args) {
      super(...(args.length ? args : [fixedTime]));
    }
    static now() { return fixedTime; }
  };
  globalThis.fetch = async (url, init) => {
    const method = String(url).split("/").at(-1);
    const payload = JSON.parse(init.body);
    telegramCalls.push({ method, payload });
    if (method === "sendPoll" && payload.question.startsWith("\u0422\u0415\u0425\u0412\u0415\u0414") && failTechOnce) {
      failTechOnce = false;
      return Response.json({ ok: false, error_code: 400, description: "temporary test failure" }, { status: 400 });
    }
    return Response.json({ ok: true, result: { message_id: telegramCalls.length } });
  };

  const stateStub = {
    async fetch(url, init) {
      const action = new URL(url).pathname.slice(1);
      const { key, messageId } = JSON.parse(init.body);
      if (action === "get") return Response.json({ ok: true, messageId: markers.get(key) ?? null });
      if (action === "set_message_id") {
        if (messageId) markers.set(key, messageId);
        else markers.delete(key);
        return Response.json({ ok: true, messageId: markers.get(key) ?? null });
      }
      throw new Error(`Unexpected state action ${action}`);
    }
  };
  const env = {
    BOT_TOKEN: "test-token",
    OWNER_PRIVATE_CHAT_ID: "99",
    ANNOUNCEMENT_STATE: { getByName: () => stateStub },
    TIMER_STATE: { getByName: () => ({ fetch: async () => Response.json({ ok: true }) }) }
  };
  const tick = async () => {
    const pending = [];
    await worker.scheduled({}, env, { waitUntil: (promise) => pending.push(promise) });
    await Promise.all(pending);
  };

  try {
    await tick();
    assert.equal(markers.get("scheduled_service_poll_leader_22_00"), "2026-10-16");
    assert.equal(markers.has("scheduled_service_poll_tech_22_00"), false);
    assert.equal(telegramCalls.filter(({ method }) => method === "sendPoll").length, 2);
    assert.equal(telegramCalls.filter(({ method }) => method === "sendMessage").length, 1);

    await tick();
    assert.equal(markers.get("scheduled_service_poll_tech_22_00"), "2026-10-16");
    await tick();
    const polls = telegramCalls.filter(({ method }) => method === "sendPoll");
    assert.deepEqual(polls.map(({ payload }) => payload.question.split(" ")[0]), ["\u0412\u0415\u0414\u0423\u0429\u0418\u0419", "\u0422\u0415\u0425\u0412\u0415\u0414", "\u0422\u0415\u0425\u0412\u0415\u0414"]);
    for (const { payload } of polls) {
      assert.equal(payload.chat_id, -1003835668674);
      assert.equal(payload.message_thread_id, 453);
      assert.equal(payload.options.length, 10);
      assert.equal(payload.is_anonymous, false);
      assert.equal(payload.allows_multiple_answers, true);
      assert.equal(payload.allows_revoting, true);
    }
  } finally {
    globalThis.Date = RealDate;
    globalThis.fetch = originalFetch;
  }
});
