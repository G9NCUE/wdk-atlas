// src/model.mjs is what the pages ask about atlas.yaml. It could not be tested while it lived
// inside app.js, which ran the whole site on import; these are the rules a published page rests
// on: what counts as late, how progress is averaged, which way a relation points.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createModel, countByStatus, isLate, itemProgress, quarterLabel, quarterOrder, repoNameOf, isStableVersion, progressOf } from "../src/model.mjs";

const atlas = {
  audit: { org: "acme" }, // not the default, so reading it is what makes the third-party test pass
  modules: [
    { id: "wdk", name: "@tetherto/wdk", publisher: "acme", status: "shipped", repo: "https://github.com/acme/wdk", relations: [{ type: "requires", target: "wdk-wallet" }, { type: "requires", target: "ghost" }] },
    { id: "wdk-wallet", name: "@tetherto/wdk-wallet", publisher: "acme", status: "shipped", chains: ["BTC", "EVM"] },
    { id: "third", publisher: "tetherto", status: "shipped", private: true }, // the default org, which here is somebody else
  ],
  northStars: [{ id: "kit", title: "Kit" }],
  roadmap: [
    { id: "child", parent: "parent", label: "Child", status: "wip", modules: ["wdk"] },
    { id: "parent", label: "Parent", status: "planned", modules: [{ id: "wdk", status: "done", progress: 100 }] },
    { id: "elsewhere", label: "Elsewhere", status: "done", modules: ["wdk-wallet"] },
  ],
};
const model = createModel({ atlas });

test("late means its quarter has passed and it is not done, and nothing else", () => {
  assert.equal(isLate({ status: "wip", quarter: "2020Q1" }), true);
  assert.equal(isLate({ status: "done", quarter: "2020Q1" }), false, "done is never late");
  assert.equal(isLate({ status: "planned", quarter: "2099Q4" }), false);
  assert.equal(isLate({ status: "planned", quarter: "backlog" }), false, "the backlog has no date to miss");
  assert.equal(isLate({ status: "planned", quarter: "" }), false, "an empty quarter sorts before every real one and is still not a date");
});

test("a tally counts each status once, no status as planned, and late beside them", () => {
  assert.deepEqual(countByStatus([{ status: "done", quarter: "2020Q1" }, { status: "wip", quarter: "2020Q1" }, { quarter: "2099Q4" }, {}]), { done: 1, wip: 1, planned: 2, late: 1 });
  assert.deepEqual(countByStatus([]), { done: 0, wip: 0, planned: 0, late: 0 });
});

test("progress is a number someone set, or the average of the modules', and never a default", () => {
  assert.equal(itemProgress({ progress: 40, modules: [{ id: "a", progress: 100 }] }), 40);
  assert.equal(itemProgress({ modules: [{ id: "a", progress: 100 }, { id: "b", progress: 50 }, "c"] }), 75);
  assert.equal(itemProgress({ modules: ["a", "b"] }), null);
  assert.equal(itemProgress({ progress: 140 }), 100, "held inside 0 to 100");
  assert.equal(progressOf({ progress: "nonsense" }), null);
  assert.equal(progressOf({ progress: -5 }), 0);
  assert.equal(progressOf({ progress: 250 }), 100);
});

test("quarters read as people say them and sort with the backlog last", () => {
  assert.equal(quarterLabel("2026Q3"), "Q3 2026");
  assert.equal(quarterLabel("backlog"), "Backlog");
  assert.equal(quarterLabel(undefined), "Backlog");
  // No quarter at all sorts with the backlog. Sorting the names themselves happens to put
  // "backlog" last, so only the missing one shows whether quarterOrder did anything.
  assert.deepEqual([undefined, "2027Q1", "2026Q4"].sort((a, b) => quarterOrder(a).localeCompare(quarterOrder(b))), ["2026Q4", "2027Q1", undefined]);
  assert.equal(quarterOrder(undefined), quarterOrder("backlog"));
});

test("a repo name comes off a GitHub address whatever trails it", () => {
  assert.equal(repoNameOf({ repo: "https://github.com/tetherto/wdk-wallet-btc" }), "wdk-wallet-btc");
  assert.equal(repoNameOf({ repo: "https://github.com/tetherto/wdk.git" }), "wdk");
  assert.equal(repoNameOf({ repo: "https://github.com/tetherto/wdk#readme" }), "wdk");
  assert.equal(repoNameOf({}), null);
});

test("stable means no pre-release suffix on the version", () => {
  assert.equal(isStableVersion("1.0.0"), true);
  for (const v of ["1.0.0-beta.18", "2.0.0-rc.1", "0.9.0-alpha", "3.1.0-next.4", "1.2.0-canary", "1.0.0-dev", "1.0.0-pre", ""]) assert.equal(isStableVersion(v), false, v);
});

test("relations point both ways and only at things that exist", () => {
  assert.deepEqual(model.relationsOf("wdk").requires, [{ id: "wdk-wallet", type: "requires" }], "the relation to a module that is not there is dropped");
  assert.deepEqual(model.relationsOf("wdk-wallet").requiredBy, [{ id: "wdk", type: "requires" }]);
  assert.equal(model.itemById("nope"), undefined);
});

test("a module's roadmap lists parents before children, with the module's own status where it has one", () => {
  const entries = model.roadmapFor("wdk");
  assert.deepEqual(entries.map((e) => e.id), ["parent", "child"]);
  assert.equal(entries[0].status, "done", "the status set on the module reference wins over the item's");
  assert.deepEqual(model.roadmapFor("third"), []);
});

test("third party means published by someone other than the org", () => {
  assert.equal(model.isEcosystem(atlas.modules[0]), false);
  assert.equal(model.isEcosystem(atlas.modules[2]), true);
  assert.deepEqual(model.chainsOf(atlas.modules[1]), ["BTC", "EVM"]);
  assert.deepEqual(model.chainsOf(atlas.modules[0]), []);
  assert.deepEqual(model.privateModules().map((m) => m.id), ["third"]);
});
