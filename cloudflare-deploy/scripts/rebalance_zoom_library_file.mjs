import fs from "node:fs";
import {
  ZOOM_LIBRARY_REBALANCED_COLLECTIONS,
  buildLibraryZoomMessages,
  rebalanceNumberedBookEntries,
  stripEmbeddedLibraryHeader,
  unicodeLength
} from "../zoom_library.js";

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) {
  throw new Error("Usage: node scripts/rebalance_zoom_library_file.mjs INPUT.json OUTPUT.json");
}

const library = JSON.parse(fs.readFileSync(inputPath, "utf8"));
if (!library?.collections || typeof library.collections !== "object") {
  throw new Error("Invalid Zoom library file.");
}

const report = {};
for (const [collectionId, collection] of Object.entries(library.collections)) {
  if (!collection?.entries || typeof collection.entries !== "object") continue;
  collection.entries = Object.fromEntries(Object.entries(collection.entries).map(([key, entry]) => [key, {
    ...entry,
    text: stripEmbeddedLibraryHeader(collectionId, entry?.text)
  }]));
}
for (const collectionId of ZOOM_LIBRARY_REBALANCED_COLLECTIONS) {
  const collection = library.collections[collectionId];
  if (!collection?.entries || typeof collection.entries !== "object") continue;
  const sourceCount = Object.keys(collection.entries).length;
  const entries = rebalanceNumberedBookEntries(collectionId, collection.entries);
  const lengths = Object.entries(entries).map(([key, entry]) => {
    const messages = buildLibraryZoomMessages(collectionId, key, entry.text);
    if (messages.length !== 1) throw new Error(`${collectionId} ${key}: expected one final Zoom message.`);
    const length = unicodeLength(messages[0]);
    if (length > 950) throw new Error(`${collectionId} ${key}: ${length} characters.`);
    if (!/[.!?\u2026][\u00bb\u201d"'\u2019)\]]*$/u.test(entry.text.trim())) {
      throw new Error(`${collectionId} ${key}: excerpt does not end at a sentence boundary.`);
    }
    return length;
  });
  collection.entries = entries;
  report[collectionId] = {
    sourceCount,
    packedCount: lengths.length,
    min: Math.min(...lengths),
    max: Math.max(...lengths),
    average: Math.round(lengths.reduce((sum, length) => sum + length, 0) / lengths.length),
    below800ExceptLast: lengths.slice(0, -1).filter((length) => length < 800).length,
    last: lengths.at(-1)
  };
}

library.version = `sentence-packed-${new Date().toISOString()}`;
library.publishedAt = new Date().toISOString();
fs.writeFileSync(outputPath, JSON.stringify(library));
console.log(JSON.stringify(report, null, 2));
