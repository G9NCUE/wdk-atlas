// Calendar quarters, as plain strings like "2026Q3", and the sums taken over them.
//
// This is the arithmetic behind the growth key result on the Key results page, so it decides a
// published number. It lives here, apart from the page, because the browser and Node can both
// import it and because it can be tested without a DOM.
//
// A quarter is "YYYYQn". Ranges are half open: from is included, to is not, which is what makes
// summing consecutive periods add up without double counting a day.
//
// quarterOf, quarterBounds and previousQuarter lived here until 2026-09-20. They existed for the
// quarterGrowth key result, which was replaced by a rolling count, and afterwards nothing but
// their own tests called them.

const QUARTER = /^(\d{4})Q([1-4])$/;

function parse(quarter) {
  const m = QUARTER.exec(String(quarter));
  if (!m) throw new TypeError(`not a quarter: ${JSON.stringify(quarter)}`);
  return { year: Number(m[1]), index: Number(m[2]) };
}

const format = (year, index) => `${year}Q${index}`;

/** The quarter after this one, rolling into January. */
export function nextQuarter(quarter) {
  const { year, index } = parse(quarter);
  return index === 4 ? format(year + 1, 1) : format(year, index + 1);
}

/**
 * Total of a per-repo daily series over a half-open range of days.
 * Shaped { repo: { "YYYY-MM-DD": number } }. Missing or malformed entries count as nothing
 * rather than poisoning the sum, because a collector that skipped a day should not read as a
 * drop to zero and must never turn a published figure into NaN.
 */
export function sumSeries(perRepo, from, to) {
  let total = 0;
  for (const days of Object.values(perRepo || {})) {
    if (!days || typeof days !== "object") continue;
    for (const [day, value] of Object.entries(days)) {
      if (day < from || day >= to) continue;
      if (typeof value === "number" && Number.isFinite(value)) total += value;
    }
  }
  return total;
}

/**
 * Which quarters a roadmap link asks to show. `raw` is the ?quarters= value, a comma list of
 * quarters; `available` is the ordered list the timeline can draw. Unknown names are dropped
 * and the result keeps the timeline's order, so a link never changes what a quarter is called
 * or where it sits. Nothing valid means everything: an empty or malformed selection must not
 * blank the page.
 */
export function selectedQuarters(raw, available) {
  const wanted = new Set(String(raw || "").split(",").map((q) => q.trim()).filter((q) => QUARTER.test(q)));
  const picked = available.filter((q) => wanted.has(q));
  return picked.length ? picked : available.slice();
}
