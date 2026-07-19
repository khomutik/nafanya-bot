import assert from "node:assert/strict";
import {
  buildQueueText,
  cleanQueueDisplayName,
  createEmptyQueueState,
  makeManualQueueEntry,
  parseGameCommand,
  parseQueueEntry,
  runQueueStateAction
} from "./core/queue-engine.js";

let nextMessageId = 1;

function message(author, text, source = "Telegram") {
  return {
    chat: { id: source },
    message_id: nextMessageId++,
    from: { first_name: author },
    text
  };
}

function act(state, action, payload = {}, buildText = buildQueueText) {
  return runQueueStateAction(state, action, payload, buildText);
}

function addParsed(state, author, text, source = "Telegram") {
  const entry = parseQueueEntry(message(author, text, source), state, { source });
  assert.ok(entry, `Expected "${text}" to create a queue entry`);
  return act(state, "add", { entry }).state;
}

function open(mode) {
  return act(createEmptyQueueState(), "open", { mode }).state;
}

function assertNoSourceSuffix(text) {
  assert.doesNotMatch(text, /\((?:Telegram|Zoom)\)/u);
  assert.doesNotMatch(text, /\b(?:Telegram|Zoom)\b/u);
}

function testSeparateStates() {
  let telegram = open("bill");
  const zoom = createEmptyQueueState();
  telegram = addParsed(telegram, "\u041c\u0430\u0448\u0430", "111", "Telegram");
  assert.equal(telegram.entries.length, 1);
  assert.equal(zoom.entries.length, 0);

  let zoomOpen = open("bill");
  zoomOpen = addParsed(zoomOpen, "\u041e\u043b\u044f", "111", "Zoom");
  assert.equal(zoomOpen.entries.length, 1);
  assert.equal(telegram.entries.length, 1);
  assert.equal(telegram.entries[0].author, "\u041c\u0430\u0448\u0430");
  assert.equal(zoomOpen.entries[0].author, "\u041e\u043b\u044f");
}

function testCommonRules() {
  let state = open("bill");
  state = addParsed(state, "\u041c\u0430\u0448\u0430", "111");
  state = addParsed(state, "\u041e\u043b\u044f", "222");
  state = addParsed(state, "\u0418\u0440\u0430", "333");
  state = addParsed(state, "\u041d\u0438\u043d\u0430", "444");
  assert.deepEqual(state.entries.map((entry) => entry.block), ["first", "222", "333", "444"]);

  const duplicate = act(state, "add", { entry: parseQueueEntry(message("\u041c\u0430\u0448\u0430", "111"), state) });
  assert.equal(duplicate.response.duplicate, true);
  assert.equal(duplicate.state.entries.length, 4);

  let changed = act(state, "done").state;
  assert.equal(changed.entries[0].status, "done");
  assert.equal(changed.entries[1].isActive, true);

  changed = act(changed, "skip").state;
  assert.equal(changed.entries[1].isActive, true);

  changed = act(changed, "undo").state;
  assert.equal(changed.entries[1].isActive, true);

  changed = act(changed, "remove").state;
  assert.equal(changed.entries.length, 3);
  assert.equal(changed.entries[1].isActive, true);

  changed = act(changed, "remove_by_number", { index: 2 }).state;
  assert.equal(changed.entries.length, 2);

  changed = act(changed, "close").state;
  assert.equal(changed.isOpen, false);
}

function testBillMode() {
  let state = open("bill");
  state = addParsed(state, "\u041c\u0430\u0448\u0430", "111", "Telegram");
  state = addParsed(state, "\u041e\u043b\u044f", "\u0438\u0433\u0440\u0430 17", "Telegram");
  assert.equal(parseGameCommand("\u0438\u0433\u0440\u0430 17"), 17);
  assert.equal(parseGameCommand("\u0438\u0433\u0440\u0430 501"), null);
  assert.equal(parseQueueEntry(message("\u0418\u0440\u0430", "\u0438\u0433\u0440\u0430 501"), state), null);

  const duplicate = act(state, "add", { entry: parseQueueEntry(message("\u041c\u0430\u0448\u0430", "111"), state) });
  assert.equal(duplicate.response.duplicate, true);

  const text = buildQueueText(state);
  assert.match(text, /\u041c\u0430\u0448\u0430 \u2014 111/u);
  assert.doesNotMatch(text, /111 \u2014 111/u);
}

