const DEFAULT_FAQ_FILE_ID = "1tN9NDlJFaxvx0VJDardsMx0uM2mSInVVHUa4wkZPf8U";
const DEFAULT_ROTATION_FILE_ID = "1HMeaRZShf-H4yEfnO6qTgePmNue5dd9MHxJCL5vrRHk";
const DEFAULT_SCHEDULE_FILE_ID = "1VAWzdnevTgTmfyx83wfSig9BW6PfdKK1wZorpW0bIvU";
const CACHE_TTL = 5 * 60 * 1e3;
const TOKEN_SAFETY = 60 * 60 * 1e3;
const GENERIC_FALLBACK = "Нафаня порылся в актуальных таблицах группы, но прямого ответа там не нашёл.";
const PROGRAM_BLOCKED_ANSWER = "\u041f\u043e \u043f\u0440\u043e\u0433\u0440\u0430\u043c\u043c\u0435 \u0438 \u0411\u041a \u044f \u0441\u0435\u0439\u0447\u0430\u0441 \u043d\u0435 \u043e\u0442\u0432\u0435\u0447\u0430\u044e, \u0447\u0442\u043e\u0431\u044b \u043d\u0435 \u043d\u0430\u0431\u0440\u0435\u0445\u0430\u0442\u044c \u0441 \u0443\u043c\u043d\u044b\u043c \u0432\u0438\u0434\u043e\u043c. \u042d\u0442\u043e\u0442 \u0431\u043b\u043e\u043a \u043f\u043e\u043a\u0430 \u043e\u0442\u043a\u043b\u044e\u0447\u0451\u043d.";

