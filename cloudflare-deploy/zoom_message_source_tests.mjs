import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ZOOM_MEETING_MESSAGE_TEXTS, ZOOM_TOPIC_MESSAGE_KEYS_BY_WEEKDAY } from "./zoom_meeting_texts.js";

const source = await readFile(new URL("./message_zoom.md", import.meta.url), "utf8");
const queueEngine = await readFile(new URL("./core/queue-engine.js", import.meta.url), "utf8");

assert.match(source, /^scam\\_warning:/mu, "The canonical Markdown source must include the scam warning section");
assert.doesNotMatch(source, /\*\*/u, "Zoom meeting text source should contain no Markdown emphasis markers");
assert.deepEqual(Object.keys(ZOOM_MEETING_MESSAGE_TEXTS), [
  "minute_silence",
  "prayer",
  "preambula",
  "newcomer",
  "steps12",
  "traditions12",
  "meeting_rules",
  "chat_cleanliness",
  "seventh_tradition",
  "tea_rules",
  "speaker_questions",
  "scam_warning",
  "free_services",
  "group_sponsors",
  "telemost_link",
  "theme_monday",
  "theme_tuesday",
  "theme_thursday",
  "theme_friday",
  "theme_sunday",
  "meeting_schedule"
]);
assert.equal(
  ZOOM_MEETING_MESSAGE_TEXTS.scam_warning.join("\n"),
  "\u203C\uFE0F\u0410\u0410 - \u044D\u0442\u043E \u0441\u043E\u043E\u0431\u0449\u0435\u0441\u0442\u0432\u043E, \u0433\u0434\u0435 \u043F\u043E\u043C\u043E\u0449\u044C \u0438 \u043E\u043F\u044B\u0442 \u043F\u0435\u0440\u0435\u0434\u0430\u044E\u0442\u0441\u044F \u0411\u0415\u0421\u041F\u041B\u0410\u0422\u041D\u041E\u203C\uFE0F\n\u0415\u0441\u043B\u0438 \u0432\u0430\u043C \u043F\u0438\u0448\u0443\u0442 \u0441 \u043F\u0440\u043E\u0441\u044C\u0431\u043E\u0439 \u043E \u0434\u0435\u043D\u044C\u0433\u0430\u0445, \u0438\u043B\u0438 \u0447\u0442\u043E-\u0442\u043E, \u0447\u0442\u043E \u043A\u0430\u0436\u0435\u0442\u0441\u044F \u0432\u0430\u043C \u043F\u043E\u0434\u043E\u0437\u0440\u0438\u0442\u0435\u043B\u044C\u043D\u044B\u043C \u0438 \u0441\u0442\u0440\u0430\u043D\u043D\u044B\u043C - \u043C\u043E\u0436\u0435\u0442\u0435 \u0441\u043E\u043E\u0431\u0449\u0438\u0442\u044C \u043E\u0431 \u044D\u0442\u043E\u043C \u0430\u0434\u043C\u0438\u043D\u0430\u043C.\n\u041F\u0440\u043E\u0441\u0438\u043C \u043F\u043E\u043C\u043D\u0438\u0442\u044C \u043E \u0440\u0430\u0437\u0443\u043C\u043D\u043E\u0439 \u043E\u0441\u0442\u043E\u0440\u043E\u0436\u043D\u043E\u0441\u0442\u0438 \u0432 \u0438\u043D\u0442\u0435\u0440\u043D\u0435\u0442-\u043F\u0440\u043E\u0441\u0442\u0440\u0430\u043D\u0441\u0442\u0432\u0435.\n\u0421\u043F\u0430\u0441\u0438\u0431\u043E, \u0447\u0442\u043E \u043F\u043E\u043C\u043E\u0433\u0430\u0435\u0442\u0435 \u0441\u043E\u0445\u0440\u0430\u043D\u044F\u0442\u044C \u043D\u0430\u0448\u0435 \u0441\u043E\u043E\u0431\u0449\u0435\u0441\u0442\u0432\u043E \u0431\u0435\u0437\u043E\u043F\u0430\u0441\u043D\u044B\u043C \u0434\u043B\u044F \u0432\u0441\u0435\u0445.\uD83D\uDE4F"
);
assert.deepEqual(ZOOM_TOPIC_MESSAGE_KEYS_BY_WEEKDAY, {
  "0": "theme_sunday",
  "1": "theme_monday",
  "2": "theme_tuesday",
  "4": "theme_thursday",
  "5": "theme_friday"
});
for (const [key, messages] of Object.entries(ZOOM_MEETING_MESSAGE_TEXTS)) {
  assert.ok(messages.length > 0, `${key} should generate at least one message`);
  for (const message of messages) {
    assert.ok(Array.from(message).length <= 950, `${key} should stay within Zoom's visible message limit`);
    assert.doesNotMatch(message, /\*\*/u, `${key} should not contain Markdown formatting markers`);
  }
}
assert.doesNotMatch(queueEngine, /ZOOM_MEETING_MESSAGE_TEXTS|message_zoom\.md/u, "The queue engine must remain independent from meeting-message source and formatting");

console.log(`Zoom message source tests passed (${Object.keys(ZOOM_MEETING_MESSAGE_TEXTS).length} messagesets; queue engine remains isolated).`);
