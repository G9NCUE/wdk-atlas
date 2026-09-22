// Every initiative, by north star, on one quarter timeline or as a backlog, with search and filters.

import { el, scrollTo, withTip } from "../dom.mjs";
import { currentQuarter, isLate, quarterLabel, quarterOrder, repoNameOf, stateLabel, createModel, countByStatus } from "../model.mjs";
import { createData } from "../data.mjs";
import { createSharedViews } from "../shared-views.mjs";
import { createSeries } from "../series.mjs";
import { createKeyResults } from "../key-results.mjs";
import { use } from "../context.mjs";
import { selectedQuarters } from "../../lib/quarters.mjs";

export default function createRoadmapPage(ctx) {
  use(ctx, createModel);
  use(ctx, createData);
  use(ctx, createSharedViews);
  use(ctx, createSeries);
  use(ctx, createKeyResults);

  const { poster, query, signal, setUrlParams, getHash, atlas, metrics, onUrlChange, itemById,
    roadmapItems, loadMetrics, moduleChip, renderSearch, countedTip, renderKrStrip } = ctx;

  const QUARTERS = ["2026Q1", "2026Q2", "2026Q3", "2026Q4", "2027Q1", "2027Q2"];

  let view = query.get("view") === "backlog" ? "backlog" : "timeline";

  // Owners of an initiative: the CODEOWNERS handles of the repos behind its modules. Public, never typed here.
  function ownersOf(item) {
    if (!metrics() || !metrics().owners) return [];
    const out = new Set();
    for (const ref of item.modules || []) {
      const m = itemById(typeof ref === "string" ? ref : ref.id);
      const r = repoNameOf(m);
      for (const h of (r && metrics().owners[r]) || []) out.add(h);
    }
    return [...out];
  }

  const CHIP_LIMIT = 5;

  // Module chips, folded past CHIP_LIMIT behind a "+N" toggle so a wide initiative stays one card tall.
  function moduleChips(refs) {
    const chips = refs.map(moduleChip);
    if (chips.length <= CHIP_LIMIT + 1) return chips;
    const hidden = chips.slice(CHIP_LIMIT);
    for (const chip of hidden) chip.hidden = true;
    const more = el("button", { class: "roadmap-module more", type: "button", "aria-expanded": "false" }, `+${hidden.length} more`);
    more.addEventListener("click", () => {
      const open = more.getAttribute("aria-expanded") === "true";
      for (const chip of hidden) chip.hidden = open;
      more.setAttribute("aria-expanded", open ? "false" : "true");
      more.textContent = open ? `+${hidden.length} more` : "show fewer";
    });
    return [...chips.slice(0, CHIP_LIMIT), ...hidden, more];
  }

  // One initiative. No progress bars: nobody maintains them. A parent says how many children are done.
  function renderRoadmapItem(item, childItems = []) {
    const modules = moduleChips(item.modules || []);
    const moduleNames = (item.modules || []).map((ref) => { const m = itemById(typeof ref === "string" ? ref : ref.id); return m ? `${m.title || ""} ${m.name || m.id}` : String(ref); });
    const partners = item.partners || [];
    const late = isLate(item);
    const owners = ownersOf(item);
    const children = childItems.map((child) => renderRoadmapItem(child, []));
    const doneChildren = childItems.filter((c) => c.status === "done").length;
    const search = [item.label, item.summary, item.id, stateLabel(item), late ? "late" : "", item.quarter, ...moduleNames, ...partners, partners.length ? "partner-dependent" : "", ...owners].filter(Boolean).join(" ").toLowerCase();
    return el(
      "article",
      { class: `roadmap-card ${item.status || "planned"}${late ? " late" : ""}`, id: item.id, "data-roadmap": item.id, "data-search": search, "data-status": item.status || "planned", "data-partners": partners.length ? "1" : null },
      el(
        "div",
        { class: "roadmap-card-head" },
        el("h3", { class: "roadmap-card-title" }, item.label),
        item.priority && item.status !== "done" && el("span", { class: `priority ${String(item.priority).toLowerCase()}` }, item.priority)
      ),
      el(
        "div",
        { class: "roadmap-card-state" },
        el("span", { class: `state-dot ${item.status || "planned"}`, "aria-hidden": "true" }),
        el("span", { class: "roadmap-card-status" }, stateLabel(item)),
        late && el("span", { class: "late-badge" }, `late · ${quarterLabel(item.quarter)}`),
        childItems.length > 0 && el("span", { class: "roadmap-card-progress" }, `${doneChildren} of ${childItems.length} done`)
      ),
      item.summary && el("p", { class: "roadmap-card-summary" }, item.summary),
      partners.length > 0 &&
        el("p", withTip({ class: "roadmap-partners" }, "This cannot be finished by the WDK team alone", "Partners"),
          el("span", { class: "partner-mark", "aria-hidden": "true" }), "Needs ", partners.join(", ")),
      owners.length > 0 && el("p", withTip({ class: "roadmap-owners" }, "From the CODEOWNERS files of the repos this touches", "Owner"), "Owner ", owners.join(", ")),
      modules.length > 0 && el("div", { class: "roadmap-modules" }, modules),
      children.length > 0 && el("div", { class: "roadmap-children" }, children)
    );
  }

  function renderTimelineHead(quarters, now) {
    return el(
      "div",
      { class: "timeline-head", style: `--cols:${quarters.length}` },
      quarters.map((q) =>
        el(
          "div",
          { class: `timeline-quarter${q === now ? " is-now" : ""}` },
          quarterLabel(q),
          q === now && el("span", { class: "now-mark" }, "now")
        )
      )
    );
  }

  function renderStarRow(star, items, byParent, quarters, now, index, mode) {
    const counts = countByStatus(items);
    const tally = el(
      "ul",
      withTip({ class: "star-tally" }, countedTip(), "Counted from the atlas"),
      counts.done > 0 && el("li", { class: "done" }, el("strong", null, String(counts.done)), " done"),
      counts.wip > 0 && el("li", { class: "wip" }, el("strong", null, String(counts.wip)), " in progress"),
      counts.planned > 0 && el("li", { class: "planned" }, el("strong", null, String(counts.planned)), " planned"),
      counts.late > 0 && el("li", { class: "late" }, el("strong", null, String(counts.late)), " late")
    );
    const rank = (x) => `${x.priority || "P9"}${x.status === "done" ? 2 : x.status === "wip" ? 0 : 1}`;
    const card = (item) => renderRoadmapItem(item, byParent.get(item.id) || []);
    const body =
      mode === "backlog"
        ? el("div", { class: "backlog-grid" }, items.slice().sort((x, y) => rank(x).localeCompare(rank(y))).map(card))
        : el(
            "div",
            { class: "timeline-grid", style: `--cols:${quarters.length}` },
            quarters.map((q) =>
              el(
                "div",
                { class: `timeline-col${q === now ? " is-now" : ""}` },
                items.filter((item) => (item.quarter || "backlog") === q).sort((x, y) => rank(x).localeCompare(rank(y))).map(card)
              )
            )
          );
    // Rows open by default: a folded roadmap reads as an empty page. The reader's own folds are remembered per view.
    const details = el(
      "details",
      { class: "star-row", id: `star-${star.id}`, open: true },
      el(
        "summary",
        { class: "star-head" },
        el("span", { class: "star-index" }, String(index + 1).padStart(2, "0")),
        el("div", { class: "star-text" }, el("h2", { class: "star-title" }, star.title), star.summary && el("p", { class: "star-summary" }, star.summary), renderKrStrip(star)),
        tally
      ),
      body
    );
    // Clicking a key result goes to its page; it must not toggle the fold.
    details.querySelector(".kr-strip")?.addEventListener("click", (event) => event.stopPropagation());
    details.addEventListener("toggle", () => {
      if (!details.dataset.searching) details.dataset.userOpen = details.open ? "1" : "0";
    });
    return details;
  }

  // Arriving through a link to one initiative: bring its card into view and let it glow for a moment.
  function spotlightTarget() {
    const id = getHash().replace(/^#/, "");
    const card = id && poster.querySelector(`.roadmap-card[data-roadmap="${CSS.escape(id)}"]`);
    if (!card) return;
    const star = card.closest("details.star-row");
    if (star) star.open = true;
    scrollTo(card, { block: "center", inline: "nearest" });
    card.classList.remove("is-target");
    void card.offsetWidth; // restart the animation if the same card is targeted twice
    card.classList.add("is-target");
    card.addEventListener("animationend", () => card.classList.remove("is-target"), { once: true });
  }

  // Filters: free-text search and a status toggle (done / in progress / planned). Both narrow the same
  // set of cards; stars with a match open, stars without one dim and fold.
  const STATUSES = ["done", "wip", "planned"];

  const filter = {
    query: "",
    quarters: null, // the timeline columns to draw; null until the timeline knows which quarters exist
    statuses: (() => {
      const raw = (query.get("status") || "").split(",").filter((s) => STATUSES.includes(s));
      return new Set(raw.length ? raw : STATUSES);
    })(),
    partners: query.get("partners") === "1",
    count: null,
  };

  const filterNarrowed = () => filter.statuses.size < STATUSES.length || filter.partners;

  // Write the current filters into the address bar so a filtered roadmap can be shared, and keep the view links in step.
  function syncFilterUrl() {
    setUrlParams({
      status: filter.statuses.size === STATUSES.length ? null : STATUSES.filter((s) => filter.statuses.has(s)).join(","),
      partners: filter.partners ? "1" : null,
      quarters: !filter.quarters || filter.quarters.all.length === filter.quarters.shown.length ? null : filter.quarters.shown.join(","),
    });
  }

  // One chip per quarter the timeline can draw, all on by default. Click switches one column off or
  // on; shift-click keeps only the run between the last chip clicked and this one, which is how a
  // reader narrows a year down to the quarter being discussed. "All" puts every column back. At
  // least one stays on. The choice lives in ?quarters= so a focused roadmap can be shared as a link.
  function renderQuarterFilter(now, redraw) {
    const { all } = filter.quarters;
    let last = null;
    const chips = all.map((q) => {
      const chip = el(
        "button",
        { class: `status-toggle quarter${q === now ? " is-now" : ""}`, type: "button", "data-quarter": q, "aria-pressed": filter.quarters.shown.includes(q) ? "true" : "false" },
        quarterLabel(q)
      );
      chip.addEventListener("click", (event) => {
        const on = new Set(filter.quarters.shown);
        if (event.shiftKey && last && last !== q) {
          const [a, b] = [all.indexOf(last), all.indexOf(q)].sort((x, y) => x - y);
          on.clear();
          for (const each of all.slice(a, b + 1)) on.add(each);
        } else if (on.has(q)) {
          if (on.size === 1) return; // nothing left to draw; keep the last column
          on.delete(q);
        } else {
          on.add(q);
        }
        last = q;
        filter.quarters.shown = all.filter((each) => on.has(each));
        for (const c of chips) c.setAttribute("aria-pressed", filter.quarters.shown.includes(c.dataset.quarter) ? "true" : "false");
        syncFilterUrl();
        redraw();
      });
      return chip;
    });
    const reset = el("button", { class: "status-toggle quarter-all", type: "button", "aria-pressed": "false" }, "All");
    reset.addEventListener("click", () => {
      if (filter.quarters.shown.length === all.length) return;
      filter.quarters.shown = all.slice();
      for (const c of chips) c.setAttribute("aria-pressed", "true");
      syncFilterUrl();
      redraw();
    });
    return el(
      "div",
      { class: "quarter-bar" },
      el("span", { class: "quarter-bar-label" }, "Quarters"),
      el("div", { class: "status-filter quarter-filter", role: "group", "aria-label": "Quarters to show" }, chips, reset)
    );
  }

  // Three toggles that read like a legend: switch a status off to hide its cards. At least one stays on.
  // The choice is kept in ?status= so a filtered roadmap can be shared as a link.
  function renderStatusFilter(counts) {
    const buttons = STATUSES.map((status) => {
      const label = status === "wip" ? "In progress" : status === "done" ? "Done" : "Planned";
      const button = el(
        "button",
        { class: `status-toggle ${status}`, type: "button", "data-status": status, "aria-pressed": filter.statuses.has(status) ? "true" : "false" },
        el("span", { class: `state-dot ${status}`, "aria-hidden": "true" }),
        label,
        counts[status] > 0 && el("span", { class: "view-count" }, String(counts[status]))
      );
      button.addEventListener("click", () => {
        if (filter.statuses.has(status)) {
          if (filter.statuses.size === 1) return; // nothing left to show; keep the last one on
          filter.statuses.delete(status);
        } else {
          filter.statuses.add(status);
        }
        for (const b of buttons) b.setAttribute("aria-pressed", filter.statuses.has(b.dataset.status) ? "true" : "false");
        syncFilterUrl();
        applyFilters(filter.query, filter.count);
      });
      return button;
    });
    return el("div", { class: "status-filter", role: "group", "aria-label": "Filter by status" }, buttons);
  }

  // One toggle: only initiatives that depend on a partner. Kept in ?partners=1 like the status filter.
  function renderPartnerToggle(count) {
    const button = el(
      "button",
      withTip({ class: "status-toggle partner", type: "button", "aria-pressed": filter.partners ? "true" : "false" }, "Only initiatives that need a partner to finish", "Partner-dependent"),
      el("span", { class: "partner-mark", "aria-hidden": "true" }),
      "Partner-dependent",
      count > 0 && el("span", { class: "view-count" }, String(count))
    );
    button.addEventListener("click", () => {
      filter.partners = !filter.partners;
      button.setAttribute("aria-pressed", filter.partners ? "true" : "false");
      syncFilterUrl();
      applyFilters(filter.query, filter.count);
    });
    return el("div", { class: "status-filter", role: "group", "aria-label": "Filter by dependency" }, button);
  }

  function applyFilters(query, count) {
    const q = (query || "").trim().toLowerCase();
    const narrowed = filter.statuses.size < STATUSES.length;
    const active = Boolean(q) || filterNarrowed();
    const okText = (card) => !q || (card.dataset.search || "").includes(q);
    const okStatus = (card) => filter.statuses.has(card.dataset.status || "planned") && (!filter.partners || card.dataset.partners === "1");
    let total = 0;
    for (const star of poster.querySelectorAll("details.star-row")) {
      let visible = 0;
      for (const parent of star.querySelectorAll(".roadmap-card")) {
        if (parent.closest(".roadmap-children")) continue;
        const parentText = okText(parent);
        const own = parentText && okStatus(parent);
        let shownChildren = 0;
        let matchedChildren = 0;
        // Children of a matching parent stay visible; the parent itself stays if any child matches.
        for (const child of parent.querySelectorAll(".roadmap-children .roadmap-card")) {
          const match = okStatus(child) && okText(child);
          const show = okStatus(child) && (parentText || okText(child));
          child.hidden = !show;
          if (show) shownChildren += 1;
          if (match) matchedChildren += 1;
        }
        parent.hidden = !(own || shownChildren > 0);
        visible += (own ? 1 : 0) + matchedChildren;
      }
      for (const li of star.querySelectorAll(".star-tally li")) li.classList.toggle("off", narrowed && !STATUSES.some((s) => li.classList.contains(s) && filter.statuses.has(s)));
      total += visible;
      star.dataset.searching = active ? "1" : "";
      star.dataset.matches = active ? String(visible) : "";
      star.open = active ? visible > 0 : star.dataset.userOpen !== "0";
    }
    if (count) count.textContent = q ? `${total} ${total === 1 ? "match" : "matches"}` : "";
  }

  // Switching view keeps the search-free filters (?status=) so the same slice shows on both sides.
  function viewHref(id) {
    const params = new URLSearchParams(query);
    params.set("page", "roadmap");
    if (id === "backlog") params.set("view", "backlog");
    else params.delete("view");
    return `./?${params}`;
  }

  function renderViewToggle(backlogCount) {
    const link = (id, label, count) =>
      el(
        "a",
        { href: viewHref(id), "data-view": id, "aria-current": view === id ? "page" : null },
        label,
        count > 0 && el("span", { class: "view-count" }, String(count))
      );
    return el("nav", { class: "view-toggle", "aria-label": "Roadmap view" }, link("timeline", "Timeline"), link("backlog", "Backlog", backlogCount));
  }

  // Roadmap page: the mission, then one row per north star, each laid out on the same quarter timeline.
  function renderRoadmap() {
    const items = roadmapItems();
    const stars = atlas.northStars || [];
    const now = currentQuarter();
    const isBacklog = (item) => (item.quarter || "backlog") === "backlog";
    const wanted = getHash().replace(/^#/, "");
    if (view === "timeline" && wanted && items.some((item) => item.id === wanted && isBacklog(item))) view = "backlog";
    const used = new Set(items.filter((item) => !isBacklog(item)).map((item) => item.quarter));
    const allQuarters = [...new Set([...QUARTERS, ...used])].sort((x, y) => quarterOrder(x).localeCompare(quarterOrder(y)));
    if (!filter.quarters) filter.quarters = { all: allQuarters, shown: selectedQuarters(query.get("quarters"), allQuarters) };

    const byParent = new Map();
    for (const item of items) {
      if (!item.parent || !items.some((i) => i.id === item.parent)) continue;
      if (!byParent.has(item.parent)) byParent.set(item.parent, []);
      byParent.get(item.parent).push(item);
    }
    const allRoots = items.filter((item) => !item.parent || !items.some((i) => i.id === item.parent));
    const roots = allRoots.filter((item) => (view === "backlog") === isBacklog(item));
    const backlogCount = allRoots.filter(isBacklog).length;

    const counts = countByStatus(items);
    const mission = el(
      "section",
      { class: "mission" },
      el("p", { class: "eyebrow" }, "Mission"),
      el("h2", { class: "mission-text" }, atlas.mission || ""),
      el(
        "p",
        withTip({ class: "mission-sub" }, countedTip(), "Counted from the atlas"),
        `${stars.length} north stars · ${counts.done} shipped · ${counts.wip} in progress · ${counts.planned} planned`
      )
    );

    // The timeline draws only the selected quarters, and its tallies count only what is on screen.
    // The backlog view ignores the selection: nothing there has a quarter.
    const buildRows = () => {
      const quarters = view === "timeline" ? filter.quarters.shown : allQuarters;
      const inView = view === "timeline" ? roots.filter((item) => quarters.includes(item.quarter)) : roots;
      const rows = stars
        .map((star, index) => [star, inView.filter((item) => item.northStar === star.id), index])
        .filter(([, inStar]) => view === "timeline" || inStar.length > 0)
        .map(([star, inStar, index]) => renderStarRow(star, inStar, byParent, quarters, now, index, view));
      const orphans = inView.filter((item) => !stars.some((star) => star.id === item.northStar));
      if (orphans.length) {
        rows.push(renderStarRow({ id: "unassigned", title: "Not yet linked to a north star" }, orphans, byParent, quarters, now, stars.length, view));
      }
      if (!roots.length) rows.push(el("p", { class: "meta" }, view === "backlog" ? "The backlog is empty." : "No roadmap entries in atlas.yaml yet."));
      return { quarters, rows };
    };
    let { quarters, rows } = buildRows();

    const shown = { done: 0, wip: 0, planned: 0, partners: 0 };
    for (const item of roots.flatMap((root) => [root, ...(byParent.get(root.id) || [])])) { shown[item.status || "planned"] += 1; if ((item.partners || []).length) shown.partners += 1; }
    const intro = el("div", { class: "roadmap-intro" }, mission, el("div", { class: "roadmap-controls" }, renderSearch((value, count) => { filter.query = value; filter.count = count; applyFilters(value, count); }, "initiatives", { runAtStart: filterNarrowed() }), renderStatusFilter(shown), renderPartnerToggle(shown.partners), renderViewToggle(backlogCount)));
    if (view !== "timeline") {
      requestAnimationFrame(spotlightTarget);
      return el("div", { class: "roadmap-page" }, intro, el("p", { class: "backlog-note" }, "Not yet scheduled. Ranked by north star, then priority."), rows);
    }

    // Narrow screens: the timeline scrolls sideways on its own, the quarter header follows it and stays sticky.
    const headWrap = el("div", { class: "timeline-head-wrap" }, renderTimelineHead(quarters, now));
    const scroller = el("div", { class: "timeline-scroll", style: `--cols:${quarters.length}` }, el("div", { class: "timeline-track" }, rows));
    scroller.addEventListener("scroll", () => { headWrap.scrollLeft = scroller.scrollLeft; }, { passive: true });
    const fit = () => scroller.style.setProperty("--viewport", `${scroller.clientWidth}px`);
    window.addEventListener("resize", fit, { passive: true, signal });
    requestAnimationFrame(() => { fit(); spotlightTarget(); });
    // A change of quarters redraws the header and the columns in place; the text and status filters are applied again on the new cards.
    const redraw = () => {
      ({ quarters, rows } = buildRows());
      headWrap.replaceChildren(renderTimelineHead(quarters, now));
      scroller.style.setProperty("--cols", String(quarters.length));
      scroller.replaceChildren(el("div", { class: "timeline-track" }, rows));
      applyFilters(filter.query, filter.count);
      requestAnimationFrame(fit);
    };
    const quarterBar = renderQuarterFilter(now, redraw);
    return el("div", { class: "roadmap-page" }, intro, quarterBar, headWrap, scroller);
  }

  // The timeline/backlog links are built from the query, so they go stale when a filter moves.
  onUrlChange(() => { for (const a of poster.querySelectorAll(".view-toggle a[data-view]")) a.href = viewHref(a.dataset.view); });

  return {
    // Owners come from the metrics file, so it has to be here before the cards are drawn.
    async render() { await loadMetrics(); return renderRoadmap(); },
    hashChanged: spotlightTarget,
  };
}
