// A key result with a `metric` block reads its value from public data, never from a number typed
// by hand. This is that evaluation, and the chip the Roadmap and the Overview show it in.

import { el, pct, tipAttrs } from "./dom.mjs";
import { repoNameOf, createModel } from "./model.mjs";
import { createData } from "./data.mjs";
import { createSeries } from "./series.mjs";
import { use } from "./context.mjs";
import { sumSeries } from "./../lib/quarters.mjs";
import { attribute, weightedCurrency } from "./../lib/adoption.mjs";
import { originFor } from "./../lib/origins.mjs";
import { responseStats } from "./../lib/support.mjs";

export function createKeyResults(ctx) {
  use(ctx, createModel);
  use(ctx, createData);
  use(ctx, createSeries);

  const { dataUrl, atlas, metrics, orgName, privateModules, walletRepos, examplesRepoUrl,
    publishedRepos, latestSnapshot, readinessFact, coverageOf, seriesBuckets, lastTwo } = ctx;

  // A link to the very file the page fetched. dataUrl gives an absolute address, and the link
  // allow-list refuses plain http, so a same-origin address is handed over as a path: the link
  // then works on the site, inside an embed, and on a local server alike.
  const dataHref = (path) => {
    const url = dataUrl(path);
    try { const u = new URL(url); if (u.origin === location.origin) return `${u.pathname}${u.search}`; } catch {}
    return url;
  };

  // The context the shared table needs to build a real address: the org, one package in scope as
  // a worked example, and the files this site serves.
  function originContext(repo) {
    const info = repo && metrics() && metrics().repos ? metrics().repos[repo] : null;
    return { org: orgName(), repo, pkg: info ? info.package : null, examplesUrl: examplesRepoUrl(), atlasUrl: dataHref("atlas.yaml") };
  }

  // Chosen installs per repo for the last complete period: the download total minus whatever
  // another WDK package pinned. One copy, because the dashboard and the key result quoting
  // different numbers from the same data is exactly the fault this loop keeps finding.
  function splitInstalls(file, repos) {
    const D = (file && file.daily) || {};
    const cov = coverageOf(D.downloads, file, false);
    const withPackages = repos.filter((r) => file.repos[r] && file.repos[r].package);
    const totals = Object.fromEntries(withPackages.map((r) => [r, lastTwo(seriesBuckets({ [r]: (D.downloads || {})[r] }, [r], { coverage: cov })).now || 0]));
    const repoOfPackage = new Map(Object.entries(file.repos).map(([name, info]) => [info.package, name]));
    const edges = {};
    for (const [name, pkgs] of Object.entries(file.deps || {})) {
      const inner = (pkgs || []).map((pkg) => repoOfPackage.get(pkg)).filter((r) => r && totals[r] != null);
      if (inner.length && totals[name] != null) edges[name] = inner;
    }
    return { withPackages, split: attribute(totals, edges), edges };
  }

  /** Just the chosen part, keyed by repo, for weighting. */

  const chosenInstalls = (file, repos) => {
    const { withPackages, split } = splitInstalls(file, repos);
    return Object.fromEntries(withPackages.map((r) => [r, split[r] ? split[r].direct : 0]));
  };

  // A key result with `metric` reads its current value and progress from public data: the atlas, npm and GitHub
  // through the metrics file. It never reads a number typed by hand.
  function evaluateMetric(kr) {
    const m = kr.metric; if (!m) return null;
    // `origin` is the public endpoint a stranger can call to check the row for themselves, and
    // `data` is the file holding the copy we counted. Without them the source column links only
    // to another page of ours, which is the opposite of what "don't trust, verify" promises.
    const out = { source: "Dashboard", link: "./?page=dashboard", origin: null, data: dataHref("data/metrics.json"), note: null, current: null, target: null, progress: null, unit: "", valueTitle: null };
    if (m.kind === "count" && m.source === "thirdPartyModules") {
      const n = (atlas.modules || []).filter((x) => x.publisher && x.publisher !== orgName() && x.status === "shipped").length;
      Object.assign(out, { current: n, target: m.target, progress: m.target ? Math.min(100, Math.round((100 * n) / m.target)) : null, link: "./?page=map", source: "Map, third-party modules", origin: originFor(m, originContext(null)), data: dataHref("atlas.yaml") });
      return out;
    }
    if (m.kind === "count" && m.source === "privateRepos") {
      const priv = privateModules();
      Object.assign(out, { current: `${priv.length} private`, target: null, progress: priv.length ? 0 : 100, unit: priv.length ? "target none · hover the number for the repos" : "every repo in scope is public", link: "./?page=map", source: "Map, private repos", origin: originFor(m, originContext(null)), data: dataHref("atlas.yaml"),
        valueTitle: priv.length ? priv.map((x) => `${x.title || x.id}${repoNameOf(x) ? ` (${repoNameOf(x)})` : ""}`).join("\n") : null });
      return out;
    }
    if (!metrics() || !metrics().daily) { out.note = "Dashboard data not loaded."; return out; }
    const D = metrics().daily;
    if (m.kind === "share" || m.kind === "average") {
      const snap = latestSnapshot();
      const scope = m.scope === "wallets" ? walletRepos() : publishedRepos();
      const scopeLabel = m.scope === "wallets" ? "first-party wallet packages" : "published packages";
      out.link = "./?page=dashboard#readiness"; out.source = "Dashboard, release readiness";
      out.origin = originFor(m, originContext(scope[0]));
      if (m.field !== "stable" && (!snap || !snap[m.field])) { out.note = `Not collected yet (${m.field}); the next metrics run adds it.`; return out; }
      if (m.kind === "share") {
        const n = scope.filter((r) => readinessFact(m.field, r, snap) === true).length, total = scope.length;
        Object.assign(out, { current: `${n} of ${total}`, target: null, progress: total ? Math.round((100 * n) / total) : null, unit: `${scopeLabel} · target all ${total}` });
        return out;
      }
      const vals = scope.map((r) => snap[m.field][r]).filter((v) => typeof v === "number");
      if (!vals.length) { out.note = "No repo measured yet."; return out; }
      const at = vals.filter((v) => v >= m.target).length, avg = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
      Object.assign(out, { current: `${at} of ${vals.length}`, target: null, progress: Math.round((100 * at) / vals.length), unit: `${scopeLabel} at ${m.target}% or more · average ${avg}% · target all ${vals.length}` });
      return out;
    }
    if (m.kind === "count" && m.source === "examples") {
      const snap = latestSnapshot(); const n = snap ? snap.examples : null;
      out.link = examplesRepoUrl(); out.source = "GitHub, examples repo"; out.origin = originFor(m, originContext(null));
      if (n == null) { out.note = "Not collected yet; the next metrics run adds it."; return out; }
      Object.assign(out, { current: n, target: m.target, progress: m.target ? Math.min(100, Math.round((100 * n) / m.target)) : null, unit: "example folders" });
      return out;
    }
    if (m.kind === "seriesTotal") {
      // A count over a rolling window, where a percentage would have said more about the size of
      // the base than about the work. The window is half open, like every other range here.
      const days = Math.max(1, Number(m.days) || 30);
      const to = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
      const from = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
      const total = sumSeries(D[m.series], from, to);
      out.origin = originFor(m, originContext(null));
      Object.assign(out, { current: total, target: m.target, progress: m.target ? Math.min(100, Math.round((100 * total) / m.target)) : null,
        unit: `merged in the last ${days} days`, link: "./?page=dashboard&range=weekly" });
      if (metrics() && metrics().since && metrics().since > from) out.note = `Collection starts ${metrics().since}, so the window is not yet full.`;
      return out;
    }
    if (m.kind === "currency") {
      const snap = latestSnapshot();
      out.origin = originFor(m, originContext(publishedRepos()[0]));
      if (!snap || !snap.onLatest) { out.note = "Not collected yet; the next metrics run adds it."; return out; }
      const pct = weightedCurrency(snap.onLatest, chosenInstalls(metrics(), Object.keys(metrics().repos || {})));
      if (pct == null) { out.note = "No chosen installs in the window yet."; return out; }
      const counted = Object.keys(snap.onLatest).length;
      Object.assign(out, { current: `${pct}%`, target: `${m.target}%`, progress: Math.min(100, Math.round((100 * pct) / m.target)),
        unit: `of chosen installs, across ${counted} published packages`, link: "./?page=dashboard&range=weekly", source: "Dashboard, adoption" });
      return out;
    }
    if (m.kind === "issueResponse") {
      const within = m.withinHours || 168, now = Date.now();
      // The collector only refreshes this window; older days are stale.
      const windowDays = 30, from = new Date(now - windowDays * 864e5).toISOString().slice(0, 10);
      const { answered, pending, total, pct } = responseStats(D.issueResponse, { withinHours: within, from, now });
      const days = Math.round(within / 24);
      Object.assign(out, { current: pct == null ? null : `${pct}%`, target: `${m.target}%`, progress: pct == null ? null : Math.min(100, Math.round((100 * pct) / m.target)), unit: `${answered} of ${total} issues, last ${windowDays} days${pending ? `, ${pending} still within ${days} days` : ""}`, link: "./?page=dashboard&range=weekly", origin: originFor(m, originContext(null)), note: total ? null : "No issues opened in the window yet." });
      return out;
    }
    out.note = `Unknown metric kind ${m.kind}.`; return out;
  }

  // Key results: strings or objects; progress from numbers someone set, or from the Dashboard when `metric` is set.
  function keyResultsOf(star) {
    return (star.keyResults || []).map((kr, i) => {
      const o = typeof kr === "string" ? { label: kr } : kr;
      const ev = evaluateMetric(o);
      let progress = Number.isFinite(Number(o.progress)) ? Number(o.progress) : null;
      if (progress == null && Number.isFinite(Number(o.target)) && Number.isFinite(Number(o.current)) && Number(o.target) > 0) {
        progress = (100 * Number(o.current)) / Number(o.target);
      }
      if (ev && ev.progress != null) progress = ev.progress;
      return { id: o.id || `${star.id}-kr-${i + 1}`, label: o.label || String(kr), target: ev ? ev.target : o.target, current: ev ? ev.current : o.current, unit: ev ? ev.unit : o.unit,
        source: ev ? ev.source : o.source, sourceLink: ev ? ev.link : null, origin: ev ? ev.origin : null, data: ev ? ev.data : null, note: [o.note, ev && ev.note].filter(Boolean).join(" "), fromDashboard: Boolean(ev), valueTitle: ev ? ev.valueTitle : null,
        progress: progress == null ? null : Math.max(0, Math.min(100, Math.round(progress))) };
    });
  }

  // The definition the Key results page prints under every row: what is counted, what the target
  // is, and how it is judged. It is what turns "0 of 35" from a failure into a stated position,
  // so the Roadmap and the Overview show it too rather than leaving it one page away.
  const krExplain = (kr) => [kr.unit, kr.note].filter(Boolean).join(" · ");

  function renderKrChip(kr, starId) {
    const measured = kr.progress != null;
    return el(
      "a",
      // The tip goes on the link, not inside it: a focusable span within a link would give one
      // chip two tab stops.
      { ...tipAttrs(krExplain(kr), kr.label), class: `kr${measured ? "" : " unmeasured"}${krExplain(kr) ? " has-tip" : ""}`, href: `./?page=results#${starId}` },
      el("span", { class: "kr-label" }, kr.label),
      measured
        ? el("span", { class: "kr-meter", "aria-label": `${kr.progress}%` }, el("span", { class: "kr-bar" }, el("span", { style: `width:${pct(kr.progress)}%` })), el("span", { class: "kr-pct" }, `${kr.progress}%`))
        : el("span", { class: "kr-none" }, "not measured")
    );
  }

  function renderKrStrip(star) {
    const krs = keyResultsOf(star);
    if (!krs.length) return null;
    return el("div", { class: "kr-strip", "aria-label": "Key results" }, krs.map((kr) => renderKrChip(kr, star.id)));
  }

  return {
    keyResultsOf, krExplain, renderKrStrip, splitInstalls,
  };
}
