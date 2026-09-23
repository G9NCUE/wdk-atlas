// The steady-use figure decides the order of the third-party table, so the cases here are the
// ones where a wrong answer would still look like a ranking: a burst week, a young package,
// a partial week at either end.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isoWeekOf, median, steadyWeekly } from "../lib/steady.mjs";

// Fourteen full ISO weeks, Monday 2026-06-01 to Sunday 2026-09-06, ten downloads a day.
const series = {};
for (let t = new Date("2026-06-01T00:00:00Z"); t <= new Date("2026-09-06T00:00:00Z"); t.setUTCDate(t.getUTCDate() + 1)) series[t.toISOString().slice(0, 10)] = 10;

test("ISO weeks start on Monday and the year boundary follows the Thursday rule", () => {
  assert.equal(isoWeekOf("2026-06-01"), "2026-W23");
  assert.equal(isoWeekOf("2026-06-07"), "2026-W23");
  assert.equal(isoWeekOf("2026-06-08"), "2026-W24");
  assert.equal(isoWeekOf("2026-01-01"), "2026-W01");
  assert.equal(isoWeekOf("2027-01-01"), "2026-W53");
});

test("median of an even count is the mean of the middle two, rounded", () => {
  assert.equal(median([1, 2, 3, 4]), 3);
  assert.equal(median([5, 1, 3]), 3);
  assert.equal(median([]), null);
});

test("twelve complete weeks of the same total give that total, whatever the burst", () => {
  const spiked = { ...series, "2026-08-19": 2610 }; // one Wednesday, two hundred and sixty times the usual
  assert.deepEqual(steadyWeekly(series, "2026-09-06", "2026-06-01"), { median: 70, weeks: 12 });
  assert.deepEqual(steadyWeekly(spiked, "2026-09-06", "2026-06-01"), { median: 70, weeks: 12 });
});

test("a partial week at either end is left out rather than counted short", () => {
  // Reported through Wednesday: the week of 2026-08-31 is incomplete and must not appear as 30.
  assert.deepEqual(steadyWeekly(series, "2026-09-02", "2026-06-01"), { median: 70, weeks: 12 });
  // Published on a Thursday: that first week has four days and is not a week.
  const r = steadyWeekly(series, "2026-09-06", "2026-07-02");
  assert.equal(r.weeks, 9, "2026-07-06 to 2026-09-06 is nine complete weeks");
  assert.equal(r.median, 70);
});

test("a package younger than the window is measured over the weeks it has, and says so", () => {
  const young = {};
  for (let t = new Date("2026-08-24T00:00:00Z"); t <= new Date("2026-09-06T00:00:00Z"); t.setUTCDate(t.getUTCDate() + 1)) young[t.toISOString().slice(0, 10)] = 3;
  assert.deepEqual(steadyWeekly(young, "2026-09-06", "2026-08-24"), { median: 21, weeks: 2 });
  assert.deepEqual(steadyWeekly(young, "2026-09-06", "2026-08-24", 1), { median: 21, weeks: 1 });
});

test("no complete week is null, not zero", () => {
  assert.deepEqual(steadyWeekly({ "2026-09-01": 5 }, "2026-09-03", "2026-09-01"), { median: null, weeks: 0 });
  assert.deepEqual(steadyWeekly({}, "2026-09-03", null), { median: null, weeks: 0 });
});

test("a quiet day inside a complete week counts as zero; the week stays and the median holds", () => {
  const gaps = { ...series }; delete gaps["2026-08-19"];
  assert.deepEqual(steadyWeekly(gaps, "2026-09-06", "2026-06-01"), { median: 70, weeks: 12 });
});
