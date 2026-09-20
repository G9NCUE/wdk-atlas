// The registry decides what may be published, so a hole in it becomes a number on a public
// page with nothing behind it. These tests enforce the three-part test from the specification
// rather than the shape of the file: a decision is named, the number can move, and enough of
// the page is able to go down that a reader could tell a bad quarter from a good one.
import { test } from "node:test";
import assert from "node:assert/strict";
import { METRICS, REQUIRED, VERDICTS, DEMOTED, metricDef, mayShowChange } from "../lib/metrics-defs.mjs";

test("every entry carries every required field, filled in", () => {
  for (const m of METRICS) {
    for (const field of REQUIRED) {
      assert.ok(field in m, `${m.id || "?"} is missing ${field}`);
      const v = m[field];
      assert.ok(v !== null && v !== undefined && v !== "", `${m.id} has an empty ${field}`);
    }
  }
});

test("ids are unique and look like ids", () => {
  const seen = new Set();
  for (const m of METRICS) {
    assert.match(m.id, /^[a-z][a-z0-9-]*$/, `${m.id} is not a plain lower-case id`);
    assert.ok(!seen.has(m.id), `${m.id} appears twice`);
    seen.add(m.id);
  }
});

test("every entry names a decision, and names it in a sentence rather than a word", () => {
  for (const m of METRICS) {
    assert.equal(typeof m.decision, "string");
    // A decision of "adoption" or "growth" is a label, not a decision. Insist on a sentence.
    assert.ok(m.decision.trim().split(/\s+/).length >= 8, `${m.id}: the decision is too short to be one`);
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

test("every verdict is one we defined", () => {
  for (const m of METRICS) assert.ok(VERDICTS.includes(m.verdict), `${m.id} has verdict ${m.verdict}`);
});

test("canFall is a real boolean, and at least four numbers can fall", () => {
  for (const m of METRICS) assert.equal(typeof m.canFall, "boolean", `${m.id}: canFall is not a boolean`);
  const falling = METRICS.filter((m) => m.canFall);
  assert.ok(falling.length >= 4, `only ${falling.length} published numbers can go down`);
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

test("the demoted list is exactly the entries marked demote", () => {
  assert.deepEqual([...DEMOTED].sort(), METRICS.filter((m) => m.verdict === "demote").map((m) => m.id).sort());
  assert.ok(DEMOTED.includes("stars"), "stars failed all three parts of the test and must stay demoted");
});

test("entries are frozen, so a page cannot edit a definition at runtime", () => {
  assert.throws(() => { METRICS[0].definition = "something else"; }, TypeError);
});

test("every entry says which pages publish it", () => {
  const pages = new Set(["overview", "roadmap", "results", "dashboard", "map", "dev"]);
  for (const m of METRICS) {
    assert.ok(Array.isArray(m.pages) && m.pages.length, `${m.id} names no page`);
    for (const p of m.pages) assert.ok(pages.has(p), `${m.id} names an unknown page: ${p}`);
  }
});
