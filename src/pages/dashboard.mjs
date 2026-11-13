// The evidence: tiles, charts and the release-readiness table, for whichever repositories are selected.

import { el, withTip } from "../dom.mjs";
import { createModel } from "../model.mjs";
import { createData } from "../data.mjs";
import { createSeries } from "../series.mjs";
import { createKeyResults } from "../key-results.mjs";
import { use } from "../context.mjs";
import { createThirdParty } from "../third-party.mjs";
import { weightedCurrency } from "../../lib/adoption.mjs";
import { responseStats } from "../../lib/support.mjs";
import { median } from "../../lib/steady.mjs";
import { aggregate, namingAny } from "../../lib/projects.mjs";
import { nameSelection } from "../../lib/selection.mjs";

export default function createDashboardPage(ctx) {
  use(ctx, createModel);
  use(ctx, createData);
  use(ctx, createSeries);
  use(ctx, createKeyResults);
  use(ctx, createThirdParty);

  const { query, setUrlParams, atlas, onUrlChange, poster, unscoped, walletRepos, publishedRepos, loadMetrics, loadProjects, loadThirdParty,
    readinessFact, SERIES, fmtNum, deltaPill, trendPill, defFor, defTip, statTile, lineChart,
    releaseMarks, groupedBars, hBars, exportControls, chartCard, dashSection, GRAINS, grain,
    bucketKey, bucketLabel, coverageOf, seriesBuckets, lastTwo, snapshotSeries, coverageNote, gapNote, fmtLast, periodRows,
    splitInstalls, keyResultsOf, firstFullMonth, unit, renderThirdParty } = ctx;

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

  // Monthly is offered once the download series covers a whole calendar month; the event charts
  // say "no complete month yet" for themselves until they do.
  function monthlyReady(file) {
    const [since] = coverageOf((file.daily || {}).downloads, file, false);
    if (!since) return false;
    const [, done] = firstFullMonth(since);
    return new Date().toISOString().slice(0, 10) >= done.toISOString().slice(0, 10);
  }

  const grainHref = (id) => { const u = new URLSearchParams(query); u.set("page", "dashboard"); u.set("range", id); return `./?${u}`; };

  function renderGrainSwitch(file) {
    const link = (id) => el("a", { href: grainHref(id), "data-grain": id, "aria-current": grain === id ? "page" : null }, GRAINS[id]);
    const ids = Object.keys(GRAINS).filter((id) => id !== "monthly" || grain === "monthly" || monthlyReady(file));
    return el("nav", { class: "view-toggle", "aria-label": "Granularity" }, ids.map(link));
  }

  // The selection panel: one checkbox per repo, grouped by atlas section, a box per section and a few
  // named sets; changes re-render the numbers in place. The button names what is on show.
  function renderRepoPanel(file, selected, onChange) {
    const all = Object.keys(file.repos).sort();
    const titleOf = (n) => file.repos[n].title || n;
    const sectionIds = (atlas.sections || []).map((sec) => sec.id);
    const groupOf = (name) => file.repos[name].section || "other";
    const labelOf = (id) => ((atlas.sections || []).find((sec) => sec.id === id) || {}).label || "Not on the map";
    const groups = [...new Set([...sectionIds, "other"])].map((id) => [labelOf(id), all.filter((n) => groupOf(n) === id)]).filter(([, names]) => names.length);
    // The two scopes the key results measure, wallets and published packages, the protocols, and the map's own.
    const wallets = new Set(walletRepos());
    const presets = [
      ["Wallets", all.filter((n) => wallets.has(n))],
      ["Protocols", all.filter((n) => /^wdk-protocol-/.test(n))],
      ["Published on npm", publishedRepos()],
      ["On the map", all.filter((n) => file.repos[n].module)],
    ].filter(([, names]) => names.length);
    const panel = el("details", { class: "repo-panel" });
    const name = el("span", { class: "repo-panel-name" });
    const count = el("span", { class: "view-count" });
    const summary = el("summary", { class: "repo-panel-summary" }, el("span", { class: "repo-panel-label" }, "Showing"), name, count);
    // Beside the button, not in it: a summary may not hold a button.
    const reset = el("button", { type: "button", class: "linkish repo-reset" }, "Show all");
    const boxes = new Map(), groupBoxes = [];
    const presetButtons = presets.map(([label, names]) => [el("button", { type: "button", class: "linkish repo-preset" }, label, el("span", { class: "repo-preset-n" }, String(names.length))), names]);
    const sync = (chosen) => {
      const has = new Set(chosen), same = (names) => names.length === chosen.length && names.every((x) => has.has(x));
      name.textContent = nameSelection(chosen, all, presets, groups, titleOf);
      count.textContent = chosen.length === all.length ? String(all.length) : `${chosen.length} of ${all.length}`;
      panel.classList.toggle("is-narrowed", chosen.length < all.length);
      reset.hidden = chosen.length === all.length;
      for (const [box, names] of groupBoxes) { const k = names.filter((x) => has.has(x)).length; box.checked = k === names.length; box.indeterminate = k > 0 && k < names.length; }
      for (const [button, names] of presetButtons) button.setAttribute("aria-current", String(same(names)));
    };
    const apply = () => {
      const chosen = all.filter((n) => boxes.get(n).checked);
      sync(chosen);
      saveSelection(chosen, all);
      // Read from the address but never written to it, so a dashboard link used to show the
      // recipient a different set of repositories.
      setUrlParams({ repos: chosen.length === all.length ? null : chosen.join(",") });
      onChange(chosen);
    };
    const choose = (names) => { const set = new Set(names); for (const [n, b] of boxes) b.checked = set.has(n); apply(); };
    const list = el("div", { class: "repo-groups" }, groups.map(([label, names]) => {
      // Ticks or clears the whole section; half-set while only some of it is on show.
      const groupBox = el("input", { type: "checkbox" });
      groupBox.addEventListener("change", () => { for (const n of names) boxes.get(n).checked = groupBox.checked; apply(); });
      groupBoxes.push([groupBox, names]);
      return el("fieldset", { class: "repo-group" }, el("legend", null, el("label", { class: "repo-group-toggle" }, groupBox, label)), names.map((n) => {
        const box = el("input", { type: "checkbox", value: n });
        box.checked = selected.includes(n);
        box.addEventListener("change", apply);
        boxes.set(n, box);
        const r = file.repos[n];
        const pkgLabel = unscoped(r.package);
        // Beside the label, not in it: a label may not hold a button.
        const only = el("button", { type: "button", class: "linkish repo-only", "aria-label": `Show only ${r.title}` }, "only");
        only.addEventListener("click", () => choose([n]));
        return el("div", { class: "repo-line" },
          el("label", withTip({ class: "repo-row" }, n, r.title), box, el("span", { class: "repo-title" }, r.title), pkgLabel && pkgLabel !== r.title && el("span", { class: "repo-pkg" }, pkgLabel)),
          only);
      }));
    }));
    const noneButton = el("button", { type: "button", class: "linkish" }, "None");
    reset.addEventListener("click", () => choose(all));
    noneButton.addEventListener("click", () => choose([]));
    for (const [button, names] of presetButtons) button.addEventListener("click", () => choose(names));
    const tools = el("div", { class: "repo-tools" }, noneButton, el("span", { class: "repo-tools-sep" }), presetButtons.map(([button]) => button));
    panel.append(summary, el("div", { class: "repo-panel-body" }, tools, list));
    sync(selected);
    return el("div", { class: "repo-scope" }, panel, reset);
  }

  function buildDashboard(file, selected, third, projects) {
    const snaps = file.snapshots || {};
    const snapDays = Object.keys(snaps).sort();
    const latest = snaps[snapDays[snapDays.length - 1]] || {};
    const sum = (obj) => selected.reduce((n, r) => n + ((obj || {})[r] || 0), 0);
    const uniq = (obj) => new Set(selected.flatMap((r) => (obj || {})[r] || [])).size;
    const people = uniq(file.contributors || latest.contributors);
    const D = file.daily || {};
    const dlCov = coverageOf(D.downloads, file, false), evCov = coverageOf(D.prsOpened, file, true);
    const dl = seriesBuckets(D.downloads, selected, { coverage: dlCov });
    const ev = (series) => seriesBuckets(series, selected, { coverage: evCov, fill: true });
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
    // The public projects naming a package the selected repos publish, counted from the list by the
    // collector's own counter. Every published package selected is all of WDK, whatever else is left
    // out; the collector's count stands in when the list did not load.
    const packageSet = (names) => new Set(names.map((r) => file.repos[r]).filter((r) => r.version).map((r) => r.package));
    const chosenPackages = packageSet(selected);
    const tracked = projects && chosenPackages.size < packageSet(Object.keys(file.repos)).size ? chosenPackages : null;
    const naming = projects && namingAny(projects.repos, tracked);
    const census = naming ? { measured: projects.measured, ...aggregate(naming) } : file.adopters;

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
    const medianShare = median(currencyRepos.map((r) => onLatest[r]));
    // Only packages someone chose: one installed only through our pins says where the pins point.
    const byCurrency = currencyRepos.filter((r) => partOf(r, "direct") > 0)
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
      census && statTile(defFor("dependents"), "Projects depending on WDK", fmtNum(census.projects), el("span", { class: "delta none" }, `${census.building} still building`), `public repos, counted ${census.measured}`),
      statTile(defFor("downloads"), `npm downloads, last full ${unit}`, fmtLast(dlLast), trendPill("downloads", dl), splitHint || (dlLast.key ? `${withPkg} package${withPkg === 1 ? "" : "s"}` : coverageNote(dlCov))),
      currencyPct != null && statTile(defFor("version-currency"), "Version currency", `${currencyPct}%`,
        el("span", { class: "delta none" }, `${currencyRepos.length} package${currencyRepos.length === 1 ? "" : "s"}`),
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
      chartCard(defFor("downloads"), `npm downloads per ${unit}`, fmtLast(dlLast), trendPill("downloads", dl), dl.length ? lineChart(dl, { marks: releaseMarks((r) => (file.releases || {})[r], selected, (r) => unscoped(file.repos[r] && file.repos[r].package) || r) }) : el("p", { class: "chart-foot" }, coverageNote(dlCov)), ["Ticks mark releases.", gapNote(dl), "The current period is left out; npm reports late."].filter(Boolean).join(" "),
        { ...exportMeta, columns: ["period", "downloads", "note"], rows: periodRows(dl) }),
      chartCard(defFor("downloads-direct"), `Chosen installs by package, last full ${unit}`, fmtNum(chosenTotal), null, hBars(byPackage, { color: SERIES[1] }), "Top eight. A lower bound.",
        { ...exportMeta, columns: ["package", "title", "chosen installs, at least"], rows: byPackage.map((r) => [r.label, r.hint, r.value]) }),
      byCurrency.length ? chartCard(defFor("version-currency"), "Installs on the latest release, by package", currencyPct == null ? null : `${currencyPct}%`, null,
        hBars(byCurrency, { color: SERIES[0], unit: "%", scale: 100 }), "Of the packages people chose, the eight furthest behind.",
        { ...exportMeta, columns: ["package", "share of installs on the latest release"], rows: byCurrency.map((r) => [r.label, r.value]) }) : null,
      byInduced.length ? chartCard(defFor("downloads-induced"), `Pulled in as a dependency, last full ${unit}`, fmtNum(inducedTotal), null, hBars(byInduced, { color: SERIES[2] }), "Top eight. An upper bound.",
        { ...exportMeta, columns: ["package", "title", "pulled in, at most"], rows: byInduced.map((r) => [r.label, r.hint, r.value]) }) : null,
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
      chartCard(defFor("external-prs-merged"), `External pull requests per ${unit}`, lastTwo(xM).now == null ? "—" : String(lastTwo(xM).now), null, xpr.cats.length ? groupedBars(xpr.cats, [{ label: "Opened", values: xpr.a }, { label: "Merged", values: xpr.b }]) : el("p", { class: "chart-foot" }, coverageNote(evCov)), "Authors outside the org.", series2(xpr.cats, xpr.a, xpr.b, "opened", "merged")),
      chartCard(defFor("stars"), "Stars by repository", fmtNum(sum(latest.stars)), null, hBars(byStars, { color: SERIES[2] }), "Top eight of the selection.",
        { ...exportMeta, columns: ["repo", "title", "stars"], rows: byStars.map((r) => [r.label, r.hint, r.value]) }),
    ]);
    const support = dashSection("Support & responsiveness", [
      chartCard(defFor("issues-flow"), `Issues opened and closed per ${unit}`, String(sum(latest.openIssues)), deltaPill("open-issues", lastTwo(backlogSeries).now, lastTwo(backlogSeries).prev, { invert: true }), iss.cats.length ? groupedBars(iss.cats, [{ label: "Opened", values: iss.a }, { label: "Closed", values: iss.b }]) : el("p", { class: "chart-foot" }, coverageNote(evCov)), "Headline is today's backlog.", series2(iss.cats, iss.a, iss.b, "opened", "closed")),
    ]);
    const readiness = renderReadiness(file, selected, latest);
    const note = el("p", { class: "dash-note" }, `${selected.length} of ${Object.keys(file.repos).length} public WDK repos · npm and GitHub only · collected ${String(file.updated).slice(0, 10)} · snapshots since ${snapDays[0]}`);
    return [tiles, adoption, census && renderProjects(census, naming, tracked), renderThirdParty(third), community, support, readiness, note];
  }

  // The public projects behind the dependents count, from the census the collector keeps
  // (bin/lib/census.mjs). `tracked` is the packages of the selected repos, null for all of WDK; `list`
  // the rows naming one of them, null when data/projects.json did not load. A month
  // is the one the project's repository was created in, and only whole months are drawn, like every
  // other chart.
  function renderProjects(c, list, tracked) {
    const [y, m] = c.measured.split("-").map(Number);
    const months = Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(y, m - 13 + i, 1)).toISOString().slice(0, 7));
    const counts = months.map((k) => c.cohorts[k] || [0, 0]);
    const earlier = Object.entries(c.cohorts).filter(([k]) => k < months[0]).reduce((n, [, v]) => n + v[0], 0);
    const short = (k) => new Date(`${k}-01T00:00:00Z`).toLocaleDateString("en", { month: "short", timeZone: "UTC" });
    const named = Object.entries(c.packages).filter(([name]) => !tracked || tracked.has(name));
    const top = named.slice(0, 8).map(([name, n]) => ({ label: unscoped(name), value: n }));
    const packagesOf = tracked && (tracked.size ? `one of the ${tracked.size} package${tracked.size === 1 ? "" : "s"} the selected repos publish` : null);
    const meta = { collected: c.measured, scope: `public repositories outside the org, ${tracked ? `naming ${packagesOf || "no package: the selected repos publish none"}` : "all of WDK"}` };
    return dashSection("Projects building on WDK", [
      chartCard(defFor("dependents-active"), "Projects started and still building, by month", String(c.building), null,
        groupedBars(months.map(short), [{ label: "Started", values: counts.map((v) => v[0]) }, { label: "Still building", values: counts.map((v) => v[1]) }]),
        `${c.organisations} of those still building belong to organisations. ${earlier} started before ${short(months[0])} ${months[0].slice(0, 4)}. ${c.modules ? `${c.modules} WDK modules' own repositories left out. ` : ""}Public GitHub only.`,
        { ...meta, columns: ["month", "started", "still building"], rows: months.map((k, i) => [k, ...counts[i]]) }),
      chartCard(defFor("dependents"), "Packages public projects use", fmtNum(c.projects), null,
        top.length ? hBars(top, { color: SERIES[1] }) : el("p", { class: "chart-foot" }, "No public project names a package of the selected repos."),
        "Projects naming each package, top eight. A project can name several.",
        { ...meta, columns: ["package", "projects"], rows: named }),
      list && renderProjectList(list, meta),
    ], tracked && (packagesOf ? `Public projects naming ${packagesOf}.` : "The selected repos publish no package, so no project is counted."));
  }

  // Every project the census found, the most starred first, WDK modules' own among them and marked,
  // with one box to hide those. "On the map" is read from atlas.yaml, so it is right as soon as the
  // map changes. A link here is not a recommendation: anything public can name a package, and the
  // foot says so.
  function renderProjectList(repos, meta) {
    const mapped = new Set((atlas.modules || []).map((m) => (/github\.com\/([^/]+\/[^/#?]+)/.exec(m.repo || "") || [])[1])
      .filter(Boolean).map((r) => r.replace(/\.git$/, "").toLowerCase()));
    const kind = (r) => (!r.module ? "project" : mapped.has(r.repo.toLowerCase()) ? "WDK module, on the map" : "WDK module");
    const columns = ["project", "stars", "kind", "owner", "started", "last push", "still building", "packages"];
    const toRow = (r) => [r.repo, r.stars, kind(r), r.org ? "organisation" : "person", r.created, r.pushed, r.building ? "yes" : "no", r.packages.map(unscoped).join(" ")];
    const building = (yes) => (yes === "yes" ? el("span", { class: "fact yes" }, "✓", el("span", { class: "visually-hidden" }, "yes")) : el("span", { class: "visually-hidden" }, "no"));
    let hide = query.get("pnomod") === "1";
    const tbody = el("tbody");
    const count = el("span", { class: "view-count" });
    const exportSlot = el("span");
    const apply = () => {
      const rows = repos.filter((r) => !hide || !r.module).map(toRow);
      tbody.replaceChildren(...rows.map(([repo, stars, ...rest]) => el("tr", null,
        el("td", null, el("a", { href: `https://github.com/${repo}`, rel: "nofollow noopener" }, repo)),
        el("td", { class: "mono" }, fmtNum(stars)),
        rest.map((v, i) => (i === 4 ? el("td", null, building(v)) : el("td", { class: i > 1 ? "mono" : null }, v))))));
      count.textContent = String(rows.length);
      exportSlot.replaceChildren(exportControls(defFor("dependents"), { ...meta, title: "Public projects depending on WDK", columns, rows }));
      setUrlParams({ pnomod: hide ? "1" : null });
    };
    const box = el("input", { type: "checkbox" });
    box.checked = hide;
    box.addEventListener("change", () => { hide = box.checked; apply(); });
    apply();
    const modules = repos.filter((r) => r.module).length;
    return el("details", { class: "ready-card table-fold" },
      el("summary", { class: "repo-panel-summary" }, "Every public project ", count),
      el("div", { class: "tp-tools" }, el("label", { class: "tp-toggle" }, box, `Hide WDK modules (${modules})`), exportSlot),
      el("div", { class: "table-wrap" }, el("table", { class: "ready" },
        el("thead", null, el("tr", null, columns.map((h) => el("th", { scope: "col" }, h[0].toUpperCase() + h.slice(1))))), tbody)),
      el("p", { class: "chart-foot" }, "Named as GitHub lists them, not reviewed or endorsed. Most stars first. A WDK module's own repository is marked as one,"
        + " and as on the map when the map lists it; teammates' repositories are left out. A tick marks a project still building:"
        + " pushed to in the last 90 days, after at least 14 days of work."));
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
    const shownWallets = repos.filter((r) => wallets.has(r));
    const summary = !repos.length ? el("p", { class: "ready-summary" }, "No published package among the selected repos.") : el("p", { class: "ready-summary" },
      `${count("stable")} of ${repos.length} stable`, " · ",
      measured("ci") ? `${count("ci")} green CI` : "CI not collected yet", " · ",
      measured("audits") ? `${count("audits")} with an audit` : "audits not collected yet", " · ",
      avgHealth != null ? `community health ${avgHealth}% on average` : latest.health ? "no community health score" : "community health not collected yet",
      latest.signer && shownWallets.length ? ` · signer interface in ${shownWallets.filter((r) => latest.signer[r]).length} of ${shownWallets.length} wallet${shownWallets.length === 1 ? "" : "s"}` : "");
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
    const [file, third, projects] = await Promise.all([loadMetrics(), loadThirdParty(), loadProjects()]);
    if (!file) throw new Error("No data/metrics.json yet. Run bin/collect-metrics.mjs or the Metrics action.");
    if (file.schema !== 3) throw new Error("data/metrics.json is an older schema; run the collector again.");
    const all = Object.keys(file.repos || {}).sort();
    let selected = readSelection(all);
    const body = el("div", { class: "dash-body" }, buildDashboard(file, selected, third, projects));
    const controls = el("div", { class: "dash-controls" }, renderGrainSwitch(file), renderRepoPanel(file, selected, (chosen) => { selected = chosen; body.replaceChildren(...buildDashboard(file, selected, third, projects)); }));
    return el("div", { class: "dash-page" }, controls, body);
  }

  // The granularity links carry the query forward, so they go stale when the selection moves.
  onUrlChange(() => { for (const a of poster.querySelectorAll(".view-toggle a[data-grain]")) a.href = grainHref(a.dataset.grain); });

  return { render: renderDashboard };
}
