// Which packages get measured is decided here, so a wrong answer is a package that silently
// never appears, or one of ours counted as somebody else's.
import { test } from "node:test";
import assert from "node:assert/strict";
import { repoParts, measuredUnder, thirdPartyModules, packageNameOf, trimDownloads, rangeChunks } from "../bin/lib/packages.mjs";

test("splits a long range into pieces npm will answer, touching every day once", () => {
  const chunks = rangeChunks("2024-01-01", "2026-09-23");
  assert.deepEqual(chunks, [["2024-01-01", "2025-06-23"], ["2025-06-24", "2026-09-23"]]);
  assert.deepEqual(rangeChunks("2026-09-01", "2026-09-23"), [["2026-09-01", "2026-09-23"]]);
  assert.deepEqual(rangeChunks("2026-09-23", "2026-09-23"), [["2026-09-23", "2026-09-23"]]);
  assert.deepEqual(rangeChunks("2026-09-24", "2026-09-23"), []);
});

const hosted = { id: "wdk-protocol-fiat-moonpay", publisher: "tetherto", status: "shipped", repo: "https://github.com/tetherto/wdk-protocol-fiat-moonpay" };
const EXCEPTIONS = { "wdk-protocol-fiat-moonpay": "MoonPay" };

test("an org-hosted repo named in the exception list is measured under the partner, and the module itself is left as written", () => {
  assert.equal(measuredUnder(hosted, "tetherto"), null, "without the list it is ours");
  assert.equal(measuredUnder(hosted, "tetherto", EXCEPTIONS), "MoonPay");
  const [m] = thirdPartyModules([hosted], "tetherto", EXCEPTIONS);
  assert.equal(m.publisher, "MoonPay");
  assert.equal(m.hostedByOrg, true);
  assert.equal(hosted.publisher, "tetherto", "the atlas entry must not be rewritten");
});

test("the exception list matches the exact repo name", () => {
  assert.equal(measuredUnder({ ...hosted, repo: "https://github.com/tetherto/wdk-protocol-fiat-moonpay-v2" }, "tetherto", EXCEPTIONS), null);
});

const ours = { id: "wdk-wallet-btc", publisher: "tetherto", status: "shipped", repo: "https://github.com/tetherto/wdk-wallet-btc" };
const theirs = { id: "wdk-wallet-rgb", publisher: "UTEXO", status: "shipped", repo: "https://github.com/UTEXO-Protocol/wdk-wallet-rgb" };
const planned = { id: "wdk-wallet-x", publisher: "Someone", status: "planned", repo: "https://github.com/someone/x" };
const noRepo = { id: "wdk-wallet-y", publisher: "Someone", status: "shipped" };
const named = { id: "wdk-wallet-cosmos", publisher: "SwapDK", status: "shipped", package: "@swapdk/wdk-wallet-cosmos" };

test("reads owner and name from a repository address", () => {
  assert.deepEqual(repoParts("https://github.com/UTEXO-Protocol/wdk-wallet-rgb"), { owner: "UTEXO-Protocol", name: "wdk-wallet-rgb" });
  assert.deepEqual(repoParts("https://github.com/org/repo.git"), { owner: "org", name: "repo" });
  assert.equal(repoParts("https://docs.example.com/guide"), null);
  assert.equal(repoParts(undefined), null);
});

test("a third-party module is shipped, published by someone else, and has somewhere to read a package from", () => {
  assert.deepEqual(thirdPartyModules([ours, theirs, planned, noRepo, named], "tetherto").map((m) => m.id), ["wdk-wallet-rgb", "wdk-wallet-cosmos"]);
});

test("the organisation's own modules are never third party, whatever the case of the name", () => {
  assert.deepEqual(thirdPartyModules([{ ...ours, publisher: "TetherTo" }], "tetherto"), []);
});

test("reads the package name from a public manifest and refuses a private or monorepo root", () => {
  assert.deepEqual(packageNameOf({ name: "@utexo/wdk-wallet-rgb", version: "2.0.3" }), { name: "@utexo/wdk-wallet-rgb", reason: null });
  assert.equal(packageNameOf({ name: "wdk-wallets-swapdk", private: true, workspaces: ["packages/*"] }).name, null);
  assert.match(packageNameOf({ name: "wdk-wallets-swapdk", private: true, workspaces: ["packages/*"] }).reason, /monorepo/);
  assert.match(packageNameOf({ name: "x", private: true }).reason, /private/);
  assert.match(packageNameOf({ version: "1.0.0" }).reason, /names no package/);
  assert.match(packageNameOf(null).reason, /no package\.json/);
});

test("drops npm's trailing zero days and the last day still filling", () => {
  const range = { downloads: [
    { day: "2026-09-01", downloads: 5 }, { day: "2026-09-02", downloads: 7 }, { day: "2026-09-03", downloads: 4 },
    { day: "2026-09-04", downloads: 0 }, { day: "2026-09-05", downloads: 0 },
  ] };
  assert.deepEqual(trimDownloads(range), { "2026-09-01": 5, "2026-09-02": 7 });
});

test("a zero inside the range is a real quiet day and stays", () => {
  const range = { downloads: [{ day: "2026-09-01", downloads: 0 }, { day: "2026-09-02", downloads: 3 }, { day: "2026-09-03", downloads: 1 }] };
  assert.deepEqual(trimDownloads(range), { "2026-09-01": 0, "2026-09-02": 3 });
});

test("an empty or missing range is an empty series, not a crash", () => {
  assert.deepEqual(trimDownloads(null), {});
  assert.deepEqual(trimDownloads({ downloads: [] }), {});
});
