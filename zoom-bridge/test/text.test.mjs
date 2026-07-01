import test from "node:test";
import assert from "node:assert/strict";
import { splitZoomText } from "../src/text.mjs";

test("splitZoomText keeps short text intact", () => {
  assert.deepEqual(splitZoomText("hello", 10), ["hello"]);
});

test("splitZoomText splits text under the configured limit", () => {
  const parts = splitZoomText("one two three four five", 9);
  assert.deepEqual(parts, ["one two", "three", "four five"]);
  assert.ok(parts.every((part) => part.length <= 9));
});

test("splitZoomText splits long tokens safely", () => {
  const parts = splitZoomText("abcdefghij", 4);
  assert.deepEqual(parts, ["abcd", "efgh", "ij"]);
});
