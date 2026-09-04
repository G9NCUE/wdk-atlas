#!/usr/bin/env node
// bin/collect-metrics.mjs — public metrics for the WDK, per repo and per day, merged into data/metrics.json.
//
//   node bin/collect-metrics.mjs            collect today, write data/metrics.json
//   node bin/collect-metrics.mjs --dry      print the day's snapshot instead of writing
//
// Sources: the npm registry download API and the GitHub API (GITHUB_TOKEN or ATLAS_TOKEN for the rate limit).
// Public figures only. Scope: the org's public repos matching audit.repoPattern in atlas.yaml, and the npm
// package each publishes (from its package.json). The page sums whatever repos the reader selects.
//
// data/metrics.json, schema 3:
//   repos:     { name: { title, module, package } }
//   daily:     { downloads | prsOpened | prsMerged | externalPrsOpened | externalPrsMerged | issuesOpened | issuesClosed:
//                { repo: { "YYYY-MM-DD": n } } }         rewritten for the last 30 days on every run, older days kept
//              issueResponse: { repo: { "YYYY-MM-DD": [hours to first response, -1 if none yet] } }
//              externalAuthorsOpened | externalAuthorsMerged: { repo: { "YYYY-MM-DD": { login: n } } }
//   authors:   { login: association label last seen }
//   snapshots: { "YYYY-MM-DD": { stars, forks, openIssues, openPrs, contributors: { repo: … }, published: [repo…] } }
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "data", "metrics.json");
const TOKEN = process.env.ATLAS_TOKEN || process.env.GITHUB_TOKEN || "";
const DRY = process.argv.includes("--dry");

const ctx = {};
createContext(ctx);
runInContext(readFileSync(join(ROOT, "vendor/js-yaml.min.js"), "utf8"), ctx);
const atlas = ctx.jsyaml.load(readFileSync(join(ROOT, "atlas.yaml"), "utf8"));
const ORG = (atlas.audit && atlas.audit.org) || "tetherto";
const REPO_PATTERN = new RegExp((atlas.audit && atlas.audit.repoPattern) || "^(wdk$|wdk-|pear-wrk-wdk$|create-wdk-module$)");

