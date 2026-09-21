// The front page: what WDK is, where each north star stands, this quarter, the headline numbers.

import { el, pct, tipAttrs, withTip } from "../dom.mjs";
import { currentQuarter, fmtDay, isLate, quarterLabel, createModel, countByStatus } from "../model.mjs";
import { createData } from "../data.mjs";
import { createSeries } from "../series.mjs";
import { createKeyResults } from "../key-results.mjs";
import { use } from "../context.mjs";
import { nextQuarter } from "../../lib/quarters.mjs";

export default function createOverviewPage(ctx) {
  use(ctx, createModel);
  use(ctx, createData);
  use(ctx, createSeries);
  use(ctx, createKeyResults);

  const { atlas, roadmapItems, privateModules, loadMetrics, readinessFact, fmtNum, deltaPill,
    trendPill, defFor, countedTip, statTile, grain, coverageOf, seriesBuckets, keyResultsOf,
    krExplain, unit } = ctx;

  function briefItem(item) {
    const late = isLate(item);
    return el("li", { class: `brief-item ${item.status || "planned"}${late ? " late" : ""}` },
      el("span", { class: `state-dot ${item.status || "planned"}`, "aria-hidden": "true" }),
      el("a", { href: `./?page=roadmap#${item.id}` }, item.label),
      late && el("span", { class: "late-badge" }, `late · ${quarterLabel(item.quarter)}`),
      (item.partners || []).length > 0 && el("span", { class: "partner-mark", "aria-label": `needs ${item.partners.join(", ")}` }));
  }

  function briefList(title, items, more, empty) {
    const rank = (x) => `${x.priority || "P9"}`;
    const shown = items.slice().sort((a, b) => rank(a).localeCompare(rank(b))).slice(0, 8);
    return el("section", { class: "brief-col" },
      el("h3", { class: "brief-col-title" }, title, el("span", { class: "view-count" }, String(items.length))),
      items.length ? el("ul", { class: "brief-items" }, shown.map(briefItem)) : el("p", { class: "meta" }, empty),
      items.length > shown.length && el("a", { class: "brief-more", href: more }, `all ${items.length} on the roadmap`));
  }

  function briefTiles(file) {
    const all = Object.keys(file.repos || {}).sort();
    const snaps = file.snapshots || {}; const snapDays = Object.keys(snaps).sort(); const latest = snaps[snapDays[snapDays.length - 1]] || {};
    const D = file.daily || {};
    const dl = seriesBuckets(D.downloads, all, { coverage: coverageOf(D.downloads, file, false) });
    const xM = seriesBuckets(D.externalPrsMerged, all, { coverage: coverageOf(D.prsOpened, file, true) });
    const sum4 = (pts) => pts.slice(-4).reduce((a, p) => a + p.y, 0);
    const prev4 = (pts) => (pts.length >= 8 ? pts.slice(-8, -4).reduce((a, p) => a + p.y, 0) : null);
    const published = all.filter((r) => file.repos[r].version), stable = published.filter((r) => readinessFact("stable", r, latest)).length;
    const people = new Set(all.flatMap((r) => (file.contributors || {})[r] || [])).size;
    return el("div", { class: "tiles brief-tiles" },
      latest.dependents != null && statTile(defFor("dependents"), "Projects depending on WDK", fmtNum(latest.dependents), null, "public repos outside the org"),
      statTile(defFor("downloads"), `npm downloads, last full ${unit}`, dl.length ? fmtNum(dl[dl.length - 1].y) : "—", trendPill("downloads", dl), `${published.length} packages`),
      statTile(defFor("external-prs-merged"), `External pull requests merged, last 4 ${unit}s`, xM.length ? String(sum4(xM)) : "—", deltaPill("external-prs-merged", xM.length ? sum4(xM) : null, prev4(xM), { note: "vs prev 4" }), "Tether team excluded"),
      statTile(defFor("contributors"), "Contributors", String(people), null, "people with commits, bots excluded"),
      statTile(defFor("packages-published"), "Packages published", String(published.length), el("span", { class: "delta none" }, `${stable} stable · ${published.length - stable} in beta`), "on npm, first party"),
    );
  }

  function briefRisks(stars, items) {
    const risks = [];
    const late = items.filter(isLate);
    if (late.length) risks.push(el("li", { class: "risk bad" }, el("strong", null, `${late.length} past their quarter: `), late.flatMap((i, k) => [k ? ", " : "", el("a", { href: `./?page=roadmap#${i.id}` }, i.label)])));
    const partnerWip = items.filter((i) => i.status !== "done" && (i.partners || []).length);
    if (partnerWip.length) risks.push(el("li", { class: "risk" }, el("strong", null, `${partnerWip.length} open initiatives need a partner: `), partnerWip.flatMap((i, k) => [k ? ", " : "", el("a", { href: `./?page=roadmap#${i.id}` }, i.label), ` (${i.partners.join(", ")})`])));
    const priv = privateModules();
    if (priv.length) risks.push(el("li", { class: "risk" }, el("strong", null, `${priv.length} repos still private: `), priv.map((m) => m.title || m.id).join(", "), " ", el("a", { href: "./?page=map" }, "on the map")));
    const krs = stars.flatMap((star) => keyResultsOf(star));
    const far = krs.filter((kr) => kr.progress != null && kr.progress < 25);
    for (const kr of far) risks.push(el("li", { class: "risk bad" }, el("strong", null, "Far from target: "), el("a", { href: `./?page=results#${kr.id}` }, kr.label), ` · ${kr.current}${kr.target != null ? ` of ${kr.target}` : ""}`));
    const unmeasured = krs.filter((kr) => kr.progress == null);
    if (unmeasured.length) risks.push(el("li", { class: "risk" }, el("strong", null, `${unmeasured.length} key results not measured yet`), " · ", el("a", { href: "./?page=results" }, "see why")));
    return el("section", { class: "brief-risks" }, el("h2", { class: "brief-h" }, "Risks and gaps"), risks.length ? el("ul", null, risks) : el("p", { class: "meta" }, "Nothing flagged: no initiative is late, no result is far from target."));
  }

  async function renderOverview() {
    const file = await loadMetrics();
    const stars = atlas.northStars || [];
    const items = roadmapItems();
    const now = currentQuarter(), next = nextQuarter(now);
    const counts = countByStatus(items);
    const intro = el("section", { class: "brief-intro" },
      el("div", { class: "brief-intro-text mission" },
        el("p", { class: "eyebrow" }, "WDK in one page"),
        el("h2", { class: "mission-text" }, atlas.mission || ""),
        atlas.about && el("p", { class: "brief-about" }, atlas.about),
        // The one claim that separates this from a status page someone typed out. It is the rule
        // the whole site is built on, it was only ever stated in the README, and a reader who
        // never opens the README had no way of knowing it.
        el("p", { class: "brief-promise" },
          "Every number here is recomputed from public sources, npm and GitHub. Nothing is typed by hand, and anything that cannot be measured that way says so. ",
          el("a", { href: "./?page=results" }, "See how each result is measured"),
          ".")),
      el("div", { class: "brief-intro-side" },
        el("p", withTip({ class: "mission-sub" }, countedTip(), "Counted from the atlas"), `${stars.length} north stars · ${counts.done} initiatives shipped · ${counts.wip} in progress · ${counts.planned} planned`),
        file && el("p", { class: "mission-sub" }, `Atlas updated ${fmtDay(file.atlasUpdated)} · metrics collected ${fmtDay(file.updated)}`)));
    const starBlocks = stars.map((star, index) => {
      const linked = items.filter((item) => item.northStar === star.id);
      const c = countByStatus(linked);
      const krs = keyResultsOf(star);
      return el("section", { class: "brief-star" },
        el("header", { class: "star-head static" },
          el("span", { class: "star-index" }, String(index + 1).padStart(2, "0")),
          el("div", { class: "star-text" }, el("h3", { class: "star-title plain" }, el("a", { href: `./?page=roadmap#star-${star.id}` }, star.title)), star.summary && el("p", { class: "star-summary" }, star.summary)),
          el("ul", withTip({ class: "star-tally" }, countedTip(), "Counted from the atlas"),
            el("li", null, el("strong", null, String(linked.length)), " initiatives"),
            c.done > 0 && el("li", { class: "done" }, el("strong", null, String(c.done)), " done"),
            c.wip > 0 && el("li", { class: "wip" }, el("strong", null, String(c.wip)), " in progress"),
            c.late > 0 && el("li", { class: "late" }, el("strong", null, String(c.late)), " late"))),
        el("ul", { class: "brief-krs" }, krs.map((kr) => el("li", { class: kr.progress == null ? "unmeasured" : "" },
          el("a", { ...tipAttrs(krExplain(kr), kr.label), class: `brief-kr-label${krExplain(kr) ? " has-tip" : ""}`, href: `./?page=results#${kr.id}` }, kr.label),
          kr.progress == null
            ? el("span", { class: "kr-none" }, "not measured")
            : el("span", { class: "brief-kr-meter" }, el("span", { class: "kr-bar" }, el("span", { style: `width:${pct(kr.progress)}%` })), (() => { const text = `${kr.current}${kr.target != null && String(kr.target) !== String(kr.current) ? ` / ${kr.target}` : ""}`; const a = tipAttrs(kr.valueTitle, text); return el("span", { ...a, class: `brief-kr-value${a.class ? " has-tip" : ""}` }, text); })())))));
    });
    const quarter = el("section", { class: "brief-quarter" },
      el("h2", { class: "brief-h" }, `This quarter, ${quarterLabel(now)}`),
      el("div", { class: "brief-cols" },
        briefList("Shipped", items.filter((i) => i.status === "done" && i.quarter === now), `./?page=roadmap&status=done`, "Nothing shipped yet this quarter."),
        briefList("In progress", items.filter((i) => i.status === "wip"), `./?page=roadmap&status=wip`, "Nothing in progress."),
        briefList(`Next, ${quarterLabel(next)}`, items.filter((i) => (i.status || "planned") === "planned" && i.quarter === next), `./?page=roadmap&status=planned`, "Nothing scheduled yet.")));
    return el("div", { class: "brief-page" }, intro, file ? briefTiles(file) : el("p", { class: "meta" }, "Metrics not loaded."), el("h2", { class: "brief-h" }, "North stars"), starBlocks, quarter, briefRisks(stars, items));
  }

  return { render: renderOverview };
}
