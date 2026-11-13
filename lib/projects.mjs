// The public projects depending on WDK, counted: shared by the collector, which writes the counts
// for all of WDK into metrics.json, and the dashboard, which counts again from data/projects.json
// over the packages of the repos someone tracks. One function, so the two cannot count the same
// rows differently. Pure so Node can test it.

/**
 * Rows are { created, org, packages, module, building }. A module's own repository is only counted:
 * `modules` is how many there were, and nothing else counts them. `cohorts` maps the month a
 * repository was created to [projects started, still building]; `organisations` is how many of those
 * still building an organisation owns; `packages` counts the projects naming each package, most first.
 */
export function aggregate(rows) {
  const projects = rows.filter((r) => !r.module);
  const cohorts = {}, packages = {};
  for (const r of projects) {
    const c = (cohorts[r.created.slice(0, 7)] ||= [0, 0]);
    c[0] += 1;
    if (r.building) c[1] += 1;
    for (const p of r.packages) packages[p] = (packages[p] || 0) + 1;
  }
  const live = projects.filter((r) => r.building);
  return {
    projects: projects.length,
    modules: rows.length - projects.length,
    building: live.length,
    organisations: live.filter((r) => r.org).length,
    cohorts: Object.fromEntries(Object.entries(cohorts).sort()),
    packages: Object.fromEntries(Object.entries(packages).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))),
  };
}

/** The rows naming any of `packages`; every row when `packages` is null, the whole of WDK. */
export function namingAny(rows, packages) {
  return packages ? rows.filter((r) => r.packages.some((p) => packages.has(p))) : rows;
}
