// Calendar quarters, as plain strings like "2026Q3", and the sums taken over them.
//
// This is the arithmetic behind the growth key result on the Key results page, so it decides a
// published number. It lives here, apart from the page, because the browser and Node can both
// import it and because it can be tested without a DOM.
//
// A quarter is "YYYYQn". A day is "YYYY-MM-DD". Ranges are half open: from is included, to is
// not, which is what makes summing consecutive quarters add up without double counting a day.

const QUARTER = /^(\d{4})Q([1-4])$/;
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

function parse(quarter) {
  const m = QUARTER.exec(String(quarter));
  if (!m) throw new TypeError(`not a quarter: ${JSON.stringify(quarter)}`);
  return { year: Number(m[1]), index: Number(m[2]) };
}

const format = (year, index) => `${year}Q${index}`;

/** The quarter a day falls in. quarterOf("2026-09-20") === "2026Q3". */
export function quarterOf(day) {
  const m = DAY.exec(String(day));
  if (!m) throw new TypeError(`not a day: ${JSON.stringify(day)}`);
  const month = Number(m[2]);
  if (month < 1 || month > 12) throw new RangeError(`not a month: ${day}`);
  return format(Number(m[1]), Math.floor((month - 1) / 3) + 1);
}

/** The half-open range of days in a quarter: [first day, first day of the next quarter). */
export function quarterBounds(quarter) {
  const { year, index } = parse(quarter);
  const firstMonth = (index - 1) * 3 + 1;
  const from = `${year}-${String(firstMonth).padStart(2, "0")}-01`;
  const to = index === 4 ? `${year + 1}-01-01` : `${year}-${String(firstMonth + 3).padStart(2, "0")}-01`;
  return [from, to];
}

/** The quarter after this one, rolling into January. */
export function nextQuarter(quarter) {
  const { year, index } = parse(quarter);
  return index === 4 ? format(year + 1, 1) : format(year, index + 1);
}

/** The quarter before this one, rolling back into the previous year. */
export function previousQuarter(quarter) {
  const { year, index } = parse(quarter);
  return index === 1 ? format(year - 1, 4) : format(year, index - 1);
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
