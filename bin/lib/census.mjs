// Who builds on WDK: the public projects behind the "projects depending on WDK" count.
//
// The collector's code search lists every public repository outside the org whose package.json
// mentions a WDK package, and used to keep only how many there were. Read on 2026-11-09, the list
// said more than the count: a third of the projects were last touched within two days of being
// created. This reads each repository's dates and manifests and keeps the aggregates, and names
// only the projects still building: the rest are mostly a weekend's experiment, and naming 222
// repositories would cost every page that loads the file about 8 KB.

/** Repositories per GraphQL query: one query, one point of the hourly budget. */
const BATCH = 40;
/** "Still building": pushed to within this many days, and worked on for at least the other. */
const ACTIVE_DAYS = 90;
const MIN_LIFE_DAYS = 14;

/** The packages a package.json names in any dependency field that `isWdk` accepts. Unreadable text names none. */
function namedPackages(text, isWdk) {
  let pkg;
  try { pkg = JSON.parse(text); } catch { return []; }
  const deps = { ...pkg?.devDependencies, ...pkg?.peerDependencies, ...pkg?.dependencies };
  return Object.keys(deps).filter(isWdk);
}

/**
 * One row per repository whose manifests name a WDK package: { repo, created, pushed, stars, org, packages }.
 * `hits` maps a repository's full name to the package.json paths code search found in it;
 * `graphql(query)` returns the query's data, with null for a repository GitHub will not show.
 */
export async function profile(graphql, hits, isWdk) {
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
      const packages = [...new Set(paths.flatMap((_, k) => namedPackages(r[`m${k}`]?.text, isWdk)))];
      if (packages.length) rows.push({ repo, created: r.createdAt.slice(0, 10), pushed: r.pushedAt.slice(0, 10), stars: r.stargazerCount, org: r.owner.__typename === "Organization", packages });
    });
  }
  return rows;
}

/**
 * What the file keeps. `cohorts` maps the month a repository was created to [projects started,
 * still building]; `organisations` is how many of those still building an organisation owns;
 * `packages` counts the projects naming each package, most first; `repos` lists the projects still
 * building, the most recently pushed first.
 */
export function tally(rows, today) {
  const days = (a, b) => (Date.parse(b) - Date.parse(a)) / 864e5;
  const building = (r) => days(r.pushed, today) <= ACTIVE_DAYS && days(r.created, r.pushed) >= MIN_LIFE_DAYS;
  const cohorts = {}, packages = {};
  for (const r of rows) {
    const c = (cohorts[r.created.slice(0, 7)] ||= [0, 0]);
    c[0] += 1;
    if (building(r)) c[1] += 1;
    for (const p of r.packages) packages[p] = (packages[p] || 0) + 1;
  }
  const live = rows.filter(building);
  return {
    measured: today,
    projects: rows.length,
    building: live.length,
    organisations: live.filter((r) => r.org).length,
    cohorts: Object.fromEntries(Object.entries(cohorts).sort()),
    packages: Object.fromEntries(Object.entries(packages).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))),
    repos: live.sort((a, b) => (a.pushed === b.pushed ? (a.repo < b.repo ? -1 : 1) : a.pushed < b.pushed ? 1 : -1)),
  };
}
