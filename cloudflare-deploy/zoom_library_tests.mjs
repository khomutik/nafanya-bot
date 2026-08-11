import test from "node:test";
import assert from "node:assert/strict";
import {
  ZOOM_LIBRARY_CURRENT_KEY,
  ZOOM_LIBRARY_PREVIOUS_KEY,
  buildLibraryZoomMessages,
  getLibraryEntry,
  mergeLibraryCollections,
  rebalanceNumberedBookEntries,
  readZoomLibrary,
  saveZoomLibrary,
  stripEmbeddedLibraryHeader,
  unicodeLength,
  validateLibraryImport
} from "./zoom_library.js";

class FakeR2 {
  constructor() { this.objects = new Map(); }
  async get(key) {
    if (!this.objects.has(key)) return null;
    const value = this.objects.get(key);
    return {
      body: new Blob([value]).stream(),
      async json() { return JSON.parse(value); },
      async text() { return value; }
    };
  }
  async put(key, value) {
    if (value instanceof ReadableStream) this.objects.set(key, await new Response(value).text());
    else this.objects.set(key, String(value));
  }
}

test("950-symbol source is split because the final 950 limit includes the header", () => {
  const messages = buildLibraryZoomMessages("big_book", 484, "я".repeat(950));
  assert.ok(messages.length >= 2);
  assert.ok(messages.every((message) => unicodeLength(message) <= 950));
  assert.match(messages[0], /Большая книга/u);
  assert.ok(messages.slice(1).every((message) => !/Большая книга|Часть \d+\/\d+/u.test(message)));
});

test("long text, manual separators and emoji are split without part numbering", () => {
  const text = `${"😀 абзац. ".repeat(90)}\n\n<!-- zoom-part -->\n\n${"Продолжение. ".repeat(100)}`;
  const messages = buildLibraryZoomMessages("big_book", 1, text);
  assert.ok(messages.length >= 2);
  assert.ok(messages.every((message) => unicodeLength(message) <= 950));
  assert.ok(messages.every((message) => !/Часть \d+\/\d+/u.test(message)));
  assert.match(messages[0], /Большая книга/u);
  assert.ok(messages.slice(1).every((message) => !/Большая книга/u.test(message)));
  assert.doesNotMatch(messages.join("\n"), /zoom-part/u);
});

