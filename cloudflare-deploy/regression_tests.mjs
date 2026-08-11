import fs from "node:fs";
import assert from "node:assert/strict";
import { createKnowledgeRuntime } from "./knowledge_runtime.js";
import { QUERY_HINT, FAQ_HINT, sysPrompt } from "./bot_prompts.js";
import { ROLE_ALIASES, looksLikeBlockedProgramQuestion, scoreChunkBonus } from "./bot_lexicon.js";
import { buildZoomValidationResponse, hmacSha256Hex, getQueue111Note, handleRootRequest, handleStatusRequest, handleZoomOAuthReturn, isChatGroup, parseGameCommand, parseQueueEntry, saveAnnouncementMessageIdAfterCopy, verifyZoomWebhookSignature } from "./worker.mjs";
import { handleGroupQueueAndGameMessage, handleServiceMessages, handleTechThreadMessage, handleWebhookMessage } from "./message_handlers.js";
import { MEETING_PANEL_TEXT, QUEUE_PANEL_TEXT, buildMeetingKeyboard, buildQueueKeyboard } from "./bot_panels.js";
import { createVacancyReplacementRequest, handleCallbackQuery } from "./callback_handlers.js";
import { ZOOM_MEETING_MESSAGE_TEXTS } from "./zoom_meeting_texts.js";
import { isExpectedDeleteMessageFailure } from "./telegram_api.js";

const root = new URL("../", import.meta.url);
const serviceAccountPath = process.env.SA_PATH || new URL("../\u0414\u043e\u0441\u0442\u0443\u043f\u044b/nafanya-493610-8cea2c43c14d.json", import.meta.url);

function runtimeForDate(isoDate) {
  return createKnowledgeRuntime({
    QUERY_HINT,
    FAQ_HINT,
    sysPrompt,
    ROLE_ALIASES,
    looksLikeBlockedProgramQuestion,
    scoreChunkBonus,
    now: () => new Date(`${isoDate}T12:00:00.000Z`)
  });
}

function env() {
  return {
    GOOGLE_SERVICE_ACCOUNT_JSON: fs.readFileSync(serviceAccountPath, "utf8")
  };
}

async function answer(runtime, question) {
  const result = await runtime.findKnowledgeAnswerDetailed(env(), question, { restrained: false });
  return result.answer || "";
}

async function testZoomWebhookHelpers() {
  const secret = "zoom-secret";
  const validationResponse = await buildZoomValidationResponse(
    { ZOOM_WEBHOOK_SECRET_TOKEN: secret },
    { event: "endpoint.url_validation", payload: { plainToken: "plain-token" } }
  );
  assert.equal(validationResponse.status, 200);
  const validationJson = await validationResponse.json();
  assert.equal(validationJson.plainToken, "plain-token");
  assert.equal(validationJson.encryptedToken, await hmacSha256Hex(secret, "plain-token"));

  const rawBody = JSON.stringify({ event: "meeting.chat_message_sent", payload: { object: { id: 5487249245 } }, event_ts: 1 });
  const timestamp = "1782400000";
  const signature = `v0=${await hmacSha256Hex(secret, `v0:${timestamp}:${rawBody}`)}`;
  const signedRequest = new Request("https://example.com/zoom/events", {
    method: "POST",
    headers: {
      "x-zm-request-timestamp": timestamp,
      "x-zm-signature": signature
    },
    body: rawBody
  });
  assert.equal(await verifyZoomWebhookSignature(signedRequest, { ZOOM_WEBHOOK_SECRET_TOKEN: secret }, rawBody), true);

}

async function testRootResponseHasZoomRequiredSecurityHeaders() {
  const response = await handleStatusRequest({});
  assert.equal(response.headers.get("strict-transport-security"), "max-age=31536000; includeSubDomains; preload");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.ok(response.headers.get("content-security-policy")?.includes("default-src 'none'"));
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
}

async function testRootHomePageUsesBotStatus() {
  const response = await handleRootRequest({});
  const body = await response.text();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "text/plain; charset=UTF-8");
  assert.match(body, /\u041d\u0430\u0444\u0430\u043d\u044f/u);
  assert.doesNotMatch(body, /\/zoom\/app\/action/u);
}

async function testZoomOAuthReturnEndpoint() {
  const readyResponse = handleZoomOAuthReturn(new Request("https://example.com/oauth"));
  assert.equal(readyResponse.status, 200);
  assert.match(await readyResponse.text(), /OAuth return endpoint is ready/u);
  const codeResponse = handleZoomOAuthReturn(new Request("https://example.com/oauth?code=test-code"));
  assert.equal(codeResponse.status, 200);
  assert.match(await codeResponse.text(), /authorization received/u);
  const errorResponse = handleZoomOAuthReturn(new Request("https://example.com/oauth?error=access_denied"));
  assert.equal(errorResponse.status, 400);
}

function headerIndex(headers, names) {
  return headers.findIndex((header) => names.some((name) => String(header || "").toLowerCase().includes(name)));
}

function isoFromRuDate(value) {
  const match = String(value || "").match(/^(\d{2})\.(\d{2})\.(\d{4})$/u);
  assert.ok(match, `Expected dd.mm.yyyy date, got: ${value}`);
  return `${match[3]}-${match[2]}-${match[1]}`;
}

