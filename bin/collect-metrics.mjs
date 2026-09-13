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
//   authors:   { login: association label last seen; MEMBER/OWNER/COLLABORATOR mark a teammate and stick }
//   snapshots: { "YYYY-MM-DD": { stars, forks, openIssues, openPrs, contributors: { repo: count }, published: [repo…],
//                ci: { repo: conclusion of the last completed run on the default branch },
//                health: { repo: GitHub community-profile percentage }, community: { repo: { readme, license, contributing, codeOfConduct } },
//                audits: { repo: true when an audit folder or file sits at the repo root },
//                signer: { repo: true when the code references ISigner }   (code search; absent when the token cannot search)
//                examples: number of example folders in the examples repo, dependents: repos outside the org that depend on a WDK package } }
//   contributors: { repo: [login…] }   current, kept once
//   owners: { repo: [handle…] }        from CODEOWNERS, current, kept once
//   releases: { repo: { "YYYY-MM-DD": version } }   npm publish dates inside the retention window, rewritten each run
//   atlasUpdated: last commit touching atlas.yaml, from git
//   since: first day the event series cover
// Pruning keeps the file small: snapshots stay daily for 90 days then thin to one a month; daily
// series are dropped after 400 days. The page fetches this file, so it must not grow without bound.
//
// Who is a teammate: GitHub's author_association only says MEMBER when the token can see the org's
// membership. The default Actions token cannot (memberships in this org are mostly private), so with it
// every teammate reads CONTRIBUTOR and lands in the external charts. Three sources, any one is enough:
// the org member list (when the token belongs to a member; set ATLAS_TOKEN), a MEMBER/OWNER/COLLABORATOR
// label kept in `authors` from an earlier run that could see, and `audit.team` in atlas.yaml.
//
// Stars, forks, contributors and open counts are snapshots, not history: GitHub's dated stargazer
// list is closed to us. Probed 2026-09-07 — an Actions token gets 403 "Resource not accessible by
// integration" on every repo, anonymous gets 401, and a personal token gets 404 on almost everything
// including torvalds/linux (two repos answer 200, unexplained). GraphQL reports stargazerCount but
// an empty stargazers connection. So these series can only grow forward, one point per run.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
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
// Scope: every public repo whose name matches the pattern — WDK's public open-source footprint.
// Deliberately NOT the drift check's `audit.ignoreRepos`: that list means "not a module drawn on the
// map" (the docs site, the websites, devops), which is a different question from "not part of what we
// publish". wdk-docs is the developer documentation behind docs.wdk.tether.io and belongs in the
// numbers. Private repos never appear here: the query below asks GitHub for public ones only.
const isBot = (login) => !login || login.endsWith("[bot]");
const EXAMPLES_REPO = (atlas.audit && atlas.audit.examplesRepo) || "wdk-examples";
const EXAMPLES_IGNORE = new Set((atlas.audit && atlas.audit.examplesIgnore) || ["shared"]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SNAPSHOT_DAILY_DAYS = 90;  // every snapshot for this long, then one per month
const SERIES_DAYS = 400;         // daily series kept this long (a year plus a margin)
// npm serves an arbitrary date range (up to 18 months per call), so downloads are fetched for the whole
// retention window every run rather than the trailing 30 days. One request per package, self-healing,
// and it backfills history the first time it runs.

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
  let file = { schema: 3, org: ORG, repos: {}, daily: {}, snapshots: {} };
  if (existsSync(OUT)) { try { const f = JSON.parse(readFileSync(OUT, "utf8")); if (f.schema === 3) file = f; } catch {} }

  // ---------------------------------------------------------------- repos in scope, and the module each maps to
  const byRepoName = new Map();
  for (const m of atlas.modules || []) {
    const r = /github\.com\/([^/]+)\/([^/#?]+)/.exec(m.repo || "");
    if (r && r[1].toLowerCase() === ORG.toLowerCase()) byRepoName.set(r[2].toLowerCase(), m);
  }
  // Public repos only: the workflow token cannot see private ones, and the dashboard publishes nothing private.
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
  const releases = {};
  for (const [name, r] of Object.entries(repos)) {
    if (!r.package) continue;
    const from = new Date(Date.now() - SERIES_DAYS * 864e5).toISOString().slice(0, 10);
    const range = await npmJson(`https://api.npmjs.org/downloads/range/${from}:${today}/${r.package}`);
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
    // Publish dates inside the retention window, for release markers on the charts.
    if (meta && meta.time) {
      const from = new Date(Date.now() - SERIES_DAYS * 864e5).toISOString().slice(0, 10);
      const dated = {};
      for (const [ver, t] of Object.entries(meta.time)) { if (ver === "created" || ver === "modified") continue; const d = day(t); if (d >= from) dated[d] = ver; }
      if (Object.keys(dated).length) releases[name] = Object.fromEntries(Object.entries(dated).sort());
    }
  }

  const repoSet = new Set(wdkRepos.map((r) => r.name));
  const repoSetHas = (name) => repoSet.has(name);

  // ---------------------------------------------------------------- GitHub snapshot: stars, forks, contributors, open counts
  const snap = { stars: {}, forks: {}, openIssues: {}, openPrs: {}, contributors: {}, published, ci: {}, health: {}, community: {}, audits: {} };
  const contributorsByRepo = {}; // logins, kept once (current), not per snapshot
  const ownersByRepo = {};       // CODEOWNERS handles, kept once (current)
  for (const r of wdkRepos) {
    snap.stars[r.name] = r.stargazers_count;
    snap.forks[r.name] = r.forks_count;
    contributorsByRepo[r.name] = (await ghAll(`/repos/${ORG}/${r.name}/contributors?anon=0`)).map((u) => u.login).filter((l) => !isBot(l));
    snap.contributors[r.name] = contributorsByRepo[r.name].length;
    // Key-result sources, all public: the last completed CI run on the default branch, GitHub's community
    // profile, an audit folder or file at the root, and CODEOWNERS for who owns the repo.
    const runs = await gh(`/repos/${ORG}/${r.name}/actions/runs?branch=${encodeURIComponent(r.default_branch || "main")}&status=completed&per_page=1`);
    snap.ci[r.name] = runs && runs.workflow_runs && runs.workflow_runs[0] ? runs.workflow_runs[0].conclusion : null;
    const profile = await gh(`/repos/${ORG}/${r.name}/community/profile`);
    if (profile) {
      snap.health[r.name] = profile.health_percentage;
      const f = profile.files || {};
      snap.community[r.name] = { readme: Boolean(f.readme), license: Boolean(f.license), contributing: Boolean(f.contributing), codeOfConduct: Boolean(f.code_of_conduct) };
    }
    const root = await gh(`/repos/${ORG}/${r.name}/contents`);
    snap.audits[r.name] = Array.isArray(root) && root.some((e) => /audit/i.test(e.name));
    for (const path of [".github/CODEOWNERS", "CODEOWNERS"]) {
      const c = await gh(`/repos/${ORG}/${r.name}/contents/${path}`);
      if (!c || !c.content) continue;
      const text = Buffer.from(c.content, "base64").toString("utf8");
      const handles = [...new Set(text.split("\n").filter((l) => l.trim() && !l.trim().startsWith("#")).flatMap((l) => l.split(/\s+/).slice(1)).filter((h) => h.startsWith("@")))];
      if (handles.length) ownersByRepo[r.name] = handles;
      break;
    }
  }
  // Examples: top-level folders of the examples repo, dot-folders and shared code excluded.
  if (repoSetHas(EXAMPLES_REPO)) {
    const root = await gh(`/repos/${ORG}/${EXAMPLES_REPO}/contents`);
    if (Array.isArray(root)) snap.examples = root.filter((e) => e.type === "dir" && !e.name.startsWith(".") && !EXAMPLES_IGNORE.has(e.name)).length;
  }
  // Code search needs a user token and allows ten calls a minute; skipped, not guessed, when unavailable.
  const codeSearch = async (q, pages = 10) => {
    const seen = new Set();
    for (let pageNo = 1; pageNo <= pages; pageNo += 1) {
      let body;
      try { body = await gh(`/search/code?q=${encodeURIComponent(q)}&per_page=100&page=${pageNo}`); } catch { return null; }
      if (!body || !Array.isArray(body.items)) return pageNo === 1 ? null : seen;
      for (const item of body.items) seen.add(item.repository.full_name);
      if (body.items.length < 100 || seen.size >= body.total_count) break;
      await sleep(6500);
    }
    return seen;
  };
  const signerRepos = await codeSearch(`ISigner org:${ORG}`);
  if (signerRepos) { snap.signer = {}; for (const r of wdkRepos) snap.signer[r.name] = signerRepos.has(`${ORG}/${r.name}`); }
  else console.error("collect-metrics: code search unavailable with this token; signer coverage not measured");
  await sleep(6500);
  const dependents = await codeSearch(`"@${ORG}/wdk" filename:package.json -org:${ORG}`);
  if (dependents) snap.dependents = dependents.size;
  const repoOf = (item) => (item.repository_url || "").split("/").pop();
  const inScope = (item) => repoSet.has(repoOf(item));
  // Teammates (see the header). The member list counts only when the token holder is an org member:
  // for anyone else GitHub quietly answers with the public members, which would look complete and is not.
  const INTERNAL = new Set(["MEMBER", "OWNER", "COLLABORATOR"]);
  const team = new Set((atlas.audit && atlas.audit.team) || []);
  let members = null;
  try {
    const viewer = await gh(`/user/memberships/orgs/${ORG}`);
    if (viewer && viewer.state === "active") members = new Set((await ghAll(`/orgs/${ORG}/members`)).map((u) => u.login));
  } catch { members = null; }
  const remembered = new Set(Object.entries(file.authors || {}).filter(([, label]) => INTERNAL.has(label)).map(([login]) => login));
  if (members) console.error(`collect-metrics: ${members.size} org members visible; teammate labels are refreshed`);
  else console.error(`collect-metrics: the token cannot list org members; ${remembered.size} teammates kept from earlier runs, ${team.size} from audit.team`);
  const isInternal = (login, association) => team.has(login) || INTERNAL.has(association) || (members ? members.has(login) : remembered.has(login));
  const external = (item) => Boolean(item.user && item.user.login) && !isBot(item.user.login) && !isInternal(item.user.login, item.author_association);
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
  // Every author's label, not only external ones, so a teammate seen once stays a teammate on runs that cannot see.
  const authorLabel = {};
  for (const i of [...prsOpened30, ...prsMerged30]) {
    const login = i.user && i.user.login;
    if (!login || isBot(login)) continue;
    authorLabel[login] = members && members.has(login) && !INTERNAL.has(i.author_association) ? "MEMBER" : i.author_association;
  }
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
  file.repos = repos;
  for (const [name, perRepo] of Object.entries(daily)) {
    // downloads come back for the whole retention window, so the fetch is authoritative and replaces
    if (name === "downloads") { file.daily.downloads = perRepo; continue; }
    file.daily[name] = file.daily[name] || {};
    const allRepos = new Set([...Object.keys(file.daily[name]), ...Object.keys(perRepo)]);
    for (const repo of allRepos) {
      const merged = { ...(file.daily[name][repo] || {}) };
      for (const d of Object.keys(merged)) if (d >= since30) delete merged[d];        // the window is rewritten
      Object.assign(merged, perRepo[repo] || {});
      if (Object.keys(merged).length) file.daily[name][repo] = Object.fromEntries(Object.entries(merged).sort());
      else delete file.daily[name][repo]; // a window with nothing left must not keep last run's entries
    }
  }
  file.snapshots[today] = snap;
  file.contributors = contributorsByRepo;
  file.owners = ownersByRepo;
  file.releases = releases;
  try { file.atlasUpdated = execSync("git log -1 --format=%cI -- atlas.yaml", { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString().trim() || file.atlasUpdated || null; } catch {}
  file.since = file.since || since30; // first day the event series cover

  // Keep the file small enough to fetch on every page view: daily snapshots for SNAPSHOT_DAILY_DAYS,
  // then the first snapshot of each month; daily series for SERIES_DAYS, enough for a year-on-year read.
  const cutoff = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
  const snapCut = cutoff(SNAPSHOT_DAILY_DAYS), seenMonth = new Set();
  for (const d of Object.keys(file.snapshots).sort()) {
    if (d >= snapCut) continue;
    const month = d.slice(0, 7);
    if (seenMonth.has(month)) delete file.snapshots[d];
    else seenMonth.add(month);
  }
  const seriesCut = cutoff(SERIES_DAYS);
  for (const perRepo of Object.values(file.daily)) {
    for (const [repo, days] of Object.entries(perRepo)) {
      for (const d of Object.keys(days)) if (d < seriesCut) delete days[d];
      if (!Object.keys(days).length) delete perRepo[repo];
    }
  }
  // login -> association label, last seen. A teammate label survives a run whose token cannot see membership.
  file.authors = file.authors || {};
  for (const [login, label] of Object.entries(authorLabel)) {
    const kept = file.authors[login];
    file.authors[login] = !members && INTERNAL.has(kept) && !INTERNAL.has(label) ? kept : label;
  }
  file.updated = new Date().toISOString();
  if (DRY) console.log(JSON.stringify({ repos: Object.keys(repos).length, snapshot: snap }, null, 2));
  else {
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, JSON.stringify(file) + "\n");
    const stars = Object.values(snap.stars).reduce((a, b) => a + b, 0);
    const people = new Set(Object.values(contributorsByRepo).flat()).size;
    console.log(`wrote data/metrics.json: ${today}, ${Object.keys(repos).length} repos, ${published.length} published packages, ${stars} stars, ${people} contributors, ${Object.keys(file.snapshots).length} snapshot(s)`);
  }
} catch (error) {
  console.error(`collect-metrics: ${error && error.message ? error.message : error}`);
  process.exit(1);
}
