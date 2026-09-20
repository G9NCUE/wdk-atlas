// This table is what stands between a reader and a source column that only links back to us,
// so the cases that matter are the ones where it should refuse: a measurement nobody has
// pointed anywhere, and a context too thin to build a real address from.
import { test } from "node:test";
import assert from "node:assert/strict";
import { originFor, uncovered, describe, metricsOf, PROBE } from "../lib/origins.mjs";

test("each readiness field goes somewhere public and specific", () => {
  const ctx = { org: "tetherto", repo: "wdk-wallet", pkg: "@tetherto/wdk-wallet" };
  assert.match(originFor({ kind: "share", field: "stable" }, ctx).href, /^https:\/\/registry\.npmjs\.org\//);
  assert.match(originFor({ kind: "share", field: "audits" }, ctx).href, /contents/);
  assert.match(originFor({ kind: "share", field: "ci" }, ctx).href, /actions\/runs/);
  assert.match(originFor({ kind: "average", field: "health" }, ctx).href, /community\/profile/);
  assert.match(originFor({ kind: "share", field: "signer" }, ctx).href, /search\?q=org%3Atetherto/);
});

test("every address is https or a relative path, never plain http", () => {
  for (const m of [{ kind: "share", field: "stable" }, { kind: "count", source: "privateRepos" }, { kind: "issueResponse" }, { kind: "quarterGrowth" }]) {
    const href = originFor(m, PROBE).href;
    assert.ok(/^https:\/\//.test(href), `${describe(m)} -> ${href}`);
  }
  assert.equal(originFor({ kind: "count", source: "thirdPartyModules" }, PROBE).href, "./atlas.yaml");
});

test("a field nobody has pointed anywhere returns null rather than a guess", () => {
  assert.equal(originFor({ kind: "share", field: "coverage" }, PROBE), null);
  assert.equal(originFor({ kind: "count", source: "newsletter" }, PROBE), null);
  assert.equal(originFor({ kind: "somethingNew" }, PROBE), null);
  assert.equal(originFor(null, PROBE), null);
  assert.equal(originFor({}, PROBE), null);
});

test("a context too thin to build a real address refuses instead of half building one", () => {
  assert.equal(originFor({ kind: "share", field: "stable" }, { org: "o", repo: "r" }), null, "no package name");
  assert.equal(originFor({ kind: "share", field: "ci" }, { org: "o" }), null, "no repo");
  assert.equal(originFor({ kind: "issueResponse" }, {}), null, "no org");
  assert.equal(originFor({ kind: "count", source: "examples" }, PROBE).href, PROBE.examplesUrl);
});

test("uncovered names what is missing and stays empty when nothing is", () => {
  assert.deepEqual(uncovered([{ kind: "share", field: "stable" }, { kind: "issueResponse" }]), []);
  assert.deepEqual(uncovered([{ kind: "share", field: "coverage" }, { kind: "count", source: "wishes" }]),
    ["share:coverage", "count:wishes"]);
});

test("metrics are read off the north stars, including none at all", () => {
  const stars = [{ keyResults: [{ metric: { kind: "share", field: "stable" } }, { label: "typed by hand" }, "a bare string"] }, {}];
  assert.deepEqual(metricsOf(stars), [{ kind: "share", field: "stable" }]);
  assert.deepEqual(metricsOf(null), []);
});