function isoFromRuDateOffset(value, offsetDays) {
  const date = new Date(`${isoFromRuDate(value)}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offsetDays);
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function monthNameFromRuDate(value) {
  const month = String(value || "").split(".")[1];
  return {
    "01": "\u044f\u043d\u0432\u0430\u0440\u044f",
    "02": "\u0444\u0435\u0432\u0440\u0430\u043b\u044f",
    "03": "\u043c\u0430\u0440\u0442\u0430",
    "04": "\u0430\u043f\u0440\u0435\u043b\u044f",
    "05": "\u043c\u0430\u044f",
    "06": "\u0438\u044e\u043d\u044f",
    "07": "\u0438\u044e\u043b\u044f",
    "08": "\u0430\u0432\u0433\u0443\u0441\u0442\u0430",
    "09": "\u0441\u0435\u043d\u0442\u044f\u0431\u0440\u044f",
    "10": "\u043e\u043a\u0442\u044f\u0431\u0440\u044f",
    "11": "\u043d\u043e\u044f\u0431\u0440\u044f",
    "12": "\u0434\u0435\u043a\u0430\u0431\u0440\u044f"
  }[month];
}

async function testKnowledgeAnswers() {
  const runtime = runtimeForDate("2026-06-03");
  const snapshot = await runtime.getSnapshot(env());
  assert.ok(snapshot?.faqEntries?.length > 0, "FAQ entries should load from Google Sheets");
  assert.ok(snapshot?.schedule?.rows?.length > 1, "schedule rows should load from Google Sheets");
  const scheduleHeaders = snapshot.schedule.rows[0] || [];
  const scheduleIdx = {
    date: headerIndex(scheduleHeaders, ["дата"]),
    day: headerIndex(scheduleHeaders, ["день недели", "день"]),
    leader: headerIndex(scheduleHeaders, ["ведущий", "ведет", "ведёт", "вед"]),
    techHost: headerIndex(scheduleHeaders, ["техвед"])
  };

  const denisTechAnswer = await answer(runtime, "\u043a\u0430\u043a\u043e\u0433\u043e \u0447\u0438\u0441\u043b\u0430 \u0442\u0435\u0445\u0432\u0435\u0434 \u0414\u0435\u043d\u0438\u0441?");
  assert.match(denisTechAnswer, /\u0414\u0430\u0442\u0430: \d{2}\.\d{2}\.2026[\s\S]*\u0422\u0435\u0445\u0432\u0435\u0434: \u0414\u0435\u043d\u0438\u0441/u);
  assert.doesNotMatch(denisTechAnswer, /01\.06\.2026/u);
  assert.match(await answer(runtime, "\u043a\u0430\u043a\u043e\u0433\u043e \u0447\u0438\u0441\u043b\u0430 \u0442\u0435\u0445\u0432\u0435\u0434 \u0410\u0440\u0442\u0435\u043c?"), /\u043d\u0435 \u043d\u0430\u0448\u0451\u043b \u0410\u0440\u0442\u0435\u043c \u0442\u0435\u0445\u0432\u0435\u0434\u043e\u043c/u);
  const missingTechHostRows = snapshot.schedule.rows.slice(1).filter((row) => String(row[scheduleIdx.date] || "").trim() && !String(row[scheduleIdx.techHost] || "").trim());
  const missingTechHostAnswer = await answer(runtime, "\u0432 \u043a\u0430\u043a\u043e\u0439 \u0434\u0435\u043d\u044c \u0443 \u043d\u0430\u0441 \u043d\u0435\u0442 \u0442\u0435\u0445\u0432\u0435\u0434\u0430?");
  if (missingTechHostRows.length) {
    assert.match(missingTechHostAnswer, /\u0422\u0435\u0445\u0432\u0435\u0434: \u043d\u0435\u0442/u);
  } else {
    assert.equal(missingTechHostAnswer, "", "The live schedule currently has a tech host in every dated row");
  }
  assert.equal(await answer(runtime, "\u043a\u0430\u043a\u0430\u044f \u0442\u0435\u043c\u0430 \u0441\u043e\u0431\u0440\u0430\u043d\u0438\u044f 3 \u0438\u044e\u043d\u044f?"), "\u0412 \u044d\u0442\u043e\u0442 \u0434\u0435\u043d\u044c \u0432 \u0440\u0430\u0441\u043f\u0438\u0441\u0430\u043d\u0438\u0438 \u043d\u0435\u0442 \u0441\u043e\u0431\u0440\u0430\u043d\u0438\u044f.");
  assert.match(await answer(runtime, "\u043a\u0430\u043a\u0438\u0435 \u043e\u0431\u044f\u0437\u0430\u043d\u043d\u043e\u0441\u0442\u0438 \u0443 \u0441\u043f\u0438\u043a\u0435\u0440\u0445\u0430\u043d\u0442\u0435\u0440\u0430?"), /\u0421\u043f\u0438\u043a\u0435\u0440\u0445\u0430\u043d\u0442\u0435\u0440 \u043e\u0442\u0432\u0435\u0447\u0430\u0435\u0442/u);
  const sundayRow = snapshot.schedule.rows.slice(1).find((row) => /\u0432\u043e\u0441\u043a\u0440\u0435\u0441\u0435\u043d\u044c\u0435/iu.test(String(row[scheduleIdx.day] || "")) && String(row[scheduleIdx.leader] || "").trim());
  assert.ok(sundayRow, "schedule should have a Sunday row with a leader");
  const sundayDate = String(sundayRow[scheduleIdx.date] || "");
  const sundayLeader = String(sundayRow[scheduleIdx.leader] || "").trim();
  const sundayLeaderPattern = sundayLeader.split(/\s+/u).map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+");
  assert.match(await answer(runtimeForDate(isoFromRuDate(sundayDate)), "\u043a\u0442\u043e \u0432\u0435\u0434\u0443\u0449\u0438\u0439 \u0432 \u0432\u043e\u0441\u043a\u0440\u0435\u0441\u0435\u043d\u0438\u0435?"), new RegExp(`${sundayDate.replaceAll(".", "\\.")}[\\s\\S]*\\u0412\\u0435\\u0434\\u0443\\u0449\\u0438\\u0439: ${sundayLeaderPattern}`, "u"));
  assert.match(await answer(runtime, "\u043a\u043e\u0433\u0434\u0430 \u0440\u043e\u0442\u0430\u0446\u0438\u044f \u0443 \u0412\u0430\u0441\u0438?"), /\u043d\u0435 \u043d\u0430\u0448\u0451\u043b \u0412\u0430\u0441\u0438/u);
  assert.match(await answer(runtime, "\u0433\u0434\u0435 \u0438\u043d\u0444\u043e\u043a\u0430\u043d\u0430\u043b?"), /https:\/\/telegram\.me\/\+n40PjinXX_pjNTcy/u);
  assert.match(await answer(runtime, "\u0447\u0435\u043c \u0437\u0430\u043d\u0438\u043c\u0430\u0435\u0442\u0441\u044f \u0441\u0435\u043a\u0440\u0435\u0442\u0430\u0440\u044c?"), /\u0434\u043e\u043a\u0443\u043c\u0435\u043d\u0442\u044b/u);
}

async function testMeetingScheduleAnswers() {
  const noMeetingRuntime = runtimeForDate("2026-06-03");
  const snapshot = await noMeetingRuntime.getSnapshot(env());
  const scheduleHeaders = snapshot.schedule.rows[0] || [];
  const scheduleIdx = {
    date: headerIndex(scheduleHeaders, ["дата"]),
    theme: headerIndex(scheduleHeaders, ["тема собрания", "тема"])
  };
  const topicRows = snapshot.schedule.rows.slice(1).filter((row) => String(row[scheduleIdx.date] || "").trim() && String(row[scheduleIdx.theme] || "").trim());
  const topicRow = topicRows[0];
  const tomorrowTopicRow = topicRows[1] || topicRows[0];
  assert.ok(topicRow, "schedule should have a row with a topic");
  const topicDate = String(topicRow[scheduleIdx.date] || "");
  const topicMonthName = monthNameFromRuDate(topicDate);
  assert.ok(topicMonthName, `Expected supported month in date: ${topicDate}`);
  const tomorrowTopicDate = String(tomorrowTopicRow[scheduleIdx.date] || "");

  assert.equal(
    await answer(noMeetingRuntime, "\u043a\u043e\u0433\u0434\u0430 \u0441\u043e\u0431\u0440\u0430\u043d\u0438\u0435?"),
    "\u0421\u0435\u0433\u043e\u0434\u043d\u044f \u0443 \u043d\u0430\u0441 \u043d\u0435\u0442 \u0441\u043e\u0431\u0440\u0430\u043d\u0438\u044f. \u041d\u0430\u0448\u0435 \u0440\u0430\u0441\u043f\u0438\u0441\u0430\u043d\u0438\u0435: \u043f\u043e\u043d\u0435\u0434\u0435\u043b\u044c\u043d\u0438\u043a, \u0432\u0442\u043e\u0440\u043d\u0438\u043a, \u0447\u0435\u0442\u0432\u0435\u0440\u0433, \u043f\u044f\u0442\u043d\u0438\u0446\u0430, \u0432\u043e\u0441\u043a\u0440\u0435\u0441\u0435\u043d\u0438\u0435 \u0432 21:30 \u043f\u043e \u043c\u0441\u043a. \u0417\u0430 5-10 \u043c\u0438\u043d\u0443\u0442 \u0432 \u0447\u0430\u0442 \u0432\u044b\u043b\u043e\u0436\u0430\u0442 \u0441\u0441\u044b\u043b\u043a\u0443 \u043d\u0430 Zoom. \u041f\u0440\u0438\u0445\u043e\u0434\u0438, \u0431\u0443\u0434\u0435\u043c \u0440\u0430\u0434\u044b \u0432\u0438\u0434\u0435\u0442\u044c!"
  );

  const meetingRuntime = runtimeForDate("2026-06-04");
  assert.equal(
    await answer(meetingRuntime, "\u0432\u043e \u0441\u043a\u043e\u043b\u044c\u043a\u043e \u0441\u043e\u0431\u0440\u0430\u043d\u0438\u0435?"),
    "\u0421\u043e\u0431\u0440\u0430\u043d\u0438\u0435 \u0441\u0435\u0433\u043e\u0434\u043d\u044f, \u0432 21:30 \u043f\u043e \u043c\u0441\u043a. \u0417\u0430 5-10 \u043c\u0438\u043d\u0443\u0442 \u0432 \u0447\u0430\u0442 \u0432\u044b\u043b\u043e\u0436\u0430\u0442 \u0441\u0441\u044b\u043b\u043a\u0443 \u043d\u0430 Zoom. \u041f\u0440\u0438\u0445\u043e\u0434\u0438, \u0431\u0443\u0434\u0435\u043c \u0440\u0430\u0434\u044b \u0432\u0438\u0434\u0435\u0442\u044c!"
  );
  assert.equal(
    await answer(meetingRuntime, "\u0441\u0435\u0433\u043e\u0434\u043d\u044f \u0435\u0441\u0442\u044c \u0441\u043e\u0431\u0440\u0430\u043d\u0438\u0435?"),
    "\u0421\u043e\u0431\u0440\u0430\u043d\u0438\u0435 \u0441\u0435\u0433\u043e\u0434\u043d\u044f, \u0432 21:30 \u043f\u043e \u043c\u0441\u043a. \u0417\u0430 5-10 \u043c\u0438\u043d\u0443\u0442 \u0432 \u0447\u0430\u0442 \u0432\u044b\u043b\u043e\u0436\u0430\u0442 \u0441\u0441\u044b\u043b\u043a\u0443 \u043d\u0430 Zoom. \u041f\u0440\u0438\u0445\u043e\u0434\u0438, \u0431\u0443\u0434\u0435\u043c \u0440\u0430\u0434\u044b \u0432\u0438\u0434\u0435\u0442\u044c!"
  );
  assert.equal(
    await answer(meetingRuntime, "\u043a\u043e\u0433\u0434\u0430 \u0433\u0440\u0443\u043f\u043f\u0430?"),
    "\u0421\u043e\u0431\u0440\u0430\u043d\u0438\u0435 \u0441\u0435\u0433\u043e\u0434\u043d\u044f, \u0432 21:30 \u043f\u043e \u043c\u0441\u043a. \u0417\u0430 5-10 \u043c\u0438\u043d\u0443\u0442 \u0432 \u0447\u0430\u0442 \u0432\u044b\u043b\u043e\u0436\u0430\u0442 \u0441\u0441\u044b\u043b\u043a\u0443 \u043d\u0430 Zoom. \u041f\u0440\u0438\u0445\u043e\u0434\u0438, \u0431\u0443\u0434\u0435\u043c \u0440\u0430\u0434\u044b \u0432\u0438\u0434\u0435\u0442\u044c!"
  );
  assert.equal(await answer(meetingRuntime, "\u0441\u043e\u0431\u0440\u0430\u043d\u0438\u0435"), "");
  assert.equal(await answer(meetingRuntime, "\u0433\u0440\u0443\u043f\u043f\u0430"), "");
  assert.match(await answer(runtimeForDate(isoFromRuDate(topicDate)), "\u043a\u0430\u043a\u0430\u044f \u0442\u0435\u043c\u0430 \u0441\u043e\u0431\u0440\u0430\u043d\u0438\u044f \u0441\u0435\u0433\u043e\u0434\u043d\u044f?"), new RegExp(`${topicDate.replaceAll(".", "\\.")}[\\s\\S]*\\u0422\\u0435\\u043c\\u0430 \\u0441\\u043e\\u0431\\u0440\\u0430\\u043d\\u0438\\u044f`, "u"));

  const tomorrowTopic = await answer(runtimeForDate(isoFromRuDateOffset(tomorrowTopicDate, -1)), "\u043a\u0430\u043a\u0430\u044f \u0437\u0430\u0432\u0442\u0440\u0430 \u0442\u0435\u043c\u0430 \u0441\u043e\u0431\u0440\u0430\u043d\u0438\u044f?");
  assert.match(tomorrowTopic, new RegExp(`${tomorrowTopicDate.replaceAll(".", "\\.")}[\\s\\S]*\\u0422\\u0435\\u043c\\u0430 \\u0441\\u043e\\u0431\\u0440\\u0430\\u043d\\u0438\\u044f`, "u"));
  const topicDay = String(topicDate).split(".")[0].replace(/^0/u, "");
  assert.match(await answer(noMeetingRuntime, `\u043a\u0430\u043a\u0430\u044f \u0442\u0435\u043c\u0430 ${topicDay} ${topicMonthName}?`), new RegExp(`${topicDate.replaceAll(".", "\\.")}[\\s\\S]*\\u0422\\u0435\\u043c\\u0430 \\u0441\\u043e\\u0431\\u0440\\u0430\\u043d\\u0438\\u044f`, "u"));

  const workingRuntime = runtimeForDate("2026-06-01");
  assert.match(await answer(workingRuntime, "\u043a\u043e\u0433\u0434\u0430 \u0440\u0430\u0431\u043e\u0447\u043a\u0430?"), /27\.06\.2026/u);
  assert.match(await answer(workingRuntime, "\u043a\u043e\u0433\u0434\u0430 \u0440\u0430\u0431\u043e\u0447\u0435\u0435 \u0441\u043e\u0431\u0440\u0430\u043d\u0438\u0435?"), /\u0421\u043b\u0435\u0434\u0443\u044e\u0449\u0435\u0435 \u0440\u0430\u0431\u043e\u0447\u0435\u0435 \u0441\u043e\u0431\u0440\u0430\u043d\u0438\u0435/u);
}

function testWorkerStaticRules() {
  const worker = fs.readFileSync(new URL("./worker.mjs", import.meta.url), "utf8");
  const wranglerConfig = JSON.parse(fs.readFileSync(new URL("./wrangler.jsonc", import.meta.url), "utf8"));
  const servicePersonMap = JSON.parse(wranglerConfig.vars.SERVICE_PERSON_MAP_JSON);
  const messageHandlers = fs.readFileSync(new URL("./message_handlers.js", import.meta.url), "utf8");
  const botPanels = fs.readFileSync(new URL("./bot_panels.js", import.meta.url), "utf8");
  const callbackHandlers = fs.readFileSync(new URL("./callback_handlers.js", import.meta.url), "utf8");
  const telegramApi = fs.readFileSync(new URL("./telegram_api.js", import.meta.url), "utf8");
  const stateClients = fs.readFileSync(new URL("./state_clients.js", import.meta.url), "utf8");
  const zoomMeetingTexts = fs.readFileSync(new URL("./zoom_meeting_texts.js", import.meta.url), "utf8");
  const queueEngine = fs.readFileSync(new URL("./core/queue-engine.js", import.meta.url), "utf8");
  assert.match(worker, /service_reminders_12_00/u, "service reminders should run at 12:00");
  assert.match(worker, /var DAILY_22_ANNOUNCEMENT_ID = 4191;/u, "the daily 22:00 announcement should use TECHVED message 4191");
  assert.match(worker, /runScheduledTaskOncePerDay\(env, "daily_22_00", 22, 0, \(\) => sendAnnouncementCopyToGroup\(env, DAILY_22_ANNOUNCEMENT_ID\), 120\)/u, "TECHVED message 4191 should refresh daily at 22:00 with a same-day catch-up window");
  assert.match(worker, /sendAdminTodayServiceSummary\(env, today, clock\.dateKey, personMap\)/u, "daily service summary should be sent to the admin thread");
  assert.match(worker, /service_admin_summary_sent:\$\{dateKey\}/u, "admin service summary should be deduplicated per day");
  assert.match(worker, /!deletion\.ok && !deletion\.expected/u, "expected Telegram deletion limits should not alert the owner");
  assert.match(telegramApi, /isExpectedDeleteMessageFailure\(error\)/u, "Telegram delete failures should be classified");
  assert.equal(servicePersonMap["\u042e\u043b\u044f"]?.username, "gorinayua", "Julia should resolve from the schedule name");
  assert.equal(servicePersonMap["\u042e\u043b\u044f"]?.telegram_user_id, "6479617191", "Julia should resolve to her Telegram user ID");
  assert.match(worker, /telemost_link: 2597/u, "Zoom link requests should copy tech message 2597");
  assert.match(worker, /meeting_schedule: 3053/u, "Meeting schedule requests should copy message 3053");
  assert.match(messageHandlers, /zoom\|\\u0437\\u0443\\u043c/u, "Zoom link detector should understand Zoom wording");
  assert.match(messageHandlers, /\\u043f\\u0440\\u0438\\u043d\\u0435\\u0441\\u0438/u, "Zoom link detector should understand 'bring link' wording");
  assert.match(messageHandlers, /looksLikeTelemostLinkRequest\(text, normalizeLightText\)[\s\S]*TECH_MESSAGES\.telemost_link/u, "Zoom link route should copy the reference message");
  assert.match(messageHandlers, /looksLikeMeetingScheduleRequest\(text, normalizeLightText\)[\s\S]*TECH_MESSAGES\.meeting_schedule/u, "Meeting schedule route should copy the reference message");
  assert.match(messageHandlers, /deps\.isPrivateChat\(chatType\) \|\| chatId === deps\.CHAT_GROUP_ID \|\| chatId === deps\.INFO_CHAT_ID/u, "Meeting schedule route should work in private, group, and INFO chats");
  assert.match(messageHandlers, /payload\.message_thread_id = threadId/u, "Meeting schedule copies in INFO should stay in the current topic");
  assert.match(messageHandlers, /chatId === deps\.CHAT_GROUP_ID \|\| chatId === deps\.INFO_CHAT_ID/u, "Nafanya addressed requests should work in both public channels");
  assert.match(messageHandlers, /if \(deps\.isPrivateChat\(chatType\)\) return true/u, "Private chats should handle Nafanya requests without explicit address");
  assert.match(messageHandlers, /const canSendAdminSignal = nafanyaRequestHere \|\| isPrepThread\(chatId, threadId\)/u, "Fix/help routes should work for Nafanya requests in both channels and private chats");
  assert.match(messageHandlers, /if \(nafanyaRequestHere && hasServiceRequest\(text\)\)/u, "Service requests should work for Nafanya requests in both channels and private chats");
  assert.match(messageHandlers, /findKnowledgeAnswerDetailed\(env, parsedAddressedQuestion, \{ restrained \}\)/u, "Addressed public questions should try FAQ/schedule/servants before AI");
  assert.match(messageHandlers, /\\u0433\\u0440\\u0443\\u043f\\u043f/u, "Meeting schedule detector should understand group schedule wording");
  assert.match(messageHandlers, /\\u043c\\u043e\\u0436\\u0435\\u0442/u, "Meeting schedule detector should understand 'maybe, schedule' wording");
  assert.match(worker, /DAILY_15_ANNOUNCEMENT_ID = 3053/u, "daily 15:00 group copy should use message 3053");
  assert.match(worker, /daily_15_00", 15, 0/u, "daily group copy should run at 15:00");
  assert.match(worker, /DAILY_ANNOUNCE_THREAD_MESSAGE_ID = 3053/u, "daily announce-thread copy should use message 3053");
  assert.match(worker, /message_thread_id: targetThreadId/u, "info-thread copies should target a Telegram topic");
  assert.match(worker, /announce_thread_11_00", 11, 0/u, "announce-thread copy should run at 11:00");
  assert.match(worker, /announce_thread_18_00", 18, 0/u, "announce-thread copy should run at 18:00");
  assert.match(worker, /DAILY_ANNOUNCE_THREAD_MESSAGE_ID, ANNOUNCE_THREAD_ID/u, "daily message should be copied to Announce thread");
  assert.doesNotMatch(worker, /free_services_10_00/u, "free-services announcement should not run at 10:00");
  assert.doesNotMatch(worker, /info_channel_21_00/u, "info-channel announcement should not run at 21:00");
  assert.doesNotMatch(worker, /sendAdminSignal\(env, text, true\)/u, "service reminder errors should not be formatted as moderation signals");
  assert.match(worker, /sourceMessageId: 2893/u, "Monday tech announcement should copy message 2893");
  assert.match(worker, /sourceMessageId: 2894/u, "Tuesday tech announcement should copy message 2894");
  assert.match(worker, /sourceMessageId: 2895/u, "Thursday tech announcement should copy message 2895");
  assert.match(worker, /sourceMessageId: 2896/u, "Friday tech announcement should copy message 2896");
  assert.match(worker, /sourceMessageId: 2897/u, "Sunday tech announcement should copy message 2897");
  assert.match(worker, /sourceMessageId: 3132[\s\S]*zoomKey: "theme_monday"/u, "Meeting-topic button should use new Monday source 3132");
  assert.match(worker, /sourceMessageId: 3133[\s\S]*zoomKey: "theme_tuesday"/u, "Meeting-topic button should use new Tuesday source 3133");
  assert.match(worker, /sourceMessageId: 3134[\s\S]*zoomKey: "theme_thursday"/u, "Meeting-topic button should use new Thursday source 3134");
  assert.match(worker, /sourceMessageId: 3135[\s\S]*zoomKey: "theme_friday"/u, "Meeting-topic button should use new Friday source 3135");
  assert.match(worker, /sourceMessageId: 3136[\s\S]*zoomKey: "theme_sunday"/u, "Meeting-topic button should use new Sunday source 3136");
  assert.doesNotMatch(botPanels, /promises9/u, "Meeting panel should not include the 9th-step promises button");
  assert.doesNotMatch(botPanels, /topicsMeetingUrl|url: topicsMeetingUrl/u, "Meeting topics button should not be a link");
  assert.match(botPanels, /callback_data: "meeting:today_topic"/u, "Meeting topics button should publish today's topic");
  assert.match(botPanels, /meeting:seventh_tradition" \},\s*\n\s*\{ text: "\\uD83D\\uDE4B[\s\S]*callback_data: "meeting:free_services"/u, "Seventh tradition and free services should be on one meeting-panel row");
  assert.match(botPanels, /meeting:tea_rules" \},\s*\n\s*\{ text: "\\u2753[\s\S]*callback_data: "meeting:speaker_questions"/u, "Tea rules and speaker questions should be on one meeting-panel row");
  assert.match(botPanels, /meeting:chat_cleanliness" \},\s*\n\s*\{ text: "\\uD83D\\uDCCC[\s\S]*callback_data: "meeting:chat_rules"/u, "Chat cleanliness and chat rules should be on one meeting-panel row");
  assert.match(botPanels, /callback_data: "meeting:meeting_schedule"[\s\S]*callback_data: "meeting:telemost_link"/u, "Meeting schedule and links should share the final meeting-panel row");
  assert.match(botPanels, /text: "\\u0421\\u0441\\u044b\\u043b\\u043a\\u0438"[\s\S]*callback_data: "meeting:telemost_link"/u, "Meeting links button should be renamed to 'Links'");
  assert.match(worker, /free_services: FREE_SERVICES_ANNOUNCEMENT_ID/u, "Free services meeting button should copy the free-services announcement");
  assert.match(worker, /function isMeetingPanelCommand\(text, \{ allowBare = true \} = \{\}\)[\s\S]*\\u043F\\u0443\\u043B\\u044C\\u0442 \\u0441\\u043E\\u0431\\u0440\\u0430\\u043D\\u0438\\u044F[\s\S]*allowBare && bare/u, "Meeting panel command should support strict 'panel meeting' mode");
  assert.match(messageHandlers, /isMeetingPanelCommand\(text, \{ allowBare: !isChatGroup\(chatId, threadId\) \}\)/u, "Group chat should require 'panel meeting' to open meeting panel");
  assert.match(worker, /function getTodayTopicSourceMessageId\(\)[\s\S]*TODAY_TOPIC_MESSAGES\.find/u, "Today's topic button should be selected from the new topic-message map");
  assert.match(worker, /function getTodayTopicZoomMessages\(\)[\s\S]*getZoomMeetingMessages\(key\)/u, "Zoom topic messages should use the weekday theme text");
  assert.match(worker, /const combined = parts\.map\(\(part\) => plainZoomText\(part\)\)\.filter\(Boolean\)\.join\("\\n"\);[\s\S]*return splitZoomText\(combined\)/u, "Zoom meeting messages should be packed into the minimum number of messages");
  assert.match(callbackHandlers, /if \(key === "today_topic"\)[\s\S]*copyTechMessageToGroup\(env, CHAT_GROUP_ID, INFO_CHAT_ID, sourceMessageId\)/u, "Today's topic button should copy the source message from TECHVED");
  assert.match(callbackHandlers, /\\u0421\\u0435\\u0433\\u043E\\u0434\\u043D\\u044F \\u0441\\u043E\\u0431\\u0440\\u0430\\u043D\\u0438\\u044F \\u043D\\u0435\\u0442/u, "No-topic days should say today's meeting is absent");
  assert.doesNotMatch(worker + zoomMeetingTexts, /\\u0442\\u0435\\u043A\\u0441\\u0442 \\u0434\\u043B\\u044F Zoom \\u043D\\u0443\\u0436\\u043D\\u043E \\u043F\\u0435\\u0440\\u0435\\u043D\\u0435\\u0441\\u0442\\u0438/u, "Zoom meeting texts should not contain placeholder copy");
  for (const key of ["minute_silence", "prayer", "preambula", "newcomer", "steps12", "traditions12", "meeting_rules", "chat_cleanliness", "seventh_tradition", "tea_rules", "speaker_questions", "free_services", "telemost_link", "meeting_schedule", "theme_monday", "theme_tuesday", "theme_thursday", "theme_friday", "theme_sunday"]) {
    assert.match(zoomMeetingTexts, new RegExp(`"${key}"`, "u"), `Zoom meeting text should include ${key}`);
  }
  assert.equal(ZOOM_MEETING_MESSAGE_TEXTS.steps12.length, 2, "Zoom 12 steps should be manually split into two parts");
  assert.equal(ZOOM_MEETING_MESSAGE_TEXTS.traditions12.length, 2, "Zoom 12 traditions should be manually split into two parts");
  assert.equal(ZOOM_MEETING_MESSAGE_TEXTS.meeting_rules.length, 1, "Zoom meeting rules should stay in one message");
  assert.equal(ZOOM_MEETING_MESSAGE_TEXTS.meeting_rules[0].length, 946, "Zoom meeting rules should fit the one-message limit");
  assert.match(ZOOM_MEETING_MESSAGE_TEXTS.meeting_rules[0], /^\u041F\u0420\u0410\u0412\u0418\u041B\u0410 \u0421\u041E\u0411\u0420\u0410\u041D\u0418\u042F\n\n\u2705 /u, "Zoom meeting rules should use the requested plain header");
  assert.doesNotMatch(ZOOM_MEETING_MESSAGE_TEXTS.meeting_rules[0], /\*\*/u, "Zoom meeting rules should not include Markdown bold markers");
  assert.match(ZOOM_MEETING_MESSAGE_TEXTS.meeting_rules[0], /\u043E\u0441\u0442\u0430\u0442\u044C\u0441\u044F \u0441\u043B\u0443\u0448\u0430\u0442\u0435\u043B\u0435\u043C$/u, "Zoom meeting rules should use the requested ending");
  assert.equal(ZOOM_MEETING_MESSAGE_TEXTS.chat_cleanliness.length, 1, "Zoom chat cleanliness should stay in one message");
  assert.match(ZOOM_MEETING_MESSAGE_TEXTS.chat_cleanliness[0], /^\u0427\u0418\u0421\u0422\u041E\u0422\u0410 \u0427\u0410\u0422\u0410\n\n\u2705 /u, "Zoom chat cleanliness should use its own plain header");
  assert.notEqual(ZOOM_MEETING_MESSAGE_TEXTS.chat_cleanliness[0], ZOOM_MEETING_MESSAGE_TEXTS.meeting_rules[0], "Zoom chat cleanliness should not reuse meeting rules");
  assert.equal(ZOOM_MEETING_MESSAGE_TEXTS.seventh_tradition.length, 1, "Zoom seventh tradition should stay in one message");
  assert.equal(ZOOM_MEETING_MESSAGE_TEXTS.seventh_tradition[0].length, 511, "Zoom seventh tradition should fit the one-message limit");
  assert.match(ZOOM_MEETING_MESSAGE_TEXTS.seventh_tradition[0], /^\u0421\u0415\u0414\u042C\u041C\u0410\u042F \u0422\u0420\u0410\u0414\u0418\u0426\u0418\u042F\n\n\u2705 /u, "Zoom seventh tradition should use the requested plain header");
  assert.doesNotMatch(ZOOM_MEETING_MESSAGE_TEXTS.seventh_tradition[0], /\*\*/u, "Zoom seventh tradition should not include Markdown bold markers");
  assert.match(ZOOM_MEETING_MESSAGE_TEXTS.seventh_tradition[0], /\u0421\u0431\u0435\u0440 \(\u0421\u0411\u041F\)[\s\S]*\u043F\u0438\u0448\u0438\u0442\u0435 "7 \u0442\u0440\u0430\u0434\u0438\u0446\u0438\u044F"/u, "Zoom seventh tradition should use the requested Sber and comment text");
  assert.match(ZOOM_MEETING_MESSAGE_TEXTS.seventh_tradition[0], /\u0411\u043B\u0430\u0433\u043E\u0434\u0430\u0440\u0438\u043C \u0437\u0430 \u0443\u0447\u0430\u0441\u0442\u0438\u0435 \u0438 \u043F\u043E\u0434\u0434\u0435\u0440\u0436\u043A\u0443! \uD83D\uDE4F$/u, "Zoom seventh tradition should use the requested ending");
  for (const [key, messages] of Object.entries(ZOOM_MEETING_MESSAGE_TEXTS)) {
    for (const message of messages) {
      assert.doesNotMatch(message, /\*\*/u, `Zoom meeting text ${key} should not include Markdown bold markers`);
    }
  }
  assert.match(ZOOM_MEETING_MESSAGE_TEXTS.telemost_link[0], /\u041D\u0410\u0428\u0418 \u0420\u0415\u0421\u0423\u0420\u0421\u042B \u0412 \u0418\u041D\u0422\u0415\u0420\u041D\u0415\u0422\u0415[\s\S]*https:\/\/pochtinormalnye\.ru\/[\s\S]*\u0421\u043E\u0431\u0440\u0430\u043D\u0438\u044F \u0432 Zoom:[\s\S]*https:\/\/us06web\.zoom\.us\/j\/5487249245/u, "Zoom links message should include the site and Zoom meeting");
  assert.match(ZOOM_MEETING_MESSAGE_TEXTS.telemost_link[0], /\u0413\u0440\u0443\u043F\u043F\u0430 \u0432 \u0422\u0413:[\s\S]*https:\/\/telegram\.me\/\+mta_CKQY2c05ODRi[\s\S]*\u0418\u043D\u0444\u043E \u041A\u0430\u043D\u0430\u043B \u0432 \u0422\u0413:[\s\S]*https:\/\/telegram\.me\/\+n40PjinXX_pjNTcy/u, "Zoom links message should include Telegram group and info channel");
  assert.equal((ZOOM_MEETING_MESSAGE_TEXTS.telemost_link[0].match(/https:\/\/pochtinormalnye\.ru\//gu) || []).length, 1, "Zoom links message should include the site once");
  assert.doesNotMatch(ZOOM_MEETING_MESSAGE_TEXTS.telemost_link[0], /max\.ru|MAX|\u041C\u0410\u0425/u, "Zoom links message should not include the old MAX fallback");
  assert.match(ZOOM_MEETING_MESSAGE_TEXTS.steps12[0], /^12 \u0428\u0410\u0413\u041E\u0412 \u0410\u0410/u, "Zoom 12 steps part 1 should omit the part label");
  assert.match(ZOOM_MEETING_MESSAGE_TEXTS.steps12[1], /^8\uFE0F\u20E3/u, "Zoom 12 steps part 2 should omit the part label");
  assert.match(ZOOM_MEETING_MESSAGE_TEXTS.traditions12[0], /^12 \u0422\u0420\u0410\u0414\u0418\u0426\u0418\u0419 \u0410\u0410/u, "Zoom 12 traditions part 1 should omit the part label");
  assert.match(ZOOM_MEETING_MESSAGE_TEXTS.traditions12[1], /^8\uFE0F\u20E3/u, "Zoom 12 traditions part 2 should omit the part label");
  assert.doesNotMatch(`${ZOOM_MEETING_MESSAGE_TEXTS.steps12.join("\n")}\n${ZOOM_MEETING_MESSAGE_TEXTS.traditions12.join("\n")}`, /\u0427\u0430\u0441\u0442\u044C [12]\/2:/u, "Zoom split messages should not include part labels");
  assert.equal(ZOOM_MEETING_MESSAGE_TEXTS.tea_rules[0].length, 836, "Zoom tea rules should use the requested one-message text");
  assert.match(ZOOM_MEETING_MESSAGE_TEXTS.tea_rules[0], /^\u2615\uFE0F \u0414\u043E\u0431\u0440\u043E \u043F\u043E\u0436\u0430\u043B\u043E\u0432\u0430\u0442\u044C \u0432 \u0432\u0438\u0440\u0442\u0443\u0430\u043B\u044C\u043D\u0443\u044E \u0447\u0430\u0439\u043D\u0443\u044E!\n\n\u2705/u, "Zoom tea rules should use the requested heading and compact rules");
  assert.match(ZOOM_MEETING_MESSAGE_TEXTS.tea_rules[0], /\*\u0421\u043B\u0443\u0436\u0430\u0449\u0438\u0435/u, "Zoom tea rules should keep the requested service note marker");
  assert.equal(ZOOM_MEETING_MESSAGE_TEXTS.theme_monday[0].length, 279, "Zoom Monday theme should use the requested one-message text");
  assert.match(ZOOM_MEETING_MESSAGE_TEXTS.theme_monday[0], /^\u041F\u041E\u041D\u0415\u0414\u0415\u041B\u042C\u041D\u0418\u041A\n\n\u0422\u0435\u043C\u044B \u0441\u043E\u0431\u0440\u0430\u043D\u0438\u044F\n_______________\n\n/u, "Zoom Monday theme should use the requested plain underline");
  assert.match(ZOOM_MEETING_MESSAGE_TEXTS.meeting_schedule[0], /\u0427\u0415\u0422\u0412\u0415\u0420\u0413[\s\S]*\u0416\u0438\u0442\u044c \u0442\u0440\u0435\u0437\u0432\u044b\u043c\u0438/u, "Zoom schedule should put newcomer/living sober on Thursday");
  assert.match(ZOOM_MEETING_MESSAGE_TEXTS.meeting_schedule[0], /\u041f\u042f\u0422\u041d\u0418\u0426\u0410[\s\S]*12 \u0448\u0430\u0433\u043e\u0432 \u0438 12 \u0442\u0440\u0430\u0434\u0438\u0446\u0438\u0439[\s\S]*\u0421\u043f\u0438\u043a\u0435\u0440\u0441\u043a\u0430\u044f/u, "Zoom schedule should put 12x12 and speaker meeting on Friday");
  assert.ok(
    ZOOM_MEETING_MESSAGE_TEXTS.meeting_schedule[0].indexOf("\u0421\u043e\u0431\u0440\u0430\u043d\u0438\u044f \u0432 Zoom") < ZOOM_MEETING_MESSAGE_TEXTS.meeting_schedule[0].indexOf("\u041c\u044b \u0432 \u0422\u0435\u043b\u0435\u0433\u0440\u0430\u043c"),
    "Zoom schedule should list Zoom before Telegram"
  );
  assert.match(worker, /tech_11_00`, item\.weekday, 11, 0, \(\) => sendAnnouncementCopyToGroup/u, "weekday tech announcements should run at 11:00");
  assert.match(worker, /tech_21_20`, item\.weekday, 21, 20, \(\) => sendAnnouncementCopyToGroup/u, "weekday tech announcements should run at 21:20");
  assert.match(worker, /\\u041f\\u043e\\u0434\\u0442\\u0432\\u0435\\u0440\\u0436\\u0434\\u0430\\u044e/u, "service reminder OK button should say 'Confirm'");
  assert.match(queueEngine, /const speechNote = getQueue111Note\(rawText\);[\s\S]*return makeQueueEntry\(message, "speech", "__speech__", rawText, \{ kind: "bill_speech", speechNote, source \}\)/u, "Bill queue should accept 111 with text before or after it");
  assert.match(botPanels, /title: "\\u0427\\u0442\\u0435\\u043d\\u0438\\u0435 \\u043A\\u043D\\u0438\\u0433\\u0438"/u, "BK queue title should say 'Reading book'");
  assert.match(queueEngine, /const trigger = normalized\.match\(\/\^\(222\|333\|444\)/u, "Bill queue should still accept plain repeat triggers");
  assert.match(queueEngine, /lines\.push\(`\$\{marker\} \$\{index \+ 1\}\. \$\{entry\.author\}/u, "Queue text should show visible row numbers");
  assert.match(queueEngine, /function formatQueueAuthorLabel\(author\)[\s\S]*return cleanAuthor \|\|/u, "Queue author should not include Telegram or Zoom source markers");
  assert.match(queueEngine, /function isDuplicatePendingQueueEntry[\s\S]*existing\.status === "pending"[\s\S]*normalizeQueueEntryKey\(existing\.author\) === author/u, "Queue should ignore duplicate pending entries from the same person");
  assert.match(queueEngine, /function isDuplicatePendingBillSpeechEntry[\s\S]*\(111\|222\|333\|444\)[\s\S]*duplicate: true/u, "Bill queue should ignore repeated 111 before converting it into 222/333/444");
  assert.match(queueEngine, /export const QUEUE_FOOTER_LINES = \[\];/u, "Queue text should not append Telegram or Zoom footer links");
  const queueModeText = botPanels.match(/export const QUEUE_MODE_TEXT = \{[\s\S]*?\n\};/u)?.[0] || "";
  assert.doesNotMatch(queueModeText, /help|telegram\.me\/\+mta_CKQY2c05ODRi|us06web\.zoom\.us\/j\/5487249245/u, "Queue prompts should stay clean without help or link footers");
  assert.match(worker, /runQueueStateActionCore\(queueState, action, payload, buildQueueTextCore\)/u, "Worker queue Durable Object should delegate queue rules to the shared engine");
  assert.match(queueEngine, /if \(action === "remove_by_number"\)[\s\S]*state\.entries\.splice\(visibleNumber - 1, 1\)/u, "Queue state should remove entries by visible row number");
  assert.match(worker, /result\.queueText,[\s\S]*buildQueuePublicKeyboard\(\),[\s\S]*result\.parseMode/u, "Published queue messages should include public queue control buttons");
  assert.match(botPanels, /function buildQueuePublicKeyboard\(\)[\s\S]*queue:done[\s\S]*queue:skip[\s\S]*queue:remove[\s\S]*queue:undo[\s\S]*queue:close/u, "Public queue keyboard should keep only active queue controls");
  assert.doesNotMatch(botPanels, /function buildQueuePublicKeyboard\(\)[\s\S]*queue:open_bill/u, "Public queue keyboard should not include queue mode buttons");
  assert.match(telegramApi, /disable_web_page_preview = true/u, "Bot text messages should suppress link previews");
  assert.doesNotMatch(worker, /const standalone = normalized\.match/u, "Bill game questions should not catch bare numbers like 1");
  assert.doesNotMatch(worker, /const anyNumber = normalized\.match/u, "Bill game questions should not catch arbitrary numbers inside text");
  assert.match(queueEngine, /return makeQueueEntry\(message, "first", `\\u0438\\u0433\\u0440\\u0430 \$\{questionNumber\}`/u, "Bill game requests should be queued in the first-priority block");
  assert.match(queueEngine, /const priorityOrder = \{ first: 1, "222": 2, "333": 3, "444": 4 \}[\s\S]*return diff !== 0 \? diff : a\.createdAt - b\.createdAt/u, "Bill queue should keep chronological order inside the first-priority block");
  assert.match(messageHandlers, /await sendMessage\(env, chatId, `\\u0412\\u043e\\u043f\\u0440\\u043e\\u0441 \$\{gameNumber\}/u, "Bill game command should send a question before queue handling");
  assert.match(messageHandlers, /await sendMessage\(env, chatId, `\\u0412\\u043e\\u043f\\u0440\\u043e\\u0441 \$\{gameNumber\}[\s\S]*const queueInfo = await callQueueState\(env, "get"\);[\s\S]*const gameQueueEntry = parseQueueEntry/u, "Bill game command should add to queue only after answering and only when Bill queue is open");
  assert.match(messageHandlers, /if \(message\?\.reply_to_message && !message\.reply_to_message\?\.from\?\.is_bot\) \{\s*return null;\s*\}[\s\S]*const gameNumber = parseGameCommand/u, "Queue triggers should ignore replies to people but allow replies to bot queue messages");
  assert.doesNotMatch(messageHandlers, /isGameAllowedNow|21:30 \\u0434\\u043e 24:00|allowBillGameEntries/u, "Bill game should not have a time-of-day restriction");
  assert.doesNotMatch(messageHandlers, /\\u0418\\u0433\\u0440\\u0430 \\u0440\\u0430\\u0431\\u043e\\u0442\\u0430\\u0435\\u0442 \\u0442\\u043e\\u043b\\u044c\\u043a\\u043e \\u0432\\u043e \\u0432\\u0440\\u0435\\u043c\\u044f \\u0441\\u043e\\u0431\\u0440\\u0430\\u043d\\u0438\\u044f/u, "Bill game should not claim it only works during the meeting");
  assert.match(messageHandlers, /if \(message\?\.from\?\.is_bot\) \{\s*return okResponse\(\);/u, "Bot-authored messages should be ignored before routing");
  assert.match(queueEngine, /function getQueueSpeechCodeNote\(rawText\)[\s\S]*\(111\|222\|333\|444\)/u, "BK and RS queues should accept 111/222/333/444 trigger codes");
  assert.match(queueEngine, /function parseBkQueueEntry\(message, \{ source = "Telegram" \} = \{\}\)[\s\S]*formatQueue111Label\(codeInfo\.note\)/u, "BK queue should publish every accepted trigger as 111");
  assert.match(queueEngine, /function parseRsQueueEntry\(message, \{ source = "Telegram" \} = \{\}\)[\s\S]*formatQueue111Label\(codeInfo\.note\)/u, "RS queue should publish every accepted trigger as 111");
  assert.match(messageHandlers, /function parseManualQueueAddBody\(body\)[\s\S]*action: "add_game"[\s\S]*action: "add_111"[\s\S]*function parseManualQueueCommand\(text\)[\s\S]*action: "remove"/u, "Admin text commands should parse manual queue add/game/remove actions");
  assert.doesNotMatch(messageHandlers, /parseBareManualQueueCommand/u, "Bare 111 from admins should stay a normal self queue request");
  assert.match(messageHandlers, /\?:\\s\+\\u0432\\s\+\\u043e\\u0447\\u0435\\u0440\\u0435\\u0434\\u044c\)\?/u, "Manual add command should allow short 'add 111 name' form");
  assert.match(messageHandlers, /isPrivateChat\(chatType\)[\s\S]*getPrivateRoles[\s\S]*isUserAdmin\(env, message\.from\?\.id, chatId, chatType\)/u, "Manual queue commands should use group admin checks in chats");
  assert.match(messageHandlers, /if \(!roles\.isAdmin\) \{[\s\S]*\\u0442\\u043e\\u043b\\u044c\\u043a\\u043e \\u0434\\u043b\\u044f \\u0430\\u0434\\u043c\\u0438\\u043d\\u043e\\u0432/u, "Non-admins should not be able to change the queue manually");
  assert.match(messageHandlers, /makeManualQueueEntry\(parsed\.author, "first", `\\u0438\\u0433\\u0440\\u0430 \$\{parsed\.number\}`[\s\S]*\\u0412\\u043e\\u043f\\u0440\\u043e\\u0441 \$\{parsed\.number\}/u, "Manual game command should add to queue and send the question");
  assert.match(worker, /makeManualQueueEntry: makeManualQueueEntryCore/u, "Manual queue entry factory should be passed to message handlers");
  assert.match(messageHandlers, /isPanelPlace = isTechThread\(chatId, threadId\) \|\| isChatGroup\(chatId, threadId\) \|\| isPrivateChat\(chatType\)/u, "Meeting and queue panels should open in TECHVED, group chat, and private chats");
  assert.match(messageHandlers, /Number\(message\?\.sender_chat\?\.id\) === Number\(chatId\)/u, "Panel commands posted by an anonymous group admin should be allowed");
  assert.match(messageHandlers, /reopenForumTopic[\s\S]*sendMessage[\s\S]*closeForumTopic/u, "Panels should be delivered into a closed TECHVED topic and leave it closed");
  assert.match(messageHandlers, /handleServiceMessages[\s\S]*isTechThread,[\s\S]*TECH_THREAD_ID,[\s\S]*callTelegram,/u, "Service handler should receive all dependencies used by the timer panel");
  assert.match(messageHandlers, /isChatGroup\(chatId, threadId\) \|\| isTechThread\(chatId, threadId\) \|\| isPrivateChat\(chatType\)\) && isTimerPanelCommand\(text\)/u, "Timer panel should open in TECHVED, group chat, and private chats");
  assert.match(worker, /async function isUserAdmin\(env, userId, chatId = INFO_CHAT_ID, chatType = ""\)[\s\S]*isPrivateChat\(chatType\)[\s\S]*getPrivateRoles/u, "Private callback permissions should use bot admin roles");
  assert.match(worker, /ADMIN_MANAGER_USERNAMES/u, "Admin manager usernames should be configurable");
  assert.match(worker, /get_personal_subscription[\s\S]*subscription\?\.username[\s\S]*isAdminDmUser\(env, id, username\)/u, "Private roles should recognize saved usernames from /start");
  assert.match(stateClients, /function callScheduleState[\s\S]*getByName\("schedule"\)/u, "Cron run markers should use a separate Durable Object instance");
  assert.match(worker, /let previous = await callScheduleState\(env, "get", \{ key: stateKey \}\)[\s\S]*legacyPrevious = await callAnnouncementState\(env, "get", \{ key: stateKey \}\)[\s\S]*await callScheduleState\(env, "set_message_id"/u, "Cron run markers should migrate old once-per-day state without duplicating sends");
  assert.match(worker, /async function sendPersonalDayAnnouncement\(env, sourceMessageId, silent = false\) \{\s*const result = await callPersonalDayState\(env, "list_personal_subscriptions"\);/u, "Personal 10-11 delivery should not silently treat storage failures as zero subscribers");
  assert.match(messageHandlers, /canManageAdmins = false[\s\S]*if \(isOwner \|\| canManageAdmins\)/u, "Admin manager role should show add/remove admin buttons");
  assert.match(callbackHandlers, /managerRoles\.canManageAdmins/u, "Admin manager role should be allowed to confirm add/remove admin callbacks");
  assert.match(worker, /chat_id: targetChatId/u, "Chat callback permissions should check the chat where the button was pressed");
  assert.match(worker, /function isChatGroup\(chatId, threadId\) \{\s*return chatId === CHAT_GROUP_ID;/u, "Any Telegram topic id in the main group should count as the group chat for queue messages");
  assert.match(callbackHandlers, /isUserAdmin\(env, userId, chatId, chatType\)/u, "Panel callbacks should pass chat context into admin checks");
  assert.doesNotMatch(callbackHandlers, /\\u042D\\u0442\\u043E\\u0442 \\u043F\\u0443\\u043B\\u044C\\u0442 \\u0436\\u0438\\u0432/u, "Panel callbacks should not reject buttons just because the panel is outside its old topic");
  assert.match(messageHandlers, /const canSendAdminSignal = nafanyaRequestHere \|\| isPrepThread\(chatId, threadId\)/u, "fix/help should work in private chats and addressed public channels");
  assert.match(messageHandlers, /if \(nafanyaRequestHere && hasServiceRequest\(text\)\)/u, "service requests should work in private chats and addressed public channels");
  assert.match(messageHandlers, /privateKnowledgeQuestion/u, "private chats should query knowledge docs before light talk");
}

function testExpectedDeleteMessageFailures() {
  assert.equal(isExpectedDeleteMessageFailure(new Error('deleteMessage failed: {"description":"Bad Request: message can\'t be deleted"}')), true);
  assert.equal(isExpectedDeleteMessageFailure(new Error('deleteMessage failed: {"description":"Bad Request: message to delete not found"}')), true);
  assert.equal(isExpectedDeleteMessageFailure(new Error('deleteMessage failed: {"description":"Forbidden: bot is not an administrator"}')), false);
}

async function testSuccessfulTelegramCopySurvivesMarkerFailure() {
  const env = {
    ANNOUNCEMENT_STATE: {
      getByName() {
        return {
          async fetch() {
            return Response.json({ ok: false, error: "overloaded" }, { status: 503 });
          }
        };
      }
    }
  };
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    assert.equal(
      await saveAnnouncementMessageIdAfterCopy(env, "daily-test", 12345),
      false,
      "A failed auxiliary marker write must not turn an already successful Telegram copy into a failed send"
    );
  } finally {
    console.error = originalConsoleError;
  }
}


function testZoomOnlyStaticRules() {
  const worker = fs.readFileSync(new URL("./worker.mjs", import.meta.url), "utf8");
  const queueEngine = fs.readFileSync(new URL("./core/queue-engine.js", import.meta.url), "utf8");
  const stateClients = fs.readFileSync(new URL("./state_clients.js", import.meta.url), "utf8");
  const wrangler = fs.readFileSync(new URL("./wrangler.jsonc", import.meta.url), "utf8");
  const fetchRouter = worker.match(/var worker_default = \{[\s\S]*?async scheduled/su)?.[0] || "";

  assert.match(worker, /var ZoomMeetingStateDurableObject = class/u, "Current Zoom board and outbox should have a dedicated Durable Object");
  assert.match(worker, /var ZoomSharedTimerStateDurableObject = class/u, "The frequently synchronized Zoom timer should have its own Durable Object");
  assert.match(stateClients, /bindingName: "ZOOM_MEETING_STATE"[\s\S]*legacyExportAction: "export_zoom_meeting_state"/u, "Meeting state should migrate automatically from the legacy announcement object");
  assert.match(stateClients, /bindingName: "ZOOM_SHARED_TIMER_STATE"[\s\S]*legacyExportAction: "export_zoom_shared_timer_state"/u, "Timer state should migrate automatically from the legacy announcement object");
  assert.match(worker, /action === "export_zoom_meeting_state"/u, "Legacy meeting state should remain readable during the compatibility migration");
  assert.match(worker, /action === "export_zoom_shared_timer_state"/u, "Legacy timer state should remain readable during the compatibility migration");
  assert.match(worker, /callZoomMeetingState\(env, "meeting_board_action"/u, "The active free-form queue should use the dedicated meeting object");
  assert.match(stateClients, /getByName\(instanceName\)/u, "Zoom state clients must support isolated Durable Object instances");
  assert.match(worker, /callZoomSharedTimerState\(env, "timer_action"/u, "Timer actions should bypass the announcement singleton");
  assert.match(worker, /callZoomMeetingState\(env, "pull_messages"/u, "The live sender should pull from the dedicated meeting outbox");
  assert.match(worker, /ignored: "queue_paused"/u, "Retired Zoom chat queue endpoints should remain harmless compatibility stubs");
  assert.match(worker, /return htmlResponse\(buildZoomMeetingBoardPanelHtml\(\)\)/u, "The current tech-host panel must not depend on a laboratory mode");
  assert.doesNotMatch(worker, /meeting_board_replay|onParticipantChange/u, "Participant joins must not republish the meeting board");
  assert.doesNotMatch(worker, /ZOOM_QUEUE_ENABLED|function isZoomQueueEnabled/u, "The retired Zoom queue switch must not survive in Worker source");
  assert.doesNotMatch(worker, /buildZoomAppHtml|buildZoomV2PanelHtml|buildZoomLibraryPanelHtml|ZOOM_APP_ALLOWED_COMMANDS|ZOOM_V2_PANEL_QUEUE_ACTIONS/u, "Retired Zoom panels and queue controls must be physically removed");
  assert.doesNotMatch(worker, /handleZoomBridgeMessage|handleZoomOnlyMessage|parseZoomManualQueueCommand|callZoomOnlyQueueState|buildZoomPayloadFromChatEvent/u, "Retired Zoom chat-ingest queue implementation must be physically removed");
  assert.doesNotMatch(queueEngine, /buildZoomOnlyQueueText|action === "auto_open"/u, "The shared Telegram queue engine must not retain retired Zoom-only branches");
  assert.doesNotMatch(wrangler, /ZOOM_QUEUE_ENABLED|ZOOM_ADMIN_NAMES/u, "Retired Zoom queue configuration must be removed");
  assert.doesNotMatch(fetchRouter, /\/zoom-only\/reset|\/zoom\/outbox|\/zoom\/webhook|\/zoom\/debug|\/zoom\/app\/action/u, "Retired Zoom queue and reset routes must not be exposed");
  assert.doesNotMatch(fetchRouter, /url\.pathname === "\/zoom\/app"/u, "The retired Worker-hosted Zoom app must not be exposed");
  assert.doesNotMatch(worker.match(/async scheduled[\s\S]*?\n  \}\n\};/su)?.[0] || "", /queue_clear_23_55|isZoomQueueEnabled/u, "The retired Zoom queue must not run scheduled work");
  assert.match(wrangler, /"ZOOM_MEETING_STATE"[\s\S]*"ZoomMeetingStateDurableObject"/u, "Wrangler should bind the meeting state object");
  assert.match(wrangler, /"ZOOM_SHARED_TIMER_STATE"[\s\S]*"ZoomSharedTimerStateDurableObject"/u, "Wrangler should bind the timer state object");
  assert.match(worker, /url\.pathname\.startsWith\("\/zoom-only\/team-chat\/"\)[\s\S]*team_chat_test_retired/u, "Retired Team Chat routes should fail closed with an explicit compatibility response");
  assert.doesNotMatch(worker, /zoom_team_chat|callZoomTeamChatState|sendMessageToChat|teamChatTest/u, "The failed Team Chat laboratory must be physically removed from runtime code");
  assert.doesNotMatch(wrangler, /ZOOM_TEAM_CHAT_STATE|ZOOM_TEAM_CHAT_TEST|ZOOM_BOT_REPLACEMENT/u, "Retired Team Chat bindings and flags must not survive in active configuration");
  assert.match(wrangler, /"tag": "v7"[\s\S]*"deleted_classes"[\s\S]*"ZoomTeamChatStateDurableObject"/u, "The retired Team Chat Durable Object needs an explicit deletion migration");
  assert.match(wrangler, /"tag": "v5"[\s\S]*"ZoomMeetingStateDurableObject"[\s\S]*"ZoomSharedTimerStateDurableObject"/u, "Both new SQLite Durable Objects need an explicit migration");
}

function testQueueBehavior() {
  assert.equal(isChatGroup(-1003547823625, null), true, "Main group without topic id should be accepted");
  assert.equal(isChatGroup(-1003547823625, 1), true, "Main group topic id 1 should be accepted");
  assert.equal(isChatGroup(-1003547823625, 999), true, "Any main group topic id should be accepted");
  assert.equal(getQueue111Note("111 \u0410\u043D\u043D\u0430 \u041B\u0438\u043E\u043D"), "\u0410\u043D\u043D\u0430 \u041B\u0438\u043E\u043D");
  assert.equal(getQueue111Note("111 \u0434\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u0410\u043D\u043D\u0430 \u041B\u0438\u043E\u043D"), "\u0434\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u0410\u043D\u043D\u0430 \u041B\u0438\u043E\u043D");
  assert.equal(parseGameCommand("111 \u0438 \u0418\u0433\u0440\u0430 65"), 65, "Game question should be recognized inside a queue request regardless of case");

  const entry = parseQueueEntry(
    {
      chat: { id: -1003547823625 },
      message_id: 1001,
      text: "111 \u0410\u043D\u043D\u0430 \u041B\u0438\u043E\u043D",
      from: { id: 42, first_name: "\u0410\u043D\u043D\u0430", last_name: "\u041B\u0438\u043E\u043D" }
    },
    { isOpen: true, mode: "bk", entries: [] }
  );
  assert.equal(entry?.block, "bk", "BK queue 111 should create a BK queue entry");
  assert.equal(entry?.label, "111 \u0410\u043D\u043D\u0430 \u041B\u0438\u043E\u043D", "BK queue entry should keep text after 111");
  assert.equal(entry?.author, "\u0410\u043D\u043D\u0430 \u041B\u0438\u043E\u043D", "Queue author should show the name without a Telegram source marker");

  const convertedEntry = parseQueueEntry(
    {
      chat: { id: -1003547823625 },
      message_id: 1002,
      text: "333 @anna_lion",
      from: { id: 42, first_name: "\u0410\u043D\u043D\u0430", username: "anna_lion" }
    },
    { isOpen: true, mode: "bk", entries: [] }
  );
  assert.equal(convertedEntry?.label, "111 anna_lion", "BK queue should accept 222/333/444 but publish them as 111");
}

async function testGameQuestionsWorkWithoutOpenQueue() {
  const sent = [];
  let queueReads = 0;
  let queueAdds = 0;
  const speakerQuestions = new Map([[1, "\u0422\u0435\u0441\u0442\u043E\u0432\u044B\u0439 \u0432\u043E\u043F\u0440\u043E\u0441"]]);
  const deps = {
    isChatGroup: () => true,
    callQueueState: async (_env, action) => {
      if (action === "get") {
        queueReads += 1;
        return { state: { isOpen: false, mode: null, entries: [] } };
      }
      queueAdds += 1;
      return {};
    },
    parseGameCommand,
    parseQueueEntry,
    getBillQuestionNumber: parseGameCommand,
    getSpeakerQuestions: async () => speakerQuestions,
    sendMessage: async (_env, chatId, text, threadId, replyToMessageId) => {
      sent.push({ chatId, text, threadId, replyToMessageId });
    },
    applyQueueResponse: async () => {}
  };

  const response = await handleGroupQueueAndGameMessage({}, {
    chat: { id: -1003547823625 },
    from: { id: 42, first_name: "\u0410\u043D\u043D\u0430" },
    message_id: 1001,
    text: "\u043F\u043E\u0436\u0430\u043B\u0443\u0439\u0441\u0442\u0430 \u0418\u0433\u0440\u0430 1"
  }, "\u043F\u043E\u0436\u0430\u043B\u0443\u0439\u0441\u0442\u0430 \u0418\u0433\u0440\u0430 1", -1003547823625, null, deps);

  assert.equal(response.status, 200, "Game command should be handled even when queue is closed");
  assert.equal(sent.length, 1, "Closed queue game command should still send the question");
  assert.match(sent[0].text, /^\u0412\u043E\u043F\u0440\u043E\u0441 1:/u);
  assert.equal(queueReads, 1, "Closed queue should be read only after the game question is sent");
  assert.equal(queueAdds, 0, "Closed queue game command must not add a queue entry");
  assert.doesNotMatch(sent[0].text, /\u0442\u043E\u043B\u044C\u043A\u043E \u0432\u043E \u0432\u0440\u0435\u043C\u044F \u0441\u043E\u0431\u0440\u0430\u043D\u0438\u044F/u);
}

async function testGameQuestionsStillAddToOpenBillQueue() {
  const speakerQuestions = new Map([[1, "\u0422\u0435\u0441\u0442\u043E\u0432\u044B\u0439 \u0432\u043E\u043F\u0440\u043E\u0441"]]);
  let queueAdds = 0;
  let published = 0;
  const deps = {
    isChatGroup: () => true,
    callQueueState: async (_env, action, payload) => {
      if (action === "get") {
        return { state: { isOpen: true, mode: "bill", entries: [] } };
      }
      if (action === "add") {
        queueAdds += 1;
        assert.equal(payload.entry.label, "\u0438\u0433\u0440\u0430 1");
        return { publishQueue: true };
      }
      return {};
    },
    parseGameCommand,
    parseQueueEntry,
    getBillQuestionNumber: parseGameCommand,
    getSpeakerQuestions: async () => speakerQuestions,
    sendMessage: async () => {},
    applyQueueResponse: async () => {
      published += 1;
    }
  };

  await handleGroupQueueAndGameMessage({}, {
    chat: { id: -1003547823625 },
    from: { id: 42, first_name: "\u0410\u043D\u043D\u0430" },
    message_id: 1002,
    text: "\u0438\u0433\u0440\u0430 1"
  }, "\u0438\u0433\u0440\u0430 1", -1003547823625, null, deps);

  assert.equal(queueAdds, 1, "Open Bill queue game command should still add a queue entry");
  assert.equal(published, 1, "Open Bill queue should still publish updated queue");
}

async function testBotMessagesAreIgnored() {
  let sent = 0;
  const response = await handleWebhookMessage({}, {
    chat: { id: -1003547823625, type: "supergroup" },
    from: { id: 777, is_bot: true, first_name: "\u041D\u0430\u0444\u0430\u043D\u044F" },
    message_id: 1003,
    text: "\u0438\u0433\u0440\u0430 65"
  }, {
    sendMessage: async () => {
      sent += 1;
    }
  });

  assert.equal(response.status, 200, "Bot-authored messages should be acknowledged");
  assert.equal(sent, 0, "Bot-authored messages must not trigger replies");
}

async function testBillPanelWorksInMainGroup() {
  const groupId = -1003547823625;
  const sent = [];
  const stateWrites = [];
  await handleCallbackQuery({}, {
    id: "bill-panel-callback",
    data: "meeting:bill_prompt",
    from: { id: 7 },
    message: { chat: { id: groupId, type: "supergroup" }, message_id: 10 }
  }, {
    isUserAdmin: async () => true,
    answerCallback: async () => {},
    QUEUE_CALLBACK_TEXTS: {},
    TIMER_CALLBACK_TEXTS: {},
    sendMessage: async (_env, chatId, text, threadId) => {
      sent.push({ chatId, text, threadId });
      return { result: { message_id: 11 } };
    },
    callAnnouncementState: async (_env, action, payload) => {
      if (action === "set_message_id") stateWrites.push(payload);
      return {};
    },
    INFO_CHAT_ID: -1003835668674,
    TECH_THREAD_ID: 440,
    TECH_MESSAGES: {},
    CHAT_GROUP_ID: groupId
  });
  assert.equal(sent[0]?.chatId, groupId, "Bill prompt opened from main group must stay in main group");
  assert.ok(stateWrites.some((item) => item.key === `bill_prompt_waiting:${groupId}:0`));

  let billNumberSent = null;
  const groupResponses = [];
  await handleTechThreadMessage({}, {
    chat: { id: groupId, type: "supergroup" },
    from: { id: 7 },
    message_id: 12,
    text: "17"
  }, "17", groupId, null, {
    isTechThread: () => false,
    isChatGroup: (chatId) => chatId === groupId,
    isPrivateChat: () => false,
    isMeetingPanelCommand: () => false,
    isUserAdmin: async () => true,
    getPrivateRoles: async () => ({ isAdmin: true }),
    buildPersonalDayUserSnapshot: () => ({}),
    sendMessage: async (_env, chatId, text) => {
      groupResponses.push({ chatId, text });
      return { result: { message_id: 13 } };
    },
    callTelegram: async () => ({}),
    INFO_CHAT_ID: -1003835668674,
    CHAT_GROUP_ID: groupId,
    MEETING_PANEL_TEXT: "",
    TECH_THREAD_ID: 440,
    buildMeetingKeyboard: () => ({}),
    isQueuePanelCommand: () => false,
    QUEUE_PANEL_TEXT: "",
    buildQueueKeyboard: () => ({}),
    isYozhikCommand: () => false,
    sendYozhikToGroup: async () => {},
    isBillPromptCommand: () => false,
    callAnnouncementState: async (_env, action, payload) => {
      if (action === "get" && payload.key === `bill_prompt_waiting:${groupId}:0`) return { messageId: 11 };
      return {};
    },
    parseBillInput: () => 17,
    sendBillToGroup: async (_env, number) => {
      billNumberSent = number;
    }
  });
  assert.equal(billNumberSent, 17, "Bill number entered after the main-group prompt must publish the excerpt");
  assert.equal(groupResponses.length, 0, "Main group must not receive a redundant Bill delivery confirmation");
}

async function testAnonymousAdminTechPanels() {
  const infoChatId = -1003835668674;
  const techThreadId = 440;
  const sent = [];
  const deps = {
    isTechThread: (chatId, threadId) => chatId === infoChatId && threadId === techThreadId,
    isChatGroup: () => false,
    isPrivateChat: () => false,
    isMeetingPanelCommand: (text) => text.toLowerCase() === "\u0441\u043e\u0431\u0440\u0430\u043d\u0438\u0435",
    isUserAdmin: async () => false,
    getPrivateRoles: async () => ({ isAdmin: false }),
    buildPersonalDayUserSnapshot: () => ({}),
    sendMessage: async (...args) => {
      sent.push(args);
      return { ok: true };
    },
    INFO_CHAT_ID: infoChatId,
    CHAT_GROUP_ID: -1003547823625,
    MEETING_PANEL_TEXT,
    TECH_THREAD_ID: techThreadId,
    buildMeetingKeyboard,
    isQueuePanelCommand: (text) => text.toLowerCase() === "\u043e\u0447\u0435\u0440\u0435\u0434\u044c",
    QUEUE_PANEL_TEXT,
    buildQueueKeyboard,
    isYozhikCommand: () => false,
    sendYozhikToGroup: async () => {},
    isBillPromptCommand: () => false,
    callAnnouncementState: async () => ({}),
    parseBillInput: () => null,
    sendBillToGroup: async () => {}
  };
  const baseMessage = {
    chat: { id: infoChatId, type: "supergroup" },
    message_thread_id: techThreadId,
    sender_chat: { id: infoChatId, type: "supergroup" }
  };

  await handleTechThreadMessage({}, { ...baseMessage, message_id: 1, text: "\u0421\u043e\u0431\u0440\u0430\u043d\u0438\u0435" }, "\u0421\u043e\u0431\u0440\u0430\u043d\u0438\u0435", infoChatId, techThreadId, deps);
  await handleTechThreadMessage({}, { ...baseMessage, message_id: 2, text: "\u041e\u0447\u0435\u0440\u0435\u0434\u044c" }, "\u041e\u0447\u0435\u0440\u0435\u0434\u044c", infoChatId, techThreadId, deps);

  assert.equal(sent.length, 2, "Anonymous admin commands in TECHVED should create both panels");
  assert.equal(sent[0][1], infoChatId);
  assert.equal(sent[0][2], MEETING_PANEL_TEXT);
  assert.equal(sent[0][3], techThreadId);
  assert.ok(sent[0][5]?.inline_keyboard?.length, "Meeting panel should include buttons");
  assert.equal(sent[1][2], QUEUE_PANEL_TEXT);
  assert.ok(sent[1][5]?.inline_keyboard?.length, "Queue panel should include buttons");
}

async function testRegularAdminClosedTechPanel() {
  const infoChatId = -1003835668674;
  const techThreadId = 440;
  const telegramCalls = [];
  let sendAttempts = 0;
  const deps = {
    isTechThread: (chatId, threadId) => chatId === infoChatId && threadId === techThreadId,
    isChatGroup: () => false,
    isPrivateChat: () => false,
    isMeetingPanelCommand: (text) => text.toLowerCase() === "\u0441\u043e\u0431\u0440\u0430\u043d\u0438\u0435",
    isUserAdmin: async (_env, userId, chatId) => userId === 2077822616 && chatId === infoChatId,
    getPrivateRoles: async () => ({ isAdmin: false }),
    buildPersonalDayUserSnapshot: () => ({}),
    sendMessage: async () => {
      sendAttempts += 1;
      if (sendAttempts === 1) throw new Error("sendMessage failed: TOPIC_CLOSED");
      return { ok: true };
    },
    callTelegram: async (_env, method, payload) => {
      telegramCalls.push({ method, payload });
      return { ok: true };
    },
    INFO_CHAT_ID: infoChatId,
    CHAT_GROUP_ID: -1003547823625,
    MEETING_PANEL_TEXT,
    TECH_THREAD_ID: techThreadId,
    buildMeetingKeyboard,
    isQueuePanelCommand: () => false,
    QUEUE_PANEL_TEXT,
    buildQueueKeyboard,
    isYozhikCommand: () => false,
    sendYozhikToGroup: async () => {},
    isBillPromptCommand: () => false,
    callAnnouncementState: async () => ({}),
    parseBillInput: () => null,
    sendBillToGroup: async () => {}
  };
  const message = {
    chat: { id: infoChatId, type: "supergroup" },
    message_id: 3,
    message_thread_id: techThreadId,
    from: { id: 2077822616, first_name: "\u041c\u0430\u043d\u044f" },
    text: "\u0421\u043e\u0431\u0440\u0430\u043d\u0438\u0435"
  };

  await handleTechThreadMessage({}, message, message.text, infoChatId, techThreadId, deps);

  assert.equal(sendAttempts, 2, "Regular admin panel should retry after Telegram rejects the closed topic");
  assert.deepEqual(telegramCalls.map((item) => item.method), ["reopenForumTopic", "closeForumTopic"]);
  assert.ok(telegramCalls.every((item) => item.payload.message_thread_id === techThreadId));
}

async function testServiceHandlerAllowsTechPanelCommandsThrough() {
  const infoChatId = -1003835668674;
  const techThreadId = 440;
  const result = await handleServiceMessages(
    {},
    {
      chat: { id: infoChatId, type: "supergroup" },
      from: { id: 2077822616 },
      message_id: 4,
      message_thread_id: techThreadId,
      text: "\u0421\u043e\u0431\u0440\u0430\u043d\u0438\u0435"
    },
    "\u0421\u043e\u0431\u0440\u0430\u043d\u0438\u0435",
    infoChatId,
    techThreadId,
    "supergroup",
    {
      isIdCommand: () => false,
      sendMessage: async () => ({ ok: true }),
      isPrivateChat: () => false,
      isChatGroup: () => false,
      isTechThread: (chatId, threadId) => chatId === infoChatId && threadId === techThreadId,
      isUserAdmin: async () => true,
      isTimerPanelCommand: () => false,
      CHAT_GROUP_ID: -1003547823625,
      INFO_CHAT_ID: infoChatId,
      callPersonalDayState: async () => ({}),
      buildPersonalDayUserSnapshot: () => ({}),
      getPrivateRoles: async () => ({ isAdmin: true }),
      setMyCommands: async () => {},
      TIMER_PANEL_TEXT: "",
      TECH_THREAD_ID: techThreadId,
      buildTimerKeyboard: () => ({}),
      callTelegram: async () => ({ ok: true }),
      isPrepThread: () => false,
      hasFixMarker: () => false,
      getAuthorLabel: () => "",
      sendAdminDigest: async () => {},
      FIX_CONFIRMATION: "",
      hasHelpMarker: () => false,
      HELP_CONFIRMATION: "",
      hasServiceRequest: () => false,
      normalizeLightText: (text) => text.toLowerCase(),
      parseNafanyaQuestion: () => null,
      SERVICE_CONFIRMATION: "",
      sendManualServiceReminder: async () => {},
      resetManualReplacementRequest: async () => {},
      sendManualCoordinatorServiceSummary: async () => ({})
    }
  );
  assert.equal(result, null, "Service handler should not crash or consume a meeting-panel command");
}

async function testBareFixWorksInMainGroup() {
  const groupChatId = -1003547823625;
  const text = "\u0424\u0438\u043a\u0441 Zoom: \u041d\u0430\u0444\u0430\u043d\u044e \u0431\u044b \u043d\u0430\u0443\u0447\u0438\u0442\u044c \u0432 \u0437\u0443\u043c\u0435 \u0443\u0434\u0430\u043b\u044f\u0442\u044c \u0441\u0432\u043e\u0438 \u043e\u0447\u0435\u0440\u0435\u0434\u0438";
  const digests = [];
  const sent = [];
  const confirmation = "\u0424\u0438\u043a\u0441 \u043f\u0440\u0438\u043d\u044f\u0442";
  const message = {
    chat: { id: groupChatId, type: "supergroup" },
    from: { id: 42, first_name: "Denis" },
    message_id: 5,
    text
  };

  const result = await handleServiceMessages({}, message, text, groupChatId, null, "supergroup", {
    isIdCommand: () => false,
    sendMessage: async (...args) => {
      sent.push(args);
      return { ok: true };
    },
    isPrivateChat: () => false,
    isChatGroup: (chatId, threadId) => chatId === groupChatId && threadId === null,
    isTechThread: () => false,
    isUserAdmin: async () => false,
    isTimerPanelCommand: () => false,
    CHAT_GROUP_ID: groupChatId,
    INFO_CHAT_ID: -1003835668674,
    callPersonalDayState: async () => ({}),
    buildPersonalDayUserSnapshot: () => ({}),
    getPrivateRoles: async () => ({ isAdmin: false }),
    setMyCommands: async () => {},
    TIMER_PANEL_TEXT: "",
    TECH_THREAD_ID: 440,
    buildTimerKeyboard: () => ({}),
    callTelegram: async () => ({ ok: true }),
    isPrepThread: () => false,
    hasFixMarker: (value) => /^\u0444\u0438\u043a\u0441(?:\s|$)/iu.test(String(value || "").trim()),
    getAuthorLabel: () => "Denis",
    sendAdminDigest: async (...args) => digests.push(args),
    FIX_CONFIRMATION: confirmation,
    hasHelpMarker: () => false,
    HELP_CONFIRMATION: "",
    hasServiceRequest: () => false,
    normalizeLightText: (value) => String(value || "").toLowerCase(),
    parseNafanyaQuestion: () => null,
    SERVICE_CONFIRMATION: "",
    sendManualServiceReminder: async () => {},
    resetManualReplacementRequest: async () => {},
    sendManualCoordinatorServiceSummary: async () => ({})
  });

  assert.equal(result.status, 200, "Bare fix in the main group should be consumed");
  assert.equal(digests.length, 1, "Bare fix should be forwarded to the admin digest");
  assert.deepEqual(digests[0].slice(1), ["\u0424\u0418\u041a\u0421\u0418\u0420\u0423\u042e", "Denis", text, "#\u0444\u0438\u043a\u0441\u0438\u0440\u0443\u044e"]);
  assert.equal(sent.length, 1, "Bare fix should receive one confirmation");
  assert.deepEqual(sent[0].slice(1, 6), [groupChatId, confirmation, null, message.message_id]);
}

async function testVacancyReplacementRequest() {
  const sent = [];
  const request = {
    id: "vacancy-1",
    date: "2026-06-09",
    time: "21:30",
    group_name: "\u041f\u043e\u0447\u0442\u0438 \u043d\u043e\u0440\u043c\u0430\u043b\u044c\u043d\u044b\u0435",
    service: "\u0432\u0435\u0434\u0443\u0449\u0438\u0439",
    request_kind: "vacancy",
    vacancy_text: "\u0421\u0435\u0433\u043e\u0434\u043d\u044f \u043d\u0435\u0442 \u0432\u0435\u0434\u0443\u0449\u0435\u0433\u043e. \u0414\u043e\u0431\u0440\u043e\u0432\u043e\u043b\u044c\u0446\u044b?",
    responders: []
  };
  const deps = {
    callPersonalDayState: async (_env, action) => action === "create_replacement_request"
      ? { created: true, duplicateOpen: false, request }
      : { found: true, request },
    listAdminDmRecipients: async () => [{ userId: "1", chatId: "1" }, { userId: "2", chatId: "2" }],
    isCoordinatorUser: async (_env, userId) => String(userId) === "1",
    sendMessage: async (_env, chatId, text, _thread, _reply, keyboard) => {
      sent.push({ kind: "admin", chatId, text, keyboard });
      return { result: { chat: { id: chatId }, message_id: 11 } };
    },
    sendAdminThreadMessage: async (_env, text, _silent, keyboard) => {
      sent.push({ kind: "thread", text, keyboard });
      return { result: { chat: { id: "-1" }, message_id: 12 } };
    },
    sendCoordinatorServiceNotice: async (_env, text, keyboard) => {
      sent.push({ kind: "coordinator", text, keyboard });
      return { chatId: "1", result: { result: { chat: { id: "1" }, message_id: 13 } } };
    },
    deleteMessageSafe: async () => true,
    notifyOwnerTechError: async () => {}
  };
  await createVacancyReplacementRequest({}, {
    dateKey: "2026-06-09",
    roleKey: "l",
    service: "\u0432\u0435\u0434\u0443\u0449\u0438\u0439",
    vacancyText: request.vacancy_text
  }, deps);
  assert.ok(sent.some((item) => item.kind === "admin" && item.keyboard?.inline_keyboard?.[0]?.[0]?.text === "\u041c\u043e\u0433\u0443 \u043f\u043e\u0434\u043c\u0435\u043d\u0438\u0442\u044c"));
  assert.equal(sent.filter((item) => item.kind === "admin" && String(item.chatId) === "1").length, 0, "Coordinator must not receive a duplicate admin DM");
  assert.ok(sent.some((item) => item.kind === "coordinator" && item.text.includes(request.vacancy_text)));
  assert.ok(sent.some((item) => item.kind === "coordinator" && item.keyboard?.inline_keyboard?.[0]?.[0]?.text === "\u041c\u043e\u0433\u0443 \u043f\u043e\u0434\u043c\u0435\u043d\u0438\u0442\u044c"));
  assert.ok(sent.some((item) => item.kind === "thread" && item.keyboard?.inline_keyboard?.[0]?.[0]?.text === "\u041c\u043e\u0433\u0443 \u043f\u043e\u0434\u043c\u0435\u043d\u0438\u0442\u044c"));
  assert.ok(sent.every((item) => !item.text.includes("\u043d\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043d\u043e")));
}

async function testOnlyCoordinatorCanSelectReplacement() {
  let stateCalls = 0;
  const answers = [];
  const deps = {
    isUserAdmin: async () => true,
    answerCallback: async (_env, _id, text) => answers.push(text),
    QUEUE_CALLBACK_TEXTS: {},
    TIMER_CALLBACK_TEXTS: {},
    isCoordinatorUser: async () => false,
    callPersonalDayState: async () => {
      stateCalls += 1;
      return {};
    }
  };
  await handleCallbackQuery({}, {
    id: "cb-1",
    data: "repl:select:req-1:42",
    from: { id: 7 },
    message: { chat: { id: 7, type: "private" } }
  }, deps);
  assert.equal(stateCalls, 0, "Non-coordinator selection must not change replacement state");
  assert.equal(answers.at(-1), "\u0412\u044b\u0431\u0440\u0430\u0442\u044c \u0437\u0430\u043c\u0435\u043d\u044f\u044e\u0449\u0435\u0433\u043e \u043c\u043e\u0436\u0435\u0442 \u0442\u043e\u043b\u044c\u043a\u043e \u043a\u043e\u043e\u0440\u0434\u0438\u043d\u0430\u0442\u043e\u0440.");

  const ordinaryRequest = {
    id: "req-2",
    date: "2026-06-09",
    time: "21:30",
    group_name: "\u041f\u043e\u0447\u0442\u0438 \u043d\u043e\u0440\u043c\u0430\u043b\u044c\u043d\u044b\u0435",
    service: "\u0432\u0435\u0434\u0443\u0449\u0438\u0439",
    original_person_name: "\u041c\u0430\u043d\u044f",
    original_user_id: "8",
    responders: [{ user_id: "42", private_chat_id: "42", name: "Vladimir", username: "VladimirRingo" }]
  };
  const coordinatorDeps = {
    ...deps,
    isCoordinatorUser: async () => true,
    callPersonalDayState: async (_env, action) => {
      if (action === "select_replacement_responder") {
        stateCalls += 1;
        return { selected: true, closed: false, request: ordinaryRequest };
      }
      return { found: true, request: ordinaryRequest };
    },
    sendMessage: async () => ({ result: { message_id: 21 } }),
    sendCoordinatorServiceNotice: async () => ({ chatId: "7", result: { result: { chat: { id: "7" }, message_id: 22 } } }),
    sendAdminThreadMessage: async () => ({ result: { chat: { id: "-1" }, message_id: 23 } }),
    deleteMessageSafe: async () => true
  };
  await handleCallbackQuery({}, {
    id: "cb-2",
    data: "repl:select:req-2:42",
    from: { id: 7 },
    message: { chat: { id: 7, type: "private" } }
  }, coordinatorDeps);
  assert.equal(stateCalls, 1, "Coordinator must be able to select a responder for an ordinary replacement request");
}

async function testOnlyTelegramGroupAdminsCanOfferFromAdminThread() {
  let stateCalls = 0;
  const answers = [];
  const deps = {
    isUserAdmin: async () => false,
    answerCallback: async (_env, _id, text) => answers.push(text),
    QUEUE_CALLBACK_TEXTS: {},
    TIMER_CALLBACK_TEXTS: {},
    getPrivateRoles: async () => ({ isAdmin: true }),
    callPersonalDayState: async () => {
      stateCalls += 1;
      return {};
    }
  };
  await handleCallbackQuery({}, {
    id: "cb-offer-1",
    data: "repl:offer:req-1",
    from: { id: 99 },
    message: { chat: { id: -1003835668674, type: "supergroup" }, message_thread_id: 123 }
  }, deps);
  assert.equal(stateCalls, 0, "Non-admin group member must not be added as a replacement responder");
  assert.equal(answers.at(-1), "\u042d\u0442\u0430 \u043a\u043d\u043e\u043f\u043a\u0430 \u0442\u043e\u043b\u044c\u043a\u043e \u0434\u043b\u044f \u0430\u0434\u043c\u0438\u043d\u043e\u0432.");
}

async function testSelectedReplacementRejectsLateOffersClearly() {
  const answers = [];
  await handleCallbackQuery({}, {
    id: "cb-late-offer",
    data: "repl:offer:req-selected",
    from: { id: 99 },
    message: { chat: { id: 99, type: "private" } }
  }, {
    isUserAdmin: async () => true,
    answerCallback: async (_env, _id, text) => answers.push(text),
    QUEUE_CALLBACK_TEXTS: {},
    TIMER_CALLBACK_TEXTS: {},
    getPrivateRoles: async () => ({ isAdmin: true }),
    callPersonalDayState: async () => ({
      found: true,
      closed: true,
      request: { id: "req-selected", status: "selected" }
    })
  });
  assert.equal(answers.at(-1), "\u0417\u0430\u043c\u0435\u043d\u0430 \u0443\u0436\u0435 \u043d\u0430\u0439\u0434\u0435\u043d\u0430.");
}

await testVacancyReplacementRequest();
await testOnlyCoordinatorCanSelectReplacement();
await testOnlyTelegramGroupAdminsCanOfferFromAdminThread();
await testSelectedReplacementRejectsLateOffersClearly();
await testZoomWebhookHelpers();
await testRootResponseHasZoomRequiredSecurityHeaders();
await testRootHomePageUsesBotStatus();
await testZoomOAuthReturnEndpoint();
testQueueBehavior();
await testGameQuestionsWorkWithoutOpenQueue();
await testGameQuestionsStillAddToOpenBillQueue();
await testBotMessagesAreIgnored();
testZoomOnlyStaticRules();
await testBillPanelWorksInMainGroup();
if (!process.argv.includes("--skip-live-knowledge")) {
  await testKnowledgeAnswers();
  await testMeetingScheduleAnswers();
}
testWorkerStaticRules();
testExpectedDeleteMessageFailures();
await testSuccessfulTelegramCopySurvivesMarkerFailure();
await testAnonymousAdminTechPanels();
await testRegularAdminClosedTechPanel();
await testServiceHandlerAllowsTechPanelCommandsThrough();
await testBareFixWorksInMainGroup();

console.log("Nafanya regression tests passed.");
