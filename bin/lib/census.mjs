// Who builds on WDK: the public projects behind the "projects depending on WDK" count.
//
// The collector's code search lists every public repository outside the org whose package.json
// mentions a WDK package, and used to keep only how many there were. Read on 2026-11-09, the list
// said more than the count: a third of the projects were last touched within two days of being
// created. This reads each repository's dates and manifests and keeps the aggregates, and names
// only the projects still building: the rest are mostly a weekend's experiment, and naming 222
// repositories would cost every page that loads the file about 8 KB.
//
// A WDK module's own repository depends on WDK too, and on 2026-11-10 a third of the projects named
// were modules: partners' wallets and protocols the catalog already shows. They extend the kit
// rather than build on it, so they are counted apart and left out of everything else.

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

/**
 * What the file keeps, modules apart: `modules` is how many there were, and nothing else counts them.
 * `cohorts` maps the month a repository was created to [projects started,
 * still building]; `organisations` is how many of those still building an organisation owns;
 * `packages` counts the projects naming each package, most first; `repos` lists the projects still
 * building, the most recently pushed first.
 */
export function tally(rows, today) {
  const days = (a, b) => (Date.parse(b) - Date.parse(a)) / 864e5;
  const building = (r) => days(r.pushed, today) <= ACTIVE_DAYS && days(r.created, r.pushed) >= MIN_LIFE_DAYS;
  const projects = rows.filter((r) => !r.module).map(({ module: _, ...r }) => r);
  const cohorts = {}, packages = {};
  for (const r of projects) {
    const c = (cohorts[r.created.slice(0, 7)] ||= [0, 0]);
    c[0] += 1;
    if (building(r)) c[1] += 1;
    for (const p of r.packages) packages[p] = (packages[p] || 0) + 1;
  }
  const live = projects.filter(building);
  return {
    measured: today,
    projects: projects.length,
    modules: rows.length - projects.length,
    building: live.length,
    organisations: live.filter((r) => r.org).length,
    cohorts: Object.fromEntries(Object.entries(cohorts).sort()),
    packages: Object.fromEntries(Object.entries(packages).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))),
    repos: live.sort((a, b) => (a.pushed === b.pushed ? (a.repo < b.repo ? -1 : 1) : a.pushed < b.pushed ? 1 : -1)),
  };
}
