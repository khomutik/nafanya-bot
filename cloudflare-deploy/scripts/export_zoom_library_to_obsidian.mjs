import fs from "node:fs";
import path from "node:path";

const [inputPath, outputRoot] = process.argv.slice(2);
if (!inputPath || !outputRoot) {
  throw new Error("Usage: node scripts/export_zoom_library_to_obsidian.mjs INPUT.json OUTPUT_DIRECTORY");
}

const library = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const folders = {
  big_book: "01 Большая книга",
  twelve_twelve: "02 12 шагов и 12 традиций",
  living_sober: "03 Жить трезвыми",
  daily_reflections: "04 Ежедневные размышления",
  as_bill_sees_it: "05 Как это видит Билл",
  game_questions: "06 500 вопросов"
};

if (fs.existsSync(outputRoot)) throw new Error(`Output directory already exists: ${outputRoot}`);
fs.mkdirSync(outputRoot, { recursive: true });
const counts = {};
for (const [collectionId, folderName] of Object.entries(folders)) {
  const entries = library?.collections?.[collectionId]?.entries || {};
  const folderPath = path.join(outputRoot, folderName);
  fs.mkdirSync(folderPath, { recursive: true });
  for (const [key, entry] of Object.entries(entries)) {
    const fileKey = collectionId === "daily_reflections" ? key : String(key).padStart(3, "0");
    fs.writeFileSync(path.join(folderPath, `${fileKey}.md`), `${String(entry?.text || "").trim()}\n`, "utf8");
  }
  counts[collectionId] = Object.keys(entries).length;
}

fs.writeFileSync(path.join(outputRoot, "README.md"), [
  "# База Нафани для Obsidian",
  "",
  "Большая книга, 12 шагов и 12 традиций и Жить трезвыми перенарезаны по законченным предложениям под итоговый лимит Zoom 950 знаков вместе с заголовком.",
  "Остальные коллекции сохранены без перенарезки.",
  ""
].join("\n"), "utf8");
console.log(JSON.stringify(counts, null, 2));
