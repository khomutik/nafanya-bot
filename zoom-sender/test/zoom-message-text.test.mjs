import test from "node:test";
import assert from "node:assert/strict";
import { plainZoomMessageText } from "../src/zoom-message-text.mjs";
import { publicationTextHash } from "../src/publication-delivery.mjs";

test("Zoom messages are plain text and strip only queued Markdown emphasis markers", () => {
  assert.equal(plainZoomMessageText("**\u0421\u043B\u0443\u0436\u0435\u043D\u0438\u044F**\n\n\u0418 \u0434\u0440\u0443\u0433\u043E\u0439 \u0442\u0435\u043A\u0441\u0442"), "\u0421\u043B\u0443\u0436\u0435\u043D\u0438\u044F\n\n\u0418 \u0434\u0440\u0443\u0433\u043E\u0439 \u0442\u0435\u043A\u0441\u0442");
  assert.equal(plainZoomMessageText("Ordinary queue update"), "Ordinary queue update");
  assert.equal(plainZoomMessageText("unclosed ** marker"), "unclosed ** marker");
});

test("publication identity is stable whether a queued message still has Markdown markers", () => {
  assert.equal(publicationTextHash("**Heading**\nBody"), publicationTextHash("Heading\nBody"));
});
