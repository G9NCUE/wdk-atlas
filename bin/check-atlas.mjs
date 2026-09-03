#!/usr/bin/env node
// bin/check-atlas.mjs — checks the map in atlas.yaml against GitHub and npm, prints a Markdown report.
//
//   node bin/check-atlas.mjs            Markdown on stdout
//   node bin/check-atlas.mjs --json     JSON instead
//
// Checks: repo links resolve; status agrees with npm; `requires` agrees with package.json both ways;
// WDK repos in the org that the atlas does not mention; roadmap items name modules that exist.
// The roadmap's own status is not checked here: that will come from wherever the roadmap ends up living.
// Env: GITHUB_TOKEN (or ATLAS_TOKEN) raises the API rate limit and lets the check see private repos.
// No dependencies: the YAML parser is the one the site already ships in vendor/.
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TOKEN = process.env.ATLAS_TOKEN || process.env.GITHUB_TOKEN || "";
const JSON_OUT = process.argv.includes("--json");

// ---------------------------------------------------------------- load
const ctx = {};
createContext(ctx);
runInContext(readFileSync(join(ROOT, "vendor/js-yaml.min.js"), "utf8"), ctx);
const atlas = ctx.jsyaml.load(readFileSync(join(ROOT, "atlas.yaml"), "utf8"));
const audit = atlas.audit || {};
const ORG = audit.org || "tetherto";
const REPO_PATTERN = new RegExp(audit.repoPattern || "^(wdk-|pear-wrk-wdk$|create-wdk-module$)");
const IGNORE = new Set(audit.ignoreRepos || []);
const IGNORE_PATTERN = audit.ignorePattern ? new RegExp(audit.ignorePattern) : null;
const modules = atlas.modules || [];
const roadmap = atlas.roadmap || [];
// Dependencies nobody draws: everything in the Foundation section, plus whatever the atlas lists.
const IMPLICIT = new Set([...modules.filter((m) => m.section === "foundation").map((m) => m.id), ...(audit.implicitRequires || [])]);
// Apps and developer tools consume many packages; only their stale `requires` are worth a finding.
const CONSUMER_SECTIONS = new Set(audit.consumerSections || ["app", "dev"]);

// ---------------------------------------------------------------- fetch helpers
const gh = async (path) => {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: { accept: "application/vnd.github+json", "user-agent": "wdk-atlas-check", ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}) },
  });
  if (res.status === 404) return null;
  if (res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0") {
    const reset = new Date(Number(res.headers.get("x-ratelimit-reset")) * 1000).toISOString();
    throw new Error(`GitHub rate limit exhausted until ${reset}. Set GITHUB_TOKEN (for example: GITHUB_TOKEN=$(gh auth token)).`);
  }
  if (!res.ok) throw new Error(`GitHub ${res.status} on ${path}`);
  return res.json();
};
const npmView = async (name) => {
  const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name).replace("%40", "@")}`, { headers: { accept: "application/json" } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`npm ${res.status} on ${name}`);
  return res.json();
};
const repoOf = (url) => {
  const m = /github\.com\/([^/]+)\/([^/#?]+)/.exec(url || "");
  return m ? { owner: m[1], name: m[2].replace(/\.git$/, "") } : null;
};

// ---------------------------------------------------------------- collect
try {
const facts = new Map(); // module id -> { repo, pkg, npm }
for (const m of modules) {
  const r = repoOf(m.repo);
  const f = { id: m.id, repo: r, repoInfo: null, pkg: null, npm: null };
  if (r) {
    f.repoInfo = await gh(`/repos/${r.owner}/${r.name}`);
    if (f.repoInfo) {
      const c = await gh(`/repos/${r.owner}/${r.name}/contents/package.json`);
      if (c && c.content) {
        try { f.pkg = JSON.parse(Buffer.from(c.content, "base64").toString("utf8")); } catch {}
      }
    }
  }
  if (f.pkg && f.pkg.name && !f.pkg.private) f.npm = await npmView(f.pkg.name);
  facts.set(m.id, f);
}
const byNpmName = new Map();
for (const f of facts.values()) if (f.pkg && f.pkg.name) byNpmName.set(f.pkg.name, f.id);

const orgRepos = [];
for (let page = 1; page < 10; page += 1) {
  const list = await gh(`/orgs/${ORG}/repos?per_page=100&page=${page}&type=all`);
  if (!list || !list.length) break;
  orgRepos.push(...list);
  if (list.length < 100) break;
}

// ---------------------------------------------------------------- checks
const findings = { links: [], status: [], relations: [], coverage: [], roadmap: [] };

for (const m of modules) {
  const f = facts.get(m.id);
  if (m.repo && f.repo && !f.repoInfo) findings.links.push({ id: m.id, evidence: `repo link 404: ${m.repo}` });
  if (f.repoInfo && f.repoInfo.archived) findings.links.push({ id: m.id, evidence: `repo is archived` });

  // Status against npm and the repo.
  const version = f.npm && f.npm["dist-tags"] ? f.npm["dist-tags"].latest : null;
  const published = version && version !== "0.0.0";
  const deprecated = f.npm && f.npm.versions && version && f.npm.versions[version] && f.npm.versions[version].deprecated;
  if (m.status === "shipped" && f.pkg && !f.pkg.private && !published && !m.placeholder) {
    findings.status.push({ id: m.id, evidence: `atlas says shipped, npm has ${version || "nothing"} for ${f.pkg.name}` });
  }
  if (m.status === "planned" && published) {
    findings.status.push({ id: m.id, evidence: `atlas says planned, ${f.pkg.name}@${version} is on npm` });
  }
  if (m.status === "wip" && published) {
    findings.status.push({ id: m.id, evidence: `atlas says wip, ${f.pkg.name}@${version} is on npm` });
  }
  if (deprecated) findings.status.push({ id: m.id, evidence: `${f.pkg.name}@${version} is deprecated on npm: ${String(deprecated).slice(0, 80)}` });

  // Relations against package.json dependencies, both ways, among atlas modules only.
  if (f.pkg) {
    const deps = Object.keys({ ...(f.pkg.dependencies || {}), ...(f.pkg.peerDependencies || {}) });
    const actual = new Set(deps.map((d) => byNpmName.get(d)).filter((id) => id && id !== m.id));
    const declared = new Set((m.relations || []).filter((r) => r.type === "requires").map((r) => r.target));
    // A declared dependency on a base is satisfied by a dependency on one of its variants (`under`).
    const baseOf = (id) => ((modules.find((x) => x.id === id) || {}).relations || []).filter((r) => r.type === "under").map((r) => r.target);
    for (const id of [...actual]) for (const base of baseOf(id)) if (declared.has(base)) actual.add(base);
    for (const id of actual) {
      if (declared.has(id) || IMPLICIT.has(id) || CONSUMER_SECTIONS.has(m.section)) continue;
      findings.relations.push({ id: m.id, evidence: `depends on ${id} in package.json, no \`requires\` in the atlas` });
    }
    for (const id of declared) if (!actual.has(id) && facts.get(id)?.pkg) findings.relations.push({ id: m.id, evidence: `atlas says requires ${id}, package.json does not list ${facts.get(id).pkg.name}` });
  }
}