export function createKnowledgeRuntime(deps) {
  const { QUERY_HINT, FAQ_HINT, sysPrompt, ROLE_ALIASES, looksLikeBlockedProgramQuestion, scoreChunkBonus, now = () => new Date() } = deps;
  let snapshotCache = null;
  let snapshotCacheAt = 0;
  let tokenCache = null;

  const MONTHS = {
    января: 1,
    февраля: 2,
    марта: 3,
    апреля: 4,
    мая: 5,
    июня: 6,
    июля: 7,
    августа: 8,
    сентября: 9,
    октября: 10,
    ноября: 11,
    декабря: 12
  };

  function compact(value) {
    return String(value || "").replace(/\uFEFF/g, "").replace(/\s+/g, " ").trim();
  }

  function compactPreservingLines(value) {
    return String(value || "")
      .replace(/\uFEFF/g, "")
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .map((line) => line.replace(/[^\S\n]+/g, " ").trim())
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function norm(value) {
    return compact(value)
      .toLowerCase()
      .replace(/ё/g, "е")
      .replace(/[^\p{L}\p{N}\s:/+.-]/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function sanitizeOutgoingText(text) {
    let out = compactPreservingLines(text);
    if (!out) return out;
    out = out.replace(/^\s*Привет(?:,\s*[^!?.]+)?[!?.]?\s*/iu, "Пошуршал бумагами. ");
    out = out.replace(/\bАрхив группы\b/giu, "FAQ");
    out = out.replace(/\bАрхив решений\b/giu, "FAQ");
    out = out.replace(/\bПроект Положения группы\b/giu, "FAQ");
    out = out.replace(/\bСценарий собрания\b/giu, "График служений");
    out = out.replace(/[^\S\n]{2,}/g, " ");
    out = out.replace(/[^\S\n]+([,.!?;:])/g, "$1");
    return out.trim();
  }

  function canonicalSourceLabel(label, fallback = "FAQ") {
    const text = compact(label);
    const normalized = norm(text);
    if (!normalized) return fallback;
    if (normalized.includes("faq") || normalized.includes("вопрос") || normalized.includes("ответ")) return "FAQ";
    if (normalized.includes("график") || normalized.includes("собрание") || normalized.includes("служен")) return "График служений";
    if (normalized.includes("ротац") || normalized.includes("список служащ") || normalized.includes("служащ")) return "Список служащих/ротация";
    if (normalized.includes("архив") || normalized.includes("положени") || normalized.includes("сценарий")) return fallback;
    return text || fallback;
  }

  function tokenSet(value) {
    return new Set(norm(value).split(" ").filter((token) => token.length > 2));
  }

  function escapeRegex(value) {
    return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function hasNormalizedWord(text, word) {
    const escaped = escapeRegex(word);
    return new RegExp(`(?:^|[^\\p{L}\\p{N}_])${escaped}(?=$|[^\\p{L}\\p{N}_])`, "u").test(text);
  }

  function score(text, question) {
    const normalized = norm(text);
    let points = 0;
    for (const token of tokenSet(question)) {
      if (normalized.includes(token)) {
        points += token.length >= 6 ? 6 : 3;
      }
    }
    return points;
  }

  function cyrillicShare(value) {
    const text = String(value || "");
    const cyrillic = (text.match(/[А-Яа-яЁё]/g) || []).length;
    const latin = (text.match(/[A-Za-z]/g) || []).length;
    return cyrillic / Math.max(1, cyrillic + latin);
  }

  function hasBlockedProgramCue(question) {
    return typeof looksLikeBlockedProgramQuestion === "function"
      ? looksLikeBlockedProgramQuestion(question, norm)
      : false;
  }

  function slug(value) {
    return norm(value).replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "");
  }

  function moscowNow() {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Moscow",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(now());
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return {
      year: Number(values.year),
      month: Number(values.month),
      day: Number(values.day)
    };
  }

  function keyDate({ day, month, year }) {
    const dd = String(day).padStart(2, "0");
    const mm = String(month).padStart(2, "0");
    return year ? `${dd}.${mm}.${year}` : `${dd}.${mm}`;
  }

  function shiftMoscowDate(deltaDays = 0) {
    const now = moscowNow();
    const shifted = new Date(Date.UTC(now.year, now.month - 1, now.day + deltaDays));
    return {
      year: shifted.getUTCFullYear(),
      month: shifted.getUTCMonth() + 1,
      day: shifted.getUTCDate()
    };
  }

  function parseDateKey(value) {
    const text = norm(value);
    if (!text) return null;
    let match = text.match(/\b(\d{1,2})[./](\d{1,2})(?:[./](\d{4}))?\b/);
    if (match) {
      return keyDate({
        day: Number(match[1]),
        month: Number(match[2]),
        year: match[3] ? Number(match[3]) : null
      });
    }
    match = text.match(/(?:^|\s)(\d{1,2})\s+([а-я]+)(?:\s|$)/u);
    if (match) {
      const month = MONTHS[match[2]];
      if (month) {
        return keyDate({ day: Number(match[1]), month, year: null });
      }
    }
    return null;
  }

  function weekdayIndexFromWord(word) {
    const text = norm(word);
    if (!text) return null;
    if (text.startsWith("понедель")) return 1;
    if (text.startsWith("вторник")) return 2;
    if (text.startsWith("сред")) return 3;
    if (text.startsWith("четверг")) return 4;
    if (text.startsWith("пятниц")) return 5;
    if (text.startsWith("суббот")) return 6;
    if (text.startsWith("воскресен")) return 0;
    return null;
  }

  function lastSaturdayOfMonth(year, monthIndex) {
    const date = new Date(Date.UTC(year, monthIndex + 1, 0));
    while (date.getUTCDay() !== 6) {
      date.setUTCDate(date.getUTCDate() - 1);
    }
    return date;
  }

  function parseDateValue(value) {
    const text = norm(value);
    const key = parseDateKey(text);
    if (!key) return null;
    const parts = key.split(".");
    const day = Number(parts[0]);
    const month = Number(parts[1]);
    const year = parts[2] ? Number(parts[2]) : moscowNow().year;
    return new Date(Date.UTC(year, month - 1, day));
  }

  function dateFromKey(dateKey) {
    const match = String(dateKey || "").match(/^(\d{2})\.(\d{2})(?:\.(\d{4}))?$/u);
    if (!match) return null;
    return new Date(Date.UTC(Number(match[3]) || moscowNow().year, Number(match[2]) - 1, Number(match[1])));
  }

  function formatMoscowDate(date) {
    const dd = String(date.getUTCDate()).padStart(2, "0");
    const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
    const yyyy = date.getUTCFullYear();
    return `${dd}.${mm}.${yyyy}`;
  }

  function formatMentionedName(name) {
    const text = compact(name || "");
    return text ? `${text[0].toUpperCase()}${text.slice(1)}` : text;
  }

  function isRegularMeetingDate(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return false;
    const start = new Date(Date.UTC(2026, 5, 1));
    if (date < start) return false;
    return [0, 1, 2, 4, 5].includes(date.getUTCDay());
  }

  function nextRegularMeetingDate(fromDate) {
    const start = new Date(Date.UTC(2026, 5, 1));
    const base = fromDate > start ? fromDate : start;
    for (let offset = 0; offset < 14; offset += 1) {
      const candidate = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() + offset));
      if (isRegularMeetingDate(candidate)) return candidate;
    }
    return start;
  }

  function weekdayRu(date) {
    return ["\u0432\u043e\u0441\u043a\u0440\u0435\u0441\u0435\u043d\u044c\u0435", "\u043f\u043e\u043d\u0435\u0434\u0435\u043b\u044c\u043d\u0438\u043a", "\u0432\u0442\u043e\u0440\u043d\u0438\u043a", "\u0441\u0440\u0435\u0434\u0430", "\u0447\u0435\u0442\u0432\u0435\u0440\u0433", "\u043f\u044f\u0442\u043d\u0438\u0446\u0430", "\u0441\u0443\u0431\u0431\u043e\u0442\u0430"][date.getUTCDay()];
  }

  function dateKeyFromDate(date) {
    return keyDate({
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate()
    });
  }

  function weekdayKeyFromOffset(offset) {
    const now = moscowNow();
    const date = new Date(Date.UTC(now.year, now.month - 1, now.day + offset));
    return dateKeyFromDate(date);
  }

  function nextWeekdayKey(weekdayIndex, { strict = false } = {}) {
    const now = moscowNow();
    const today = new Date(Date.UTC(now.year, now.month - 1, now.day));
    const todayIndex = today.getUTCDay();
    let delta = (weekdayIndex - todayIndex + 7) % 7;
    if (strict && delta === 0) delta = 7;
    const date = new Date(Date.UTC(now.year, now.month - 1, now.day + delta));
    return dateKeyFromDate(date);
  }

  function guessDateKey(question) {
    const text = norm(question);
    if (hasNormalizedWord(text, "\u043f\u043e\u0441\u043b\u0435\u0437\u0430\u0432\u0442\u0440\u0430")) return weekdayKeyFromOffset(2);
    if (hasNormalizedWord(text, "\u0437\u0430\u0432\u0442\u0440\u0430")) return weekdayKeyFromOffset(1);
    if (hasNormalizedWord(text, "\u0441\u0435\u0433\u043e\u0434\u043d\u044f")) return weekdayKeyFromOffset(0);
    if (hasNormalizedWord(text, "\u0432\u0447\u0435\u0440\u0430")) return weekdayKeyFromOffset(-1);

    const weekdayPatterns = [
      { strict: true, regex: /(?:^|\s)(?:в\s+)?следующ(?:ий|ую|ее)\s+(понедельник|вторник|сред[ау]|четверг|пятниц[ау]|суббот[ау]|воскресен(?:ье|ие|ья|ия|ью|ию)?)(?:\s|$)/u },
      { strict: false, regex: /(?:^|\s)(?:в\s+)?(понедельник|вторник|сред[ау]|четверг|пятниц[ау]|суббот[ау]|воскресен(?:ье|ие|ья|ия|ью|ию)?)(?:\s|$)/u }
    ];
    for (const pattern of weekdayPatterns) {
      const match = text.match(pattern.regex);
      if (!match) continue;
      const weekdayIndex = weekdayIndexFromWord(match[1]);
      if (weekdayIndex !== null) {
        return nextWeekdayKey(weekdayIndex, { strict: pattern.strict });
      }
    }

    return parseDateKey(text);
  }

  function extractQuestionDateKeys(question) {
    const text = norm(question);
    const keys = new Set();
    const guessed = guessDateKey(text);
    if (guessed) keys.add(guessed);

    const numeric = text.match(/\b(\d{1,2})[./](\d{1,2})(?:[./](\d{4}))?\b/);
    if (numeric) {
      keys.add(keyDate({
        day: Number(numeric[1]),
        month: Number(numeric[2]),
        year: numeric[3] ? Number(numeric[3]) : null
      }));
    }

    const month = text.match(/(?:^|\s)(\d{1,2})\s+([а-я]+)(?:\s|$)/u);
    if (month) {
      const monthIndex = MONTHS[month[2]];
      if (monthIndex) {
        keys.add(keyDate({ day: Number(month[1]), month: monthIndex, year: null }));
      }
    }

    return [...keys];
  }

  function dateKeyMatches(rowDateKey, targetDateKey) {
    const rowParts = String(rowDateKey || "").split(".");
    const targetParts = String(targetDateKey || "").split(".");
    if (rowParts.length < 2 || targetParts.length < 2) return false;
    if (rowParts[0] !== targetParts[0] || rowParts[1] !== targetParts[1]) return false;
    return targetParts.length < 3 || rowParts[2] === targetParts[2];
  }

  function questionLooksLikeScheduleRow(question) {
    const text = norm(question);
    const hasScheduleField = /(ведущ|ведет|ведёт|техвед|техническ|дата|день недели)/u.test(text);
    const hasTopicCue = /(какая|какой|какое|какие)\s+тема(?:\s+собрания)?/u.test(text);
    const hasDateCue = /(сегодня|завтра|послезавтра|вчера|следующ(?:ая|ий|ую|ее)|\d{1,2}[./]\d{1,2}|\d{1,2}\s+[а-я]+)/u.test(text);
    const hasWeekdayCue = /(?:^|\s)(?:в\s+)?(?:понедельник|вторник|сред[ау]|четверг|пятниц[ау]|суббот[ау]|воскресен(?:ье|ие|ья|ия|ью|ию)?)(?:\s|$)/u.test(text);
    const hasWhenCue = /(когда|какого\s+числа|в\s+какой\s+день|какой\s+день|во\s*сколько|на\s*когда|какое\s+время|к\s+которому\s+времени)/u.test(text);
    const hasRoleCue = /(ведущ|ведет|ведёт|техвед|техническ)/u.test(text);
    return hasTopicCue || (hasDateCue && /собрани/u.test(text)) || ((hasDateCue || hasWeekdayCue || hasWhenCue) && (hasScheduleField || hasRoleCue));
  }

  function getSA(env) {
    if (!env?.GOOGLE_SERVICE_ACCOUNT_JSON) return null;
    try {
      return JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON);
    } catch {
      return null;
    }
  }

  function getGoogleSourceIds(env) {
    return {
      faq: env?.FAQ_FILE_ID || DEFAULT_FAQ_FILE_ID,
      schedule: env?.SCHEDULE_FILE_ID || DEFAULT_SCHEDULE_FILE_ID,
      rotation: env?.ROTATION_FILE_ID || DEFAULT_ROTATION_FILE_ID
    };
  }

  function b64u(bytes) {
    let bin = "";
    const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    for (const b of arr) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function pemBuf(pem) {
    const body = String(pem || "")
      .replace(/-----BEGIN PRIVATE KEY-----/g, "")
      .replace(/-----END PRIVATE KEY-----/g, "")
      .replace(/\s+/g, "");
    const bin = atob(body);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
    return out.buffer;
  }

  async function signJwt(sa, scope) {
    const now = Math.floor(Date.now() / 1e3);
    const header = { alg: "RS256", typ: "JWT" };
    const payload = {
      iss: sa.client_email,
      scope,
      aud: sa.token_uri || "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600
    };
    const input = `${b64u(new TextEncoder().encode(JSON.stringify(header)))}.${b64u(new TextEncoder().encode(JSON.stringify(payload)))}`;
    const key = await crypto.subtle.importKey("pkcs8", pemBuf(sa.private_key), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
    const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(input));
    return `${input}.${b64u(sig)}`;
  }

  async function accessToken(env) {
    if (tokenCache && tokenCache.expiresAt > Date.now() + TOKEN_SAFETY) return tokenCache.token;
    const sa = getSA(env);
    if (!sa?.client_email || !sa.private_key) return null;
    const assertion = await signJwt(sa, "https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/documents.readonly https://www.googleapis.com/auth/spreadsheets.readonly");
    const body = new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    });
    const response = await fetch(sa.token_uri || "https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString()
    });
    if (!response.ok) return null;
    const data = await response.json();
    tokenCache = {
      token: data.access_token,
      expiresAt: Date.now() + Number(data.expires_in || 3600) * 1e3
    };
    return tokenCache.token;
  }

  async function gjson(url, token) {
    const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
    if (!response.ok) return null;
    return response.json();
  }

  function scoreSheetTab(tab, kind) {
    const headerRow = headers(tab.rows || []);
    const normalized = norm(headerRow.join(" "));
    let score = 0;
    if (kind === "faq") {
      if (normalized.includes("вопрос")) score += 6;
      if (normalized.includes("ответ")) score += 6;
      if (normalized.includes("источник")) score += 4;
      if (normalized.includes("тег")) score += 2;
    } else if (kind === "schedule") {
      if (normalized.includes("дата")) score += 6;
      if (normalized.includes("тема")) score += 6;
      if (normalized.includes("вед")) score += 4;
      if (normalized.includes("тех")) score += 4;
      if (normalized.includes("день")) score += 2;
    } else if (kind === "rotation") {
      if (normalized.includes("служ")) score += 6;
      if (normalized.includes("ротац")) score += 6;
      if (normalized.includes("кто")) score += 4;
      if (normalized.includes("срок")) score += 4;
      if (normalized.includes("ценз")) score += 4;
    }
    score += Math.min((tab.rows || []).length, 50);
    return score;
  }

  function pickBestSheetTab(tabs, kind) {
    if (!tabs.length) return null;
    return [...tabs]
      .map((tab) => ({ tab, score: scoreSheetTab(tab, kind) }))
      .sort((a, b) => b.score - a.score)[0]?.tab || tabs[0];
  }

  async function loadSheet(token, id, kind) {
    const meta = await gjson(`https://sheets.googleapis.com/v4/spreadsheets/${id}?fields=properties.title,sheets.properties.title,sheets.properties.hidden`, token);
    if (!meta) return null;
    const visibleSheets = (meta.sheets || []).map((sheet) => sheet?.properties).filter((props) => props && !props.hidden);
    const tabs = await Promise.all(visibleSheets.map(async (sheet) => {
      const values = await gjson(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent(sheet.title)}!A:Z?valueRenderOption=FORMATTED_VALUE`, token);
      return {
        title: sheet.title || "Sheet1",
        rows: values?.values || []
      };
    }));
    const bestTab = pickBestSheetTab(tabs, kind) || tabs[0] || { title: "Sheet1", rows: [] };
    return {
      id,
      title: meta.properties?.title || "",
      sheetTitle: bestTab.title || "Sheet1",
      rows: bestTab.rows || [],
      tabs
    };
  }

  function headers(rows) {
    return (rows[0] || []).map((cell) => norm(cell));
  }

  function hdr(headerRow, variants) {
    const expected = variants.map((variant) => norm(variant));
    for (let i = 0; i < headerRow.length; i += 1) {
      if (expected.some((variant) => headerRow[i].includes(variant))) {
        return i;
      }
    }
    return -1;
  }

  function rowText(sheetName, headerRow, row) {
    const parts = [];
    for (let i = 0; i < headerRow.length; i += 1) {
      const value = compact(row[i] || "");
      if (headerRow[i] && value) {
        parts.push(`${headerRow[i]}: ${value}`);
      }
    }
    return `${sheetName}: ${parts.join("; ")}`;
  }

  function faqEntriesFromRows(rows) {
    const grid = Array.isArray(rows) ? rows.filter((row) => Array.isArray(row) && row.some((cell) => compact(cell || ""))) : [];
    if (grid.length < 2) return [];
    const headerRow = headers(grid);
    const questionIndex = hdr(headerRow, ["вопрос", "question"]);
    const answerIndex = hdr(headerRow, ["ответ", "answer"]);
    const sourceIndex = hdr(headerRow, ["источник", "source"]);
    const tagsIndex = hdr(headerRow, ["тег", "теги", "tags"]);
    if (questionIndex < 0 || answerIndex < 0) return [];
    return grid.slice(1).map((row) => ({
      question: compact(row[questionIndex] || ""),
      answer: compactPreservingLines(row[answerIndex] || ""),
      source: sourceIndex >= 0 ? canonicalSourceLabel(row[sourceIndex] || "", "FAQ") : "FAQ",
      tags: tagsIndex >= 0 ? compact(row[tagsIndex] || "") : ""
    })).filter((entry) => entry.question && entry.answer);
  }

  function faqAnswer(snapshot, question) {
    const entries = snapshot.faqEntries || [];
    if (!entries.length) return null;
    if (hasBlockedProgramCue(question)) return null;
    let candidates = entries;
    if (serviceDescriptionLooksFaq(question)) {
      const role = rotationRoleKey(question);
      const aliases = (ROLE_ALIASES[role] || []).map((alias) => norm(alias)).filter(Boolean);
      if (aliases.length) {
        const roleMatches = entries.filter((entry) => {
          const text = norm(`${entry.question} ${entry.tags}`);
          return aliases.some((alias) => text.includes(alias));
        });
        if (roleMatches.length) candidates = roleMatches;
      }
    }
    const ranked = candidates
      .map((entry) => ({ entry, score: score(`${entry.question} ${entry.tags}`, question) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score);
    const winner = ranked[0];
    const threshold = serviceDescriptionLooksFaq(question) ? 5 : 8;
    if (!winner || winner.score < threshold) return null;
    return sanitizeOutgoingText(winner.entry.answer);
  }

  function answerFixedGroupKnowledge(question) {
    const text = norm(question);
    if (/(?:где|куда|ссылк|линк).*(?:инфоканал|инфо\s*канал)|(?:инфоканал|инфо\s*канал).*(?:где|куда|ссылк|линк)/u.test(text)) {
      return {
        answer: "\u0418\u043d\u0444\u043e\u041a\u0430\u043d\u0430\u043b \u0433\u0440\u0443\u043f\u043f\u044b \u0432 Telegram:\nhttps://t.me/+n40PjinXX_pjNTcy\n\n\u0418\u0441\u0442\u043e\u0447\u043d\u0438\u043a: \u041f\u043e\u043b\u043e\u0436\u0435\u043d\u0438\u0435 \u0433\u0440\u0443\u043f\u043f\u044b.",
        source: "\u041f\u043e\u043b\u043e\u0436\u0435\u043d\u0438\u0435 \u0433\u0440\u0443\u043f\u043f\u044b"
      };
    }
    if (/(?:\u0447\u0435\u043c\s+\u0437\u0430\u043d\u0438\u043c\u0430\u0435\u0442\u0441\u044f|\u0447\u0442\u043e\s+\u0434\u0435\u043b\u0430\u0435\u0442|\u0437\u0430\s+\u0447\u0442\u043e\s+\u043e\u0442\u0432\u0435\u0447\u0430\u0435\u0442|\u043e\u0431\u044f\u0437\u0430\u043d\u043d).*\u0441\u0435\u043a\u0440\u0435\u0442\u0430\u0440|\u0441\u0435\u043a\u0440\u0435\u0442\u0430\u0440.*(?:\u0447\u0435\u043c\s+\u0437\u0430\u043d\u0438\u043c\u0430\u0435\u0442\u0441\u044f|\u0447\u0442\u043e\s+\u0434\u0435\u043b\u0430\u0435\u0442|\u0437\u0430\s+\u0447\u0442\u043e\s+\u043e\u0442\u0432\u0435\u0447\u0430\u0435\u0442|\u043e\u0431\u044f\u0437\u0430\u043d\u043d)/u.test(text)) {
      return {
        answer: "\u0421\u0435\u043a\u0440\u0435\u0442\u0430\u0440\u044c \u0433\u0440\u0443\u043f\u043f\u044b \u043e\u0442\u0432\u0435\u0447\u0430\u0435\u0442 \u0437\u0430 \u044f\u0441\u043d\u043e\u0441\u0442\u044c \u0440\u0430\u0431\u043e\u0447\u0435\u0439 \u0438\u043d\u0444\u043e\u0440\u043c\u0430\u0446\u0438\u0438, \u0444\u0438\u043a\u0441\u0430\u0446\u0438\u044e \u0440\u0435\u0448\u0435\u043d\u0438\u0439 \u0433\u0440\u0443\u043f\u043f\u044b \u0438 \u0430\u0440\u0445\u0438\u0432. \u041a\u0440\u0430\u0442\u043a\u043e: \u0434\u043e\u043a\u0443\u043c\u0435\u043d\u0442\u044b, \u0440\u0435\u0448\u0435\u043d\u0438\u044f, \u043e\u0431\u044a\u044f\u0432\u043b\u0435\u043d\u0438\u044f, \u0441\u043f\u0438\u0441\u043e\u043a \u0441\u043b\u0443\u0436\u0430\u0449\u0438\u0445, \u0430\u0440\u0445\u0438\u0432 \u0438 \u043f\u0440\u043e\u0437\u0440\u0430\u0447\u043d\u043e\u0441\u0442\u044c \u0440\u0430\u0431\u043e\u0447\u0438\u0445 \u043f\u0440\u043e\u0446\u0435\u0441\u0441\u043e\u0432.\n\n\u0418\u0441\u0442\u043e\u0447\u043d\u0438\u043a: \u041f\u043e\u043b\u043e\u0436\u0435\u043d\u0438\u0435 \u0433\u0440\u0443\u043f\u043f\u044b.",
        source: "\u041f\u043e\u043b\u043e\u0436\u0435\u043d\u0438\u0435 \u0433\u0440\u0443\u043f\u043f\u044b"
      };
    }
    return null;
  }

  function roleAliases() {
    return Object.entries(ROLE_ALIASES || {});
  }

  function roleKey(question) {
    const normalized = norm(question);
    for (const [key, aliases] of roleAliases()) {
      if ((aliases || []).some((alias) => normalized.includes(norm(alias)))) {
        return key;
      }
    }
    return null;
  }

    function rotationRoleKey(question) {
      const normalized = norm(question);
      if (/(?:секретар|секретарша)/u.test(normalized)) return "secretary";
      if (/(?:координатор|коорд)/u.test(normalized)) return "coordinator";
      if (/(?:\u043f\u0440\u0435\u0434\u0441\u0442\u0430\u0432\u0438\u0442\u0435\u043b|\u043f\u0433)/u.test(normalized)) return "representative";
      if (/(?:сисадмин|сис\s*админ|системн[а-я]*\s+админ)/u.test(normalized)) return "sysAdmin";
      if (/(?:техвед|тех\s*вед|техническ[а-я]*\s+ведущ)/u.test(normalized)) return "techHost";
    if (/(?:ведущ|ведет|ведёт)/u.test(normalized)) return "leader";
    if (/(?:казнач)/u.test(normalized)) return "treasurer";
    if (/(?:\u043a\u0443\u0440\u0430\u0442\u043e\u0440|\u043e\u0431\u0443\u0447\u0435\u043d)/u.test(normalized)) return "trainingCurator";
    if (/(?:\u0440\u0430\u0441\u0441\u044b\u043b|\u0430\u043d\u043e\u043d\u0441)/u.test(normalized)) return "announcer";
    if (/(?:литератор|литератур)/u.test(normalized)) return "literature";
    if (/(?:чайн|чайщик|чайщиц)/u.test(normalized)) return "tea";
    if (/(?:новичк)/u.test(normalized)) return "newcomer";
    if (/(?:спикерхант)/u.test(normalized)) return "speakerHunter";
    return roleKey(question);
  }

  function matchesFlexibleName(question, name) {
    const normalizedQuestion = norm(question);
    const normalizedName = norm(name);
    if (!normalizedQuestion || !normalizedName) return false;
    if (normalizedQuestion.includes(normalizedName)) return true;
    const stem = normalizedName.replace(/(?:[аяыиоуеёью]|ся)$/u, "");
    if (stem.length >= 3 && normalizedQuestion.includes(stem)) return true;
    if (normalizedName.length >= 5 && normalizedQuestion.includes(normalizedName.slice(0, -1))) return true;
    return false;
  }

  function isFreeCell(value) {
    const text = norm(value);
    return /^(свободно|свободна|свободны|free)$/u.test(text);
  }

  function formatRoleOccupant(value, fallback = "нет") {
    const text = compact(value || "");
    if (!text) return fallback;
    if (isFreeCell(text)) return "есть свободное место";
    const usernameMatch = text.match(/(^|\s)(@[A-Za-z0-9_]{3,})(?=\s|$)/);
    if (!usernameMatch) return text;
    const username = usernameMatch[2];
    const name = compact(text.replace(usernameMatch[0], " "));
    if (!name) return username;
    return `${name} (${username})`;
  }

  function ensureSentenceEnding(text) {
    const value = compact(text || "");
    if (!value) return value;
    return /[.!?…]$/u.test(value) ? value : `${value}.`;
  }

  function formatServiceLabel(value, fallback = "Служение") {
    const text = compact(value || "");
    if (!text) return fallback;
    const normalized = norm(text);
    if (/(?:сис\s*админ|системн[а-я]*\s+админ)/u.test(normalized)) return "Сисадмин";
    if (/(?:техвед|тех\s*вед|техническ)/u.test(normalized)) return "Техвед";
    if (/(?:ведущ|ведет|ведёт)/u.test(normalized)) return "Ведущий";
    if (/(?:казнач)/u.test(normalized)) return "Казначей";
    if (/(?:секретар)/u.test(normalized)) return "Секретарь";
    if (/(?:коорд)/u.test(normalized)) return "Координатор";
    if (/(?:представител|\bпг\b)/u.test(normalized)) return "Представитель группы (ПГ)";
    if (/(?:спикерхант)/u.test(normalized)) return "Спикерхантер";
    if (/(?:куратор|обучен)/u.test(normalized)) return "Куратор по обучению";
    if (/(?:рассыл|анонс)/u.test(normalized)) return "Рассыльный анонсов";
    return text;
  }

  function formatGroupedRotationEntries(entries, idx, labelFallback = "Служение") {
    const groups = new Map();
    for (const entry of entries) {
      const serviceName = formatServiceLabel(entry.service || "", labelFallback);
      const groupKey = norm(serviceName) || serviceName;
      const name = formatRoleOccupant(entry.who, "");
      if (!groups.has(groupKey)) {
        groups.set(groupKey, {
          service: serviceName,
          names: [],
          rotation: idx.rotation >= 0 ? compact(entry.rotation || "") : "",
          term: idx.term >= 0 ? compact(entry.term || "") : "",
          cenz: idx.cenz >= 0 ? compact(entry.cenz || "") : ""
        });
      }
      const bucket = groups.get(groupKey);
      if (name && !bucket.names.includes(name)) bucket.names.push(name);
      if (!bucket.rotation && idx.rotation >= 0) bucket.rotation = compact(entry.rotation || "");
      if (!bucket.term && idx.term >= 0) bucket.term = compact(entry.term || "");
      if (!bucket.cenz && idx.cenz >= 0) bucket.cenz = compact(entry.cenz || "");
    }

    return [...groups.values()].map((group) => {
      const lines = [
        `${group.service}:`,
        ...group.names.map((item) => `• ${item}`),
        idx.rotation >= 0 ? `\u0414\u0430\u0442\u0430 \u0440\u043e\u0442\u0430\u0446\u0438\u0438: ${formatDateCell(group.rotation || "")}` : null,
        idx.term >= 0 ? `\u0421\u0440\u043e\u043a \u0441\u043b\u0443\u0436\u0435\u043d\u0438\u044f: ${group.term || "\u043d\u0435\u0442"}` : null,
        idx.cenz >= 0 ? `\u0426\u0435\u043d\u0437: ${group.cenz || "\u043d\u0435\u0442"}` : null
      ].filter(Boolean);
      return lines.join("\n");
    }).join("\n\n");
  }

  function formatDateCell(value) {
    const text = compact(value || "");
    if (value instanceof Date) {
      return dateKeyFromDate(value);
    }
    const parsed = parseDateValue(text);
    if (parsed) return dateKeyFromDate(parsed);
    return text || "нет";
  }

  function formatRotationRow(row, idx) {
    const parts = [];
    if (idx.service >= 0) parts.push(`Служение: ${compact(row[idx.service] || "") || "нет"}`);
    if (idx.who >= 0) parts.push(`Имя: ${compact(row[idx.who] || "") || "нет"}`);
    if (idx.rotation >= 0) parts.push(`Дата ротации: ${formatDateCell(row[idx.rotation])}`);
    if (idx.term >= 0) parts.push(`Срок служения: ${compact(row[idx.term] || "") || "нет"}`);
    if (idx.cenz >= 0) parts.push(`Ценз: ${compact(row[idx.cenz] || "") || "нет"}`);
    return parts.join("\n");
  }

  function isScheduleQuestion(question) {
    const text = norm(question);
    return questionLooksLikeScheduleRow(text);
  }

  function hasScheduleDateCue(question) {
    const text = norm(question);
    return extractQuestionDateKeys(question).length > 0 || /(?:\u0441\u0435\u0433\u043e\u0434\u043d\u044f|\u0437\u0430\u0432\u0442\u0440\u0430|\u043f\u043e\u0441\u043b\u0435\u0437\u0430\u0432\u0442\u0440\u0430|\u0432\u0447\u0435\u0440\u0430|\u0441\u043b\u0435\u0434\u0443\u044e\u0449|\u0431\u043b\u0438\u0436\u0430\u0439\u0448|\u0432\s+\u043f\u043e\u043d\u0435\u0434\u0435\u043b|\u0432\s+\u0432\u0442\u043e\u0440|\u0432\s+\u0441\u0440\u0435\u0434|\u0432\s+\u0447\u0435\u0442\u0432\u0435\u0440|\u0432\s+\u043f\u044f\u0442\u043d|\u0432\s+\u0441\u0443\u0431\u0431\u043e\u0442|\u0432\s+\u0432\u043e\u0441\u043a\u0440\u0435\u0441)/u.test(text);
  }

  function rotationQuestionLooksRelevant(question) {
    const text = norm(question);
    if (hasBlockedProgramCue(text)) return false;
    return /(?:\u0441\u0435\u043a\u0440\u0435\u0442\u0430\u0440|\u043a\u043e\u043e\u0440\u0434\u0438\u043d\u0430\u0442\u043e\u0440|\u043a\u043e\u043e\u0440\u0434|\u043f\u0440\u0435\u0434\u0441\u0442\u0430\u0432\u0438\u0442\u0435\u043b|\u043f\u0433|\u0442\u0435\u0445\u0432\u0435\u0434|\u0442\u0435\u0445\s*\u0432\u0435\u0434|\u0442\u0435\u0445\u043d\u0438\u0447\u0435\u0441\u043a|\u0432\u0435\u0434\u0443\u0449|\u0432\u0435\u0434\u0435\u0442|\u0432\u0435\u0434\u0451\u0442|\u043a\u0430\u0437\u043d\u0430\u0447|\u043a\u0443\u0440\u0430\u0442\u043e\u0440|\u043e\u0431\u0443\u0447\u0435\u043d|\u0440\u0430\u0441\u0441\u044b\u043b|\u0430\u043d\u043e\u043d\u0441|\u043b\u0438\u0442\u0435\u0440\u0430\u0442\u043e\u0440|\u0447\u0430\u0439\u0449|\u043d\u043e\u0432\u0438\u0447\u043a|\u0441\u043f\u0438\u043a\u0435\u0440\u0445\u0430\u043d\u0442|\u0441\u0440\u043e\u043a|\u0446\u0435\u043d\u0437|\u0440\u043e\u0442\u0430\u0446|\u0441\u0432\u043e\u0431\u043e\u0434\u043d|\u0437\u0430\u043a\u0430\u043d\u0447|\u0441\u043b\u0443\u0436\u0435\u043d\u0438)/u.test(text);
  }

    function shouldPreferRotation(question) {
      const text = norm(question);
      if (hasBlockedProgramCue(text)) return false;
      if (/(?:\u0432\u0435\u0434\u0443\u0449|\u0442\u0435\u0445\u0432\u0435\u0434|\u0442\u0435\u0445\s*\u0432\u0435\u0434|\u0442\u0435\u0445\u043d\u0438\u0447\u0435\u0441\u043a|сисадмин|сис\s*админ|системн[а-я]*\s+админ)/u.test(text) && hasScheduleDateCue(question)) return false;
      if (/(?:^|\s)\u043a\u0442\u043e(?:\s|$)/u.test(text) && /(?:\u0432\u0435\u0434\u0443\u0449|\u0442\u0435\u0445\u0432\u0435\u0434|\u0442\u0435\u0445\s*\u0432\u0435\u0434|сисадмин|сис\s*админ|системн[а-я]*\s+админ)/u.test(text) && /(?:\u0432\s+\u0433\u0440\u0443\u043f\u043f|\u0433\u0440\u0443\u043f\u043f\u044b|\u0441\u043b\u0443\u0436\u0435\u043d|\u0441\u043b\u0443\u0436\u0430\u0449|\u0443\s+\u043d\u0430\u0441)/u.test(text)) return true;
      if (/(?:\u0441\u0432\u043e\u0431\u043e\u0434\u043d|\u0441\u0440\u043e\u043a|\u0446\u0435\u043d\u0437|\u0440\u043e\u0442\u0430\u0446|\u0437\u0430\u043a\u0430\u043d\u0447|\u0441\u0435\u043a\u0440\u0435\u0442\u0430\u0440|\u043a\u043e\u043e\u0440\u0434\u0438\u043d\u0430\u0442\u043e\u0440|\u043a\u043e\u043e\u0440\u0434|\u043f\u0440\u0435\u0434\u0441\u0442\u0430\u0432\u0438\u0442\u0435\u043b|\u043f\u0433|\u043a\u0430\u0437\u043d\u0430\u0447|сисадмин|сис\s*админ|системн[а-я]*\s+админ|\u043a\u0443\u0440\u0430\u0442\u043e\u0440|\u043e\u0431\u0443\u0447\u0435\u043d|\u0440\u0430\u0441\u0441\u044b\u043b|\u0430\u043d\u043e\u043d\u0441|\u043b\u0438\u0442\u0435\u0440\u0430\u0442\u043e\u0440|\u0447\u0430\u0439\u0449|\u043d\u043e\u0432\u0438\u0447\u043a|\u0441\u043f\u0438\u043a\u0435\u0440\u0445\u0430\u043d\u0442)/u.test(text)) return true;
      if (/(?:^|\s)кто(?:\s|$)/u.test(text) && /(ведущие|техведы|сисадмины|служащие)/u.test(text)) return true;
    if (/(?:дай|принеси|покажи|скинь)\s+список\s+служащ|список\s+служащ(?:их|ие|им)?(?:\s|$)/u.test(text)) return true;
    return false;
  }

  function isRotationExclusiveQuestion(question) {
    const text = norm(question);
    if (hasBlockedProgramCue(text)) return false;
    return /(?:\u0441\u0440\u043e\u043a|\u0446\u0435\u043d\u0437|\u0440\u043e\u0442\u0430\u0446|\u0437\u0430\u043a\u0430\u043d\u0447|\u0434\u0430\u0442\u0430\s+\u0440\u043e\u0442\u0430\u0446|\u0442\u0440\u0435\u0431\u043e\u0432\u0430\u043d)/u.test(text);
  }

  function serviceDescriptionLooksFaq(question) {
    const text = norm(question);
    const hasDescriptionCue = /(?:\u0447\u0435\u043c\s+\u0437\u0430\u043d\u0438\u043c\u0430\u0435\u0442\u0441\u044f|\u0447\u0442\u043e\s+\u0434\u0435\u043b\u0430\u0435\u0442|\u0437\u0430\s+\u0447\u0442\u043e\s+\u043e\u0442\u0432\u0435\u0447\u0430\u0435\u0442|\u043e\u043f\u0438\u0441\u0430\u043d|\u043e\u0431\u044f\u0437\u0430\u043d\u043d)/u.test(text);
    return hasDescriptionCue && Boolean(rotationRoleKey(question));
  }

  function faqShouldWinBeforeRotation(question) {
    const text = norm(question);
    const asksInfoPlace = /(?:\u0433\u0434\u0435|\u043a\u0443\u0434\u0430|\u0440\u0430\u0437\u0434\u0435\u043b|\u0441\u0441\u044b\u043b\u043a|\u043f\u0440\u0430\u0432\u0438\u043b|\u043d\u0430\u0432\u0438\u0433\u0430\u0446|\u0447\u0430\u0442|\u0442\u0435\u043b\u0435\u043c\u043e\u0441\u0442|\u0438\u043d\u0444\u043e\u043a\u0430\u043d\u0430\u043b)/u.test(text);
    const topic = /(?:\u0430\u043d\u043e\u043d\u0441|\u043d\u0430\u0432\u0438\u0433\u0430\u0446|\u0447\u0430\u0442|\u0442\u0435\u043b\u0435\u043c\u043e\u0441\u0442|\u0438\u043d\u0444\u043e\u043a\u0430\u043d\u0430\u043b|\u043c\u0430\u0445|max)/u.test(text);
    return asksInfoPlace && topic;
  }

  function classifyKnowledgeQuestion(question) {
    const cleaned = compact(question);
    if (!cleaned) return "none";
    if (hasBlockedProgramCue(cleaned)) return "blockedProgram";
    if (isRotationExclusiveQuestion(cleaned) && (shouldPreferRotation(cleaned) || rotationQuestionLooksRelevant(cleaned))) return "rotation";
    if (questionLooksLikeScheduleRow(cleaned)) return "schedule";
    if (serviceDescriptionLooksFaq(cleaned)) return "faq";
    if (faqShouldWinBeforeRotation(cleaned)) return "faq";
    if (shouldPreferRotation(cleaned) || rotationQuestionLooksRelevant(cleaned)) return "rotation";
    if (QUERY_HINT.test(cleaned) || FAQ_HINT.test(cleaned)) return "faq";
    return "none";
  }

  function pickFilledRow(rows, indexes) {
    return rows.find((row) => indexes.some((index) => index >= 0 && compact(row[index] || ""))) || rows[0];
  }

  function rotationAnswer(snapshot, question) {
    const rows = snapshot.rotation?.rows || [];
    if (rows.length < 2) return null;
    if (hasBlockedProgramCue(question)) return null;
    const headerRow = headers(rows);
    const idx = {
      who: hdr(headerRow, ["имя", "кто", "служащий"]),
      service: hdr(headerRow, ["служение", "какое служение"]),
      rotation: hdr(headerRow, ["дата ротации", "ротация", "заканч"]),
      cenz: hdr(headerRow, ["ценз"]),
      term: hdr(headerRow, ["срок"])
    };
    const normalizedQuestion = norm(question);
    if (isScheduleQuestion(question) && !shouldPreferRotation(question)) return null;

    const entries = rows.slice(1).map((row) => ({
      row,
      service: compact(row[idx.service] || ""),
      who: compact(row[idx.who] || ""),
      rotation: idx.rotation >= 0 ? compact(row[idx.rotation] || "") : "",
      term: idx.term >= 0 ? compact(row[idx.term] || "") : "",
      cenz: idx.cenz >= 0 ? compact(row[idx.cenz] || "") : ""
    }));
    const wantsDeputyService = /\u0434\u0443\u0431\u043b/u.test(normalizedQuestion);
    const matchesDeputyIntent = (service) => {
      const serviceNorm = norm(service);
      return wantsDeputyService ? /\u0434\u0443\u0431\u043b/u.test(serviceNorm) : !/\u0434\u0443\u0431\u043b/u.test(serviceNorm);
    };

    const freeServices = entries
      .filter((entry) => isFreeCell(entry.who) && entry.service)
      .map((entry) => ({
        service: entry.service,
        cenz: entry.cenz || "\u043d\u0435\u0442",
        term: entry.term || "\u043d\u0435\u0442"
      }));

    const activeServants = entries
      .filter((entry) => entry.service && entry.who && !isFreeCell(entry.who))
      .map((entry) => ({
        service: entry.service,
        who: entry.who
      }));

    if (/(?:дай|принеси|покажи|скинь)\s+список\s+служащ|список\s+служащ(?:их|ие|им)?(?:\s|$)|кто\s+сейчас\s+служ(?:ит|ащие)/i.test(normalizedQuestion)) {
      if (!activeServants.length) return "Список служащих сейчас пуст.";
      const lines = activeServants.map((item) => `• ${item.service} — ${item.who}`);
      return `Список служащих сейчас такой:\n${lines.join("\n")}\n\nИсточник: Список служащих/ротация.`;
    }

    if (/(?:какие|какой)\s+(?:служен|должност)|какие служения свободны|свободные служения|какие служения есть/i.test(normalizedQuestion)) {
      if (!freeServices.length) return "Свободных служений сейчас нет.";
      const lines = freeServices.map((item) => `• ${item.service} — ценз: ${item.cenz}; срок служения: ${item.term}`);
      return `В группе есть свободные служения:\n${lines.join("\n")}\n\nИсточник: Список служащих/ротация.`;
    }

    const explicitRole =
      normalizedQuestion.includes("секретар")
        ? { key: "secretary", label: "Секретарь", serviceTokens: ["секретар"] }
        : normalizedQuestion.includes("координатор") || normalizedQuestion.includes("коорд")
          ? { key: "coordinator", label: "Координатор", serviceTokens: ["координатор", "коорд"] }
        : /(?:\u043f\u0440\u0435\u0434\u0441\u0442\u0430\u0432\u0438\u0442\u0435\u043b|\u043f\u0433)/u.test(normalizedQuestion)
          ? { key: "representative", label: "\u041f\u0440\u0435\u0434\u0441\u0442\u0430\u0432\u0438\u0442\u0435\u043b\u044c \u0433\u0440\u0443\u043f\u043f\u044b (\u041f\u0413)", serviceTokens: ["\u043f\u0440\u0435\u0434\u0441\u0442\u0430\u0432\u0438\u0442\u0435\u043b", "\u043f\u0433"] }
        : normalizedQuestion.includes("сисадмин") || normalizedQuestion.includes("сис админ") || normalizedQuestion.includes("системн")
          ? { key: "sysAdmin", label: "Сисадмин", serviceTokens: ["сисадмин", "сис админ", "системн"] }
        : normalizedQuestion.includes("техвед") || normalizedQuestion.includes("тех вед") || normalizedQuestion.includes("техническ")
          ? { key: "techHost", label: "Техвед", serviceTokens: ["техвед", "тех вед", "техническ"] }
            : normalizedQuestion.includes("ведущ") || normalizedQuestion.includes("ведет") || normalizedQuestion.includes("ведёт")
              ? { key: "leader", label: "Ведущий", serviceTokens: ["ведущ", "ведет", "ведёт"] }
              : normalizedQuestion.includes("казнач")
                ? { key: "treasurer", label: "Казначей", serviceTokens: ["казнач"] }
                : /(?:\u043a\u0443\u0440\u0430\u0442\u043e\u0440|\u043e\u0431\u0443\u0447\u0435\u043d)/u.test(normalizedQuestion)
                  ? { key: "trainingCurator", label: "\u041a\u0443\u0440\u0430\u0442\u043e\u0440 \u043f\u043e \u043e\u0431\u0443\u0447\u0435\u043d\u0438\u044e", serviceTokens: ["\u043a\u0443\u0440\u0430\u0442\u043e\u0440", "\u043e\u0431\u0443\u0447\u0435\u043d"] }
                  : /(?:\u0440\u0430\u0441\u0441\u044b\u043b|\u0430\u043d\u043e\u043d\u0441)/u.test(normalizedQuestion)
                    ? { key: "announcer", label: "\u0420\u0430\u0441\u0441\u044b\u043b\u044c\u043d\u044b\u0439 \u0430\u043d\u043e\u043d\u0441\u043e\u0432", serviceTokens: ["\u0440\u0430\u0441\u0441\u044b\u043b", "\u0430\u043d\u043e\u043d\u0441"] }
                : normalizedQuestion.includes("литератор") || normalizedQuestion.includes("литератур")
                  ? { key: "literature", label: "Литератор", serviceTokens: ["литератор", "литератур"] }
                  : normalizedQuestion.includes("чайн") || normalizedQuestion.includes("чайщик") || normalizedQuestion.includes("чайщиц")
                    ? { key: "tea", label: "Чайная", serviceTokens: ["чайн", "чайщик", "чайщиц"] }
                    : normalizedQuestion.includes("новичк")
                      ? { key: "newcomer", label: "Новичковая", serviceTokens: ["новичк"] }
          : normalizedQuestion.includes("спикерхант")
            ? { key: "speakerHunter", label: "Спикерхантер", serviceTokens: ["спикерхант"] }
            : null;
    if (explicitRole) {
        const pairedRoles = {
          coordinator: { label: "\u041a\u043e\u043e\u0440\u0434\u0438\u043d\u0430\u0442\u043e\u0440", deputyLabel: "\u0414\u0443\u0431\u043b\u0451\u0440 \u043a\u043e\u043e\u0440\u0434\u0438\u043d\u0430\u0442\u043e\u0440\u0430", tokens: ["\u043a\u043e\u043e\u0440\u0434\u0438\u043d\u0430\u0442\u043e\u0440", "\u043a\u043e\u043e\u0440\u0434"] },
          secretary: { label: "\u0421\u0435\u043a\u0440\u0435\u0442\u0430\u0440\u044c", deputyLabel: "\u0414\u0443\u0431\u043b\u0451\u0440 \u0441\u0435\u043a\u0440\u0435\u0442\u0430\u0440\u044f", tokens: ["\u0441\u0435\u043a\u0440\u0435\u0442\u0430\u0440"] },
          representative: { label: "\u041f\u0440\u0435\u0434\u0441\u0442\u0430\u0432\u0438\u0442\u0435\u043b\u044c \u0433\u0440\u0443\u043f\u043f\u044b (\u041f\u0413)", deputyLabel: "\u0414\u0443\u0431\u043b\u0451\u0440 \u043f\u0440\u0435\u0434\u0441\u0442\u0430\u0432\u0438\u0442\u0435\u043b\u044f \u0433\u0440\u0443\u043f\u043f\u044b (\u041f\u0413)", tokens: ["\u043f\u0440\u0435\u0434\u0441\u0442\u0430\u0432\u0438\u0442\u0435\u043b", "\u043f\u0433"] },
          treasurer: { label: "\u041a\u0430\u0437\u043d\u0430\u0447\u0435\u0439", deputyLabel: "\u0414\u0443\u0431\u043b\u0451\u0440 \u043a\u0430\u0437\u043d\u0430\u0447\u0435\u044f", tokens: ["\u043a\u0430\u0437\u043d\u0430\u0447"] },
          speakerHunter: { label: "\u0421\u043f\u0438\u043a\u0435\u0440\u0445\u0430\u043d\u0442\u0435\u0440", deputyLabel: "\u0414\u0443\u0431\u043b\u0451\u0440 \u0441\u043f\u0438\u043a\u0435\u0440\u0445\u0430\u043d\u0442\u0435\u0440\u0430", tokens: ["\u0441\u043f\u0438\u043a\u0435\u0440\u0445\u0430\u043d\u0442"] },
          trainingCurator: { label: "\u041a\u0443\u0440\u0430\u0442\u043e\u0440 \u043f\u043e \u043e\u0431\u0443\u0447\u0435\u043d\u0438\u044e", deputyLabel: "\u0414\u0443\u0431\u043b\u0451\u0440 \u043a\u0443\u0440\u0430\u0442\u043e\u0440\u0430 \u043f\u043e \u043e\u0431\u0443\u0447\u0435\u043d\u0438\u044e", tokens: ["\u043a\u0443\u0440\u0430\u0442\u043e\u0440", "\u043e\u0431\u0443\u0447\u0435\u043d"] }
        };
      const pairConfig = pairedRoles[explicitRole.key];
        if (pairConfig && /(?:^|\s)\u043a\u0442\u043e(?:\s|$)/iu.test(normalizedQuestion)) {
          const matchPairRole = (entry, wantDeputy) => {
            const serviceNorm = norm(entry.service);
            const isDeputy = serviceNorm.includes("\u0434\u0443\u0431\u043b");
            return isDeputy === wantDeputy && pairConfig.tokens.some((token) => serviceNorm.includes(token));
        };
          const mainRole = entries.find((entry) => matchPairRole(entry, false));
          const deputyRole = entries.find((entry) => matchPairRole(entry, true));
          if (mainRole || deputyRole) {
            return [
              `${pairConfig.label}: ${ensureSentenceEnding(formatRoleOccupant(mainRole?.who)).replace(/[.!?…]$/u, "")}.`,
              `${pairConfig.deputyLabel}: ${ensureSentenceEnding(formatRoleOccupant(deputyRole?.who)).replace(/[.!?…]$/u, "")}.`,
              "",
              "\u0418\u0441\u0442\u043e\u0447\u043d\u0438\u043a: \u0421\u043f\u0438\u0441\u043e\u043a \u0441\u043b\u0443\u0436\u0430\u0449\u0438\u0445/\u0440\u043e\u0442\u0430\u0446\u0438\u044f."
            ].join("\n");
          }
        }
      const matches = entries.filter((entry) => {
        const serviceNorm = norm(entry.service);
        return matchesDeputyIntent(entry.service) && (explicitRole.serviceTokens || []).some((token) => serviceNorm.includes(norm(token)));
      });
        if (matches.length) {
          if (/(?:какие|какой список|список).*(?:служен|должност)/i.test(normalizedQuestion)) {
            const names = [...new Set(matches.map((entry) => formatRoleOccupant(entry.who, "")).filter(Boolean))];
            if (!names.length) return null;
            return `${explicitRole.label}:\n${names.map((item) => `• ${item}`).join("\n")}\n\nИсточник: Список служащих/ротация.`;
          }

          if (/(?:заканчивается|заканчивается служение|когда заканч|ротац|дата ротац|когда ротац)/i.test(normalizedQuestion)) {
            return `${formatGroupedRotationEntries(matches, idx, explicitRole.label)}\n\nИсточник: Список служащих/ротация.`;
          }

        if (/(?:^|\s)срок(?:\s|$)/iu.test(normalizedQuestion) && idx.term >= 0) {
          const row = matches[0];
          return `${explicitRole.label}:\nСрок служения — ${row.term || "нет"}\n\nИсточник: Список служащих/ротация.`;
        }

        if (/(?:^|\s)ценз(?:\s|$)|требован/i.test(normalizedQuestion) && idx.cenz >= 0) {
          const row = matches[0];
          return `${explicitRole.label}:\nЦенз — ${row.cenz || "нет"}\n\nИсточник: Список служащих/ротация.`;
        }

          if (/(?:^|\s)кто(?:\s|$)/iu.test(normalizedQuestion)) {
            const names = [...new Set(matches.map((entry) => formatRoleOccupant(entry.who, "")).filter(Boolean))];
            if (!names.length) return null;
            if (explicitRole.key === "leader") {
              return `${explicitRole.label}:\n${names.map((item) => `• ${item}`).join("\n")}\n\nИсточник: Список служащих/ротация.`;
            }
            return `${explicitRole.label}:\n${names.map((item) => `• ${item}`).join("\n")}\n\nИсточник: Список служащих/ротация.`;
        }
      }
    }

    const role = rotationRoleKey(question);
    const aliases = ROLE_ALIASES[role] || [];
    const roleMatches = role
      ? entries.filter((entry) => matchesDeputyIntent(entry.service) && aliases.some((alias) => norm(entry.service).includes(norm(alias))))
      : [];

    const personMatches = entries.filter((entry) => matchesFlexibleName(question, entry.who));
    const asksRotationDate = /(заканчивается|заканчивается служение|когда заканч|ротац|дата ротац|когда ротац)/i.test(normalizedQuestion);
    const asksTerm = /(?:^|\s)срок(?:\s|$)/iu.test(normalizedQuestion);
    const asksCenz = /(?:^|\s)ценз(?:\s|$)|требован/i.test(normalizedQuestion);
    const asksNamesList = /(ведущие|техведы|сисадмины|секретари|координаторы|казначеи|спикерхантеры|литераторы|чайные|новички)/i.test(normalizedQuestion);

    if (personMatches.length && asksRotationDate) {
      const sorted = [...personMatches].sort((a, b) => {
        const left = parseDateValue(a.rotation);
        const right = parseDateValue(b.rotation);
        if (left && right) return left - right;
        return 0;
      });
          return `${formatGroupedRotationEntries(sorted, idx, formatServiceLabel(sorted[0].service, "\u0421\u043b\u0443\u0436\u0435\u043d\u0438\u0435"))}\n\nИсточник: Список служащих/ротация.`;
    }

    if (!roleMatches.length && !personMatches.length) {
      const missingName = formatMentionedName(normalizedQuestion.match(/(?:у|для|по)\s+([\p{L}]{3,32})/u)?.[1] || "");
      if (asksRotationDate && missingName) {
        return `\u0412 \u0441\u043f\u0438\u0441\u043a\u0435 \u0441\u043b\u0443\u0436\u0430\u0449\u0438\u0445/\u0440\u043e\u0442\u0430\u0446\u0438\u0438 \u043d\u0435 \u043d\u0430\u0448\u0451\u043b ${missingName}.\n\n\u0418\u0441\u0442\u043e\u0447\u043d\u0438\u043a: \u0421\u043f\u0438\u0441\u043e\u043a \u0441\u043b\u0443\u0436\u0430\u0449\u0438\u0445/\u0440\u043e\u0442\u0430\u0446\u0438\u044f.`;
      }
      return null;
    }

    if (roleMatches.length) {
        if (asksNamesList || (role === "leader" && /ведущ/i.test(normalizedQuestion))) {
          const names = [...new Set(roleMatches.map((entry) => formatRoleOccupant(entry.who, "")).filter(Boolean))];
          if (!names.length) return null;
          return `${compact(roleMatches[0].service) || "Служение"}:\n${names.map((item) => `• ${item}`).join("\n")}\n\nИсточник: Список служащих/ротация.`;
        }

        if (asksRotationDate && idx.rotation >= 0) {
          return `${formatGroupedRotationEntries(roleMatches, idx, formatServiceLabel(roleMatches[0].service, aliases[0] || "\u0421\u043b\u0443\u0436\u0435\u043d\u0438\u0435"))}\n\nИсточник: Список служащих/ротация.`;
        }

      if (/(?:^|\s)срок(?:\s|$)/iu.test(normalizedQuestion) && idx.term >= 0) {
        const row = roleMatches[0];
        return `${compact(row.service || aliases[0] || "служения")}: срок служения — ${row.term || "нет"}.\n\nИсточник: Список служащих/ротация.`;
      }

      if (/(?:^|\s)ценз(?:\s|$)|требован/i.test(normalizedQuestion) && idx.cenz >= 0) {
        const row = roleMatches[0];
        return `${compact(row.service || aliases[0] || "служения")}: ценз — ${row.cenz || "нет"}.\n\nИсточник: Список служащих/ротация.`;
      }

      if (/(?:^|\s)кто(?:\s|$)/iu.test(normalizedQuestion) && idx.who >= 0) {
        const names = [...new Set(roleMatches.map((entry) => formatRoleOccupant(entry.who, "")).filter(Boolean))];
        if (!names.length) return null;
        return `${compact(roleMatches[0].service) || aliases[0] || "Служение"}: ${names.join(", ")}.\n\nИсточник: Список служащих/ротация.`;
      }
    }

      if (personMatches.length) {
        const sorted = [...personMatches].sort((a, b) => {
          const left = parseDateValue(a.rotation);
          const right = parseDateValue(b.rotation);
          if (left && right) return left - right;
          return 0;
        });
        return `${formatGroupedRotationEntries(sorted, idx, formatServiceLabel(sorted[0].service, "\u0421\u043b\u0443\u0436\u0435\u043d\u0438\u0435"))}\n\nИсточник: Список служащих/ротация.`;
      }

    return null;
  }

  function scheduleAnswer(snapshot, question) {
    const rows = snapshot.schedule?.rows || [];
    if (rows.length < 2) return null;
    const headerRow = headers(rows);
    const idx = {
      date: hdr(headerRow, ["дата"]),
      day: hdr(headerRow, ["день недели", "день"]),
      theme: hdr(headerRow, ["тема собрания", "тема"]),
      leader: hdr(headerRow, ["ведущий", "ведет", "ведёт", "вед"]),
      tech: hdr(headerRow, ["техвед", "технический ведущий", "тех ведущий"])
    };
    const normalizedQuestion = norm(question);
    const targets = extractQuestionDateKeys(question);
    const nameCatalog = [...new Set(rows.slice(1).flatMap((row) => [row[idx.leader], row[idx.tech]]).map((value) => compact(value || "")).filter(Boolean))];
    const nameTokens = (name) => norm(name).split(" ").filter((token) => token.length > 2);
    const person = nameCatalog.find((name) => normalizedQuestion.includes(norm(name)))
      || nameCatalog.find((name) => nameTokens(name).some((token) => new RegExp(`(?:^|\\s)${escapeRegex(token)}(?:\\s|$)`, "u").test(normalizedQuestion)));
    const unknownPersonMatch = normalizedQuestion.match(/(?:когда|какого\s+числа|в\s+какой\s+день)\s+([\p{L}]{3,32})\s+(?:техведит|техвед|ведет|ведёт|ведущий|ведущая)/u)
      || normalizedQuestion.match(/(?:техведит|техвед|ведет|ведёт|ведущий|ведущая)\s+([\p{L}]{3,32})/u);
    const asksTech = /(техвед|тех\s*вед|техническ[а-я]*\s+ведущ[ийаяое]|техведит)/u.test(normalizedQuestion);
    const asksLeader = /(ведущий|ведет|ведёт|ведущая|ведущие)/u.test(normalizedQuestion);
    const asksMissingTech = asksTech && /(?:нет|без|пуст|не\s+указан|не\s+назначен|свободн)/u.test(normalizedQuestion);
    const isMissingScheduleValue = (value) => {
      const text = compact(value || "");
      return !text || /^(нет|не указан|не указано|н\/д|свободно|свободна|свободны)$/iu.test(text);
    };
    const hasTimeOrDateCue = targets.length || asksMissingTech || /(сегодня|завтра|послезавтра|вчера|следующ|какого\s+числа|в\s+какой\s+день|какой\s+день|на\s+этой|в\s+эту|в\s+следующ)/u.test(normalizedQuestion);
    if (!person && unknownPersonMatch && (asksTech || asksLeader)) {
      const name = formatMentionedName(unknownPersonMatch[1]);
      const roleLabel = asksTech ? "\u0442\u0435\u0445\u0432\u0435\u0434\u043e\u043c" : "\u0432\u0435\u0434\u0443\u0449\u0438\u043c";
      return `\u0412 \u0442\u0435\u043a\u0443\u0449\u0435\u043c \u0433\u0440\u0430\u0444\u0438\u043a\u0435 \u043d\u0435 \u043d\u0430\u0448\u0451\u043b ${name} ${roleLabel}.\n\n\u0418\u0441\u0442\u043e\u0447\u043d\u0438\u043a: \u0413\u0440\u0430\u0444\u0438\u043a \u0441\u043b\u0443\u0436\u0435\u043d\u0438\u0439.`;
    }
    if ((asksTech || asksLeader) && !hasTimeOrDateCue && !person) {
      return null;
    }
    if (!targets.length && !person && !hasTimeOrDateCue) {
      return null;
    }
    const scoredRows = [];
    for (const current of rows.slice(1)) {
      let score = 0;
      const rowDateText = compact(current[idx.date] || "");
      const rowDateKey = parseDateKey(rowDateText) || norm(rowDateText);
      const rowLeader = compact(current[idx.leader] || "");
      const rowTech = compact(current[idx.tech] || "");
      const rowDay = compact(current[idx.day] || "");
      const rowTheme = compact(current[idx.theme] || "");
      const rowText = norm([rowDateText, rowDay, rowTheme, rowLeader, rowTech].filter(Boolean).join(" "));

      if (targets.length) {
        let matchedTarget = false;
        for (const target of targets) {
          if (target && rowDateKey && dateKeyMatches(rowDateKey, target)) {
            score += 60;
            matchedTarget = true;
            break;
          }
        }
        if (!matchedTarget) continue;
      }

      if (person) {
        const personKey = norm(person);
        if (asksTech && norm(rowTech).includes(personKey)) score += 50;
        if (asksLeader && norm(rowLeader).includes(personKey)) score += 50;
        if (!asksTech && !asksLeader && (norm(rowLeader).includes(personKey) || norm(rowTech).includes(personKey))) score += 35;
      }

      if (
        hasNormalizedWord(normalizedQuestion, "\u0441\u0435\u0433\u043e\u0434\u043d\u044f")
        || hasNormalizedWord(normalizedQuestion, "\u0437\u0430\u0432\u0442\u0440\u0430")
        || hasNormalizedWord(normalizedQuestion, "\u043f\u043e\u0441\u043b\u0435\u0437\u0430\u0432\u0442\u0440\u0430")
        || hasNormalizedWord(normalizedQuestion, "\u0432\u0447\u0435\u0440\u0430")
      ) {
        score += rowDateKey ? 5 : 0;
      }
      if (rowDay && normalizedQuestion.includes(norm(rowDay))) score += 8;
      if (/тема/.test(normalizedQuestion) && rowTheme) score += 10;
      if (asksLeader && rowLeader) score += 8;
      if (asksTech && rowTech) score += 8;
      if (asksMissingTech && isMissingScheduleValue(rowTech)) score += 70;

      if (score > 0) {
        scoredRows.push({ row: current, score });
      }
    }
    if (!scoredRows.length) {
      if (targets.length) {
        return "\u0412 \u044d\u0442\u043e\u0442 \u0434\u0435\u043d\u044c \u0432 \u0440\u0430\u0441\u043f\u0438\u0441\u0430\u043d\u0438\u0438 \u043d\u0435\u0442 \u0441\u043e\u0431\u0440\u0430\u043d\u0438\u044f.";
      }
      return null;
    }

    const formatValue = (value, missing = "нет") => {
      const text = compact(value || "");
      if (!text || /^(нет|не указан|не указано|н\/д)$/iu.test(text)) return missing;
      return text;
    };

    const formatRow = (row) => {
      const parts = [];
      if (idx.date >= 0) parts.push(`Дата: ${formatValue(row[idx.date], "")}`);
      if (idx.day >= 0) parts.push(`День недели: ${formatValue(row[idx.day])}`);
      if (idx.theme >= 0) parts.push(`Тема собрания: ${formatValue(row[idx.theme])}`);
      if (idx.leader >= 0) parts.push(`Ведущий: ${formatValue(row[idx.leader])}`);
      if (idx.tech >= 0) parts.push(`Техвед: ${formatValue(row[idx.tech])}`);
      return parts.join("\n");
    };

    const byDate = (a, b) => {
      const left = parseDateValue(a[idx.date]);
      const right = parseDateValue(b[idx.date]);
      if (left && right) return left - right;
      return 0;
    };

    const matchedRows = (() => {
      if (asksMissingTech) {
        return rows.slice(1).filter((row) => isMissingScheduleValue(row[idx.tech])).sort(byDate);
      }
      if (!person || targets.length) {
        return [scoredRows.sort((a, b) => b.score - a.score)[0].row];
      }
      const personKey = norm(person);
      const matches = rows.slice(1).filter((row) => {
        const rowLeader = norm(row[idx.leader] || "");
        const rowTech = norm(row[idx.tech] || "");
        if (asksTech) return rowTech.includes(personKey);
        if (asksLeader) return rowLeader.includes(personKey);
        return rowLeader.includes(personKey) || rowTech.includes(personKey);
      });
      return matches.sort(byDate);
    })();

    if (!matchedRows.length) return null;
    const visibleRows = matchedRows.slice(0, 8);
    const tail = matchedRows.length > visibleRows.length ? `\n\nЕщё найдено: ${matchedRows.length - visibleRows.length}.` : "";
    return `${visibleRows.map(formatRow).join("\n\n")}${tail}\n\nИсточник: График служений.`;
  }

  function snippet(text, question) {
    const clean = compact(text);
    if (clean.length <= 560) return clean;
    const normalized = norm(clean);
    let bestIndex = 0;
    let bestLength = -1;
    for (const token of tokenSet(question)) {
      const index = normalized.indexOf(token);
      if (index !== -1 && token.length > bestLength) {
        bestIndex = index;
        bestLength = token.length;
      }
    }
    return clean.slice(Math.max(0, bestIndex - 140), Math.min(clean.length, bestIndex + 420)).trim();
  }

  function scoreChunk(chunk, question) {
    let points = 0;
    const text = norm(`${chunk.source} ${chunk.section} ${chunk.text}`);
    for (const token of tokenSet(question)) {
      if (text.includes(token)) {
        points += token.length >= 6 ? 5 : 2;
      }
    }
    points += scoreChunkBonus(chunk.source, question);
    return points;
  }

  async function aiAnswer(env, snapshot, question, restrained) {
    if (!env?.AI?.run || !snapshot?.chunks?.length) return null;
    const ranked = snapshot.chunks
      .map((chunk) => ({ chunk, score: scoreChunk(chunk, question) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
    if (!ranked.length) return null;
    const context = ranked.map((entry, index) => [
      `Фрагмент ${index + 1}`,
      `Документ: ${entry.chunk.source}`,
      `Раздел: ${entry.chunk.section}`,
      snippet(entry.chunk.text, question)
    ].join("\n")).join("\n\n");
    const response = await env.AI.run("@cf/meta/llama-3.1-8b-instruct-fast", {
      messages: [
        { role: "system", content: sysPrompt(restrained) },
        {
          role: "user",
          content: [
            `Вопрос: ${question}`,
            "",
            "Фрагменты документов:",
            context,
            "",
            "Ответь коротко и без фантазий. Если ответа нет, так и скажи."
          ].join("\n")
        }
      ],
      max_tokens: restrained ? 140 : 180,
      temperature: 0.7
    });
    const text = sanitizeOutgoingText(String(response?.response || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean).join("\n"));
    const source = [...new Set(ranked.map((entry) => canonicalSourceLabel(entry.chunk.source, "FAQ")))].join(", ");
    return text ? `${text}\n\nИсточник: ${source}.` : null;
  }

  async function buildSnapshot(env) {
    const token = await accessToken(env);
    if (!token) return null;
    const ids = getGoogleSourceIds(env);
    const [faqSheet, scheduleSheet, rotationSheet] = await Promise.all([
      ids.faq ? loadSheet(token, ids.faq, "faq") : null,
      ids.schedule ? loadSheet(token, ids.schedule, "schedule") : null,
      ids.rotation ? loadSheet(token, ids.rotation, "rotation") : null
    ]);

    const faqEntries = faqEntriesFromRows(faqSheet?.rows || []);
    const chunks = [];

    for (const entry of faqEntries) {
      chunks.push({
        source: "FAQ",
        section: canonicalSourceLabel(entry.source || faqSheet?.sheetTitle || "FAQ", "FAQ"),
        text: sanitizeOutgoingText(`${entry.question}\n${entry.answer}${entry.tags ? `\n${entry.tags}` : ""}`),
        id: `faq-${slug(entry.question)}`
      });
    }

    if (scheduleSheet?.rows?.length) {
      const headerRow = headers(scheduleSheet.rows);
      for (const row of scheduleSheet.rows.slice(1)) {
        chunks.push({
          source: "График служений",
          section: canonicalSourceLabel(scheduleSheet.sheetTitle, "График служений"),
          text: sanitizeOutgoingText(rowText("График служений", headerRow, row)),
          id: `schedule-${slug(row.join("-"))}`
        });
      }
    }

    if (rotationSheet?.rows?.length) {
      const headerRow = headers(rotationSheet.rows);
      for (const row of rotationSheet.rows.slice(1)) {
        chunks.push({
          source: "Список служащих/ротация",
          section: canonicalSourceLabel(rotationSheet.sheetTitle, "Список служащих/ротация"),
          text: sanitizeOutgoingText(rowText("Список служащих/ротация", headerRow, row)),
          id: `rotation-${slug(row.join("-"))}`
        });
      }
    }

    return {
      faq: faqSheet,
      faqEntries,
      schedule: scheduleSheet,
      rotation: rotationSheet,
      chunks
    };
  }

  async function getSnapshot(env) {
    const ids = getGoogleSourceIds(env);
    const key = `${ids.faq}|${ids.schedule}|${ids.rotation}`;
    if (snapshotCache && snapshotCache.key === key && Date.now() - snapshotCacheAt < CACHE_TTL) {
      return snapshotCache.value;
    }
    const snapshot = await buildSnapshot(env).catch(() => null);
    if (!snapshot) return null;
    snapshotCache = { key, value: snapshot };
    snapshotCacheAt = Date.now();
    return snapshot;
  }

  function answerFixedMeetingQuestion(question) {
    const text = norm(question);
    const isWhenCue = /(когда|во\s*сколько|на\s*когда|какое\s+время|к\s+которому\s+времени)/i.test(text);
    const asksTodayMeeting = /(?:сегодня|сейчас)\s+(?:есть|будет|проходит|ид[её]т)\s*(?:собрание|группа)|(?:будет|есть|проходит|ид[её]т)\s+(?:сегодня|сейчас)\s*(?:собрание|группа)|(?:собрание|группа)\s+(?:сегодня|сейчас)\s*$/i.test(text);
    const isWorkingMeeting = (isWhenCue || asksTodayMeeting) && /(рабочее собрание|рабочее|рабочка|рабочк|\bрс\b)/i.test(text);
    const isGeneralMeeting = !isWorkingMeeting && (isWhenCue || asksTodayMeeting) && /(собрание|собрания|группа)/i.test(text);
    if (questionLooksLikeScheduleRow(text) && !isGeneralMeeting && !isWorkingMeeting) return null;

    if (isWorkingMeeting) {
      const todayParts = moscowNow();
      const current = new Date(Date.UTC(todayParts.year, todayParts.month - 1, todayParts.day));
      const thisMonthLastSaturday = lastSaturdayOfMonth(current.getUTCFullYear(), current.getUTCMonth());
      const nextMonthIndex = (current.getUTCMonth() + 1) % 12;
      const nextMonthYear = current.getUTCMonth() === 11 ? current.getUTCFullYear() + 1 : current.getUTCFullYear();
      const nextMonthLastSaturday = lastSaturdayOfMonth(nextMonthYear, nextMonthIndex);
      const target = current <= thisMonthLastSaturday ? thisMonthLastSaturday : nextMonthLastSaturday;
      return {
        answer: sanitizeOutgoingText(`Следующее рабочее собрание состоится ${formatMoscowDate(target)}, в 18:00 по мск. За 5-10 минут в чат выложат ссылку на Zoom. Приходи, будем рады видеть!`),
        source: "Фиксированное правило группы"
      };
    }

    if (isGeneralMeeting) {
      const todayParts = moscowNow();
      const today = new Date(Date.UTC(todayParts.year, todayParts.month - 1, todayParts.day));
      if (isRegularMeetingDate(today)) {
        return {
          answer: sanitizeOutgoingText("\u0421\u043e\u0431\u0440\u0430\u043d\u0438\u0435 \u0441\u0435\u0433\u043e\u0434\u043d\u044f, \u0432 21:30 \u043f\u043e \u043c\u0441\u043a. \u0417\u0430 5-10 \u043c\u0438\u043d\u0443\u0442 \u0432 \u0447\u0430\u0442 \u0432\u044b\u043b\u043e\u0436\u0430\u0442 \u0441\u0441\u044b\u043b\u043a\u0443 \u043d\u0430 Zoom. \u041f\u0440\u0438\u0445\u043e\u0434\u0438, \u0431\u0443\u0434\u0435\u043c \u0440\u0430\u0434\u044b \u0432\u0438\u0434\u0435\u0442\u044c!"),
          source: "\u0424\u0438\u043a\u0441\u0438\u0440\u043e\u0432\u0430\u043d\u043d\u043e\u0435 \u0440\u0430\u0441\u043f\u0438\u0441\u0430\u043d\u0438\u0435 \u0433\u0440\u0443\u043f\u043f\u044b"
        };
      }
      return {
        answer: sanitizeOutgoingText("\u0421\u0435\u0433\u043e\u0434\u043d\u044f \u0443 \u043d\u0430\u0441 \u043d\u0435\u0442 \u0441\u043e\u0431\u0440\u0430\u043d\u0438\u044f. \u041d\u0430\u0448\u0435 \u0440\u0430\u0441\u043f\u0438\u0441\u0430\u043d\u0438\u0435: \u043f\u043e\u043d\u0435\u0434\u0435\u043b\u044c\u043d\u0438\u043a, \u0432\u0442\u043e\u0440\u043d\u0438\u043a, \u0447\u0435\u0442\u0432\u0435\u0440\u0433, \u043f\u044f\u0442\u043d\u0438\u0446\u0430, \u0432\u043e\u0441\u043a\u0440\u0435\u0441\u0435\u043d\u0438\u0435 \u0432 21:30 \u043f\u043e \u043c\u0441\u043a. \u0417\u0430 5-10 \u043c\u0438\u043d\u0443\u0442 \u0432 \u0447\u0430\u0442 \u0432\u044b\u043b\u043e\u0436\u0430\u0442 \u0441\u0441\u044b\u043b\u043a\u0443 \u043d\u0430 Zoom. \u041f\u0440\u0438\u0445\u043e\u0434\u0438, \u0431\u0443\u0434\u0435\u043c \u0440\u0430\u0434\u044b \u0432\u0438\u0434\u0435\u0442\u044c!"),
        source: "\u0424\u0438\u043a\u0441\u0438\u0440\u043e\u0432\u0430\u043d\u043d\u043e\u0435 \u0440\u0430\u0441\u043f\u0438\u0441\u0430\u043d\u0438\u0435 \u0433\u0440\u0443\u043f\u043f\u044b"
      };
    }

    return null;
  }

  async function findKnowledgeAnswer(env, question, { restrained = false } = {}) {
    const result = await findKnowledgeAnswerDetailed(env, question, { restrained });
    return result.answer;
  }

  async function findKnowledgeAnswerDetailed(env, question, { restrained = false } = {}) {
    const cleaned = compact(question);
    if (!cleaned) {
      return { answer: null, searchFailed: false, reason: "empty" };
    }

    const fixedMeeting = answerFixedMeetingQuestion(cleaned);
    if (fixedMeeting?.answer) {
      return { answer: fixedMeeting.answer, searchFailed: false, reason: "fixed" };
    }

    const fixedGroupKnowledge = answerFixedGroupKnowledge(cleaned);
    if (fixedGroupKnowledge?.answer) {
      return { answer: fixedGroupKnowledge.answer, searchFailed: false, reason: "fixed_group" };
    }

    const route = classifyKnowledgeQuestion(cleaned);
    if (route === "blockedProgram") {
      return { answer: PROGRAM_BLOCKED_ANSWER, searchFailed: false, reason: "blocked_program" };
    }
    if (route === "none") {
      return { answer: null, searchFailed: false, reason: "not_group_question" };
    }

    const snapshot = await getSnapshot(env);
    if (!snapshot) {
      return { answer: null, searchFailed: true, reason: "snapshot_unavailable" };
    }

    let answer = null;

    if (route === "schedule") {
      answer = scheduleAnswer(snapshot, cleaned);
      return { answer, searchFailed: false, reason: answer ? "schedule" : "not_found" };
    }

    if (route === "rotation") {
      answer = rotationAnswer(snapshot, cleaned);
      return { answer, searchFailed: false, reason: answer ? "rotation" : "not_found" };
    }

    if (route === "faq") {
      answer = faqAnswer(snapshot, cleaned);
      return { answer, searchFailed: false, reason: answer ? "faq" : "not_found" };
    }

    return { answer: null, searchFailed: false, reason: "not_found" };
  }

  async function answerKnowledgeQuestion(env, question, { restrained = false } = {}) {
    const cleaned = compact(question);
    if (!cleaned) {
      return "Нафаня ворчит: вопрос-то сформулируй, а не маши руками в темноте.";
    }

    const fixedMeeting = answerFixedMeetingQuestion(cleaned);
    if (fixedMeeting?.answer) {
      return fixedMeeting.answer;
    }

    const fixedGroupKnowledge = answerFixedGroupKnowledge(cleaned);
    if (fixedGroupKnowledge?.answer) {
      return fixedGroupKnowledge.answer;
    }

    const answer = await findKnowledgeAnswer(env, cleaned, { restrained });
    return answer || GENERIC_FALLBACK;
  }

  return {
    answerFixedMeetingQuestion,
    getSnapshot,
    findKnowledgeAnswerDetailed,
    findKnowledgeAnswer,
    answerKnowledgeQuestion
  };
}
