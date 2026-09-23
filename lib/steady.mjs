// Steady use: the figure to rank packages by when the question is "which is used most", as
// opposed to "which had the biggest week". No DOM, so the page and the tests share it.
//
// A total rewards age and a single week rewards a burst: one CI matrix or registry mirror can
// give any package a 261-download day. The median of the last twelve complete weeks does
// neither. It is the same window for every package, and one spike week cannot move it.

/** The ISO week a day belongs to, as "YYYY-Www". Weeks run Monday to Sunday. */
export function isoWeekOf(dayStr) {
  const d = new Date(dayStr + "T00:00:00Z");
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const wd = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - wd);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return `${t.getUTCFullYear()}-W${String(Math.ceil(((t - y0) / 864e5 + 1) / 7)).padStart(2, "0")}`;
}

/** The middle value; for an even count, the mean of the two middle values, rounded, so that a
 * reader who recomputes it from the export lands on the printed number. */
export function median(values) {
  if (!values.length) return null;
  const v = [...values].sort((a, b) => a - b), i = Math.floor(v.length / 2);
  return v.length % 2 ? v[i] : Math.round((v[i - 1] + v[i]) / 2);
}

/** How many complete weeks steady use is read over. */
export const STEADY_WEEKS = 12;

/**
 * The median weekly total over the last `weeks` complete ISO weeks of a daily series.
 *
 * A week is complete when all seven of its days fall between `since` and `lastDay`, both
 * inclusive: `since` is the day the package first existed (npm's created date, or the first
 * day the series has), `lastDay` the last day npm has reported. A week before the package
 * existed is not a quiet week, so it is not counted; a package younger than the window is
 * measured over the weeks it has, and `weeks` in the answer says how many that was.
 *
 * Returns { median, weeks }, with median null when no complete week exists.
 */
export function steadyWeekly(days, lastDay, since, weeks = STEADY_WEEKS) {
  const keys = Object.keys(days || {}).sort();
  const first = since && since > (keys[0] || since) ? since : keys[0] || since;
  if (!first || !lastDay || first > lastDay) return { median: null, weeks: 0 };
  const perWeek = new Map(); // key -> { days, total }
  for (let t = new Date(first + "T00:00:00Z"); ; t.setUTCDate(t.getUTCDate() + 1)) {
    const day = t.toISOString().slice(0, 10);
    if (day > lastDay) break;
    const key = isoWeekOf(day);
    const w = perWeek.get(key) || { days: 0, total: 0 };
    w.days += 1; w.total += days[day] || 0;
    perWeek.set(key, w);
  }
  const complete = [...perWeek].filter(([, w]) => w.days === 7).sort().slice(-weeks).map(([, w]) => w.total);
  return { median: median(complete), weeks: complete.length };
}
