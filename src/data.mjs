// The files Atlas reads, and the facts read straight off them. The fetches at the top are shared
// by every instance on a page; createData holds what one instance has loaded so far.

import { isStableVersion } from "./model.mjs";

// Data is fetched once per address, however many instances ask or are replaced by navigating.
// no-cache because the Metrics workflow rewrites these files daily: a 304 when nothing changed.
const fetched = new Map();
function fetchJsonOnce(url) {
  if (!fetched.has(url)) fetched.set(url, fetch(url, { cache: "no-cache" }).then((res) => (res.ok ? res.json() : null)).catch(() => null));
  return fetched.get(url);
}

const atlases = new Map();
export function loadAtlasOnce(url) {
  if (!atlases.has(url)) {
    atlases.set(url, fetch(url).then(async (response) => {
      if (!response.ok) throw new Error(`Could not load atlas.yaml (${response.status}).`);
      return jsyaml.load(await response.text());
    }));
  }
  return atlases.get(url);
}

// index.html loads the parser in its own tag. A page that embeds Atlas should not have to know
// that, so when it is absent this fetches it from beside this module, once.
let parserLoading = null;
export function loadParser(src) {
  if (typeof jsyaml !== "undefined") return Promise.resolve();
  if (!parserLoading) {
    parserLoading = new Promise((resolve, reject) => {
      const tag = document.createElement("script");
      tag.src = src;
      tag.onload = resolve;
      tag.onerror = () => reject(new Error("The YAML parser could not be loaded. Atlas needs vendor/js-yaml.min.js beside app.js."));
      document.head.append(tag);
    }).then(() => {
      if (typeof jsyaml === "undefined") throw new Error("The YAML parser loaded but did not register. Check that vendor/js-yaml.min.js is the published bundle.");
    });
  }
  return parserLoading;
}

export function createData(ctx) {
  const { dataUrl } = ctx;

  // fetchJsonOnce already hands every caller the same request, so nothing more is remembered
  // here than the file once it has arrived, for the facts below that read it without waiting.
  let METRICS = null;
  const loadMetrics = () => fetchJsonOnce(dataUrl("data/metrics.json")).then((file) => { METRICS = file; return file; });

  // The Map and the Developer Resources pages need four values: two dates for the footer stamp,
  // the package to install and how many examples there are. data/summary.json carries them in
  // about a kilobyte; an older deployment without it still works, from the full file.
  const loadSummary = () => fetchJsonOnce(dataUrl("data/summary.json")).then((file) => file || loadMetrics());

  function publishedRepos() { return Object.entries((METRICS && METRICS.repos) || {}).filter(([, r]) => r.version).map(([n]) => n).sort(); }

  function latestSnapshot() { const snaps = (METRICS && METRICS.snapshots) || {}; const days = Object.keys(snaps).sort(); return days.length ? snaps[days[days.length - 1]] : null; }

  // One repo's fact for a readiness field: true, false, or null when the collector has not measured it.
  function readinessFact(field, repo, snap) {
    if (field === "stable") return isStableVersion(METRICS && METRICS.repos[repo] && METRICS.repos[repo].version);
    if (!snap || !snap[field]) return null;
    const v = snap[field][repo];
    if (field === "ci") return v == null ? false : v === "success";
    return v === true;
  }

  // For the modules that read the file after it has arrived, without waiting on it again.
  const metrics = () => METRICS;

  return {
    latestSnapshot, loadMetrics, loadSummary, metrics, publishedRepos, readinessFact,
  };
}
