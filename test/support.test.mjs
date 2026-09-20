// The trap here is counting an issue opened this morning as unanswered. It would make the
// figure fall every time somebody opens an issue, which is the opposite of what it measures.
import { test } from "node:test";
import assert from "node:assert/strict";
import { responseStats } from "../lib/support.mjs";

const NOW = Date.parse("2026-09-20T12:00:00Z");
const opts = (extra = {}) => ({ withinHours: 168, from: "2026-08-21", now: NOW, ...extra });

test("answers inside the window count for us, later ones against", () => {
  const s = responseStats({ r: { "2026-09-01": [2, 100, 168, 169, 400] } }, opts());
  assert.equal(s.answered, 3, "2, 100 and exactly 168 hours are inside the window");
  assert.equal(s.missed, 2);
  assert.equal(s.pct, 60);
});

test("an issue still inside its deadline is pending, not missed", () => {
  // opened yesterday, no reply yet: seven days have not passed
  const s = responseStats({ r: { "2026-09-19": [-1] } }, opts());
  assert.deepEqual([s.answered, s.missed, s.pending], [0, 0, 1]);
  assert.equal(s.pct, null, "no answer either way yet");
});

test("an issue past its deadline with no reply counts against us", () => {
  const s = responseStats({ r: { "2026-09-01": [-1] } }, opts());
  assert.deepEqual([s.answered, s.missed, s.pending], [0, 1, 0]);
  assert.equal(s.pct, 0);
});

test("days before the window are left out", () => {
  const s = responseStats({ r: { "2026-07-01": [2, 2, 2], "2026-09-01": [400] } }, opts());
  assert.equal(s.total, 1);
});

test("a repo selection narrows the count", () => {
  const data = { a: { "2026-09-01": [2] }, b: { "2026-09-01": [400] } };
  assert.equal(responseStats(data, opts()).pct, 50);
  assert.equal(responseStats(data, opts({ repos: ["a"] })).pct, 100);
  assert.equal(responseStats(data, opts({ repos: [] })).pct, null, "an empty selection has no answer");
});

test("no issues in the window is no answer, never zero per cent", () => {
  assert.equal(responseStats({}, opts()).pct, null);
  assert.equal(responseStats(null, opts()).pct, null);
  assert.equal(responseStats({ r: {} }, opts()).pct, null);
});

test("malformed entries are skipped rather than counted", () => {
  const s = responseStats({ r: { "2026-09-01": [2, null, "soon", NaN, undefined] } }, opts());
  assert.equal(s.total, 1);
  assert.equal(s.pct, 100);
});
