// The gates decide whether a number may be published, so a gate that miscounts is worse than
// no gate: it would report a pass over a page nobody had checked. These tests cover the three
// pieces of text handling the gates rely on, including the cases that would quietly inflate a
// count and turn a fail into a pass.
import { test } from "node:test";
import assert from "node:assert/strict";
import { callSites, referencedIds, balancedBlock, pillSites } from "../bin/check-metrics.mjs";

test("counts a call once per line and ignores the line that declares it", () => {
  const src = [
    "function statTile(label, value) {",
    '  statTile("a", 1),',
    '  statTile("b", 2),',
    "export function deltaPill(a, b) {",
    "  deltaPill(1, 2)",
  ].join("\n");
  assert.equal(callSites(src, "statTile"), 2);
  assert.equal(callSites(src, "deltaPill"), 1);
});

test("a name that is a prefix of another does not borrow its calls", () => {
  const src = 'chartCardHeading("x"), chartCard("y")';
  // chartCard( appears inside neither chartCardHeading( nor the other way round
  assert.equal(callSites(src, "chartCardHeading"), 1);
  assert.equal(callSites(src, "chartCard"), 1);
});

test("reads registry ids only through the helper, never from any quoted string", () => {
  const src = 'defFor("downloads"), "stars", defFor("dependents"), metricDef("not-this-one")';
  assert.deepEqual(referencedIds(src), ["downloads", "dependents"]);
});

test("an id with characters an id cannot have is not read", () => {
  assert.deepEqual(referencedIds('defFor("Downloads"), defFor("with space"), defFor("ok-2")'), ["ok-2"]);
});

test("takes a balanced block, not everything up to the first closing bracket", () => {
  const src = 'const tiles = el("div", { class: "tiles" }, statTile(fmt(a, b), c), other());\nconst next = 1;';
  const block = balancedBlock(src, 'el("div", { class: "tiles" }');
  assert.ok(block.includes("statTile"));
  assert.ok(block.endsWith(")"));
  assert.ok(!block.includes("const next"), "ran past the end of the call");
});

test("a block that never closes is refused rather than guessed at", () => {
  assert.equal(balancedBlock('el("div", { class: "tiles" }, statTile(', 'el("div", { class: "tiles" }'), null);
});

test("a marker that is not there yields nothing", () => {
  assert.equal(balancedBlock("nothing here", "missing("), null);
});

test("a change indicator counts once per line, and only when it names its metric", () => {
  const src = [
    "function trendPill(id, pts) {",
    '  return deltaPill(id, now, prev, {});',
    '  trendPill("downloads", dl),',
    "  trendPill(someVariable, dl),",
    '  deltaPill("open-issues", a, b),',
  ].join("\n");
  const { total, named, ids } = pillSites(src);
  assert.equal(total, 4, "the declaration line is not a call site");
  assert.equal(named, 3, "a call passing an unknown variable is not named");
  assert.deepEqual(ids, ["downloads", "open-issues"]);
});

test("the helper's own forwarding call counts as named", () => {
  const { named, total } = pillSites("  return deltaPill(id, last, base, {});");
  assert.equal(total, 1);
  assert.equal(named, 1);
});