test("numbered books are repacked close to 950 characters only at sentence boundaries", () => {
  const sentence = (number) => `\u041f\u0440\u0435\u0434\u043b\u043e\u0436\u0435\u043d\u0438\u0435 ${number}: ${"\u0442\u0435\u043a\u0441\u0442 ".repeat(16).trim()}.`;
  const sentences = Array.from({ length: 30 }, (_, index) => sentence(index + 1));
  const packed = rebalanceNumberedBookEntries("big_book", {
    1: { text: sentences.slice(0, 4).join(" ") },
    2: { text: sentences.slice(4, 13).join(" ") },
    3: { text: sentences.slice(13).join(" ") }
  });
  const entries = Object.values(packed);
  assert.ok(entries.length > 3);
  entries.slice(0, -1).forEach((entry, index) => {
    assert.match(entry.text, /[.!?\u2026][\u00bb\u201d"'\u2019)\]]*$/u);
    const messages = buildLibraryZoomMessages("big_book", index + 1, entry.text);
    assert.equal(messages.length, 1);
    assert.ok(unicodeLength(messages[0]) <= 950);
    assert.ok(unicodeLength(messages[0]) >= 800);
  });
});

test("a source-file boundary inside a sentence becomes a space, not a paragraph break", () => {
  const packed = rebalanceNumberedBookEntries("big_book", {
    1: { text: "\u041d\u0430\u0447\u0430\u043b\u043e \u043e\u0434\u043d\u043e\u0433\u043e \u043f\u0440\u0435\u0434\u043b\u043e\u0436\u0435\u043d\u0438\u044f \u0431\u0435\u0437 \u0442\u043e\u0447\u043a\u0438" },
    2: { text: "\u0438 \u0435\u0433\u043e \u0437\u0430\u043a\u043e\u043d\u0447\u0435\u043d\u0438\u0435." }
  });
  assert.match(packed["1"].text, /\u0431\u0435\u0437 \u0442\u043e\u0447\u043a\u0438 \u0438 \u0435\u0433\u043e/u);
  assert.doesNotMatch(packed["1"].text, /\u0431\u0435\u0437 \u0442\u043e\u0447\u043a\u0438\n/u);
});

test("embedded book and number headers are removed without losing section titles", () => {
  assert.equal(
    stripEmbeddedLibraryHeader("as_bill_sees_it", "\u041a\u0430\u043a \u044d\u0442\u043e \u0432\u0438\u0434\u0438\u0442 \u0411\u0438\u043b\u043b \u00b7 \u2116 096\n\n\u0417\u0430\u0433\u043e\u043b\u043e\u0432\u043e\u043a\n\n\u0422\u0435\u043a\u0441\u0442"),
    "\u0417\u0430\u0433\u043e\u043b\u043e\u0432\u043e\u043a\n\n\u0422\u0435\u043a\u0441\u0442"
  );
  assert.equal(
    stripEmbeddedLibraryHeader("daily_reflections", "\u0415\u0436\u0435\u0434\u043d\u0435\u0432\u043d\u044b\u0435 \u0440\u0430\u0437\u043c\u044b\u0448\u043b\u0435\u043d\u0438\u044f \u00b7 31.07 \u00b7 \u2116 213\n\n\u041c\u041e\u041b\u0418\u0422\u0412\u0410"),
    "\u041c\u041e\u041b\u0418\u0422\u0412\u0410"
  );
  assert.equal(
    stripEmbeddedLibraryHeader("game_questions", "\u0412\u043e\u043f\u0440\u043e\u0441 \u0434\u043b\u044f \u0438\u0433\u0440\u044b \u00b7 \u2116 063\n\n\u0421\u0430\u043c \u0432\u043e\u043f\u0440\u043e\u0441?"),
    "\u0421\u0430\u043c \u0432\u043e\u043f\u0440\u043e\u0441?"
  );
  assert.equal(
    stripEmbeddedLibraryHeader("twelve_twelve", "12\u00d712 \u00b7 \u041f\u0420\u0415\u0414\u0418\u0421\u041b\u041e\u0412\u0418\u0415 \u00b7 \u2116 0001\n\n\u0422\u0435\u043a\u0441\u0442"),
    "\u041f\u0420\u0415\u0414\u0418\u0421\u041b\u041e\u0412\u0418\u0415\n\n\u0422\u0435\u043a\u0441\u0442"
  );
  const daily = buildLibraryZoomMessages("daily_reflections", "31.07", "\u0415\u0436\u0435\u0434\u043d\u0435\u0432\u043d\u044b\u0435 \u0440\u0430\u0437\u043c\u044b\u0448\u043b\u0435\u043d\u0438\u044f \u00b7 31.07 \u00b7 \u2116 213\n\n\u041c\u041e\u041b\u0418\u0422\u0412\u0410")[0];
  assert.equal((daily.match(/\u0415\u0436\u0435\u0434\u043d\u0435\u0432\u043d\u044b\u0435 \u0440\u0430\u0437\u043c\u044b\u0448\u043b\u0435\u043d\u0438\u044f/gu) || []).length, 1);
  assert.doesNotMatch(daily, /\u2116\s*213/u);
});

test("validation rejects duplicates, gaps, empty files and unknown collections", () => {
  const result = validateLibraryImport({ collections: {
    big_book: { entries: [
      { key: "1", text: "Первый" },
      { key: "1", text: "Дубль" },
      { key: "3", text: "Третий" },
      { key: "4", text: "" }
    ] },
    surprise: { entries: [{ key: "1", text: "Нет" }] }
  } });
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /дубль 1/u);
  assert.match(result.errors.join("\n"), /пропущены номера 2/u);
  assert.match(result.errors.join("\n"), /пустой отрывок 4/u);
  assert.match(result.errors.join("\n"), /Неизвестная коллекция/u);
});

test("a later partial import merges collections and R2 keeps the previous version", async () => {
  const bucket = new FakeR2();
  const firstValidation = validateLibraryImport({ collections: { big_book: { entries: [{ key: 1, text: "Один" }] } } });
  const first = mergeLibraryCollections(null, firstValidation.collections, { version: "v1", publishedAt: "2026-01-01T00:00:00.000Z" });
  await saveZoomLibrary({ ZOOM_LIBRARY: bucket }, first);
  const secondValidation = validateLibraryImport({ collections: { living_sober: { entries: [{ key: 1, text: "Трезво" }] } } });
  const second = mergeLibraryCollections(first, secondValidation.collections, { version: "v2", publishedAt: "2026-01-02T00:00:00.000Z" });
  await saveZoomLibrary({ ZOOM_LIBRARY: bucket }, second);
  const loaded = await readZoomLibrary({ ZOOM_LIBRARY: bucket });
  assert.equal(loaded.version, "v2");
  assert.equal(getLibraryEntry(loaded, "big_book", 1).text, "Один");
  assert.equal(getLibraryEntry(loaded, "living_sober", 1).text, "Трезво");
  assert.equal(JSON.parse(bucket.objects.get(ZOOM_LIBRARY_PREVIOUS_KEY)).version, "v1");
  assert.equal(JSON.parse(bucket.objects.get(ZOOM_LIBRARY_CURRENT_KEY)).version, "v2");
});

test("daily dates include 29 February and reject an impossible date", () => {
  const valid = validateLibraryImport({ collections: { daily_reflections: { entries: [{ key: "29.02", text: "Високосный день" }] } } });
  assert.match(valid.errors.join("\n"), /ожидается 366/u);
  assert.doesNotMatch(valid.errors.join("\n"), /неверный номер\/дата/u);
  const invalid = validateLibraryImport({ collections: { daily_reflections: { entries: [{ key: "31.02", text: "Нет такого дня" }] } } });
  assert.match(invalid.errors.join("\n"), /неверный номер\/дата/u);
});
