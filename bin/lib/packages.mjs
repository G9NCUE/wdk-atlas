// Which packages the collector measures, and how it reads what the registry answers. Pure, so
// the choices are tested from Node without a token: which modules on the map are somebody
// else's, what a repository's package.json says its package is called, and which days of a
// download range are trustworthy.

/** The owner and name in a GitHub repository address, or null. */
export function repoParts(url) {
  const m = /github\.com\/([^/]+)\/([^/#?]+)/.exec(url || "");
  return m ? { owner: m[1], name: m[2].replace(/\.git$/, "") } : null;
}

/**
 * Who a module is measured under when it is not the organisation's, or null when it is ours.
 *
 * Two ways to be somebody else's. The publisher on the module is not the org: the ordinary
 * case, and the same test the map uses to draw a module as third party. Or the org hosts the
 * repo and publishes the package for a partner, and `audit.thirdPartyRepos` in atlas.yaml names
 * the repo and the partner: the map keeps the module as the org's, since the org publishes it,
 * and only the numbers move. That list is the exception, deliberately spelled out in the atlas
 * rather than inferred from anything.
 */
export function measuredUnder(module, org, exceptions = {}) {
  if (!module) return null;
  const parts = repoParts(module.repo);
  if (parts && Object.hasOwn(exceptions, parts.name)) return exceptions[parts.name];
  if (module.publisher && module.publisher.toLowerCase() !== String(org || "").toLowerCase()) return module.publisher;
  return null;
}

/**
 * The modules built by others that can be measured: shipped, and either a repository to read
 * the package name from or a package named outright. Each comes back with `publisher` set to
 * whoever it is measured under and, for the org-hosted exceptions, `hostedByOrg: true`.
 */
export function thirdPartyModules(modules, org, exceptions = {}) {
  const out = [];
  for (const m of modules || []) {
    const under = measuredUnder(m, org, exceptions);
    if (!under || m.status !== "shipped" || !(m.package || repoParts(m.repo))) continue;
    out.push(under === m.publisher ? m : { ...m, publisher: under, hostedByOrg: true });
  }
  return out;
}

/**
 * The npm package a repository publishes, from its root package.json. A private manifest is
 * not published; one with workspaces is a monorepo whose root is not the package either, and
 * the module then needs `package:` in atlas.yaml to say which one it is.
 */
export function packageNameOf(manifest) {
  if (!manifest || typeof manifest !== "object") return { name: null, reason: "no package.json at the root of the repository" };
  if (manifest.private) return { name: null, reason: manifest.workspaces ? "a monorepo; its root is not the package" : "the root package.json is private" };
  if (typeof manifest.name !== "string" || !manifest.name) return { name: null, reason: "the root package.json names no package" };
  return { name: manifest.name, reason: null };
}

/**
 * The date ranges that cover from one day to another in pieces npm will answer: its range
 * endpoint serves at most eighteen months per call, so an all-time total is asked for in
 * chunks. Inclusive on both ends, ISO days, oldest first; empty when `from` is after `to`.
 */
export function rangeChunks(from, to) {
  const maxDays = 540; // eighteen months, npm's ceiling per call
  const out = [];
  let start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (start <= end) {
    const stop = new Date(Math.min(start.getTime() + (maxDays - 1) * 864e5, end.getTime()));
    out.push([start.toISOString().slice(0, 10), stop.toISOString().slice(0, 10)]);
    start = new Date(stop.getTime() + 864e5);
  }
  return out;
}

/**
 * Daily downloads keyed by day, from npm's range answer. npm lags a few days: trailing zero
 * days are dropped, then the last reported day too, which is usually still filling.
 */
export function trimDownloads(range) {
  const days = {};
  for (const d of (range && range.downloads) || []) days[d.day] = d.downloads;
  const sorted = Object.keys(days).sort().reverse();
  for (const d of sorted) { if (days[d] === 0) delete days[d]; else break; }
  const lastLeft = Object.keys(days).sort().pop();
  if (lastLeft) delete days[lastLeft];
  return days;
}
