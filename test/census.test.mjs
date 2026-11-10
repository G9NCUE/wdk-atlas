import { test } from "node:test";
import assert from "node:assert/strict";
import { profile, tally } from "../bin/lib/census.mjs";

const isWdk = (name) => /^@tetherto\/(wdk$|wdk-|pear-wrk-wdk$)/.test(name);
const repo = (createdAt, pushedAt, type, ...manifests) => ({ createdAt, pushedAt, owner: { __typename: type },
  ...Object.fromEntries(manifests.map((m, k) => [`m${k}`, m == null ? null : { text: typeof m === "string" ? m : JSON.stringify(m) }])) });

test("profile: a row per repository naming a WDK package in any dependency field; gone, mentions and other packages dropped", async () => {
  const hits = new Map([
    ["a/one", ["package.json", "app/package.json"]],
    ["b/gone", ["package.json"]],
    ["c/mention", ["package.json"]],
    ["d/broken", ["package.json", "x/package.json"]],
    ["e/other", ["package.json"]],
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
    };
  };
  const rows = await profile(graphql, hits, isWdk);
  assert.equal(queries.length, 1);
  assert.match(queries[0], /r0: repository\(owner: "a", name: "one"\)/);
  assert.match(queries[0], /m1: object\(expression: "HEAD:app\/package.json"\)/);
  assert.deepEqual(rows, [{ created: "2026-03-22", pushed: "2026-10-01", org: true, packages: ["@tetherto/wdk", "@tetherto/wdk-wallet-evm", "@tetherto/pear-wrk-wdk"] }]);
});

test("profile: forty repositories to a query, every alias read back", async () => {
  const hits = new Map(Array.from({ length: 81 }, (_, i) => [`o/r${i}`, ["package.json"]]));
  const sizes = [];
  const graphql = async (q) => {
    const aliases = [...q.matchAll(/(r\d+): repository/g)].map((m) => m[1]);
    sizes.push(aliases.length);
    return Object.fromEntries(aliases.map((a) => [a, repo("2026-01-01", "2026-01-02", "User", { dependencies: { "@tetherto/wdk": "1" } })]));
  };
  assert.equal((await profile(graphql, hits, isWdk)).length, 81);
  assert.deepEqual(sizes, [40, 40, 1]);
});

test("tally: counts by month started, still building needs a recent push after two weeks of work", () => {
  const row = (created, pushed, org, packages) => ({ created, pushed, org, packages });
  const c = tally([
    row("2026-03-22", "2026-10-20", true, ["@tetherto/wdk", "@tetherto/wdk-wallet-evm"]), // building
    row("2026-03-22", "2026-03-23", true, ["@tetherto/wdk-wallet-evm"]),                 // a weekend
    row("2026-07-01", "2026-07-30", false, ["@tetherto/wdk-wallet-solana"]),             // quiet since August
    row("2026-11-01", "2026-11-09", false, ["@tetherto/wdk-wallet-evm"]),                // too new to tell
  ], "2026-11-10");
  assert.deepEqual(c, {
    measured: "2026-11-10",
    projects: 4,
    building: 1,
    organisations: 1,
    cohorts: { "2026-03": [2, 1], "2026-07": [1, 0], "2026-11": [1, 0] },
    packages: { "@tetherto/wdk-wallet-evm": 3, "@tetherto/wdk": 1, "@tetherto/wdk-wallet-solana": 1 },
  });
  assert.deepEqual(Object.keys(c.packages), ["@tetherto/wdk-wallet-evm", "@tetherto/wdk", "@tetherto/wdk-wallet-solana"]);
});
