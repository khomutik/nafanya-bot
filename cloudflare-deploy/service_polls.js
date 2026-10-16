const DAY_MS = 24 * 60 * 60 * 1000;
const FIRST_PUBLICATION_UTC = Date.UTC(2026, 9, 16);
const SERVICE_DAY_OFFSETS = [3, 4, 6, 7, 9, 10, 11, 13, 14, 16];
const WEEKDAY_LABELS = [
  "\u043f\u043d", "\u0432\u0442", "\u0447\u0442", "\u043f\u0442", "\u0432\u0441",
  "\u043f\u043d", "\u0432\u0442", "\u0447\u0442", "\u043f\u0442", "\u0432\u0441"
];
const POLL_ROLES = [
  { key: "leader", title: "\u0412\u0415\u0414\u0423\u0429\u0418\u0419" },
  { key: "tech", title: "\u0422\u0415\u0425\u0412\u0415\u0414" }
];

function utcDay(dateKey) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(dateKey)) return null;
  const [year, month, day] = dateKey.split("-").map(Number);
  const timestamp = Date.UTC(year, month - 1, day);
  return new Date(timestamp).toISOString().slice(0, 10) === dateKey ? timestamp : null;
}

function shortDate(timestamp) {
  const date = new Date(timestamp);
  return `${String(date.getUTCDate()).padStart(2, "0")}.${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function buildServicePollsForFriday(dateKey) {
  const publicationDay = utcDay(dateKey);
  if (publicationDay === null) return null;
  const daysSinceFirst = (publicationDay - FIRST_PUBLICATION_UTC) / DAY_MS;
  if (daysSinceFirst < 0 || daysSinceFirst % 14 !== 0) return null;

  const firstServiceDay = shortDate(publicationDay + 3 * DAY_MS);
  const lastServiceDay = shortDate(publicationDay + 16 * DAY_MS);
  const options = SERVICE_DAY_OFFSETS.map((offset, index) => ({
    text: `${WEEKDAY_LABELS[index]} ${shortDate(publicationDay + offset * DAY_MS)}`
  }));

  return POLL_ROLES.map(({ key, title }) => ({
    key,
    question: `${title} \u0441 ${firstServiceDay} \u043f\u043e ${lastServiceDay} (\u043c\u043e\u0436\u043d\u043e \u0432\u044b\u0431\u0440\u0430\u0442\u044c \u041d\u0415\u0421\u041a\u041e\u041b\u042c\u041a\u041e \u0434\u043d\u0435\u0439)`,
    options: options.map((option) => ({ ...option })),
    is_anonymous: false,
    type: "regular",
    allows_multiple_answers: true,
    allows_revoting: true,
    shuffle_options: false,
    allow_adding_options: false,
    hide_results_until_closes: false,
    is_closed: false
  }));
}
