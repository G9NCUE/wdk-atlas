// The growth key result is computed from these four lines of calendar arithmetic, so a mistake
// here becomes a wrong number on a public page. The last test compares the rewritten previous
// quarter against the expression it replaced, which relied on subtracting a number from a
// string and was the piece most likely to be wrong.
import { test } from "node:test";
import assert from "node:assert/strict";
import { quarterOf, quarterBounds, nextQuarter, previousQuarter, sumSeries } from "../lib/quarters.mjs";

test("puts every month in the right quarter", () => {
  const expected = { "01": 1, "02": 1, "03": 1, "04": 2, "05": 2, "06": 2, "07": 3, "08": 3, "09": 3, "10": 4, "11": 4, "12": 4 };
  for (const [month, quarter] of Object.entries(expected)) {
    assert.equal(quarterOf(`2026-${month}-15`), `2026Q${quarter}`, `month ${month}`);
  }
});

test("reads the boundary days correctly", () => {
  assert.equal(quarterOf("2026-01-01"), "2026Q1");
  assert.equal(quarterOf("2026-03-31"), "2026Q1");
  assert.equal(quarterOf("2026-04-01"), "2026Q2");
  assert.equal(quarterOf("2026-12-31"), "2026Q4");
});

test("gives half-open bounds that meet without a gap or an overlap", () => {
  assert.deepEqual(quarterBounds("2026Q1"), ["2026-01-01", "2026-04-01"]);
  assert.deepEqual(quarterBounds("2026Q2"), ["2026-04-01", "2026-07-01"]);
  assert.deepEqual(quarterBounds("2026Q3"), ["2026-07-01", "2026-10-01"]);
  assert.deepEqual(quarterBounds("2026Q4"), ["2026-10-01", "2027-01-01"]);
  // Each quarter ends exactly where the next begins.
  for (const q of ["2026Q1", "2026Q2", "2026Q3", "2026Q4"]) {
    assert.equal(quarterBounds(q)[1], quarterBounds(nextQuarter(q))[0], `${q} into ${nextQuarter(q)}`);
  }
});

test("steps forward and back across the year boundary", () => {
  assert.equal(nextQuarter("2026Q4"), "2027Q1");
  assert.equal(previousQuarter("2026Q1"), "2025Q4");
  assert.equal(nextQuarter("2026Q1"), "2026Q2");
  assert.equal(previousQuarter("2026Q4"), "2026Q3");
});

test("stepping forward then back returns to the start", () => {
  for (const year of [2025, 2026, 2027]) {
    for (let i = 1; i <= 4; i++) {
      const q = `${year}Q${i}`;
      assert.equal(previousQuarter(nextQuarter(q)), q);
      assert.equal(nextQuarter(previousQuarter(q)), q);
    }
  }
});

test("matches the expression it replaced, which subtracted a number from a string", () => {
  const before = (q) => {
    const [from] = quarterBounds(q);
    return `${from.slice(0, 4) - (q.endsWith("Q1") ? 1 : 0)}Q${q.endsWith("Q1") ? 4 : Number(q.slice(5)) - 1}`;
  };
  for (const year of [2024, 2025, 2026, 2027]) {
    for (let i = 1; i <= 4; i++) {
      const q = `${year}Q${i}`;
      assert.equal(previousQuarter(q), before(q), q);
    }
  }
});

test("refuses input that is not a quarter or a day", () => {
  for (const bad of ["2026", "2026Q5", "2026Q0", "26Q1", "", null, undefined, "2026-Q1"]) {
    assert.throws(() => quarterBounds(bad), `quarterBounds(${JSON.stringify(bad)})`);
    assert.throws(() => nextQuarter(bad), `nextQuarter(${JSON.stringify(bad)})`);
    assert.throws(() => previousQuarter(bad), `previousQuarter(${JSON.stringify(bad)})`);
  }
  for (const bad of ["2026-13-01", "not-a-day", "", null, "2026/09/20"]) {
    assert.throws(() => quarterOf(bad), `quarterOf(${JSON.stringify(bad)})`);
  }
});

test("sums only the days inside the half-open range", () => {
  const series = {
    "wdk-wallet": { "2026-06-30": 5, "2026-07-01": 10, "2026-09-30": 20, "2026-10-01": 40 },
    "wdk-cli": { "2026-08-15": 7 },
  };
  const [from, to] = quarterBounds("2026Q3");
  // 10 + 20 + 7; the day before the quarter and the first day of the next are both left out.
  assert.equal(sumSeries(series, from, to), 37);
});

test("consecutive quarters add up to the whole without double counting", () => {
  const series = { r: { "2026-03-31": 1, "2026-04-01": 2, "2026-06-30": 4, "2026-07-01": 8 } };
  const q1 = sumSeries(series, ...quarterBounds("2026Q1"));
  const q2 = sumSeries(series, ...quarterBounds("2026Q2"));
  const q3 = sumSeries(series, ...quarterBounds("2026Q3"));
  assert.equal(q1, 1);
  assert.equal(q2, 6);
  assert.equal(q3, 8);
  assert.equal(q1 + q2 + q3, 15);
});

test("a gap in collection never becomes NaN on the page", () => {
  const [from, to] = quarterBounds("2026Q3");
  assert.equal(sumSeries(null, from, to), 0);
  assert.equal(sumSeries({}, from, to), 0);
  assert.equal(sumSeries({ r: null }, from, to), 0);
  assert.equal(sumSeries({ r: { "2026-08-01": null, "2026-08-02": "12", "2026-08-03": NaN, "2026-08-04": 3 } }, from, to), 3);
});
