// One grid for every north star, so the columns line up: what is measured, what is not, from where.

import { el, pct, tipAttrs, withTip } from "../dom.mjs";
import { createModel, countByStatus } from "../model.mjs";
import { createData } from "../data.mjs";
import { createSeries } from "../series.mjs";
import { createKeyResults } from "../key-results.mjs";
import { use } from "../context.mjs";

export default function createResultsPage(ctx) {
  use(ctx, createModel);
  use(ctx, createData);
  use(ctx, createSeries);
  use(ctx, createKeyResults);

  const { atlas, roadmapItems, loadMetrics, countedTip, keyResultsOf } = ctx;

  function krStatus(kr) {
    if (kr.progress != null) return { key: "measured", label: "Measured" };
    if (kr.fromDashboard || kr.source) return { key: "pending", label: "Not measured yet" };
    return { key: "undefined", label: "To define" };
  }

  function krValue(kr) {
    if (kr.current == null && kr.target == null) return el("span", { class: "kr-none" }, "—");
    const cur = kr.current == null ? "—" : String(kr.current);
    const tgt = kr.target == null ? null : String(kr.target);
    const plain = tgt && /^[\d.,]+%?$/.test(tgt); // "12", "100%": read as "of"; anything else is a rule, shown as "target …"
    return el("span", { class: "kr-value" }, el("b", tipAttrs(kr.valueTitle, cur), cur), tgt && el("span", { class: "kr-target" }, plain ? ` of ${tgt}` : ` · target ${tgt}`));
  }

  function krRow(kr) {
    const st = krStatus(kr);
    return el(
      "div",
      { class: `kr-line ${st.key}`, id: kr.id },
      el("div", { class: "kr-main" },
        el("div", withTip({ class: "kr-title" }, kr.note || "", kr.label), kr.label),
        kr.unit && el("div", { class: "kr-sub" }, kr.unit)),
      el("div", { class: "kr-col kr-col-status" }, el("span", { class: `status-pill ${st.key}` }, st.label)),
      el("div", { class: "kr-col kr-col-value" }, krValue(kr)),
      el("div", { class: "kr-col kr-col-progress" }, el("span", { class: "kr-bar" }, el("span", { style: `width:${pct(kr.progress)}%` })), el("span", { class: "kr-pct" }, kr.progress == null ? "—" : `${kr.progress}%`)),
      el("div", { class: "kr-col kr-col-source" },
        kr.origin && el("a", withTip({ class: "kr-origin", href: kr.origin.href }, "The public endpoint behind this row. Call it and you get the same fact.", kr.origin.label), kr.origin.label),
        el("span", { class: "kr-secondary" },
          kr.data && el("a", { class: "kr-data", href: kr.data }, "data"),
          kr.sourceLink ? el("a", withTip({ class: "kr-view", href: kr.sourceLink }, `See it on the ${(kr.source || "dashboard").split(",")[0].toLowerCase()}`, "Open"), "\u2192") : kr.source ? el("span", null, kr.source) : el("span", { class: "kr-none" }, "to define")))
    );
  }

  function renderResults() {
    const stars = atlas.northStars || [];
    const items = roadmapItems();
    const all = stars.flatMap((star) => keyResultsOf(star));
    const measured = all.filter((kr) => kr.progress != null).length;

    const strip = el("ul", { class: "kr-strip-summary" },
      el("li", null, el("strong", null, `${measured} of ${all.length}`), " measured"),
      stars.map((star, i) => { const krs = keyResultsOf(star); const m = krs.filter((kr) => kr.progress != null).length; return el("li", null, el("a", withTip({ href: `#${star.id}` }, star.title, `star ${String(i + 1).padStart(2, "0")}`), el("strong", null, `${m}/${krs.length}`), ` star ${String(i + 1).padStart(2, "0")}`)); }));

    const head = el("div", { class: "kr-line kr-head" },
      el("div", { class: "kr-main" }, "Key result"), el("div", { class: "kr-col" }, "Status"), el("div", { class: "kr-col" }, "Current · target"), el("div", { class: "kr-col" }, "Progress"), el("div", { class: "kr-col" }, "Source"));

    const blocks = stars.map((star, index) => {
      const krs = keyResultsOf(star);
      const linked = items.filter((item) => item.northStar === star.id);
      const counts = countByStatus(linked);
      return el(
        "section",
        { class: "results-star", id: star.id },
        el("header", { class: "star-head static" },
          el("span", { class: "star-index" }, String(index + 1).padStart(2, "0")),
          el("div", { class: "star-text" }, el("h2", { class: "star-title plain" }, star.title), star.summary && el("p", { class: "star-summary" }, star.summary)),
          el("ul", withTip({ class: "star-tally" }, countedTip(), "Counted from the atlas"),
            el("li", null, el("a", { href: `./?page=roadmap#star-${star.id}` }, el("strong", null, String(linked.length)), " initiatives")),
            counts.done > 0 && el("li", { class: "done" }, el("strong", null, String(counts.done)), " done"),
            counts.wip > 0 && el("li", { class: "wip" }, el("strong", null, String(counts.wip)), " in progress"))),
        el("div", { class: "kr-lines" }, krs.map(krRow))
      );
    });
    return el("div", { class: "results-page" }, strip, head, blocks);
  }

  return { async render() { await loadMetrics(); return renderResults(); } };
}
