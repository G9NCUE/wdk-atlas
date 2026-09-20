// Where a reader goes to check a key result for themselves.
//
// Every key result on the page used to name its source as "Dashboard" or "Map" and link to
// another page of ours, which is the opposite of what the site promises. This table maps a
// measurement to the public endpoint that returns the same fact.
//
// It lives apart from the page for one reason: a gate can then ask it directly whether every
// measurement in atlas.yaml is covered, instead of reading the page's source code and guessing.
// The first version of that gate did guess, and it missed two regressions out of three.

/**
 * The public endpoint behind one metric block, or null if nothing here knows where to send a
 * reader. Null is a fault, not a default: it means a measurement has been added and nobody has
 * said how a stranger checks it.
 */
export function originFor(metric, ctx = {}) {
  if (!metric || !metric.kind) return null;
  const { org, repo, pkg, examplesUrl, atlasUrl } = ctx;
  const api = (path) => `https://api.github.com/${path}`;

  if (metric.kind === "share" || metric.kind === "average") {
    switch (metric.field) {
      case "stable":
        return pkg ? { label: "npm registry", href: `https://registry.npmjs.org/${pkg}` } : null;
      case "signer":
        return org ? { label: "GitHub code search", href: `https://github.com/search?q=org%3A${org}+ISigner&type=code` } : null;
      case "audits":
        return org && repo ? { label: "GitHub contents", href: api(`repos/${org}/${repo}/contents/`) } : null;
      case "ci":
        return org && repo ? { label: "GitHub Actions", href: api(`repos/${org}/${repo}/actions/runs?per_page=1&status=completed`) } : null;
      case "health":
        return org && repo ? { label: "GitHub community profile", href: api(`repos/${org}/${repo}/community/profile`) } : null;
      default:
        return null;
    }
  }
  if (metric.kind === "count") {
    switch (metric.source) {
      case "thirdPartyModules":
        return atlasUrl ? { label: "atlas.yaml", href: atlasUrl } : null;
      case "privateRepos":
        return org ? { label: "GitHub repos", href: api(`orgs/${org}/repos?type=public&per_page=100`) } : null;
      case "examples":
        return examplesUrl ? { label: "GitHub, examples repo", href: examplesUrl } : null;
      default:
        return null;
    }
  }
  if (metric.kind === "quarterGrowth" || metric.kind === "seriesTotal") {
    return org ? { label: "GitHub pull requests", href: api(`search/issues?q=org:${org}+is:pr+is:merged`) } : null;
  }
  if (metric.kind === "currency") {
    return pkg ? { label: "npm per-version downloads", href: `https://api.npmjs.org/versions/${encodeURIComponent(pkg)}/last-week` } : null;
  }
  if (metric.kind === "issueResponse") {
    return org ? { label: "GitHub issues", href: api(`search/issues?q=org:${org}+is:issue`) } : null;
  }
  return null;
}

/** A context in which every covered measurement can produce a URL, for asking about coverage. */
export const PROBE = Object.freeze({
  org: "org",
  repo: "repo",
  pkg: "@scope/package",
  examplesUrl: "https://github.com/org/examples",
  atlasUrl: "./atlas.yaml",
});

/** How a metric block reads in a gate's output. */
export const describe = (metric) =>
  !metric || !metric.kind ? "(no metric)" : metric.kind === "count" ? `count:${metric.source}` : metric.field ? `${metric.kind}:${metric.field}` : metric.kind;

/** The measurements nothing here can send a reader to check. Empty is the only passing answer. */
export const uncovered = (metrics, ctx = PROBE) => (metrics || []).filter((m) => !originFor(m, ctx)).map(describe);

/** Every metric block carried by the key results of these north stars. */
export function metricsOf(northStars) {
  return (northStars || [])
    .flatMap((star) => (star && star.keyResults) || [])
    .map((kr) => (kr && typeof kr === "object" ? kr.metric : null))
    .filter(Boolean);
}
