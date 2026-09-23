// The packages built by others, from their own file: a chart of their downloads, the same volume
// by publisher, and a table that can be sorted and filtered. They are never part of the repo
// selection above, and no figure or key result elsewhere counts them as ours: this is the one
// place they are summed, and it says so.

import { el, withTip } from "./dom.mjs";
import { createSeries } from "./series.mjs";
import { use } from "./context.mjs";
import { steadyWeekly, STEADY_WEEKS } from "./../lib/steady.mjs";

// The columns, in order. `num` columns sort descending first and draw a bar beside the value.
const COLUMNS = [
  { key: "pkg", label: "Package" },
  { key: "publisher", label: "Publisher" },
  { key: "median", label: "Weekly median", num: true, color: 0,
    tip: "Middle week of the last twelve complete weeks; fewer for a younger package." },
  { key: "dependents", label: "Dependents", num: true, color: 1,
    tip: "Public repos outside the org whose package.json names it, from code search." },
  { key: "last", label: "Last full", num: true, color: 2 },
  { key: "all", label: "All time", num: true, color: 2, tip: "From first publish to the last day npm has reported." },
];

export function createThirdParty(ctx) {
  use(ctx, createSeries);
  const { query, setUrlParams, fmtNum, defFor, trendPill, lineChart, hBars, chartCard, dashSection, exportControls,
    coverageOf, seriesBuckets, lastTwo, coverageNote, releaseMarks, unit, SERIES } = ctx;

  // Sort and filter live in the address, like the map's chain and search, so a view can be sent.
  const readSort = () => {
    const raw = query.get("tsort") || "-median";
    const key = raw.replace(/^-/, "");
    return COLUMNS.some((c) => c.key === key) ? { key, desc: raw.startsWith("-") } : { key: "median", desc: true };
  };

  function renderThirdParty(third) {
    if (!third) return dashSection("Third-party packages", [el("p", { class: "chart-foot" }, "Not collected yet; the next metrics run adds data/third-party.json.")]);
    const org = third.org || "the organisation";
    const packages = third.packages || {};
    const names = Object.keys(packages);
    const perPkg = Object.fromEntries(names.map((p) => [p, packages[p].downloads || {}]));
    const cov = coverageOf(perPkg, third, false);
    const total = seriesBuckets(perPkg, names, { coverage: cov });
    const last = lastTwo(total);
    // Each package's figure is read at the same period as the total, so a package quiet in the
    // last period shows zero rather than its last busy one.
    const inLast = (p) => (last.key ? (seriesBuckets({ [p]: perPkg[p] }, [p], { coverage: cov }).find((pt) => pt.key === last.key) || {}).y || 0 : null);
    const rows = names.map((p) => {
      const { title, publisher, repo, since, allTime, dependents, hostedByOrg } = packages[p];
      const steady = steadyWeekly(perPkg[p], cov[1], since);
      return { pkg: p, title, publisher, repo, since, hostedByOrg, median: steady.median, weeks: steady.weeks, dependents, last: inLast(p), all: allTime };
    });
    const collected = String(third.updated || "").slice(0, 10);
    const exportMeta = { collected, scope: `${names.length} third-party packages` };

    const marks = releaseMarks((p) => packages[p].releases, names);

    const perPublisher = new Map();
    for (const r of rows) { const e = perPublisher.get(r.publisher) || { label: r.publisher, value: 0, n: 0 }; e.value += r.last || 0; e.n += 1; perPublisher.set(r.publisher, e); }
    const byPublisher = [...perPublisher.values()].filter((e) => e.value > 0).sort((a, b) => b.value - a.value).slice(0, 8).map((e) => ({ label: e.label, hint: `${e.n} package${e.n === 1 ? "" : "s"}`, value: e.value }));

    // ---- The table: sorted and filtered in place, the state written to the address.
    let sort = readSort();
    let text = (query.get("tq") || "").trim().toLowerCase();
    let mine = query.get("tmine") === "1";
    const max = Object.fromEntries(COLUMNS.filter((c) => c.num).map((c) => [c.key, Math.max(1, ...rows.map((r) => r[c.key] || 0))]));
    const visible = () => {
      const kept = rows.filter((r) => (!mine || r.hostedByOrg) && (!text || `${r.pkg} ${r.publisher} ${r.title}`.toLowerCase().includes(text)));
      const col = COLUMNS.find((c) => c.key === sort.key);
      const dir = sort.desc ? -1 : 1;
      return kept.sort((a, b) => {
        if (col.num) { const x = a[col.key], y = b[col.key]; if (x == null && y == null) return a.pkg.localeCompare(b.pkg); if (x == null) return 1; if (y == null) return -1; return dir * (x - y) || a.pkg.localeCompare(b.pkg); }
        return dir * String(a[col.key]).localeCompare(String(b[col.key])) || a.pkg.localeCompare(b.pkg);
      });
    };
    const cell = (r, c) => {
      if (c.key === "pkg") return el("td", null, r.repo ? el("a", withTip({ href: r.repo }, r.title, r.pkg), r.pkg) : r.pkg);
      if (c.key === "publisher") return el("td", null, r.publisher, r.hostedByOrg && el("span", withTip({ class: "hosted-dot" }, `Third-party module maintained by ${org}`, "Third party, maintained by the organisation")));
      const v = r[c.key];
      return el("td", { class: "mono bar-cell" }, el("span", { class: "cell-row" },
        el("span", { class: "cell-num" }, v == null ? "·" : fmtNum(v)),
        v != null && el("span", { class: "cell-track" }, el("span", { class: "cell-fill", style: `width:${Math.round((100 * v) / max[c.key])}%;background:${SERIES[c.color]}` })),
        c.key === "median" && v != null && r.weeks < STEADY_WEEKS && el("span", { class: "ready-title" }, `${r.weeks} wk`)));
    };
    const tbody = el("tbody");
    const count = el("span", { class: "search-count", "aria-live": "polite" });
    const exportSlot = el("span");
    const heads = new Map();
    const apply = () => {
      const shown = visible();
      tbody.replaceChildren(...shown.map((r) => el("tr", null, COLUMNS.map((c) => cell(r, c)))));
      count.textContent = shown.length === rows.length ? `${rows.length}` : `${shown.length} of ${rows.length}`;
      for (const [key, th] of heads) th.setAttribute("aria-sort", key === sort.key ? (sort.desc ? "descending" : "ascending") : "none");
      exportSlot.replaceChildren(exportControls(defFor("third-party-downloads"), { title: "Third-party packages", ...exportMeta,
        columns: ["package", "publisher", "maintained by the organisation", `weekly median, last ${STEADY_WEEKS} complete weeks`, "weeks measured", "dependents", `downloads, last full ${unit}`, "downloads, all time", "on npm since"],
        rows: shown.map((r) => [r.pkg, r.publisher, r.hostedByOrg ? "yes" : "no", r.median ?? "", r.weeks, r.dependents ?? "", r.last ?? "", r.all ?? "", r.since || ""]) }));
      setUrlParams({ tsort: sort.key === "median" && sort.desc ? null : `${sort.desc ? "-" : ""}${sort.key}`, tq: text || null, tmine: mine ? "1" : null });
    };
    const head = el("tr", null, COLUMNS.map((c) => {
      const button = el("button", { type: "button", class: "sort" }, c.label === "Last full" ? `Last full ${unit}` : c.label);
      button.addEventListener("click", () => { sort = sort.key === c.key ? { key: c.key, desc: !sort.desc } : { key: c.key, desc: Boolean(c.num) }; apply(); });
      const th = el("th", c.tip ? withTip({ scope: "col" }, c.tip, c.label) : { scope: "col" }, button);
      heads.set(c.key, th);
      return th;
    }));
    const search = el("input", { class: "search-input", type: "search", placeholder: "Filter packages…", "aria-label": "Filter third-party packages", autocomplete: "off", value: text });
    search.addEventListener("input", () => { text = search.value.trim().toLowerCase(); apply(); });
    const mineBox = el("input", { type: "checkbox" });
    mineBox.checked = mine;
    mineBox.addEventListener("change", () => { mine = mineBox.checked; apply(); });
    const tools = el("div", { class: "tp-tools" },
      el("label", { class: "search" }, search, count),
      el("label", { class: "tp-toggle" }, mineBox, el("span", { class: "hosted-dot" }), `Maintained by ${org}`),
      exportSlot);
    apply();
    const table = el("div", { class: "table-wrap" }, el("table", { class: "ready" }, el("thead", null, head), tbody));
    const unmeasured = (third.unmeasured || []).map((u) => `${u.title} (${u.publisher}): ${u.reason}`);
    const allTimeTotal = rows.every((r) => r.all != null) ? rows.reduce((n, r) => n + r.all, 0) : null;

    return dashSection("Third-party packages", [
      chartCard(defFor("third-party-downloads"), `npm downloads of third-party packages per ${unit}`, last.now == null ? "—" : fmtNum(last.now), trendPill("third-party-downloads", total),
        total.length ? lineChart(total, { marks }) : el("p", { class: "chart-foot" }, coverageNote(cov)), `${names.length} packages, summed. Ticks mark releases. Not part of the selection above.`,
        { ...exportMeta, columns: ["period", "downloads"], rows: total.map((p) => [p.key, p.y]) }),
      chartCard(defFor("third-party-downloads"), `By publisher, last full ${unit}`, String(perPublisher.size), null,
        byPublisher.length ? hBars(byPublisher, { color: SERIES[2] }) : el("p", { class: "chart-foot" }, "No downloads in the period."), "Every package a publisher ships, summed.",
        { ...exportMeta, columns: ["publisher", "packages", "downloads"], rows: byPublisher.map((r) => [r.label, r.hint, r.value]) }),
      el("div", { class: "ready-card" }, tools, table,
        el("p", { class: "chart-foot" }, `Every shipped module on the map whose publisher is not ${org}, read from npm alone. Click a heading to sort.`
          + ` Weekly median is the middle week of the last twelve complete weeks, which one burst week cannot lift. Dependents are public repositories outside ${org} whose manifest names the package.`
          + (allTimeTotal == null ? "" : ` All time runs from each package's first publish: ${fmtNum(allTimeTotal)} across the ${rows.length}.`)
          + (rows.some((r) => r.hostedByOrg) ? ` An orange dot marks a third-party module maintained by ${org}.` : "")
          + (unmeasured.length ? ` Not measured: ${unmeasured.join("; ")}.` : "") + ` Collected ${collected}.`)),
    ]);
  }

  return { renderThirdParty };
}
