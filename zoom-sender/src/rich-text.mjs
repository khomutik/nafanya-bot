const BOLD_MARKER = /\*\*([^*\n]+)\*\*/gu;

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function parseZoomRichText(value) {
  const source = String(value || "");
  let hasFormatting = false;
  const fragments = [];
  let cursor = 0;

  for (const match of source.matchAll(BOLD_MARKER)) {
    hasFormatting = true;
    const start = match.index;
    const end = start + match[0].length;
    if (start > cursor) fragments.push({ text: source.slice(cursor, start), bold: false });
    fragments.push({ text: match[1], bold: true });
    cursor = end;
  }
  if (cursor < source.length) fragments.push({ text: source.slice(cursor), bold: false });
  if (!fragments.length && source) fragments.push({ text: source, bold: false });

  const plainText = fragments.map(({ text }) => text).join("");
  const html = fragments.map(({ text, bold }) => {
    const safe = escapeHtml(text).replaceAll("\r\n", "\n").replaceAll("\r", "\n").replaceAll("\n", "<br>");
    return bold ? `<strong>${safe}</strong>` : safe;
  }).join("");

  return { plainText, html, hasFormatting, fragments };
}
