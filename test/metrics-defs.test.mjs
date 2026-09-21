// The registry decides what may be published, so a hole in it becomes a number on a public
// page with nothing behind it. These tests enforce the three-part test from the specification
// rather than the shape of the file: a decision is named, the number can move, and enough of
// the page is able to go down that a reader could tell a bad quarter from a good one.
import { test } from "node:test";
import assert from "node:assert/strict";
import { METRICS, DEMOTED, metricDef, mayShowChange } from "../lib/metrics-defs.mjs";

test("ids are unique and look like ids", () => {
  const seen = new Set();
  for (const m of METRICS) {
    assert.match(m.id, /^[a-z][a-z0-9-]*$/, `${m.id} is not a plain lower-case id`);
    assert.ok(!seen.has(m.id), `${m.id} appears twice`);
    seen.add(m.id);
  }
});

test("a decision that says the number changes nothing comes with a verdict that acts on it", () => {
  const passive = ["keep", "add"];
  for (const m of METRICS) {
    if (/^None\b/.test(m.decision.trim())) {
      assert.ok(!passive.includes(m.verdict), `${m.id} serves no decision but is marked ${m.verdict}`);
    }
  }
});

test("every verdict is one of the six, spelled out here rather than imported", () => {
  // The literal is the point: asserting against the module's own list would pass for any list.
  const allowed = ["keep", "redefine", "promote", "demote", "move", "add"];
  for (const m of METRICS) assert.ok(allowed.includes(m.verdict), `${m.id} has verdict ${m.verdict}`);
});

test("a number that cannot fall is never presented as a result", () => {
  for (const m of METRICS.filter((m) => !m.canFall)) {
    assert.ok(["demote", "redefine", "move"].includes(m.verdict), `${m.id} cannot fall yet is marked ${m.verdict}`);
  }
});

test("floors are a positive count or deliberately absent", () => {
  for (const m of METRICS) {
    if (m.floor === null) continue;
    assert.ok(Number.isInteger(m.floor) && m.floor > 0, `${m.id} has floor ${m.floor}`);
  }
});

test("a percentage change is refused below the floor and allowed at it", () => {
  assert.equal(mayShowChange("external-prs-merged", 9), false);
  assert.equal(mayShowChange("external-prs-merged", 10), true);
  assert.equal(mayShowChange("external-prs-merged", 2), false, "a +50% on a base of two is arithmetic, not information");
  assert.equal(mayShowChange("downloads", 1000), true);
});

test("a metric with no floor never shows a percentage change", () => {
  assert.equal(metricDef("stars").floor, null);
  assert.equal(mayShowChange("stars", 99999), false);
});

test("an unknown id is a fault, not a default", () => {
  assert.equal(metricDef("no-such-metric"), undefined);
  assert.equal(mayShowChange("no-such-metric", 1000), false);
});

test("stars stays demoted", () => {
  assert.ok(DEMOTED.includes("stars"), "stars failed all three parts of the test and must stay demoted");
});

test("entries are frozen, so a page cannot edit a definition at runtime", () => {
  assert.throws(() => { METRICS[0].definition = "something else"; }, TypeError);
});
