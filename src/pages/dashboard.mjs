// The evidence: tiles, charts and the release-readiness table, for whichever repositories are selected.

import { el, withTip } from "../dom.mjs";
import { createModel } from "../model.mjs";
import { createData } from "../data.mjs";
import { createSeries } from "../series.mjs";
import { createKeyResults } from "../key-results.mjs";
import { use } from "../context.mjs";
import { weightedCurrency } from "../../lib/adoption.mjs";
import { responseStats } from "../../lib/support.mjs";

export default function createDashboardPage(ctx) {
  use(ctx, createModel);
  use(ctx, createData);
  use(ctx, createSeries);
  use(ctx, createKeyResults);

  const { query, setUrlParams, atlas, onUrlChange, poster, unscoped, walletRepos, loadMetrics, loadThirdParty,
    readinessFact, SERIES, fmtNum, deltaPill, trendPill, defFor, defTip, statTile, lineChart,
    releaseMarks, groupedBars, hBars, exportControls, chartCard, dashSection, GRAINS, grain,
    bucketKey, bucketLabel, coverageOf, seriesBuckets, lastTwo, snapshotSeries, coverageNote,
    splitInstalls, keyResultsOf, firstFullMonth, unit } = ctx;

  const SEL_KEY = "atlas:dash:repos";

  function readSelection(all) {
    // has(), not get(): an empty ?repos= means nothing selected, which is a state a link carries.
    if (query.has("repos")) { const set = new Set((query.get("repos") || "").split(",").filter(Boolean)); return all.filter((r) => set.has(r)); }
    try { const saved = JSON.parse(localStorage.getItem(SEL_KEY) || "null"); if (Array.isArray(saved) && saved.length) return all.filter((r) => saved.includes(r)); } catch {}
    return all;
  }

  function saveSelection(selected, all) {
    try { selected.length === all.length ? localStorage.removeItem(SEL_KEY) : localStorage.setItem(SEL_KEY, JSON.stringify(selected)); } catch {}
  }

  // Monthly is offered once event collection covers a whole calendar month; before that every event
  // chart would only say "no complete month yet". The URL still accepts range=monthly.
  function monthlyReady(file) {
    const since = file.since; if (!since) return false;
    const [, done] = firstFullMonth(since);
    return new Date().toISOString().slice(0, 10) >= done.toISOString().slice(0, 10);
  }

  const grainHref = (id) => { const u = new URLSearchParams(query); u.set("page", "dashboard"); u.set("range", id); return `./?${u}`; };

  function renderGrainSwitch(file) {
    const link = (id) => el("a", { href: grainHref(id), "data-grain": id, "aria-current": grain === id ? "page" : null }, GRAINS[id]);
    const ids = Object.keys(GRAINS).filter((id) => id !== "monthly" || grain === "monthly" || monthlyReady(file));
    return el("nav", { class: "view-toggle", "aria-label": "Granularity" }, ids.map(link));
  }

  // The selection panel: one checkbox per repo, grouped by atlas section; changes re-render the numbers in place.
  function renderRepoPanel(file, selected, onChange) {
    const all = Object.keys(file.repos).sort();
    const sections = (atlas.sections || []).map((sec) => sec.id);
    const groupOf = (name) => file.repos[name].section || "other";
    const labelOf = (id) => ((atlas.sections || []).find((sec) => sec.id === id) || {}).label || "Not on the map";
    const groups = [...new Set([...sections, "other"])].map((id) => [id, all.filter((n) => groupOf(n) === id)]).filter(([, names]) => names.length);
    const panel = el("details", { class: "repo-panel" });
    const count = el("span", { class: "view-count" }, `${selected.length}/${all.length}`);
    const summary = el("summary", { class: "repo-panel-summary" }, "Tracked repos ", count);
    const boxes = new Map();
    const apply = () => {
      const chosen = all.filter((n) => boxes.get(n).checked);
      count.textContent = `${chosen.length}/${all.length}`;
      saveSelection(chosen, all);
      // Read from the address but never written to it, so a dashboard link used to show the
      // recipient a different set of repositories.
      setUrlParams({ repos: chosen.length === all.length ? null : chosen.join(",") });
      onChange(chosen);
    };
    const list = el("div", { class: "repo-groups" }, groups.map(([id, names]) =>
      el("fieldset", { class: "repo-group" }, el("legend", null, labelOf(id)), names.map((n) => {
        const box = el("input", { type: "checkbox", value: n });
        box.checked = selected.includes(n);
        box.addEventListener("change", apply);
        boxes.set(n, box);
        const r = file.repos[n];
        const pkgLabel = unscoped(r.package);
        return el("label", withTip({ class: "repo-row" }, n, r.title), box, el("span", { class: "repo-title" }, r.title), pkgLabel && pkgLabel !== r.title && el("span", { class: "repo-pkg" }, pkgLabel));
      }))));
    const tools = el("div", { class: "repo-tools" },
      el("button", { type: "button", class: "linkish" }, "All"), el("button", { type: "button", class: "linkish" }, "None"), el("button", { type: "button", class: "linkish" }, "On the map only"));
    const [allBtn, noneBtn, mapBtn] = tools.querySelectorAll("button");
    allBtn.addEventListener("click", () => { for (const b of boxes.values()) b.checked = true; apply(); });
    noneBtn.addEventListener("click", () => { for (const b of boxes.values()) b.checked = false; apply(); });
    mapBtn.addEventListener("click", () => { for (const [n, b] of boxes) b.checked = Boolean(file.repos[n].module); apply(); });
    panel.append(summary, el("div", { class: "repo-panel-body" }, tools, list));
    return panel;
  }

  function buildDashboard(file, selected, third) {
    const snaps = file.snapshots || {};
    const snapDays = Object.keys(snaps).sort();
    const latest = snaps[snapDays[snapDays.length - 1]] || {};
    const sum = (obj) => selected.reduce((n, r) => n + ((obj || {})[r] || 0), 0);
    const uniq = (obj) => new Set(selected.flatMap((r) => (obj || {})[r] || [])).size;
    const people = uniq(file.contributors || latest.contributors);
    const D = file.daily || {};
    const dlCov = coverageOf(D.downloads, file, false), evCov = coverageOf(D.prsOpened, file, true);
    const dl = seriesBuckets(D.downloads, selected, { coverage: dlCov });
    const ev = (series) => seriesBuckets(series, selected, { coverage: evCov });
    const prsO = ev(D.prsOpened), prsM = ev(D.prsMerged);
    const xO = ev(D.externalPrsOpened), xM = ev(D.externalPrsMerged);
    const isO = ev(D.issuesOpened), isC = ev(D.issuesClosed);
    const backlogSeries = snapshotSeries(snaps, "openIssues", selected);
    const contribSeries = snapshotSeries(snaps, "contributors", selected, (vals) => vals.reduce((n, v) => n + (Array.isArray(v) ? v.length : v), 0));
    const dlLast = lastTwo(dl);
    const align = (a, b) => { const keys = [...new Set([...a, ...b].map((p) => p.key))].sort(); const at = (s, k) => (s.find((p) => p.key === k) || {}).y || 0; return { cats: keys.map(bucketLabel), a: keys.map((k) => at(a, k)), b: keys.map((k) => at(b, k)) }; };
    const pr = align(prsO, prsM), xpr = align(xO, xM), iss = align(isO, isC);
    const published = (latest.published || []).filter((r) => selected.includes(r)).length;
    const withPkg = selected.filter((r) => file.repos[r].package).length;
    const stable = selected.filter((r) => readinessFact("stable", r, latest)).length;
    const krs = new Map((atlas.northStars || []).flatMap((star) => keyResultsOf(star)).map((kr) => [kr.id, kr]));
    const feeds = (id) => { const kr = krs.get(id); return kr ? { id, label: `${kr.label}${kr.target != null ? ` · target ${kr.target}` : ""}` } : null; };

    // Downloads for the last complete period, per package, then split.
    //
    // Internal dependencies are pinned to an exact version, so an install of a package that
    // something else pins is attributable to whatever pinned it. Induced is an upper bound,
    // because a cache means a dependent install does not always fetch the dependency again;
    // chosen is therefore a lower bound. Both are bounds, and the page says so.
    const { withPackages, split, edges } = splitInstalls(file, selected);
    const partOf = (r, part) => (split[r] ? split[r][part] : 0);
    const chosenTotal = withPackages.reduce((n, r) => n + partOf(r, "direct"), 0);
    const inducedTotal = withPackages.reduce((n, r) => n + partOf(r, "induced"), 0);
    const rank = (part) => withPackages
      .map((r) => ({ label: unscoped(file.repos[r].package), hint: file.repos[r].title !== r ? file.repos[r].title : "", value: partOf(r, part) }))
      .filter((row) => row.value > 0).sort((a, b) => b.value - a.value).slice(0, 8);
    const byPackage = rank("direct");
    const byInduced = rank("induced");
    // Retention, as far as public data can show it.
    //
    // Weighted by chosen installs rather than by all of them. An install that another WDK package
    // pinned is on an old version by construction, so weighting by the raw total would measure
    // our own dependency graph and call it a reader failing to upgrade.
    const onLatest = latest.onLatest || {};
    const currencyRepos = withPackages.filter((r) => typeof onLatest[r] === "number");
    const currencyPct = weightedCurrency(onLatest, Object.fromEntries(withPackages.map((r) => [r, Math.max(partOf(r, "direct"), 0)])));
    // The middle of an even set is the mean of the two middle values, so that a reader who
    // recomputes it from the export gets the same number we printed.
    const median = (xs) => {
      if (!xs.length) return null;
      const v = [...xs].sort((a, b) => a - b), i = Math.floor(v.length / 2);
      return v.length % 2 ? v[i] : Math.round((v[i - 1] + v[i]) / 2);
    };
    const medianShare = median(currencyRepos.map((r) => onLatest[r]));
    const byCurrency = currencyRepos
      .map((r) => ({ label: unscoped(file.repos[r].package), value: onLatest[r] }))
      .sort((a, b) => a.value - b.value).slice(0, 8);

    // Answered within a week, over the same selection as everything else on the page.
    const supportFrom = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
    const supportStats = responseStats(D.issueResponse, { withinHours: 168, from: supportFrom, repos: selected });

    const splitHint = Object.keys(edges).length
      ? el("span", null,
          el("span", withTip({}, defTip(defFor("downloads-direct")), "chosen"), `${fmtNum(chosenTotal)} or more chosen`),
          " · ",
          el("span", withTip({}, defTip(defFor("downloads-induced")), "pulled in"), `${fmtNum(inducedTotal)} or fewer pulled in`))
      : null;

    // The order is the argument, and the row is now only the numbers that carry one. Stars and
    // the open-issue level were demoted by the review and removed by the PM. Both keep their
    // chart further down the page, where a count is context rather than a headline.
    const tiles = el("div", { class: "tiles" },
      latest.dependents != null && statTile(defFor("dependents"), "Projects depending on WDK", fmtNum(latest.dependents), el("span", { class: "delta none" }, "public repos outside the org"), "from GitHub code search"),
      statTile(defFor("downloads"), `npm downloads, last full ${unit}`, dlLast.now == null ? "—" : fmtNum(dlLast.now), trendPill("downloads", dl), splitHint || (dlLast.key ? `${withPkg} packages` : coverageNote(dlCov))),
      currencyPct != null && statTile(defFor("version-currency"), "Version currency", `${currencyPct}%`,
        el("span", { class: "delta none" }, `${currencyRepos.length} packages`),
        `median ${medianShare}% per package`),
      supportStats.pct != null && statTile(defFor("issue-response"), "Answered within a week", `${supportStats.pct}%`,
        el("span", { class: "delta none" }, `${supportStats.total} issues`),
        `${supportStats.pending ? `${supportStats.pending} still inside the week` : "last 30 days"}`,
        feeds("issue-response")),
      statTile(defFor("external-prs-merged"), `External pull requests merged, last ${unit}`, lastTwo(xM).now == null ? "—" : String(lastTwo(xM).now), trendPill("external-prs-merged", xM), lastTwo(xM).now == null ? coverageNote(evCov) : `${lastTwo(xO).now ?? 0} opened`, feeds("external-prs")),
      statTile(defFor("contributors"), "Contributors", String(people), trendPill("contributors", contribSeries), "bots excluded"),
      statTile(defFor("packages-published"), "Packages published", String(published), el("span", { class: "delta none" }, `${stable} stable · ${published - stable} in beta`), `${(atlas.modules || []).filter((m) => m.publisher && m.publisher !== file.org && m.status === "shipped").length} more by third parties`, feeds("stable")),
    );

    const byStars = selected.map((r) => ({ label: r, hint: file.repos[r].title !== r ? file.repos[r].title : "", value: (latest.stars || {})[r] || 0 })).sort((a, b) => b.value - a.value).slice(0, 8);

    // Every export says which day the numbers were collected and how much of the org they cover.
    const exportMeta = { collected: String(file.updated).slice(0, 10), scope: `${selected.length} of ${Object.keys(file.repos).length} repos` };
    const series2 = (cats, a, b, ca, cb) => ({ ...exportMeta, columns: ["period", ca, cb], rows: cats.map((c, i) => [c, a[i], b[i]]) });

    const adoption = dashSection("Adoption & growth", [
      chartCard(defFor("downloads"), `npm downloads per ${unit}`, fmtNum(dlLast.now), trendPill("downloads", dl), dl.length ? lineChart(dl, { marks: releaseMarks(file, selected) }) : el("p", { class: "chart-foot" }, coverageNote(dlCov)), "Ticks mark releases. The current period is left out; npm reports late.",
        { ...exportMeta, columns: ["period", "downloads"], rows: dl.map((p) => [p.key, p.y]) }),
      chartCard(defFor("downloads-direct"), `Chosen installs by package, last full ${unit}`, fmtNum(chosenTotal), null, hBars(byPackage, { color: SERIES[1] }), "Top eight. A lower bound.",
        { ...exportMeta, columns: ["package", "title", "chosen installs, at least"], rows: byPackage.map((r) => [r.label, r.hint, r.value]) }),
      byCurrency.length ? chartCard(defFor("version-currency"), "Installs on the latest release, by package", currencyPct == null ? null : `${currencyPct}%`, null,
        hBars(byCurrency, { color: SERIES[0], unit: "%", scale: 100 }), "The eight furthest behind.",
        { ...exportMeta, columns: ["package", "share of installs on the latest release"], rows: byCurrency.map((r) => [r.label, r.value]) }) : null,
      byInduced.length ? chartCard(defFor("downloads-induced"), `Pulled in as a dependency, last full ${unit}`, fmtNum(inducedTotal), null, hBars(byInduced, { color: SERIES[2] }), "Top eight. An upper bound.",
        { ...exportMeta, columns: ["package", "title", "pulled in, at most"], rows: byInduced.map((r) => [r.label, r.hint, r.value]) }) : null,
      chartCard(defFor("stars"), "Stars by repository", fmtNum(sum(latest.stars)), null, hBars(byStars, { color: SERIES[2] }), "Top eight of the selection.",
        { ...exportMeta, columns: ["repo", "title", "stars"], rows: byStars.map((r) => [r.label, r.hint, r.value]) }),
    ]);
    // External contributors over the same complete periods the pull request charts show.
    const windowKeys = new Set([...prsO, ...prsM].map((p) => p.key));
    const authors = {};
    const addAuthors = (series, field) => { for (const r of selected) for (const [d, logins] of Object.entries((series || {})[r] || {})) { if (!windowKeys.has(bucketKey(d))) continue; for (const [login, n] of Object.entries(logins)) { authors[login] = authors[login] || { opened: 0, merged: 0 }; authors[login][field] += n; } } };
    addAuthors(D.externalAuthorsOpened, "opened"); addAuthors(D.externalAuthorsMerged, "merged");
    const topAuthors = Object.entries(authors).sort((a, b) => b[1].opened - a[1].opened || b[1].merged - a[1].merged).slice(0, 5)
      .map(([login, a]) => ({ label: login, hint: `${((file.authors || {})[login] || "").toLowerCase().replace(/_/g, " ")} · ${a.merged} merged`, value: a.opened }));
    const windowLabel = windowKeys.size ? `last ${windowKeys.size} ${unit}${windowKeys.size === 1 ? "" : "s"}` : "no complete period yet";
    const community = dashSection("Community & engagement", [
      chartCard(defFor("external-authors"), `External contributors, ${windowLabel}`, String(Object.keys(authors).length), null, topAuthors.length ? hBars(topAuthors, { color: SERIES[1] }) : el("p", { class: "chart-foot" }, windowKeys.size ? "No external pull requests in the window." : coverageNote(evCov)), "Top five by pull requests opened.",
        { ...exportMeta, columns: ["author", "detail", "pull requests opened"], rows: topAuthors.map((r) => [r.label, r.hint, r.value]) }),
      chartCard(defFor("prs-flow"), `Pull requests per ${unit}`, lastTwo(prsO).now == null ? "—" : String(lastTwo(prsO).now), null, pr.cats.length ? groupedBars(pr.cats, [{ label: "Opened", values: pr.a }, { label: "Merged", values: pr.b }]) : el("p", { class: "chart-foot" }, coverageNote(evCov)), "Complete periods only.", series2(pr.cats, pr.a, pr.b, "opened", "merged")),
      chartCard(defFor("external-prs-merged"), `External pull requests per ${unit}`, lastTwo(xO).now == null ? "—" : String(lastTwo(xO).now), null, xpr.cats.length ? groupedBars(xpr.cats, [{ label: "Opened", values: xpr.a }, { label: "Merged", values: xpr.b }]) : el("p", { class: "chart-foot" }, coverageNote(evCov)), "Authors outside the org.", series2(xpr.cats, xpr.a, xpr.b, "opened", "merged")),
    ]);
    const support = dashSection("Support & responsiveness", [
      chartCard(defFor("issues-flow"), `Issues opened and closed per ${unit}`, String(sum(latest.openIssues)), deltaPill("open-issues", lastTwo(backlogSeries).now, lastTwo(backlogSeries).prev, { invert: true }), iss.cats.length ? groupedBars(iss.cats, [{ label: "Opened", values: iss.a }, { label: "Closed", values: iss.b }]) : el("p", { class: "chart-foot" }, coverageNote(evCov)), "Headline is today's backlog.", series2(iss.cats, iss.a, iss.b, "opened", "closed")),
    ]);
    const readiness = renderReadiness(file, selected, latest);
    const note = el("p", { class: "dash-note" }, `${selected.length} of ${Object.keys(file.repos).length} public WDK repos · npm and GitHub only · collected ${String(file.updated).slice(0, 10)} · snapshots since ${snapDays[0]}`);
    return [tiles, adoption, renderThirdParty(third), community, support, readiness, note];
  }

  // The packages built by others, from their own file. They are never part of the selection
  // above, and no figure or key result elsewhere counts them as ours: this section is the one
  // place they are summed, and it says so.
  function renderThirdParty(third) {
    if (!third) return dashSection("Third-party packages", [el("p", { class: "chart-foot" }, "Not collected yet; the next metrics run adds data/third-party.json.")]);
    const packages = third.packages || {};
    const names = Object.keys(packages);
    const perPkg = Object.fromEntries(names.map((p) => [p, packages[p].downloads || {}]));
    const cov = coverageOf(perPkg, third, false);
    const total = seriesBuckets(perPkg, names, { coverage: cov });
    const last = lastTwo(total);
    // Each package's figure is read at the same period as the total, so a package quiet in the
    // last period shows zero rather than its last busy one.
    const inLast = (p) => (last.key ? (seriesBuckets({ [p]: perPkg[p] }, [p], { coverage: cov }).find((pt) => pt.key === last.key) || {}).y || 0 : null);
    const rows = names.map((p) => { const { module, title, publisher, repo, version } = packages[p]; return { pkg: p, module, title, publisher, repo, version, last: inLast(p) }; })
      .sort((a, b) => (b.last || 0) - (a.last || 0) || a.pkg.localeCompare(b.pkg));
    const collected = String(third.updated || "").slice(0, 10);
    const exportMeta = { collected, scope: `${names.length} third-party packages` };
    const head = el("tr", null, ["Package", "Publisher", "Module", "Version", `Downloads, last full ${unit}`].map((h) => el("th", null, h)));
    const table = el("div", { class: "table-wrap" }, el("table", { class: "ready" }, el("thead", null, head), el("tbody", null, rows.map((r) =>
      el("tr", null,
        el("td", null, r.repo ? el("a", { href: r.repo }, r.pkg) : r.pkg),
        el("td", null, r.publisher),
        el("td", null, el("a", { href: `./?page=map#${encodeURIComponent(r.module)}` }, r.title)),
        el("td", { class: "mono" }, r.version || "—"),
        el("td", { class: "mono" }, r.last == null ? "·" : fmtNum(r.last)))))));
    // The same volume gathered by who built it, which is the split the section exists for. A
    // bar per package was here too and read as a copy: ten of the eleven publishers ship one
    // package, and the table below lists every package anyway.
    const perPublisher = new Map();
    for (const r of rows) { const p = perPublisher.get(r.publisher) || { label: r.publisher, value: 0, n: 0 }; p.value += r.last || 0; p.n += 1; perPublisher.set(r.publisher, p); }
    const byPublisher = [...perPublisher.values()].filter((p) => p.value > 0).sort((a, b) => b.value - a.value).slice(0, 8).map((p) => ({ label: p.label, hint: `${p.n} package${p.n === 1 ? "" : "s"}`, value: p.value }));
    const unmeasured = (third.unmeasured || []).map((u) => `${u.title} (${u.publisher}): ${u.reason}`);
    const listExport = { title: "Third-party packages", ...exportMeta, columns: ["package", "publisher", "module", "version", `downloads, last full ${unit}`],
      rows: rows.map((r) => [r.pkg, r.publisher, r.module, r.version || "", r.last == null ? "" : r.last]) };
    return dashSection("Third-party packages", [
      chartCard(defFor("third-party-downloads"), `npm downloads of third-party packages per ${unit}`, last.now == null ? "—" : fmtNum(last.now), trendPill("third-party-downloads", total),
        total.length ? lineChart(total) : el("p", { class: "chart-foot" }, coverageNote(cov)), `${names.length} packages, summed. Not part of the selection above.`,
        { ...exportMeta, columns: ["period", "downloads"], rows: total.map((p) => [p.key, p.y]) }),
      chartCard(defFor("third-party-downloads"), `By publisher, last full ${unit}`, String(perPublisher.size), null,
        byPublisher.length ? hBars(byPublisher, { color: SERIES[2] }) : el("p", { class: "chart-foot" }, "No downloads in the period."), "Every package a publisher ships, summed.",
        { ...exportMeta, columns: ["publisher", "packages", "downloads"], rows: byPublisher.map((r) => [r.label, r.hint, r.value]) }),
      el("div", { class: "ready-card" },
        el("div", { class: "ready-tools" }, rows.length ? exportControls(defFor("third-party-downloads"), listExport) : null),
        table,
        el("p", { class: "chart-foot" }, `Every shipped module on the map whose publisher is not ${third.org || "the organisation"}, read from npm alone; the map and the drawer say who built each one.`
          + (unmeasured.length ? ` Not measured: ${unmeasured.join("; ")}.` : "") + ` Collected ${collected}.`)),
    ]);
  }

  // Release readiness: the facts behind the "production-grade kit" key results, one row per published package.
  // Every cell is public: npm's latest tag, the last CI run, an audit folder, GitHub's community profile,
  // the ISigner reference, CODEOWNERS.
  function renderReadiness(file, selected, latest) {
    const repos = selected.filter((r) => file.repos[r].version).sort();
    const wallets = new Set(walletRepos());
    // The symbol carries the state for anyone who can see it; the hidden word carries it for
    // everyone else, so nothing here depends on recognising a tick, a cross or a colour.
    const mark = (v) => (v == null
      ? el("span", { class: "fact none" }, "·", el("span", { class: "visually-hidden" }, "not measured"))
      : el("span", { class: `fact ${v ? "yes" : "no"}` }, v ? "✓" : "✕", el("span", { class: "visually-hidden" }, v ? "yes" : "no")));
    const count = (field) => repos.filter((r) => readinessFact(field, r, latest) === true).length;
    const measured = (field) => field === "stable" || Boolean(latest[field]);
    const healthVals = repos.map((r) => (latest.health || {})[r]).filter((v) => typeof v === "number");
    const avgHealth = healthVals.length ? Math.round(healthVals.reduce((a, b) => a + b, 0) / healthVals.length) : null;
    const summary = el("p", { class: "ready-summary" },
      `${count("stable")} of ${repos.length} stable`, " · ",
      measured("ci") ? `${count("ci")} green CI` : "CI not collected yet", " · ",
      measured("audits") ? `${count("audits")} with an audit` : "audits not collected yet", " · ",
      avgHealth == null ? "community health not collected yet" : `community health ${avgHealth}% on average`,
      latest.signer ? ` · signer interface in ${[...wallets].filter((r) => latest.signer[r]).length} of ${wallets.size} wallets` : "");
    const head = el("tr", null, ["Package", "Version", "Stable", "CI", "Audit", "Health", "Signer", "Owners"].map((h) => el("th", null, h)));
    const rows = repos.map((r) => {
      const info = file.repos[r];
      return el("tr", null,
        el("td", null, el("a", { href: `https://github.com/${file.org}/${r}` }, unscoped(info.package) || r), info.title && info.title !== r && el("span", { class: "ready-title" }, info.title)),
        el("td", { class: "mono" }, info.version || "—"),
        el("td", null, mark(readinessFact("stable", r, latest))),
        el("td", null, mark(readinessFact("ci", r, latest))),
        el("td", null, mark(readinessFact("audits", r, latest))),
        el("td", { class: "mono" }, (latest.health || {})[r] == null ? "·" : `${latest.health[r]}%`),
        el("td", null, wallets.has(r) ? mark(readinessFact("signer", r, latest)) : el("span", { class: "fact none" }, "–", el("span", { class: "visually-hidden" }, "not a wallet package"))),
        el("td", { class: "mono owners" }, ((file.owners || {})[r] || []).join(" ") || "—"));
    });
    const table = el("div", { class: "table-wrap" }, el("table", { class: "ready" }, el("thead", null, head), el("tbody", null, rows)));
    const readyExport = {
      title: "Release readiness",
      collected: String(file.updated).slice(0, 10),
      scope: `${repos.length} published packages`,
      columns: ["package", "version", "stable", "ci", "audit", "health", "signer", "owners"],
      rows: repos.map((r) => {
        const fact = (f) => { const v = readinessFact(f, r, latest); return v == null ? "not measured" : v ? "yes" : "no"; };
        return [unscoped(file.repos[r].package) || r, file.repos[r].version || "", fact("stable"), fact("ci"), fact("audits"),
          (latest.health || {})[r] == null ? "not measured" : latest.health[r],
          wallets.has(r) ? fact("signer") : "not a wallet package",
          ((file.owners || {})[r] || []).join(" ")];
      }),
    };
    const section = dashSection("Release readiness", [el("div", { class: "ready-card" }, el("div", { class: "ready-tools" }, exportControls(defFor("readiness"), readyExport)), summary, table, el("p", { class: "chart-foot" }, "From npm's latest tag, the newest CI run, an audit file, GitHub's community profile, ISigner and CODEOWNERS."))]);
    section.id = "readiness";
    return section;
  }

  async function renderDashboard() {
    const [file, third] = await Promise.all([loadMetrics(), loadThirdParty()]);
    if (!file) throw new Error("No data/metrics.json yet. Run bin/collect-metrics.mjs or the Metrics action.");
    if (file.schema !== 3) throw new Error("data/metrics.json is an older schema; run the collector again.");
    const all = Object.keys(file.repos || {}).sort();
    let selected = readSelection(all);
    const body = el("div", { class: "dash-body" }, buildDashboard(file, selected, third));
    const controls = el("div", { class: "dash-controls" }, renderGrainSwitch(file), renderRepoPanel(file, selected, (chosen) => { selected = chosen; body.replaceChildren(...buildDashboard(file, selected, third)); }));
    return el("div", { class: "dash-page" }, controls, body);
  }

  // The granularity links carry the query forward, so they go stale when the selection moves.
  onUrlChange(() => { for (const a of poster.querySelectorAll(".view-toggle a[data-grain]")) a.href = grainHref(a.dataset.grain); });

  return { render: renderDashboard };
}
