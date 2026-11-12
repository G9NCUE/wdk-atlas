import { test } from "node:test";
import assert from "node:assert/strict";
import { listing, profile, tally } from "../bin/lib/census.mjs";

const isWdk = (name) => /^@tetherto\/(wdk$|wdk-|pear-wrk-wdk$)/.test(name);
const repo = (createdAt, pushedAt, type, ...manifests) => ({ createdAt, pushedAt, stargazerCount: 3, owner: { __typename: type },
  ...Object.fromEntries(manifests.map((m, k) => [`m${k}`, m == null ? null : { text: typeof m === "string" ? m : JSON.stringify(m) }])) });

test("profile: a row per repository naming a WDK package in any dependency field, modules marked; gone, mentions and other packages dropped", async () => {
  const hits = new Map([
    ["a/one", ["package.json", "app/package.json"]],
    ["b/gone", ["package.json"]],
    ["c/mention", ["package.json"]],
    ["d/broken", ["package.json", "x/package.json"]],
    ["e/other", ["package.json"]],
    ["f/wdk-wallet-x", ["package.json", "example/package.json"]],
    ["G/Listed", ["package.json"]],
    ["h/examples", ["package.json"]],
    ["i/unscoped", ["package.json"]],
  ]);
  const queries = [];
  const graphql = async (q) => {
    queries.push(q);
    return {
      r0: repo("2026-03-22T10:00:00Z", "2026-10-01T00:00:00Z", "Organization",
        { dependencies: { "@tetherto/wdk": "1", react: "18" } },
        { devDependencies: { "@tetherto/wdk-wallet-evm": "1" }, peerDependencies: { "@tetherto/pear-wrk-wdk": "*" } }),
      r1: null,
      r2: repo("2026-07-01T00:00:00Z", "2026-07-01T00:00:00Z", "User", { description: "built on @tetherto/wdk" }),
      r3: repo("2026-07-01T00:00:00Z", "2026-07-01T00:00:00Z", "User", "{ not json", null),
      r4: repo("2026-07-01T00:00:00Z", "2026-07-01T00:00:00Z", "User", { dependencies: { "@tetherto/not-wdk": "1" } }),
      r5: repo("2026-07-01T00:00:00Z", "2026-07-01T00:00:00Z", "Organization",
        { name: "@f/wdk-wallet-x", peerDependencies: { "@tetherto/wdk-wallet-evm": "1" } }, { name: "example", dependencies: { "@tetherto/wdk": "1" } }),
      r6: repo("2026-07-01T00:00:00Z", "2026-07-01T00:00:00Z", "Organization", { name: "listed", dependencies: { "@tetherto/wdk-wallet": "1" } }),
      r7: repo("2026-07-01T00:00:00Z", "2026-07-01T00:00:00Z", "Organization", { name: "wdk-wallet-example", dependencies: { "@tetherto/wdk-wallet-evm": "1" } }),
      r8: repo("2026-07-01T00:00:00Z", "2026-07-01T00:00:00Z", "Organization", { name: "wdk-protocol-y", peerDependencies: { "@tetherto/wdk-wallet": "1" } }),
    };
  };
  const rows = await profile(graphql, hits, isWdk, new Set(["g/listed"]));
  assert.equal(queries.length, 1);
  assert.match(queries[0], /r0: repository\(owner: "a", name: "one"\)/);
  assert.match(queries[0], /m1: object\(expression: "HEAD:app\/package.json"\)/);
  assert.deepEqual(rows.map((r) => [r.repo, r.module]), [["a/one", false], ["f/wdk-wallet-x", true], ["G/Listed", true], ["h/examples", false], ["i/unscoped", true]]);
  assert.deepEqual(rows[0], { repo: "a/one", created: "2026-03-22", pushed: "2026-10-01", stars: 3, org: true, packages: ["@tetherto/wdk", "@tetherto/wdk-wallet-evm", "@tetherto/pear-wrk-wdk"], module: false });
});

test("profile: forty repositories to a query, every alias read back", async () => {
  const hits = new Map(Array.from({ length: 81 }, (_, i) => [`o/r${i}`, ["package.json"]]));
  const sizes = [];
  const graphql = async (q) => {
    const aliases = [...q.matchAll(/(r\d+): repository/g)].map((m) => m[1]);
    sizes.push(aliases.length);
    return Object.fromEntries(aliases.map((a) => [a, repo("2026-01-01", "2026-01-02", "User", { dependencies: { "@tetherto/wdk": "1" } })]));
  };
  assert.equal((await profile(graphql, hits, isWdk, new Set())).length, 81);
  assert.deepEqual(sizes, [40, 40, 1]);
});

test("tally: modules only counted; by month started, still building needs a recent push after two weeks of work; nobody named", () => {
  const row = (repo, created, pushed, org, packages, module = false) => ({ repo, created, pushed, stars: 0, org, packages, module });
  const c = tally([
    row("o/a", "2026-03-22", "2026-10-20", true, ["@tetherto/wdk", "@tetherto/wdk-wallet-evm"]), // building
    row("o/b", "2026-03-22", "2026-03-23", true, ["@tetherto/wdk-wallet-evm"]),                 // a weekend
    row("o/c", "2026-07-01", "2026-07-30", false, ["@tetherto/wdk-wallet-solana"]),             // quiet since August
    row("o/d", "2026-11-01", "2026-11-09", false, ["@tetherto/wdk-wallet-evm"]),                // too new to tell
    row("o/e", "2026-08-01", "2026-11-02", false, ["@tetherto/wdk"]),                           // building, pushed later
    row("o/wdk-wallet-x", "2026-03-01", "2026-11-09", true, ["@tetherto/wdk-wallet"], true),   // a module, building
  ], "2026-11-10");
  assert.deepEqual(c, {
    measured: "2026-11-10",
    projects: 5,
    modules: 1,
    building: 2,
    organisations: 1,
    cohorts: { "2026-03": [2, 1], "2026-07": [1, 0], "2026-08": [1, 1], "2026-11": [1, 0] },
    packages: { "@tetherto/wdk-wallet-evm": 3, "@tetherto/wdk": 2, "@tetherto/wdk-wallet-solana": 1 },
  });
  assert.deepEqual(Object.keys(c.packages), ["@tetherto/wdk-wallet-evm", "@tetherto/wdk", "@tetherto/wdk-wallet-solana"]);
});

test("listing: everyone, modules too, most stars first, then the latest push, then the name; each marked still building or not", () => {
  const row = (repo, created, pushed, stars, module = false) => ({ repo, created, pushed, stars, org: false, packages: ["@tetherto/wdk"], module });
  const l = listing([
    row("o/quiet", "2026-01-01", "2026-02-01", 3),
    row("o/b", "2026-08-01", "2026-11-01", 3),
    row("o/a", "2026-08-01", "2026-11-01", 3),
    row("p/wdk-wallet-x", "2026-03-01", "2026-11-09", 40, true),
    row("o/new", "2026-11-05", "2026-11-09", 0),
  ], "2026-11-10");
  assert.equal(l.schema, 1);
  assert.equal(l.measured, "2026-11-10");
  assert.deepEqual(l.repos.map((r) => [r.repo, r.module, r.building]), [
    ["p/wdk-wallet-x", true, true],
    ["o/a", false, true],
    ["o/b", false, true],
    ["o/quiet", false, false],
    ["o/new", false, false],
  ]);
});
