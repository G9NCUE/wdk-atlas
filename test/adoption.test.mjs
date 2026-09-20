// These two calculations decide whether a published figure means demand or plumbing, so the
// cases below are the ones where getting it wrong would still look plausible on a chart.
import { test } from "node:test";
import assert from "node:assert/strict";
import { internalDeps, attribute, currency, latestShare, publishDates } from "../lib/adoption.mjs";

const KNOWN = new Set(["@tetherto/wdk-wallet", "@tetherto/wdk-failover-provider", "@tetherto/wdk"]);

test("keeps our own dependencies and drops everyone else's", () => {
  const deps = { bip39: "3.1.0", ethers: "6.17.0", "@tetherto/wdk-wallet": "1.0.0-beta.17", "@tetherto/wdk-failover-provider": "1.0.0-beta.2" };
  assert.deepEqual(internalDeps(deps, KNOWN), ["@tetherto/wdk-failover-provider", "@tetherto/wdk-wallet"]);
});

test("a package with no dependencies is not an error", () => {
  assert.deepEqual(internalDeps(undefined, KNOWN), []);
  assert.deepEqual(internalDeps({}, KNOWN), []);
});

test("splits the real shape of the WDK graph", () => {
  // wallet-evm and wallet-btc both pin failover-provider and wdk-wallet
  const totals = { "wallet-evm": 474, "wallet-btc": 240, "wdk-wallet": 782, failover: 307 };
  const edges = { "wallet-evm": ["wdk-wallet", "failover"], "wallet-btc": ["wdk-wallet", "failover"] };
  const out = attribute(totals, edges);
  assert.equal(out.failover.induced, 307, "induced is capped at what was actually downloaded");
  assert.equal(out.failover.direct, 0, "nothing is left over, so nothing was chosen");
  assert.equal(out["wallet-btc"].direct, 240, "nothing depends on it, so all of it is direct");
  assert.equal(out["wallet-evm"].induced, 0);
});

test("induced never exceeds the total, and direct never goes below zero", () => {
  const out = attribute({ dep: 10, a: 40, b: 50 }, { a: ["dep"], b: ["dep"] });
  assert.equal(out.dep.induced, 10);
  assert.equal(out.dep.direct, 0);
  assert.equal(out.dep.induced + out.dep.direct, out.dep.total, "the two parts add up to the whole");
});

test("the two parts always add up to the total", () => {
  const totals = { x: 100, y: 30, z: 7 };
  const out = attribute(totals, { y: ["x"], z: ["x"] });
  for (const [pkg, parts] of Object.entries(out)) {
    assert.equal(parts.direct + parts.induced, totals[pkg], pkg);
  }
});

test("a missing or unreadable total is skipped, not counted as zero", () => {
  const out = attribute({ a: 10, b: null, c: "many" }, { a: ["b"] });
  assert.deepEqual(Object.keys(out), ["a"]);
});

test("currency is the share landing on a release younger than the window", () => {
  const downloads = { "1.0.0-beta.19": 25, "1.0.0-beta.7": 75 };
  const dates = { "1.0.0-beta.19": "2026-09-15", "1.0.0-beta.7": "2026-01-10" };
  assert.equal(currency(downloads, dates, "2026-09-19", 30), 25);
});

test("a version published exactly on the cutoff still counts as current", () => {
  assert.equal(currency({ v: 10 }, { v: "2026-08-20" }, "2026-09-19", 30), 100);
  assert.equal(currency({ v: 10 }, { v: "2026-08-19" }, "2026-09-19", 30), 0);
});

test("no downloads means no answer, never zero per cent", () => {
  assert.equal(currency({}, {}, "2026-09-19"), null);
  assert.equal(currency({ v: 0 }, { v: "2026-09-18" }, "2026-09-19"), null);
  assert.equal(currency(null, null, "2026-09-19"), null);
});

test("a version with no publish date counts against us, not for us", () => {
  // Unknown provenance must not be read as recent, or currency flatters itself.
  assert.equal(currency({ a: 50, b: 50 }, { a: "2026-09-18" }, "2026-09-19", 30), 50);
});

test("a negative or unreadable count is ignored rather than poisoning the share", () => {
  assert.equal(currency({ a: 10, b: -5, c: "x" }, { a: "2026-09-18" }, "2026-09-19", 30), 100);
});

test("publish dates drop the registry's two non-versions and keep the day", () => {
  const out = publishDates({ created: "2025-01-01T00:00:00Z", modified: "2026-09-19T10:00:00Z", "1.0.0": "2026-02-03T09:08:07Z" });
  assert.deepEqual(out, { "1.0.0": "2026-02-03" });
});

test("the latest share isolates upgrading from our own release cadence", () => {
  const downloads = { "1.0.0-beta.19": 25, "1.0.0-beta.7": 75 };
  assert.equal(latestShare(downloads, "1.0.0-beta.19"), 25);
  // A package nobody has released for a month scores 0 on currency by construction, while the
  // latest share still reports that everyone is on what we ship.
  assert.equal(currency(downloads, { "1.0.0-beta.19": "2026-01-01", "1.0.0-beta.7": "2025-11-01" }, "2026-09-19", 30), 0);
  assert.equal(latestShare({ "1.0.0": 40 }, "1.0.0"), 100);
});

test("the latest share has no answer without a latest, or without downloads", () => {
  assert.equal(latestShare({ a: 5 }, null), null);
  assert.equal(latestShare({}, "1.0.0"), null);
});
