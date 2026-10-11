import test from "node:test";
import assert from "node:assert/strict";
import { parseZoomRichText } from "../src/rich-text.mjs";
import { publicationTextHash } from "../src/publication-delivery.mjs";

test("Zoom rich text converts Markdown bold into safe HTML and visible plain text", () => {
  const parsed = parseZoomRichText("**\u0421\u043B\u0443\u0436\u0435\u043D\u0438\u044F**\n\n\u0418 \u0434\u0440\u0443\u0433\u043E\u0439 \u0442\u0435\u043A\u0441\u0442");
  assert.equal(parsed.hasFormatting, true);
  assert.equal(parsed.plainText, "\u0421\u043B\u0443\u0436\u0435\u043D\u0438\u044F\n\n\u0418 \u0434\u0440\u0443\u0433\u043E\u0439 \u0442\u0435\u043A\u0441\u0442");
  assert.equal(parsed.html, "<strong>\u0421\u043B\u0443\u0436\u0435\u043D\u0438\u044F</strong><br><br>\u0418 \u0434\u0440\u0443\u0433\u043E\u0439 \u0442\u0435\u043A\u0441\u0442");
});

test("Zoom rich text escapes HTML and leaves unmatched markers literal", () => {
  const parsed = parseZoomRichText("**<img src=x onerror=alert(1)>** and **unfinished");
  assert.equal(parsed.plainText, "<img src=x onerror=alert(1)> and **unfinished");
  assert.equal(parsed.html, "<strong>&lt;img src=x onerror=alert(1)&gt;</strong> and **unfinished");
});

test("publication identity hashes the visible text, not Markdown delimiters", () => {
  assert.equal(publicationTextHash("**Heading**\nBody"), publicationTextHash("Heading\nBody"));
});
