// Steady use and trend: the two figures behind "which packages are doing well", how much they
// are used and which way that is going. No DOM, so the page and the tests share it.
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

/** How busy the days either side of an all-zero day must be to call it unreported. */
export const GAP_FLOOR = 20;

/**
 * The days npm did not report, for { package: { day: count } }: every package reads 0 and the
 * days either side were busy. npm answers 0 for a day it has no figures for; it gave react 0 on
 * 14 October 2026. At launch, a handful a day, a zero is only a zero.
 */
export function npmGaps(perPackage, floor = GAP_FLOOR) {
  const totals = new Map();
  for (const days of Object.values(perPackage || {})) {
    for (const [d, n] of Object.entries(days || {})) totals.set(d, (totals.get(d) || 0) + (Number.isFinite(n) ? n : 0));
  }
  const days = [...totals].sort(([a], [b]) => (a < b ? -1 : 1));
  const gaps = [];
  for (let i = 0; i < days.length; i++) {
    if (days[i][1] > 0) continue;
    let j = i;
    while (j < days.length && days[j][1] === 0) j++;
    const before = i > 0 ? days[i - 1][1] : 0, after = j < days.length ? days[j][1] : 0;
    if (Math.min(before, after) >= floor) for (let k = i; k < j; k++) gaps.push(days[k][0]);
    i = j;
  }
  return gaps;
}

/**
 * Weekly totals of a daily series over its complete ISO weeks, oldest first.
 *
 * A week is complete when all seven of its days fall between `since` and `lastDay`, both
 * inclusive: `since` is the day the package first existed (npm's created date, or the first
 * day the series has), `lastDay` the last day npm has reported. A week before the package
 * existed is not a quiet week, so it is not counted. A week holding days in `gaps` is the days
 * npm did report, scaled to seven, as the charts estimate it.
 */
export function weeklyTotals(days, lastDay, since, gaps = []) {
  const keys = Object.keys(days || {}).sort();
  const first = since && since > (keys[0] || since) ? since : keys[0] || since;
  if (!first || !lastDay || first > lastDay) return [];
  const unreported = new Set(gaps);
  const perWeek = new Map(); // key -> { days, reported, total }
  for (let t = new Date(first + "T00:00:00Z"); ; t.setUTCDate(t.getUTCDate() + 1)) {
    const day = t.toISOString().slice(0, 10);
    if (day > lastDay) break;
    const key = isoWeekOf(day);
    const w = perWeek.get(key) || { days: 0, reported: 0, total: 0 };
    w.days += 1;
    if (!unreported.has(day)) { w.reported += 1; w.total += days[day] || 0; }
    perWeek.set(key, w);
  }
  return [...perWeek].filter(([, w]) => w.days === 7 && w.reported).sort().map(([, w]) => Math.round((w.total * 7) / w.reported));
}

/**
 * The median weekly total over the last `weeks` complete weeks. A package younger than the
 * window is measured over the weeks it has, and `weeks` in the answer says how many that was;
 * median is null when no complete week exists.
 */
export function steadyWeekly(days, lastDay, since, { weeks = STEADY_WEEKS, gaps = [] } = {}) {
  const complete = weeklyTotals(days, lastDay, since, gaps).slice(-weeks);
  return { median: median(complete), weeks: complete.length };
}

/** How the trend is read: the mean of the last `recent` complete weeks against the mean of
 * the `prior` before them. Fewer than recent + prior weeks and there is no trend yet. */
export const TREND_WEEKS = { recent: 4, prior: 8 };

/**
 * The trend of a daily series: { now, before, weeks }, now and before being weekly means and
 * null while the series is younger than the two windows together.
 */
export function trendWeekly(days, lastDay, since, { recent = TREND_WEEKS.recent, prior = TREND_WEEKS.prior, gaps = [] } = {}) {
  const totals = weeklyTotals(days, lastDay, since, gaps);
  if (totals.length < recent + prior) return { now: null, before: null, weeks: totals.length };
  const mean = (xs) => Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);
  return { now: mean(totals.slice(-recent)), before: mean(totals.slice(-recent - prior, -recent)), weeks: totals.length };
}