// Org repos the atlas does not mention.
const inAtlas = new Set([...facts.values()].filter((f) => f.repo && f.repo.owner.toLowerCase() === ORG.toLowerCase()).map((f) => f.repo.name.toLowerCase()));
for (const r of orgRepos) {
  if (r.archived || r.fork || !REPO_PATTERN.test(r.name) || IGNORE.has(r.name) || (IGNORE_PATTERN && IGNORE_PATTERN.test(r.name)) || inAtlas.has(r.name.toLowerCase())) continue;
  findings.coverage.push({ id: r.name, evidence: `${r.private ? "private" : "public"} repo not in the atlas, last push ${String(r.pushed_at).slice(0, 10)}` });
}

// Roadmap integrity: every module an item touches must exist in the atlas.
const ids = new Set(modules.map((m) => m.id));
for (const item of roadmap) {
  for (const ref of item.modules || []) {
    const id = typeof ref === "string" ? ref : ref.id;
    if (!ids.has(id)) findings.roadmap.push({ id: item.id, evidence: `touches unknown module ${id}` });
  }
}

// ---------------------------------------------------------------- report
const total = Object.values(findings).reduce((n, list) => n + list.length, 0);
const date = new Date().toISOString().slice(0, 10);
const sections = [
  ["Repo links", findings.links, "Links that no longer resolve, or repos that were archived."],
  ["Status", findings.status, "The atlas status against what npm and the repo say."],
  ["Dependencies", findings.relations, "`requires` in the atlas against `dependencies` in each package.json, both ways."],
  ["Coverage", findings.coverage, `Repos in the ${ORG} org matching \`${REPO_PATTERN.source}\` that the atlas does not mention (archived and forks skipped; add to \`audit.ignoreRepos\` to silence).`],
  ["Roadmap references", findings.roadmap, "Roadmap items that name a module id missing from the atlas."],
];
if (JSON_OUT) {
  console.log(JSON.stringify({ date, total, findings, modules: modules.length, roadmap: roadmap.length, token: Boolean(TOKEN) }, null, 2));
} else {
  const lines = [];
  lines.push(`_Checked ${date} against GitHub and npm · ${modules.length} modules · ${roadmap.length} roadmap items · ${total} finding${total === 1 ? "" : "s"}${TOKEN ? "" : " · no token, private repos invisible"}_`, "");
  for (const [title, list, blurb] of sections) {
    lines.push(`## ${title} (${list.length})`, "", blurb, "");
    if (!list.length) { lines.push("Nothing to report.", ""); continue; }
    for (const f of list) lines.push(`- [ ] **${f.id}** — ${f.evidence}`);
    lines.push("");
  }
  console.log(lines.join("\n"));
}
} catch (error) {
  console.error(`check-atlas: ${error && error.message ? error.message : error}`);
  process.exit(1);
}