function testBillZoomChatAllowsNewSourceRepeats() {
  let state = open("bill");
  state = addParsed(state, "\u0412\u044b", "111", "Zoom");
  const repeated = act(state, "add", {
    entry: parseQueueEntry(message("\u0412\u044b", "111", "Zoom"), state, { source: "Zoom" }),
    allowDuplicateBillSpeechEntries: true,
    allowDuplicateEntries: true
  });
  assert.equal(repeated.response.duplicate, undefined);
  assert.equal(repeated.state.entries.length, 2);
  assert.deepEqual(repeated.state.entries.map((entry) => entry.label), ["111", "222"]);
}

function testBkMode() {
  let state = open("bk");
  state = addParsed(state, "\u041c\u0430\u0448\u0430", "111 \u0447\u0438\u0442\u0430\u0442\u044c");
  state = addParsed(state, "\u041e\u043b\u044f", "111 \u0432\u044b\u0441\u043a\u0430\u0437\u0430\u0442\u044c");
  const duplicate = act(state, "add", { entry: parseQueueEntry(message("\u041c\u0430\u0448\u0430", "111 \u0447\u0438\u0442\u0430\u0442\u044c"), state) });
  assert.equal(duplicate.response.duplicate, true);
  assert.match(buildQueueText(state), /\u041c\u0430\u0448\u0430 \u2014 111 \u0447\u0438\u0442\u0430\u0442\u044c/u);
  assert.match(buildQueueText(state), /\u041e\u043b\u044f \u2014 111 \u0432\u044b\u0441\u043a\u0430\u0437\u0430\u0442\u044c/u);
}

function testRsMode() {
  let state = open("rs");
  state = addParsed(state, "\u041c\u0430\u0448\u0430", "111");
  state = addParsed(state, "\u041e\u043b\u044f", "222");
  state = addParsed(state, "\u0418\u0440\u0430", "333");
  state = addParsed(state, "\u041d\u0438\u043d\u0430", "444");
  const duplicate = act(state, "add", { entry: parseQueueEntry(message("\u041c\u0430\u0448\u0430", "111"), state) });
  assert.equal(duplicate.response.duplicate, true);
  assert.equal(state.entries.length, 4);
  assert.deepEqual([...state.entries.map((entry) => entry.rawText)].sort(), ["111", "222", "333", "444"]);
  assert.ok(state.entries.every((entry) => entry.label === "111"));
  assert.match(buildQueueText(state), /\u041d\u0438\u043d\u0430 \u2014 111/u);
}

function testSourceCleanup() {
  assert.equal(cleanQueueDisplayName("\u041c\u0430\u0448\u0430 (Zoom)"), "\u041c\u0430\u0448\u0430");
  assert.equal(cleanQueueDisplayName("\u041c\u0430\u0448\u0430 (Telegram)"), "\u041c\u0430\u0448\u0430");
  let state = open("bk");
  state = act(state, "add", { entry: makeManualQueueEntry("\u041c\u0430\u0448\u0430 (Zoom)", "bk", "111", "111", { source: "Zoom" }) }).state;
  state = act(state, "add", { entry: makeManualQueueEntry("\u041e\u043b\u044f (Telegram)", "bk", "111", "111", { source: "Telegram" }) }).state;
  const text = buildQueueText(state);
  assert.match(text, /\u041c\u0430\u0448\u0430 \u2014 111/u);
  assert.match(text, /\u041e\u043b\u044f \u2014 111/u);
  assertNoSourceSuffix(text);
}

testSeparateStates();
testCommonRules();
testBillMode();
testBillZoomChatAllowsNewSourceRepeats();
testBkMode();
testRsMode();
testSourceCleanup();

console.log("queue engine tests passed");
