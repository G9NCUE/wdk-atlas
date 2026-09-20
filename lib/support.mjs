// Whether we answer the people who turn up.
//
// The first thing a developer learns about a project is whether anyone is home. This is the
// one support figure that is a rate rather than a level: the open-issue count falls when we
// fix things and equally when we close them unfixed, which is why it is not the headline.
//
// Shared by the dashboard tile and the key result so the two cannot quote different numbers
// from the same data, and pure so Node can test it.

/**
 * How issues opened inside the window were answered.
 *
 * `perRepo` is { repo: { "YYYY-MM-DD": [hoursToFirstReply, ...] } }, where a negative entry
 * means nobody has replied yet. An unanswered issue is only counted against us once the
 * deadline has passed; before that it is pending, because an issue opened this morning has
 * not failed a seven-day promise.
 */
export function responseStats(perRepo, { withinHours = 168, from, now = Date.now(), repos = null } = {}) {
  let answered = 0, missed = 0, pending = 0;
  const wanted = repos ? new Set(repos) : null;
  for (const [repo, byDay] of Object.entries(perRepo || {})) {
    if (wanted && !wanted.has(repo)) continue;
    for (const [day, hours] of Object.entries(byDay || {})) {
      if (from && day < from) continue;
      for (const h of Array.isArray(hours) ? hours : []) {
        if (typeof h !== "number" || !Number.isFinite(h)) continue;
        if (h >= 0 && h <= withinHours) answered += 1;
        else if (h >= 0) missed += 1;
        else if (now - Date.parse(`${day}T23:59:59Z`) > withinHours * 36e5) missed += 1;
        else pending += 1;
      }
    }
  }
  const total = answered + missed;
  return { answered, missed, pending, total, pct: total ? Math.round((100 * answered) / total) : null };
}
