// Who builds on WDK: the public projects behind the "projects depending on WDK" count.
//
// The collector's code search lists every public repository outside the org whose package.json
// mentions a WDK package, and used to keep only how many there were. Read on 2026-11-09, the list
// said more than the count: a third of the projects were last touched within two days of being
// created. This reads each repository's dates and manifests. The aggregates go in metrics.json,
// which four pages load; the repositories themselves, all of them, go in data/projects.json, which
// only the dashboard does, so naming about 220 costs no other page anything.
//
// A WDK module's own repository depends on WDK too, and on 2026-11-10 a third of the projects named
// were modules: partners' wallets and protocols the catalog already shows. They extend the kit
// rather than build on it, so the aggregates count them apart and nothing else; the list keeps them,
// marked, for the dashboard to show or hide.

/** Repositories per GraphQL query: one query, one point of the hourly budget. */
const BATCH = 40;
/** "Still building": pushed to within this many days, and worked on for at least the other. */
const ACTIVE_DAYS = 90;
const MIN_LIFE_DAYS = 14;
/** A package named the way WDK modules are: @partner/wdk-wallet-…, wdk-protocol-…. */
const MODULE_NAME = /(^|\/)wdk-(wallets?|protocol)-/;

/**
 * What a package.json says: the packages it names in any dependency field that `isWdk` accepts, and
 * whether it is a module. The name alone also takes in apps (wdk-wallet-example, wdk-wallet-backend
 * on 2026-11-10), so a module is also published under a scope or builds on the base wdk-wallet package:
 * each of the 32 module repositories found that day did one or the other, and none of the 4 others did.
 */
function readManifest(text, isWdk) {
  let pkg;
  try { pkg = JSON.parse(text); } catch { return { packages: [], module: false }; }
  const packages = Object.keys({ ...pkg?.devDependencies, ...pkg?.peerDependencies, ...pkg?.dependencies }).filter(isWdk);
  const name = typeof pkg?.name === "string" ? pkg.name : "";
  return { packages, module: MODULE_NAME.test(name) && (name.startsWith("@") || packages.some((p) => p.endsWith("/wdk-wallet"))) };
}

/**
 * One row per repository whose manifests name a WDK package: { repo, created, pushed, stars, org, packages, module }.
 * `hits` maps a repository's full name to the package.json paths code search found in it;
 * `graphql(query)` returns the query's data, with null for a repository GitHub will not show.
 * A repository is a module when one of its packages is named like one or `catalogued` (lower-case
 * full names) holds it.
 */
export async function profile(graphql, hits, isWdk, catalogued) {
  const repos = [...hits];
  const rows = [];
  for (let i = 0; i < repos.length; i += BATCH) {
    const part = repos.slice(i, i + BATCH);
    const fields = part.map(([full, paths], j) => {
      const [owner, name] = full.split("/");
      const blobs = paths.map((p, k) => `m${k}: object(expression: ${JSON.stringify(`HEAD:${p}`)}) { ... on Blob { text } }`).join(" ");
      return `r${j}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) { createdAt pushedAt stargazerCount owner { __typename } ${blobs} }`;
    });
    const data = await graphql(`{ ${fields.join("\n")} }`);
    part.forEach(([repo, paths], j) => {
      const r = data[`r${j}`];
      if (!r) return;
      const manifests = paths.map((_, k) => readManifest(r[`m${k}`]?.text, isWdk));
      const packages = [...new Set(manifests.flatMap((m) => m.packages))];
      const module = catalogued.has(repo.toLowerCase()) || manifests.some((m) => m.module);
      if (packages.length) rows.push({ repo, created: r.createdAt.slice(0, 10), pushed: r.pushedAt.slice(0, 10), stars: r.stargazerCount, org: r.owner.__typename === "Organization", packages, module });
    });
  }
  return rows;
}

const days = (a, b) => (Date.parse(b) - Date.parse(a)) / 864e5;
const isBuilding = (r, today) => days(r.pushed, today) <= ACTIVE_DAYS && days(r.created, r.pushed) >= MIN_LIFE_DAYS;

/**
 * data/projects.json: every repository, modules too, each marked `module` and `building`. Most
 * stars first, then the most recently pushed, then by name.
 */
export function listing(rows, today) {
  const order = (a, b) => b.stars - a.stars || (a.pushed === b.pushed ? (a.repo < b.repo ? -1 : 1) : a.pushed < b.pushed ? 1 : -1);
  return { schema: 1, measured: today, repos: rows.map((r) => ({ ...r, building: isBuilding(r, today) })).sort(order) };
}
