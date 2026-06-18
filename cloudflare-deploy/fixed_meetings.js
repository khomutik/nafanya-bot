function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\u0451/g, "\u0435")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function lastSaturdayOfMonth(year, monthIndex) {
  const date = new Date(Date.UTC(year, monthIndex + 1, 0));
  while (date.getUTCDay() !== 6) {
    date.setUTCDate(date.getUTCDate() - 1);
  }
  return date;
}

function formatMoscowDate(date) {
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = date.getUTCFullYear();
  return `${dd}.${mm}.${yyyy}`;
}

function isRegularMeetingDate(date) {
  const start = new Date(Date.UTC(2026, 5, 1));
  if (!(date instanceof Date) || Number.isNaN(date.getTime()) || date < start) return false;
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

export function answerFixedMeetingQuestion(question) {
  const text = normalizeText(question);
  if (
    /(\u0432\u0435\u0434\u0443\u0449|\u0432\u0435\u0434\u0435\u0442|\u0432\u0435\u0434\u0451\u0442|\u0442\u0435\u0445\u0432\u0435\u0434|\u0442\u0435\u0445\s*\u0432\u0435\u0434|\u0442\u0435\u0445\u043d\u0438\u0447\u0435\u0441\u043a|\u0442\u0435\u043c\u0430|\u0434\u0430\u0442\u0430|\u0434\u0435\u043d\u044c \u043d\u0435\u0434\u0435\u043b\u0438)/iu.test(text)
    || ((/\d{1,2}[./]\d{1,2}|\d{1,2}\s+[\u0430-\u044f]+|\u0441\u043b\u0435\u0434\u0443\u044e\u0449/iu.test(text)) && /\u0441\u043e\u0431\u0440\u0430\u043d/iu.test(text))
  ) {
    return null;
  }
  const hasWorkingMeetingMarker = /(\u0440\u0430\u0431\u043e\u0447\u0435\u0435 \u0441\u043e\u0431\u0440\u0430\u043d\u0438\u0435|\u0440\u0430\u0431\u043e\u0447\u043a\u0430|(^|\s)\u0440\u0441($|\s))/i.test(text);
  const hasWorkingMeetingQuestion = /(\u043a\u043e\u0433\u0434\u0430|\u0432\u043e \u0441\u043a\u043e\u043b\u044c\u043a\u043e|\u0431\u0443\u0434\u0435\u0442|\u0430 \u0431\u0443\u0434\u0435\u0442|\u0435\u0441\u0442\u044c|\u0441\u043e\u0441\u0442\u043e\u0438\u0442\u0441\u044f|\u043a\u0430\u043a\u043e\u0435 \u0432\u0440\u0435\u043c\u044f|\u0441\u0435\u0433\u043e\u0434\u043d\u044f|\u0441\u043b\u0435\u0434\u0443\u044e\u0449\u0435\u0435|\u0431\u043b\u0438\u0436\u0430\u0439\u0448\u0435\u0435)/i.test(text);
  const isWorkingMeeting = hasWorkingMeetingMarker && hasWorkingMeetingQuestion;
  const isGeneralMeeting = /(\u0441\u043e\u0431\u0440\u0430\u043d\u0438\u0435|\u0441\u043e\u0431\u0440\u0430\u043d\u0438\u044f)/i.test(text) && /(\u043a\u043e\u0433\u0434\u0430|\u0432\u043e \u0441\u043a\u043e\u043b\u044c\u043a\u043e|\u0431\u0443\u0434\u0435\u0442|\u0430 \u0431\u0443\u0434\u0435\u0442|\u0435\u0441\u0442\u044c|\u0441\u043e\u0441\u0442\u043e\u0438\u0442\u0441\u044f|\u043a\u0430\u043a\u043e\u0435 \u0432\u0440\u0435\u043c\u044f|\u0441\u0435\u0433\u043e\u0434\u043d\u044f)/i.test(text);

  if (isWorkingMeeting) {
    const now = new Date(Date.now() + 3 * 60 * 60 * 1000);
    const thisMonthLastSaturday = lastSaturdayOfMonth(now.getUTCFullYear(), now.getUTCMonth());
    const nextMonthIndex = (now.getUTCMonth() + 1) % 12;
    const nextMonthYear = now.getUTCMonth() === 11 ? now.getUTCFullYear() + 1 : now.getUTCFullYear();
    const nextMonthLastSaturday = lastSaturdayOfMonth(nextMonthYear, nextMonthIndex);
    const target = now <= thisMonthLastSaturday ? thisMonthLastSaturday : nextMonthLastSaturday;
    return {
      answer: `\u0421\u043b\u0435\u0434\u0443\u044e\u0449\u0435\u0435 \u0440\u0430\u0431\u043e\u0447\u0435\u0435 \u0441\u043e\u0431\u0440\u0430\u043d\u0438\u0435 \u0441\u043e\u0441\u0442\u043e\u0438\u0442\u0441\u044f ${formatMoscowDate(target)}, \u0432 18:00 \u043f\u043e \u043c\u0441\u043a. \u0417\u0430 5-10 \u043c\u0438\u043d\u0443\u0442 \u0432 \u0447\u0430\u0442 \u0432\u044b\u043b\u043e\u0436\u0430\u0442 \u0441\u0441\u044b\u043b\u043a\u0443 \u043d\u0430 Zoom. \u041f\u0440\u0438\u0445\u043e\u0434\u0438, \u0431\u0443\u0434\u0435\u043c \u0440\u0430\u0434\u044b \u0432\u0438\u0434\u0435\u0442\u044c!`,
      source: "\u0424\u0438\u043a\u0441\u0438\u0440\u043e\u0432\u0430\u043d\u043d\u043e\u0435 \u043f\u0440\u0430\u0432\u0438\u043b\u043e \u0433\u0440\u0443\u043f\u043f\u044b"
    };
  }

  if (isGeneralMeeting) {
    const now = new Date(Date.now() + 3 * 60 * 60 * 1000);
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const scheduleText = "\u0421 01.06.2026 \u0441\u043e\u0431\u0440\u0430\u043d\u0438\u044f \u0438\u0434\u0443\u0442 \u043f\u043e \u043f\u043e\u043d\u0435\u0434\u0435\u043b\u044c\u043d\u0438\u043a\u0430\u043c, \u0432\u0442\u043e\u0440\u043d\u0438\u043a\u0430\u043c, \u0447\u0435\u0442\u0432\u0435\u0440\u0433\u0430\u043c, \u043f\u044f\u0442\u043d\u0438\u0446\u0430\u043c \u0438 \u0432\u043e\u0441\u043a\u0440\u0435\u0441\u0435\u043d\u044c\u044f\u043c \u0432 21:30 \u043f\u043e \u041c\u043e\u0441\u043a\u0432\u0435 (UTC+3).";
    if (isRegularMeetingDate(today)) {
      return {
        answer: `\u0421\u0435\u0433\u043e\u0434\u043d\u044f \u0441\u043e\u0431\u0440\u0430\u043d\u0438\u0435 \u0432 21:30 \u043f\u043e \u041c\u043e\u0441\u043a\u0432\u0435 (UTC+3).\n\n${scheduleText}`,
        source: "\u0424\u0438\u043a\u0441\u0438\u0440\u043e\u0432\u0430\u043d\u043d\u043e\u0435 \u0440\u0430\u0441\u043f\u0438\u0441\u0430\u043d\u0438\u0435 \u0433\u0440\u0443\u043f\u043f\u044b"
      };
    }
    const nextMeeting = nextRegularMeetingDate(today);
    return {
      answer: `\u0421\u0435\u0433\u043e\u0434\u043d\u044f \u0441\u043e\u0431\u0440\u0430\u043d\u0438\u044f \u043d\u0435\u0442. \u0411\u043b\u0438\u0436\u0430\u0439\u0448\u0435\u0435: ${formatMoscowDate(nextMeeting)}, ${weekdayRu(nextMeeting)}, \u0432 21:30 \u043f\u043e \u041c\u043e\u0441\u043a\u0432\u0435 (UTC+3).\n\n${scheduleText}`,
      source: "\u0424\u0438\u043a\u0441\u0438\u0440\u043e\u0432\u0430\u043d\u043d\u043e\u0435 \u0440\u0430\u0441\u043f\u0438\u0441\u0430\u043d\u0438\u0435 \u0433\u0440\u0443\u043f\u043f\u044b"
    };
  }

  return null;
}
