// The kit drawn as a cross-section: one band per section, wallets and protocols as a chain by
// capability grid, and a rail down the side that follows the reader.

import { el, pct, scrollTo, withTip } from "../dom.mjs";
import { itemProgress, quarterLabel, createModel } from "../model.mjs";
import { createSharedViews } from "../shared-views.mjs";
import { createDrawer } from "../drawer.mjs";
import { use } from "../context.mjs";

export default function createMapPage(ctx) {
  use(ctx, createModel);
  use(ctx, createSharedViews);
  use(ctx, createDrawer);

  const { poster, query, signal, setUrlParams, atlas, openedId, onDrawerChange, itemById,
    isEcosystem, chainsOf, roadmapItems, pendingFor, searchTextOf, lockMark, buildModuleControls,
    closeDrawer } = ctx;

  // Inside the grid the row and column already say most of the title: "Swap & bridge via Symbiosis"
  // in the Swap & bridge row is just "Symbiosis". A module may set `short` to choose its own.
  function shortTitle(module, context) {
    const full = module.title || module.name || module.id;
    if (module.short) return module.short;
    if (!context) return full;
    let title = full;
    const lower = () => title.toLowerCase();
    if (context.group) {
      const label = context.group.label.toLowerCase();
      for (const joiner of [" via ", " on ", " "]) {
        if (lower().startsWith(label + joiner)) {
          title = title.slice(label.length + joiner.length);
          break;
        }
      }
    }
    if (context.column) {
      const word = context.column.label.split(/[\s&]+/)[0].toLowerCase() + ", ";
      if (lower().startsWith(word)) title = title.slice(word.length);
    }
    title = title.trim();
    if (!title) return full;
    return title.charAt(0).toUpperCase() + title.slice(1);
  }

  function renderChip(module, context) {
    const ecosystem = isEcosystem(module);
    const pending = pendingFor(module.id);
    const classes = ["mod", module.status || "planned", ecosystem ? "ecosystem" : "", module.placeholder ? "placeholder" : ""]
      .filter(Boolean)
      .join(" ");
    // The package name and the pending work share the chip's own tip rather than each carrying
    // their own: a second tip inside a button would give one chip two tab stops, and the pending
    // count is meaningless without the list behind it.
    const tip = [module.name || module.id, pending.length ? `Pending: ${pending.map((entry) => entry.label).join(", ")}` : ""]
      .filter(Boolean)
      .join("\n");
    return el(
      "button",
      withTip({ class: classes, type: "button", "data-id": module.id, "data-node": module.id, "aria-expanded": "false", "data-search": searchTextOf(module) }, tip, module.title || module.id),
      el("i", { class: "dot", "aria-hidden": "true" }),
      el("span", { class: "mod-title" }, shortTitle(module, context)),
      module.private && lockMark(),
      ecosystem && el("span", { class: "pub" }, module.publisher),
      pending.length > 0 && el("span", { class: "pend" }, String(pending.length))
    );
  }

  // A roadmap item that touches at least half of a band of four or more modules is drawn once,
  // as a strip across the band, instead of once under every module it names.
  const STRIP_MIN_BAND = 4;

  function bandStrips(modules) {
    if (modules.length < STRIP_MIN_BAND) return [];
    const ids = new Set(modules.map((module) => module.id));
    const strips = [];
    for (const item of roadmapItems()) {
      if (item.status === "done") continue;
      const touched = (item.modules || []).map((ref) => (typeof ref === "string" ? ref : ref.id)).filter((id) => ids.has(id));
      if (touched.length < 2 || touched.length * 2 < modules.length) continue;
      const percent = itemProgress(item);
      strips.push(
        el(
          "a",
          { class: `strip ${item.status || "planned"}`, href: `./?page=roadmap#${item.id}` },
          el("span", { class: "strip-label" }, item.label),
          el("span", { class: "strip-who" }, `touches ${touched.length} of ${modules.length} · ${quarterLabel(item.quarter)}`),
          percent != null && el("span", { class: "strip-bar", "aria-hidden": "true" }, el("i", { style: `width:${pct(percent)}%` })),
          percent != null && el("span", { class: "strip-pct" }, `${percent}%`)
        )
      );
    }
    return strips;
  }

  function renderLaneRow(lane, modules) {
    if (!modules.length) return null;
    return el(
      "div",
      { class: "lane-row" },
      el(
        "div",
        { class: "lane-head" },
        el("h3", { class: "lane-label" }, lane.label),
        lane.blurb && el("span", { class: "lane-blurb" }, lane.blurb)
      ),
      bandStrips(modules),
      el("div", { class: "chips" }, modules.map((module) => renderChip(module)))
    );
  }

  // Columns come from `chains` at the root of atlas.yaml; a label not listed there gets its own column.
  function chainColumns(modules) {
    const cols = (atlas.chains || []).map((c) => ({ id: String(c.id), label: c.label || String(c.id), also: (c.also || []).map(String) }));
    const known = new Map();
    for (const col of cols) {
      known.set(col.id, col.id);
      for (const alias of col.also) known.set(alias, col.id);
    }
    for (const module of modules) {
      for (const chain of chainsOf(module)) {
        if (known.has(chain)) continue;
        cols.push({ id: chain, label: chain, also: [] });
        known.set(chain, chain);
      }
    }
    const columnsOf = (module) => [...new Set(chainsOf(module).map((chain) => known.get(chain)))];
    return { cols, columnsOf };
  }

  // Chains across, capabilities down. A protocol sits in the column of the wallet it needs;
  // a module with no chain spans the row; an empty cell is a gap and says so.
  function renderMatrix(lanes, modules) {
    const { cols, columnsOf } = chainColumns(modules);
    const counts = new Map(cols.map((col) => [col.id, 0]));
    for (const module of modules) for (const col of columnsOf(module)) counts.set(col, counts.get(col) + 1);

    const grid = el("div", { class: "matrix", style: `--cols:${cols.length}` });
    grid.append(
      el(
        "div",
        { class: "mx-row mx-head" },
        el("div", { class: "mx-corner" }),
        cols.map((col) =>
          el(
            "button",
            withTip({ class: "mx-th", type: "button", "data-col": col.id, "aria-pressed": "false" }, `Show only ${col.label}`, col.label),
            el("b", null, col.label),
            el("span", null, `${counts.get(col.id)} module${counts.get(col.id) === 1 ? "" : "s"}`)
          )
        )
      )
    );

    for (const lane of lanes) {
      const inLane = modules.filter((module) => module.band === lane.id);
      grid.append(
        el(
          "div",
          { class: "mx-lane" },
          el("h3", { class: "lane-label" }, lane.label),
          lane.blurb && el("span", { class: "lane-blurb" }, lane.blurb),
          bandStrips(inLane)
        )
      );
      const groups = [...(lane.groups || [])];
      const known = new Set(groups.map((group) => group.id));
      if (inLane.some((module) => !known.has(module.kind))) groups.push({ id: null, label: "Other" });
      for (const group of groups) {
        const items = inLane.filter((module) => (group.id ? module.kind === group.id : !known.has(module.kind)));
        if (!items.length) continue;
        const chained = items.filter((module) => columnsOf(module).length > 0);
        const free = items.filter((module) => columnsOf(module).length === 0);
        const header = () => el("div", { class: "mx-rh" }, group.label, group.hint && el("small", null, group.hint));
        if (chained.length) {
          grid.append(
            el(
              "div",
              { class: "mx-row" },
              header(),
              cols.map((col) => {
                const here = chained.filter((module) => columnsOf(module).includes(col.id));
                return el("div", { class: `mx-cell${here.length ? "" : " none"}`, "data-col": col.id }, here.map((module) => renderChip(module, { group, column: col })));
              })
            )
          );
        }
        if (free.length) {
          grid.append(el("div", { class: "mx-row" }, chained.length ? el("div", { class: "mx-rh cont" }) : header(), el("div", { class: "mx-cell span" }, free.map((module) => renderChip(module, { group })))));
        }
      }
    }
    return el("div", { class: "matrix-scroll" }, grid);
  }

  function renderBand(section, modules) {
    const container = section.module && itemById(section.module);
    const head = el(
      "div",
      { class: "band-head" },
      el(
        "div",
        { class: "band-title-row" },
        el("h2", { class: "band-title" }, section.label),
        container && renderChip(container),
        section.seal && el("span", { class: "seal" }, section.seal)
      ),
      section.blurb && el("p", { class: "band-blurb" }, section.blurb),
      section.why &&
        el(
          "details",
          { class: "section-why" },
          el("summary", null, section.why.label || "Why?"),
          el("ul", null, (section.why.points || []).map((point) => el("li", null, point)))
        )
    );

    const lanes = section.lanes || [];
    const body = [];
    if (!lanes.length) {
      body.push(bandStrips(modules), el("div", { class: "chips" }, modules.map((module) => renderChip(module))));
    } else {
      const matrixLanes = (section.matrix || []).map((id) => lanes.find((lane) => lane.id === id)).filter(Boolean);
      let run = []; // consecutive plain lanes sit side by side
      const flush = () => {
        if (run.length) body.push(el("div", { class: "lane-run" }, run));
        run = [];
      };
      let matrixDrawn = false;
      for (const lane of lanes) {
        if (matrixLanes.includes(lane)) {
          if (matrixDrawn) continue;
          flush();
          body.push(renderMatrix(matrixLanes, modules.filter((module) => matrixLanes.some((l) => l.id === module.band))));
          matrixDrawn = true;
          continue;
        }
        const row = renderLaneRow(lane, modules.filter((module) => module.band === lane.id));
        if (row) run.push(row);
      }
      flush();
    }
    return el("section", { class: `band${section.seal ? " sealed" : ""}`, "data-section": section.id }, head, el("div", { class: "band-body" }, body));
  }

  function renderCrossSection(sections) {
    const xs = el("div", { class: "xs" });
    for (const section of sections) {
      const inSection = atlas.modules.filter((module) => module.section === section.id);
      const step = section.path
        ? el("button", { class: "step", type: "button", "data-section": section.id, "aria-label": `Go to ${section.label}` }, el("b", null, section.path.label), section.path.text)
        : el("div", { class: "step blank", "data-section": section.id });
      xs.append(step, renderBand(section, inSection));
    }
    return xs;
  }

  // ---- The rail follows the reader. The active layer is the one holding the open module, else the
  // one the reader pinned by clicking, else the band nearest the top of the viewport.
  let pinnedBand = null;

  let activeBand = null;

  function bandNearTop() {
    const bands = [...poster.querySelectorAll(".xs > .band")];
    if (!bands.length) return null;
    // "You are here": the band under a line just below the top bar; the last band once the page is scrolled to its end.
    const line = 140;
    if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) return bands[bands.length - 1];
    let best = bands[0];
    for (const band of bands) if (band.getBoundingClientRect().top <= line) best = band;
    return best;
  }

  function setActiveBand(id) {
    if (id === activeBand) return;
    activeBand = id;
    for (const node of poster.querySelectorAll(".xs > [data-section]")) {
      node.classList.toggle("is-active", node.getAttribute("data-section") === id);
    }
  }

  function updateActiveBand() {
    if (!poster.querySelector(".xs")) return;
    const open = openedId() && itemById(openedId());
    const id = (open && open.section) || pinnedBand || bandNearTop()?.getAttribute("data-section") || null;
    setActiveBand(id);
  }

  function setHoverBand(id) {
    for (const node of poster.querySelectorAll(".xs > [data-section]")) {
      node.classList.toggle("is-hover", id != null && node.getAttribute("data-section") === id);
    }
  }

  function pinBand(id) {
    pinnedBand = id;
    if (openedId()) closeDrawer();
    updateActiveBand();
  }

  let scrollTick = false;

  function onPosterScroll() {
    if (scrollTick) return;
    scrollTick = true;
    requestAnimationFrame(() => {
      scrollTick = false;
      updateActiveBand();
    });
  }

  function wireRail() {
    poster.addEventListener("mouseover", (event) => {
      const hit = event.target.closest(".xs > [data-section]");
      setHoverBand(hit ? hit.getAttribute("data-section") : null);
    });
    poster.addEventListener("mouseleave", () => setHoverBand(null));
    window.addEventListener("scroll", onPosterScroll, { passive: true, signal });
    window.addEventListener("resize", onPosterScroll, { signal });
    // Any scroll the reader makes themselves lets the rail follow the page again.
    for (const type of ["wheel", "touchmove"]) {
      window.addEventListener(type, () => { pinnedBand = null; }, { passive: true, signal });
    }
    window.addEventListener("keydown", (event) => {
      if (["ArrowDown", "ArrowUp", "PageDown", "PageUp", "Home", "End", " "].includes(event.key)) pinnedBand = null;
    }, { signal });
    updateActiveBand();
  }

  // Column filter on the grid: one chain at a time, click again to clear.
  function toggleColumn(th, { write = true } = {}) {
    const grid = th.closest(".matrix");
    const col = th.getAttribute("data-col");
    const on = th.getAttribute("aria-pressed") !== "true";
    for (const other of grid.querySelectorAll(".mx-th")) other.setAttribute("aria-pressed", other === th && on ? "true" : "false");
    grid.classList.toggle("is-filtered", on);
    for (const cell of grid.querySelectorAll("[data-col]")) cell.classList.toggle("is-off", on && cell.getAttribute("data-col") !== col);
    if (write) setUrlParams({ chain: on ? col : null });
  }

  // A map opened at ?chain=solana shows that column filtered. Applied once the grid exists, and
  // without writing back the address it came from.
  function applyChainFromUrl() {
    const wanted = query.get("chain");
    if (!wanted) return;
    const th = poster.querySelector(`.mx-th[data-col="${CSS.escape(wanted)}"]`);
    if (th) toggleColumn(th, { write: false });
  }

  // The column headers and the rail are the map's own; a click on a module is the drawer's and
  // is handled by the shell on every page.
  function onMapClick(event) {
    const th = event.target.closest(".mx-th");
    if (th) { toggleColumn(th); return; }
    if (event.target.closest("[data-id]")) return;
    // A rail step, or the blank part of a band: make that layer the active one and go there.
    const step = event.target.closest(".xs > .step[data-section]");
    const band = !event.target.closest("a, button, summary, [data-id]") && event.target.closest(".xs > .band");
    const hit = step || band;
    if (!hit) return;
    const id = hit.getAttribute("data-section");
    pinBand(id);
    if (step) scrollTo(poster.querySelector(`.xs > .band[data-section="${CSS.escape(id)}"]`), { block: "start" });
  }

  return {
    render: () => renderCrossSection(atlas.sections.filter((section) => (section.page || "map") === "map")),
    mounted() {
      applyChainFromUrl();
      buildModuleControls();
      poster.addEventListener("click", onMapClick);
      onDrawerChange(updateActiveBand);
      wireRail();
    },
  };
}
