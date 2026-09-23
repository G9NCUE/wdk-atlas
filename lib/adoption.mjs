// Telling demand apart from plumbing, and telling whether anyone keeps up.
//
// wdk-failover-provider shows 307 downloads a day. 99.7% of them are version 1.0.0-beta.2, the
// exact version every WDK package pins; the current release gets 21 a week. Nobody chose that
// package. Published as adoption, the figure would send us to build more of what nobody asked
// for, which is why these two calculations exist before the chart that uses them.
//
// Pure, so Node tests them without the network and the browser can call them directly.

/** The WDK packages a manifest depends on, ignoring everything from outside. */
export function internalDeps(dependencies, known) {
  return Object.keys(dependencies || {}).filter((name) => known.has(name)).sort();
}

/**
 * Downloads attributed to another package pinning this one, and what is left.
 *
 * `totals` is downloads per package over one window; `edges` maps a package to the WDK
 * packages it depends on. Induced is an upper bound, because a cache means a dependent install
 * does not always fetch the dependency again; direct is therefore a lower bound. Both are
 * bounds and must be published as bounds.
 */
export function attribute(totals, edges) {
  const dependents = new Map();
  for (const [pkg, deps] of Object.entries(edges || {})) {
    for (const dep of deps || []) {
      if (!dependents.has(dep)) dependents.set(dep, new Set());
      dependents.get(dep).add(pkg);
    }
  }
  // Number(null) is 0, so an absent total would otherwise be published as "downloaded nothing"
  // rather than "not collected". Absence is a value; it is not zero.
  const count = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const out = {};
  for (const [pkg, total] of Object.entries(totals || {})) {
    const n = count(total);
    if (n === null) continue;
    let induced = 0;
    for (const dependent of dependents.get(pkg) || []) {
      const t = count((totals || {})[dependent]);
      if (t !== null) induced += t;
    }
    out[pkg] = { total: n, induced: Math.min(induced, n), direct: Math.max(0, n - induced) };
  }
  return out;
}

/**
 * The share of a package's installs landing on a recent release.
 *
 * Retention, as far as public data can show it: someone who installed once and froze keeps
 * downloading the version they pinned, and shows up here as a falling share. Returns null when
 * nothing was downloaded, because zero downloads is not zero currency.
 */
export function currency(versionDownloads, publishedAt, asOf, maxAgeDays = 30) {
  const cutoff = new Date(new Date(`${asOf}T00:00:00Z`).getTime() - maxAgeDays * 864e5).toISOString().slice(0, 10);
  let total = 0, recent = 0;
  for (const [version, downloaded] of Object.entries(versionDownloads || {})) {
    const n = typeof downloaded === "number" && Number.isFinite(downloaded) ? downloaded : null;
    if (n === null || n < 0) continue;
    total += n;
    const when = String((publishedAt || {})[version] || "").slice(0, 10);
    if (when && when >= cutoff) recent += n;
  }
  if (!total) return null;
  return Math.round((100 * recent) / total);
}

/**
 * The share of installs landing on the version npm currently serves as `latest`.
 *
 * Kept apart from `currency` because the two answer different questions and one of them is
 * easy to misread: a package we have not released for a month scores 0 on currency by
 * construction, which says nothing about whether anyone upgraded. This one isolates the
 * reader's behaviour from our release cadence, so a low figure always means people are not
 * taking what we ship.
 */
export function latestShare(versionDownloads, latest) {
  if (!latest) return null;
  let total = 0, current = 0;
  for (const [version, downloaded] of Object.entries(versionDownloads || {})) {
    const n = typeof downloaded === "number" && Number.isFinite(downloaded) ? downloaded : null;
    if (n === null || n < 0) continue;
    total += n;
    if (version === latest) current += n;
  }
  if (!total) return null;
  return Math.round((100 * current) / total);
}

/** Publish dates keyed by version, from the registry's `time` object, minus its two non-versions. */
export function publishDates(time) {
  const out = {};
  for (const [key, value] of Object.entries(time || {})) {
    if (key === "created" || key === "modified") continue;
    out[key] = String(value).slice(0, 10);
  }
  return out;
}

/** Releases on or after `from`, keyed by day and sorted: { "YYYY-MM-DD": "1.3.1, 1.3.2" }.
 * Two versions on one day share the entry, so a tick can still name both. */
export function releasesSince(time, from) {
  const dated = {};
  for (const [ver, d] of Object.entries(publishDates(time))) if (d >= from) dated[d] = dated[d] ? `${dated[d]}, ${ver}` : ver;
  return Object.fromEntries(Object.entries(dated).sort());
}

/**
 * The share of installs landing on the latest release, weighted by chosen installs.
 *
 * Weighted by chosen rather than by all: an install another WDK package pinned is on an old
 * version by construction, so weighting by the raw total would measure our own dependency
 * graph and call it a reader failing to upgrade. Null when nothing was chosen, because no
 * installs is not nought per cent.
 */
export function weightedCurrency(onLatest, chosen) {
  let num = 0, den = 0;
  for (const [repo, share] of Object.entries(onLatest || {})) {
    const w = Number((chosen || {})[repo]);
    if (typeof share !== "number" || !Number.isFinite(share) || !Number.isFinite(w) || w <= 0) continue;
    num += (share / 100) * w;
    den += w;
  }
  return den ? Math.round((100 * num) / den) : null;
}
