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
 * The modules built by others: a publisher that is not the organisation, shipped, and either a
 * repository to read the package name from or a package named outright. The same test the map
 * uses to draw a module as third party, narrowed to what can be measured.
 */
export function thirdPartyModules(modules, org) {
  const ours = String(org || "").toLowerCase();
  return (modules || []).filter((m) => m && m.publisher && m.publisher.toLowerCase() !== ours && m.status === "shipped" && (m.package || repoParts(m.repo)));
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
