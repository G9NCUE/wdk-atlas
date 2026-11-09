// The pull request series once came from an organisation-wide search that GitHub cuts at 1,000
// results, which silently dropped everything older than about eighteen days. These cases are the
// ones that would let a short list pass for a complete one.
import { test } from "node:test";
import assert from "node:assert/strict";
import { pullsSince } from "../bin/lib/pulls.mjs";

const pr = (n, updated, extra = {}) => ({ number: n, updated_at: `${updated}T10:00:00Z`, created_at: `${updated}T09:00:00Z`, merged_at: null, user: { login: `u${n}` }, author_association: "CONTRIBUTOR", ...extra });

// A fake API: `lists` maps a repository to its pull requests, newest update first, served 100 a page.
const fake = (lists) => {
  const calls = [];
  const get = async (path) => {
    calls.push(path);
    const [, repo] = path.match(/\/repos\/[^/]+\/([^/]+)\/pulls/);
    const page = Number(path.match(/[?&]page=(\d+)/)[1]);
    return (lists[repo] || []).slice((page - 1) * 100, page * 100);
  };
  return { get, calls };
};

test("reads past a hundred, page by page, and stops at the first page that reaches back past the window", async () => {
  const days = Array.from({ length: 250 }, (_, i) => new Date(Date.UTC(2026, 10, 9) - i * 36e5 * 6).toISOString().slice(0, 10));
  const { get, calls } = fake({ wdk: days.map((d, i) => pr(i, d)) });
  const out = await pullsSince(get, "tetherto", ["wdk"], "2026-10-20");
  assert.equal(out.length, days.filter((d) => d >= "2026-10-20").length);
  assert.equal(calls.length, 1, "the first page already reaches back past 2026-10-20");
  const all = await pullsSince(fake({ wdk: days.map((d, i) => pr(i, d)) }).get, "tetherto", ["wdk"], "2026-01-01");
  assert.equal(all.length, 250, "every page read when the window covers them all");
});

test("shapes each one like a search result, merge date included", async () => {
  const { get } = fake({ "wdk-wallet": [pr(7, "2026-11-02", { merged_at: "2026-11-03T08:00:00Z", author_association: "MEMBER" })] });
  const [one] = await pullsSince(get, "tetherto", ["wdk-wallet"], "2026-11-01");
  assert.equal(one.repository_url.split("/").pop(), "wdk-wallet");
  assert.equal(one.pull_request.merged_at, "2026-11-03T08:00:00Z");
  assert.equal(one.author_association, "MEMBER");
  assert.equal(one.user.login, "u7");
});

test("a repository with no list, or an empty one, is skipped rather than ending the run", async () => {
  const get = async (path) => (path.includes("/gone/") ? null : [pr(1, "2026-11-05")]);
  const out = await pullsSince(get, "tetherto", ["gone", "wdk"], "2026-11-01");
  assert.equal(out.length, 1);
});
