// nextQuarter names the quarter after this one for the overview's "Next, Q4" heading, and
// sumSeries totals a per-repo daily series over a half-open range for the rolling key result.
// Ranges are spelled out as literals rather than built with the helper under test, so the
// assertions pin the contract instead of agreeing with whatever the code happens to do.
import { test } from "node:test";
import assert from "node:assert/strict";
import { nextQuarter, sumSeries } from "../lib/quarters.mjs";

test("steps forward, rolling into January", () => {
  assert.equal(nextQuarter("2026Q1"), "2026Q2");
  assert.equal(nextQuarter("2026Q3"), "2026Q4");
  assert.equal(nextQuarter("2026Q4"), "2027Q1");
});

test("refuses anything that is not a quarter", () => {
  for (const bad of ["2026", "2026Q5", "2026Q0", "26Q1", "", null, undefined, "2026-Q1", "2026q1"]) {
    assert.throws(() => nextQuarter(bad), `nextQuarter(${JSON.stringify(bad)})`);
  }
});

test("sums only the days inside the half-open range", () => {
  const series = {
    "wdk-wallet": { "2026-06-30": 5, "2026-07-01": 10, "2026-09-30": 20, "2026-10-01": 40 },
    "wdk-cli": { "2026-08-15": 7 },
  };
  // 10 + 20 + 7; the day before the range and the first day after it are both left out
  assert.equal(sumSeries(series, "2026-07-01", "2026-10-01"), 37);
});

test("consecutive ranges add up to the whole without double counting the join", () => {
  const series = { r: { "2026-03-31": 1, "2026-04-01": 2, "2026-06-30": 4, "2026-07-01": 8 } };
  const q1 = sumSeries(series, "2026-01-01", "2026-04-01");
  const q2 = sumSeries(series, "2026-04-01", "2026-07-01");
  const q3 = sumSeries(series, "2026-07-01", "2026-10-01");
  assert.deepEqual([q1, q2, q3], [1, 6, 8]);
  assert.equal(q1 + q2 + q3, 15, "the day on each boundary is counted once");
});

test("a gap in collection never becomes NaN on the page", () => {
  const range = ["2026-07-01", "2026-10-01"];
  assert.equal(sumSeries(null, ...range), 0);
  assert.equal(sumSeries({}, ...range), 0);
  assert.equal(sumSeries({ r: null }, ...range), 0);
  // a string, a null and a NaN are skipped; only the real number counts
  assert.equal(sumSeries({ r: { "2026-08-01": null, "2026-08-02": "12", "2026-08-03": NaN, "2026-08-04": 3 } }, ...range), 3);
});
