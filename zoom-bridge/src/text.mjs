function normalizeText(text) {
  return String(text || "").replace(/\r\n?/gu, "\n").trim();
}

function splitLongToken(token, limit) {
  const parts = [];
  let current = "";
  for (const char of token) {
    if (current.length + char.length > limit) {
      if (current) parts.push(current);
      current = char;
    } else {
      current += char;
    }
  }
  if (current) parts.push(current);
  return parts;
}

function pushToken(parts, current, token, limit) {
  if (!token) return current;
  if (token.length > limit) {
    if (current.trim()) parts.push(current.trim());
    const tokenParts = splitLongToken(token, limit);
    parts.push(...tokenParts.slice(0, -1));
    return tokenParts.at(-1) || "";
  }
  const separator = current ? " " : "";
  const next = `${current}${separator}${token}`;
  if (next.length <= limit) return next;
  if (current.trim()) parts.push(current.trim());
  return token;
}

export function splitZoomText(text, limit = 950) {
  const clean = normalizeText(text);
  if (!clean) return [];
  const safeLimit = Math.max(1, Math.trunc(Number(limit) || 950));
  const parts = [];
  let current = "";
  for (const paragraph of clean.split(/\n{2,}/u)) {
    const paragraphText = paragraph.trim();
    if (!paragraphText) continue;
    const blockSeparator = current ? "\n\n" : "";
    if (`${current}${blockSeparator}${paragraphText}`.length <= safeLimit) {
      current = `${current}${blockSeparator}${paragraphText}`;
      continue;
    }
    if (current.trim()) {
      parts.push(current.trim());
      current = "";
    }
    for (const line of paragraphText.split("\n")) {
      const words = line.trim().split(/\s+/u).filter(Boolean);
      for (const word of words) {
        current = pushToken(parts, current, word, safeLimit);
      }
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}