const gh = async (path) => {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: { accept: "application/vnd.github+json", "user-agent": "wdk-atlas-metrics", ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}) },
  });
  if (res.status === 404) return null;
  if (res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0") throw new Error("GitHub rate limit exhausted; set GITHUB_TOKEN");
  if (!res.ok) throw new Error(`GitHub ${res.status} on ${path}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
};
const ghAll = async (path) => {
  const out = [];
  for (let page = 1; page <= 10; page += 1) {
    const body = await gh(`${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`);
    if (!body) break;
    const items = Array.isArray(body) ? body : body.items || [];
    out.push(...items);
    if (items.length < 100) break;
  }
  return out;
};
const npmJson = async (url) => {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`npm ${res.status} on ${url}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
};
const iso = (d) => d.toISOString().slice(0, 10);
const daysAgo = (n) => { const d = new Date(); d.setUTCDate(d.getUTCDate() - n); return d; };
const day = (t) => String(t || "").slice(0, 10);

try {
  const today = iso(new Date());
  const since30 = iso(daysAgo(30));

  // ---------------------------------------------------------------- repos in scope, and the module each maps to
  const byRepoName = new Map();
  for (const m of atlas.modules || []) {
    const r = /github\.com\/([^/]+)\/([^/#?]+)/.exec(m.repo || "");
    if (r && r[1].toLowerCase() === ORG.toLowerCase()) byRepoName.set(r[2].toLowerCase(), m);
  }
  const wdkRepos = (await ghAll(`/orgs/${ORG}/repos?type=public`)).filter((r) => REPO_PATTERN.test(r.name) && !r.archived && !r.fork);
  const repos = {};
  for (const r of wdkRepos) {
    const m = byRepoName.get(r.name.toLowerCase());
    let pkg = null;
    const c = await gh(`/repos/${ORG}/${r.name}/contents/package.json`);
    if (c && c.content) { try { const p = JSON.parse(Buffer.from(c.content, "base64").toString("utf8")); if (p.name && !p.private) pkg = p.name; } catch {} }
    repos[r.name] = { title: m ? m.title || m.id : r.name, module: m ? m.id : null, section: m ? m.section : null, package: pkg };
  }

  // ---------------------------------------------------------------- npm: daily downloads per package, published versions
  const downloads = {};
  const published = [];
  for (const [name, r] of Object.entries(repos)) {
    if (!r.package) continue;
    const range = await npmJson(`https://api.npmjs.org/downloads/range/last-month/${r.package}`);
    if (range && range.downloads) {
      const days = {};
      for (const d of range.downloads) days[d.day] = d.downloads;
      // npm lags a few days: drop trailing zero days, then the last reported day too, which is usually still filling.
      const sorted = Object.keys(days).sort().reverse();
      for (const d of sorted) { if (days[d] === 0) delete days[d]; else break; }
      const lastLeft = Object.keys(days).sort().pop(); if (lastLeft) delete days[lastLeft];
      downloads[name] = days;
    }
    const meta = await npmJson(`https://registry.npmjs.org/${r.package.replace("/", "%2F")}`);
    const v = meta && meta["dist-tags"] ? meta["dist-tags"].latest : null;
    if (v && v !== "0.0.0") { published.push(name); repos[name].version = v; }
  }

  // ---------------------------------------------------------------- GitHub snapshot: stars, forks, contributors, open counts
  const snap = { stars: {}, forks: {}, openIssues: {}, openPrs: {}, contributors: {}, published };
  for (const r of wdkRepos) {
    snap.stars[r.name] = r.stargazers_count;
    snap.forks[r.name] = r.forks_count;
    snap.contributors[r.name] = (await ghAll(`/repos/${ORG}/${r.name}/contributors?anon=0`)).map((u) => u.login).filter((l) => l && !l.endsWith("[bot]"));
  }
  const repoSet = new Set(wdkRepos.map((r) => r.name));
  const repoOf = (item) => (item.repository_url || "").split("/").pop();
  const inScope = (item) => repoSet.has(repoOf(item));
  const external = (item) => !["MEMBER", "OWNER", "COLLABORATOR"].includes(item.author_association) && !(item.user && item.user.login.endsWith("[bot]"));
  const search = async (q) => (await ghAll(`/search/issues?q=${encodeURIComponent(`org:${ORG} ${q}`)}`)).filter(inScope);
  for (const i of await search("is:issue is:open")) snap.openIssues[repoOf(i)] = (snap.openIssues[repoOf(i)] || 0) + 1;

  for (const i of await search("is:pr is:open")) snap.openPrs[repoOf(i)] = (snap.openPrs[repoOf(i)] || 0) + 1;

  // ---------------------------------------------------------------- GitHub daily series: last 30 days of PRs and issues, per repo
  const prsOpened30 = await search(`is:pr created:>=${since30}`);
  const prsMerged30 = await search(`is:pr is:merged merged:>=${since30}`);
  const issuesOpened30 = await search(`is:issue created:>=${since30}`);
  const issuesClosed30 = await search(`is:issue closed:>=${since30}`);
  // External authors per repo per day: { repo: { day: { login: count } } }, for opened and for merged.
  const byAuthor = (items, key) => {
    const out = {};
    for (const i of items) {
      if (!external(i)) continue;
      const d = day(key(i)); if (d < since30) continue;
      const r = repoOf(i), l = i.user.login;
      out[r] = out[r] || {}; out[r][d] = out[r][d] || {}; out[r][d][l] = (out[r][d][l] || 0) + 1;
    }
    return out;
  };
  const authorLabel = {};
  for (const i of [...prsOpened30, ...prsMerged30]) if (external(i)) authorLabel[i.user.login] = i.author_association;
  const bucket = (items, key, filter = () => true) => {
    const out = {};
    for (const i of items) {
      if (!filter(i)) continue;
      const d = day(key(i)); if (d < since30) continue;
      const r = repoOf(i);
      out[r] = out[r] || {}; out[r][d] = (out[r][d] || 0) + 1;
    }
    return out;
  };
  // Time to first response, in hours, for every issue opened in the window: the first comment by someone
  // other than the author (bots excluded), or the close if it was closed without a comment; -1 = none yet.
  const issueResponse = {};
  for (const i of issuesOpened30) {
    const r = repoOf(i), d = day(i.created_at);
    const author = i.user && i.user.login;
    const comments = i.comments > 0 ? await ghAll(`/repos/${ORG}/${r}/issues/${i.number}/comments`) : [];
    const first = comments.find((c) => c.user && c.user.login !== author && !c.user.login.endsWith("[bot]"));
    const at = first ? first.created_at : i.closed_at;
    const hours = at ? Math.round((new Date(at) - new Date(i.created_at)) / 36e5) : -1;
    issueResponse[r] = issueResponse[r] || {}; issueResponse[r][d] = issueResponse[r][d] || []; issueResponse[r][d].push(hours);
  }
  const daily = {
    downloads,
    issueResponse,
    externalAuthorsOpened: byAuthor(prsOpened30, (i) => i.created_at),
    externalAuthorsMerged: byAuthor(prsMerged30, (i) => i.pull_request && i.pull_request.merged_at),
    prsOpened: bucket(prsOpened30, (i) => i.created_at),
    prsMerged: bucket(prsMerged30, (i) => i.pull_request && i.pull_request.merged_at),
    externalPrsOpened: bucket(prsOpened30, (i) => i.created_at, external),
    externalPrsMerged: bucket(prsMerged30, (i) => i.pull_request && i.pull_request.merged_at, external),
    issuesOpened: bucket(issuesOpened30, (i) => i.created_at),
    issuesClosed: bucket(issuesClosed30, (i) => i.closed_at),
  };

  // ---------------------------------------------------------------- merge into the file
  let file = { schema: 3, org: ORG, repos: {}, daily: {}, snapshots: {} };
  if (existsSync(OUT)) { try { const f = JSON.parse(readFileSync(OUT, "utf8")); if (f.schema === 3) file = f; } catch {} }
  file.repos = repos;
  for (const [name, perRepo] of Object.entries(daily)) {
    file.daily[name] = file.daily[name] || {};
    const allRepos = new Set([...Object.keys(file.daily[name]), ...Object.keys(perRepo)]);
    if (name === "issueResponse" || name.startsWith("externalAuthors")) { for (const repo of allRepos) { const merged = { ...(file.daily[name][repo] || {}) }; for (const d of Object.keys(merged)) if (d >= since30) delete merged[d]; Object.assign(merged, perRepo[repo] || {}); if (Object.keys(merged).length) file.daily[name][repo] = merged; } continue; }
    for (const repo of allRepos) {
      const merged = { ...(file.daily[name][repo] || {}) };
      for (const d of Object.keys(merged)) if (d >= since30) delete merged[d];        // the window is rewritten
      Object.assign(merged, perRepo[repo] || {});
      if (Object.keys(merged).length) file.daily[name][repo] = Object.fromEntries(Object.entries(merged).sort());
    }
  }
  file.snapshots[today] = snap;
  file.authors = { ...(file.authors || {}), ...authorLabel }; // login -> GitHub's association label, last seen
  file.updated = new Date().toISOString();
  if (DRY) console.log(JSON.stringify({ repos: Object.keys(repos).length, snapshot: snap }, null, 2));
  else {
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, JSON.stringify(file) + "\n");
    const stars = Object.values(snap.stars).reduce((a, b) => a + b, 0);
    const people = new Set(Object.values(snap.contributors).flat()).size;
    console.log(`wrote data/metrics.json: ${today}, ${Object.keys(repos).length} repos, ${published.length} published packages, ${stars} stars, ${people} contributors, ${Object.keys(file.snapshots).length} snapshot(s)`);
  }
} catch (error) {
  console.error(`collect-metrics: ${error && error.message ? error.message : error}`);
  process.exit(1);
}
