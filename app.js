// Asset version from this script's own URL (app.js?v=N); data fetches carry it so a bump refreshes everything.
const ASSET_V = (() => { try { return new URL(document.currentScript.src, location.href).searchParams.get("v") || ""; } catch { return ""; } })();
const versioned = (path) => (ASSET_V ? `${path}?v=${ASSET_V}` : path);

const poster = document.querySelector("#poster");
const drawer = document.querySelector("#drawer");
const errorEl = document.querySelector("#error");

let atlas = null;
let openId = null;
// The roadmap is the front page; the map lives at ?page=map ("main" kept as an alias for old links).
const page = (() => { const p = new URLSearchParams(location.search).get("page") || "roadmap"; return p === "main" ? "map" : p; })();

function showError(message) {
  errorEl.hidden = false;
  errorEl.textContent = message;
}

function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value == null || value === false) continue;
      if (key === "class") node.className = value;
      else node.setAttribute(key, value === true ? "" : value);
    }
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(child));
  }
  return node;
}

function itemById(id) {
  return (
    atlas.modules.find((module) => module.id === id) ||
    (atlas.northStars || []).find((star) => star.id === id)
  );
}

function relationsOf(id) {
  const requires = [];
  const requiredBy = [];
  for (const module of atlas.modules) {
    for (const rel of module.relations || []) {
      if (module.id === id && itemById(rel.target)) requires.push({ id: rel.target, type: rel.type });
      if (rel.target === id) requiredBy.push({ id: module.id, type: rel.type });
    }
  }
  return { requires, requiredBy };
}

// Focus, not highlight: the selection and what it requires / is required by stay at full
// strength; everything else on the map fades (see .has-focus in styles.css).
function applyRelated(id) {
  const rel = id ? relationsOf(id) : { requires: [], requiredBy: [] };
  const linked = new Set([...rel.requires, ...rel.requiredBy].map((r) => r.id));
  poster.classList.toggle("has-focus", Boolean(id));
  for (const node of poster.querySelectorAll(".module-stack, .mod")) {
    const nid = node.getAttribute("data-id");
    node.classList.toggle("is-open", nid === id);
    node.classList.toggle("is-related", linked.has(nid));
  }
}

function isEcosystem(module) {
  return Boolean(module.publisher && module.publisher !== "tetherto");
}

function chainsOf(module) {
  const raw = module.chains;
  if (raw == null || raw === false) return [];
  return (Array.isArray(raw) ? raw : [raw]).map(String).filter(Boolean);
}

// ---- Roadmap: one list at the root of atlas.yaml; everything per module is derived from it.
function roadmapItems() {
  return atlas.roadmap || [];
}

function moduleRef(item, moduleId) {
  for (const ref of item.modules || []) {
    if (ref === moduleId) return { id: moduleId };
    if (ref && ref.id === moduleId) return ref;
  }
  return null;
}

// Roadmap entries touching a module, with the module-specific status/progress when given.
function roadmapFor(moduleId) {
  const out = [];
  for (const item of roadmapItems()) {
    const ref = moduleRef(item, moduleId);
    if (!ref) continue;
    out.push({
      id: item.id,
      label: item.label,
      parent: item.parent || null,
      status: ref.status || item.status || "planned",
      progress: ref.progress ?? item.progress,
    });
  }
  return out.sort((x, y) => Number(Boolean(x.parent)) - Number(Boolean(y.parent)));
}

function quarterLabel(q) {
  if (!q || q === "backlog") return "Backlog";
  const m = /^(\d{4})Q([1-4])$/.exec(q);
  return m ? `Q${m[2]} ${m[1]}` : q;
}

function quarterOrder(q) {
  return !q || q === "backlog" ? "9999" : q;
}

function progressOf(item) {
  const n = Number(item.progress);
  if (Number.isFinite(n)) return Math.max(0, Math.min(100, Math.round(n)));
  if ((item.status || "") === "wip") return 40;
  return null;
}

function progressStyle(percent) {
  return percent == null ? null : `--p:${percent}%`;
}

function renderModule(module) {
  const ecosystem = isEcosystem(module);
  const percent = progressOf(module);
  const chip = (item, depth) =>
    el(
      "li",
      {
        class: `roadmap-item ${item.status || "planned"}${depth ? " child" : ""}`,
        style: progressStyle(progressOf(item)),
      },
      depth ? el("span", { class: "child-mark", "aria-hidden": "true" }, "\u21B3 ") : null,
      item.label || item
    );
  const chips = roadmapFor(module.id)
    .filter((item) => item.status !== "done")
    .map((item) => chip(item, item.parent ? 1 : 0));
  const status = module.status || "planned";
  const classes = [
    "module",
    status,
    ecosystem ? "ecosystem" : "",
    module.placeholder ? "placeholder" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return el(
    "div",
    { class: "module-stack", "data-id": module.id, "data-search": searchTextOf(module) },
    el(
      "button",
      {
        class: classes,
        type: "button",
        "data-node": module.id,
        "aria-expanded": "false",
        style: progressStyle(percent),
      },
      el("span", { class: "module-name" }, module.title || module.name || module.id),
      module.title && el("span", { class: "module-id" }, module.name || module.id),
      chainsOf(module).length > 0 &&
        el(
          "span",
          { class: "chains" },
          chainsOf(module).map((chain) => el("span", { class: "chain" }, chain))
        ),
      ecosystem &&
        el("span", { class: "ecosystem-mark" }, `Third party · ${module.publisher}`)
    ),
    chips.length > 0 && el("ul", { class: "roadmap" }, chips)
  );
}

// A module drawn `under` (or implementing) another one in the same list goes under it, as a column.
const PLACEMENT_TYPES = new Set(["under", "implements"]);
function renderColumns(modules) {
  const ids = new Set(modules.map((module) => module.id));
  const baseOf = (module) =>
    (module.relations || []).find((rel) => PLACEMENT_TYPES.has(rel.type) && ids.has(rel.target) && rel.target !== module.id)?.target;
  const roots = modules.filter((module) => !baseOf(module));
  const columns = roots.map((root) => {
    const children = modules.filter((module) => baseOf(module) === root.id);
    return children.length
      ? el("div", { class: "module-column" }, renderModule(root), children.map(renderModule))
      : renderModule(root);
  });
  return el("div", { class: "band-modules" }, columns);
}

function renderBandBody(band, modules) {
  const groups = band.groups || [];
  if (!groups.length) {
    return renderColumns(modules);
  }

  const used = new Set();
  const rows = [];
  for (const group of groups) {
    const items = modules.filter((module) => module.kind === group.id);
    for (const item of items) used.add(item.id);
    if (!items.length) {
      rows.push(
        el(
          "div",
          { class: "band-group is-empty", "data-group": group.id },
          el("h3", { class: "group-label" }, group.label)
        )
      );
      continue;
    }
    rows.push(
      el(
        "div",
        { class: "band-group", "data-group": group.id },
        el("h3", { class: "group-label" }, group.label),
        renderColumns(items)
      )
    );
  }

  const rest = modules.filter((module) => !used.has(module.id));
  if (rest.length) {
    rows.push(
      el(
        "div",
        { class: "band-group", "data-group": "other" },
        el("h3", { class: "group-label" }, "Other"),
        renderColumns(rest)
      )
    );
  }
  return el("div", { class: "band-groups" }, rows);
}

function renderLane(lane, modules) {
  if (!modules.length) return null;
  return el(
    "div",
    { class: "lane", "data-lane": lane.id },
    lane.label && el("h3", { class: "lane-label" }, lane.label),
    lane.blurb && el("p", { class: "lane-blurb" }, lane.blurb),
    renderBandBody(lane, modules)
  );
}

function renderSection(section, { collapsible = true } = {}) {
  const lanes = section.lanes || [];
  const inSection = atlas.modules.filter(
    (module) => module.section === section.id
  );
  let body;
  if (!lanes.length) {
    body = el("div", { class: "band-modules" }, inSection.map(renderModule));
  } else {
    body = el(
      "div",
      { class: "lanes" },
      lanes
        .map((lane) =>
          renderLane(
            lane,
            inSection.filter((module) => module.band === lane.id)
          )
        )
        .filter(Boolean)
    );
  }

  if (section.why) {
    body = el(
      "div",
      { class: "section-body" },
      el(
        "details",
        { class: "section-why" },
        el("summary", null, section.why.label || "Why?"),
        el("ul", null, (section.why.points || []).map((point) => el("li", null, point)))
      ),
      body
    );
  }

  // A page with a single section: the page heading already names it, so no summary to fold.
  if (!collapsible) {
    return el("section", { class: "section section-plain", "data-section": section.id }, body);
  }

  const key = `atlas:${section.id}`;
  let open = true;
  try { open = localStorage.getItem(key) !== "closed"; } catch {}
  const container = section.module && itemById(section.module);
  const details = el(
    "details",
    { class: "section", "data-section": section.id, open },
    el(
      "summary",
      { class: "section-head" },
      el(
        "span",
        { class: "section-text" },
        el(
          "span",
          { class: "section-title-row" },
          el("h2", { class: "section-title" }, section.label),
          container && renderModule(container)
        ),
        section.blurb && el("span", { class: "section-blurb" }, section.blurb)
      )
    ),
    body
  );
  details.addEventListener("toggle", () => {
    try { localStorage.setItem(key, details.open ? "open" : "closed"); } catch {}
  });
  return details;
}

// ---- Main page: the stack drawn as a cross-section. One rail step and one band per section;
// inside the engine, the wallet and protocol lanes become a chain × capability grid.

function pendingFor(id) {
  return roadmapFor(id).filter((entry) => entry.status !== "done");
}

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

// What the map search matches on: titles, package name, id, chains, kind, publisher, status, summary.
function searchTextOf(module) {
  return [module.title, module.short, module.name, module.id, ...chainsOf(module), module.kind, module.publisher, module.status === "shipped" ? "live" : module.status, module.summary]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

// Map search: hides chips that do not match, dims the cells and lanes left empty, keeps the geometry.
function applyMapSearch(query, count) {
  const q = query.trim().toLowerCase();
  let total = 0;
  for (const node of poster.querySelectorAll("[data-search][data-id]")) {
    const hit = !q || (node.dataset.search || "").includes(q);
    node.classList.toggle("is-filtered", !hit);
    if (q && hit) total += 1;
  }
  for (const box of poster.querySelectorAll(".mx-cell, .chips, .band-modules, .lane, .lane-row, .band-group")) {
    const any = box.querySelector("[data-search][data-id]:not(.is-filtered)");
    box.classList.toggle("search-dim", Boolean(q) && !any);
  }
  count.textContent = q ? `${total} ${total === 1 ? "match" : "matches"}` : "";
}

// The compact module: status dot, plain title, publisher for ecosystem modules, pending count.
function renderChip(module, context) {
  const ecosystem = isEcosystem(module);
  const pending = pendingFor(module.id);
  const classes = ["mod", module.status || "planned", ecosystem ? "ecosystem" : "", module.placeholder ? "placeholder" : ""]
    .filter(Boolean)
    .join(" ");
  return el(
    "button",
    { class: classes, type: "button", "data-id": module.id, "data-node": module.id, "aria-expanded": "false", title: module.name || module.id, "data-search": searchTextOf(module) },
    el("i", { class: "dot", "aria-hidden": "true" }),
    el("span", { class: "mod-title" }, shortTitle(module, context)),
    ecosystem && el("span", { class: "pub" }, module.publisher),
    pending.length > 0 &&
      el("span", { class: "pend", title: pending.map((entry) => entry.label).join(", ") }, String(pending.length))
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
        percent != null && el("span", { class: "strip-bar", "aria-hidden": "true" }, el("i", { style: `width:${percent}%` })),
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
    { class: "lane-row", "data-lane": lane.id },
    el(
      "div",
      { class: "lane-head" },
      el("h3", { class: "lane-label" }, lane.label),
      lane.blurb && el("span", { class: "lane-blurb" }, lane.blurb)
    ),
    bandStrips(modules),
    el("div", { class: "chips" }, modules.map(renderChip))
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
          { class: "mx-th", type: "button", "data-col": col.id, "aria-pressed": "false", title: `Show only ${col.label}` },
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
    body.push(bandStrips(modules), el("div", { class: "chips" }, modules.map(renderChip)));
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
  const open = openId && itemById(openId);
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
  if (openId) closeDrawer();
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
  window.addEventListener("scroll", onPosterScroll, { passive: true });
  window.addEventListener("resize", onPosterScroll);
  // Any scroll the reader makes themselves lets the rail follow the page again.
  for (const type of ["wheel", "touchmove"]) {
    window.addEventListener(type, () => { pinnedBand = null; }, { passive: true });
  }
  window.addEventListener("keydown", (event) => {
    if (["ArrowDown", "ArrowUp", "PageDown", "PageUp", "Home", "End", " "].includes(event.key)) pinnedBand = null;
  });
  updateActiveBand();
}

// Column filter on the grid: one chain at a time, click again to clear.
function toggleColumn(th) {
  const grid = th.closest(".matrix");
  const col = th.getAttribute("data-col");
  const on = th.getAttribute("aria-pressed") !== "true";
  for (const other of grid.querySelectorAll(".mx-th")) other.setAttribute("aria-pressed", other === th && on ? "true" : "false");
  grid.classList.toggle("is-filtered", on);
  for (const cell of grid.querySelectorAll("[data-col]")) cell.classList.toggle("is-off", on && cell.getAttribute("data-col") !== col);
}

function isPending(status) {
  return status === "wip" || status === "planned";
}

function moduleChip(ref) {
  const id = typeof ref === "string" ? ref : ref.id;
  const module = itemById(id);
  if (!module) return el("span", { class: "roadmap-module missing", title: "not in the atlas" }, id);
  const status = (typeof ref === "string" ? null : ref.status) || null;
  return el(
    "button",
    { class: `roadmap-module${status ? " " + status : ""}`, type: "button", "data-id": id, "data-node": id, "aria-expanded": "false" },
    module.title || module.name || id
  );
}

const QUARTERS = ["2026Q1", "2026Q2", "2026Q3", "2026Q4", "2027Q1", "2027Q2"];
const view = new URLSearchParams(location.search).get("view") === "backlog" ? "backlog" : "timeline";

function currentQuarter(date = new Date()) {
  return `${date.getFullYear()}Q${Math.floor(date.getMonth() / 3) + 1}`;
}

function stateLabel(item) {
  return item.status === "wip" ? "in progress" : item.status === "done" ? "done" : "planned";
}

// Progress for an initiative: its own number, else the average of the numbers set on its modules. Never a default.
function itemProgress(item) {
  if (Number.isFinite(Number(item.progress))) return Math.max(0, Math.min(100, Math.round(item.progress)));
  const given = (item.modules || []).map((ref) => Number(ref && ref.progress)).filter(Number.isFinite);
  return given.length ? Math.round(given.reduce((a, b) => a + b, 0) / given.length) : null;
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

// One initiative. Progress shows only when someone set a number; nothing is invented.
function renderRoadmapItem(item, children) {
  const percent = itemProgress(item);
  const modules = moduleChips(item.modules || []);
  const moduleNames = (item.modules || []).map((ref) => { const m = itemById(typeof ref === "string" ? ref : ref.id); return m ? `${m.title || ""} ${m.name || m.id}` : String(ref); });
  const search = [item.label, item.summary, item.id, stateLabel(item), item.quarter, ...moduleNames].filter(Boolean).join(" ").toLowerCase();
  return el(
    "article",
    { class: `roadmap-card ${item.status || "planned"}`, id: item.id, "data-roadmap": item.id, "data-search": search },
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
      percent != null && item.status === "wip" && el("span", { class: "roadmap-card-progress" }, `${percent}%`)
    ),
    percent != null && item.status === "wip" &&
      el("div", { class: "progress", role: "progressbar", "aria-valuenow": percent, "aria-valuemin": 0, "aria-valuemax": 100 }, el("span", { style: `width:${percent}%` })),
    item.summary && el("p", { class: "roadmap-card-summary" }, item.summary),
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
        { class: `timeline-quarter${q === now ? " is-now" : ""}`, "data-quarter": q },
        quarterLabel(q),
        q === now && el("span", { class: "now-mark" }, "now")
      )
    )
  );
}

// Dashboard data, loaded once for the pages that read key results from it.
let METRICS = null;
async function loadMetrics() {
  if (METRICS) return METRICS;
  try {
    const res = await fetch(`data/metrics.json?v=${ASSET_V || "0"}-${new Date().toISOString().slice(0, 10)}`);
    METRICS = res.ok ? await res.json() : null;
  } catch { METRICS = null; }
  return METRICS;
}
const quarterOf = (dayStr) => `${dayStr.slice(0, 4)}Q${Math.floor((Number(dayStr.slice(5, 7)) - 1) / 3) + 1}`;
const sumSeries = (perRepo, from, to) => { let n = 0; for (const days of Object.values(perRepo || {})) for (const [d, v] of Object.entries(days)) if (d >= from && d < to) n += v; return n; };
const nextQuarter = (q) => (q.endsWith("Q4") ? `${Number(q.slice(0, 4)) + 1}Q1` : `${q.slice(0, 4)}Q${Number(q.slice(5)) + 1}`);
const quarterBounds = (q) => { const y = Number(q.slice(0, 4)), i = Number(q.slice(5)); const m = (i - 1) * 3; const from = `${y}-${String(m + 1).padStart(2, "0")}-01`; const to = m + 3 > 11 ? `${y + 1}-01-01` : `${y}-${String(m + 4).padStart(2, "0")}-01`; return [from, to]; };

// A key result with `metric` reads its current value and progress from the Dashboard data.
function evaluateMetric(kr) {
  const m = kr.metric; if (!m) return null;
  const out = { source: "Dashboard", link: "./?page=dashboard", note: null, current: null, target: null, progress: null, unit: "" };
  if (m.kind === "count" && m.source === "thirdPartyModules") {
    const n = (atlas.modules || []).filter((x) => x.publisher && x.publisher !== "tetherto" && x.status === "shipped").length;
    Object.assign(out, { current: n, target: m.target, progress: m.target ? Math.min(100, Math.round((100 * n) / m.target)) : null, link: "./?page=map", source: "Map, third-party modules" });
    return out;
  }
  if (!METRICS || !METRICS.daily) { out.note = "Dashboard data not loaded."; return out; }
  const D = METRICS.daily;
  if (m.kind === "quarterGrowth") {
    const days = Object.values(D[m.series] || {}).flatMap((x) => Object.keys(x)).sort();
    const first = days[0] || null, today = new Date().toISOString().slice(0, 10);
    const q = quarterOf(today), [qFrom, qTo] = quarterBounds(q);
    const prevQ = `${qFrom.slice(0, 4) - (q.endsWith("Q1") ? 1 : 0)}Q${q.endsWith("Q1") ? 4 : Number(q.slice(5)) - 1}`, [pFrom, pTo] = quarterBounds(prevQ);
    const cur = sumSeries(D[m.series], qFrom, qTo);
    out.current = cur; out.unit = `so far in ${q}`; out.link = "./?page=dashboard&range=monthly";
    if (!first || first > pFrom) {
      const firstFull = first && first === quarterBounds(quarterOf(first))[0] ? quarterOf(first) : nextQuarter(quarterOf(first || today));
      out.note = `Needs a full previous quarter of data. Data starts ${first || "today"}; the first full quarter is ${firstFull}, so the comparison becomes possible in ${nextQuarter(firstFull)}.`;
      out.target = `+${m.targetPct}% vs ${prevQ}`; return out;
    }
    const prev = sumSeries(D[m.series], pFrom, pTo);
    const goal = Math.ceil(prev * (1 + m.targetPct / 100));
    Object.assign(out, { target: `${goal} (+${m.targetPct}% vs ${prev} in ${prevQ})`, progress: goal ? Math.min(100, Math.round((100 * cur) / goal)) : null });
    return out;
  }
  if (m.kind === "issueResponse") {
    const within = m.withinHours || 168, now = Date.now();
    let answered = 0, missed = 0, pending = 0;
    for (const perDay of Object.values(D.issueResponse || {})) for (const [d, list] of Object.entries(perDay)) for (const h of list) {
      if (h >= 0 && h <= within) answered += 1;
      else if (h >= 0) missed += 1;
      else if (now - new Date(d + "T00:00:00Z") > within * 36e5) missed += 1;
      else pending += 1;
    }
    const total = answered + missed;
    const pct = total ? Math.round((100 * answered) / total) : null;
    Object.assign(out, { current: pct == null ? null : `${pct}%`, target: `${m.target}%`, progress: pct == null ? null : Math.min(100, Math.round((100 * pct) / m.target)), unit: `${answered} of ${total} issues, last 30 days${pending ? `, ${pending} still within the week` : ""}`, link: "./?page=dashboard&range=weekly", note: total ? null : "No issues opened in the window yet." });
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
      source: ev ? ev.source : o.source, sourceLink: ev ? ev.link : null, note: [o.note, ev && ev.note].filter(Boolean).join(" "), fromDashboard: Boolean(ev),
      progress: progress == null ? null : Math.max(0, Math.min(100, Math.round(progress))) };
  });
}

function renderKrChip(kr, starId) {
  const measured = kr.progress != null;
  return el(
    "a",
    { class: `kr${measured ? "" : " unmeasured"}`, href: `./?page=results#${starId}`, title: kr.label },
    el("span", { class: "kr-label" }, kr.label),
    measured
      ? el("span", { class: "kr-meter", "aria-label": `${kr.progress}%` }, el("span", { class: "kr-bar" }, el("span", { style: `width:${kr.progress}%` })), el("span", { class: "kr-pct" }, `${kr.progress}%`))
      : el("span", { class: "kr-none" }, "not measured")
  );
}

function renderKrStrip(star) {
  const krs = keyResultsOf(star);
  if (!krs.length) return null;
  return el("div", { class: "kr-strip", "aria-label": "Key results" }, krs.map((kr) => renderKrChip(kr, star.id)));
}

function renderStarRow(star, items, byParent, quarters, now, index, mode = "timeline") {
  const counts = { done: 0, wip: 0, planned: 0 };
  for (const item of items) counts[item.status || "planned"] += 1;
  const tally = el(
    "ul",
    { class: "star-tally" },
    counts.done > 0 && el("li", { class: "done" }, el("strong", null, String(counts.done)), " done"),
    counts.wip > 0 && el("li", { class: "wip" }, el("strong", null, String(counts.wip)), " in progress"),
    counts.planned > 0 && el("li", { class: "planned" }, el("strong", null, String(counts.planned)), " planned")
  );
  const rank = (x) => `${x.priority || "P9"}${x.status === "done" ? 2 : x.status === "wip" ? 0 : 1}`;
  const card = (item) => renderRoadmapItem(item, (byParent.get(item.id) || []).map((child) => renderRoadmapItem(child, [])));
  const body =
    mode === "backlog"
      ? el("div", { class: "backlog-grid" }, items.slice().sort((x, y) => rank(x).localeCompare(rank(y))).map(card))
      : el(
          "div",
          { class: "timeline-grid", style: `--cols:${quarters.length}` },
          quarters.map((q) =>
            el(
              "div",
              { class: `timeline-col${q === now ? " is-now" : ""}`, "data-quarter": q },
              items.filter((item) => (item.quarter || "backlog") === q).sort((x, y) => rank(x).localeCompare(rank(y))).map(card)
            )
          )
        );
  const target = location.hash.replace(/^#/, "");
  const open = Boolean(target) && items.some((item) => item.id === target || (byParent.get(item.id) || []).some((child) => child.id === target));
  const details = el(
    "details",
    { class: "star-row", id: `star-${star.id}`, "data-star": star.id, open },
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
    if (!details.dataset.searching) details.dataset.userOpen = details.open ? "1" : "";
  });
  return details;
}

// Arriving through a link to one initiative: bring its card into view and let it glow for a moment.
function spotlightTarget() {
  const id = location.hash.replace(/^#/, "");
  const card = id && poster.querySelector(`.roadmap-card[data-roadmap="${CSS.escape(id)}"]`);
  if (!card) return;
  const star = card.closest("details.star-row");
  if (star) star.open = true;
  card.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
  card.classList.remove("is-target");
  void card.offsetWidth; // restart the animation if the same card is targeted twice
  card.classList.add("is-target");
  card.addEventListener("animationend", () => card.classList.remove("is-target"), { once: true });
}

// Search: filters initiative cards by title, summary, id and module names; stars with a match open.
function renderSearch(apply = applySearch) {
  const input = el("input", { class: "search-input", type: "search", placeholder: "Search initiatives…", "aria-label": "Search initiatives", autocomplete: "off" });
  const count = el("span", { class: "search-count", "aria-live": "polite" });
  const wrap = el("label", { class: "search" }, input, count);
  input.addEventListener("input", () => apply(input.value, count));
  // ?q= prefills the search, so a filtered view can be shared as a link.
  const initial = new URLSearchParams(location.search).get("q") || "";
  if (initial) {
    input.value = initial;
    requestAnimationFrame(() => apply(initial, count));
  }
  document.addEventListener("keydown", (event) => {
    if (event.key === "/" && document.activeElement !== input && !event.metaKey && !event.ctrlKey) {
      event.preventDefault();
      input.focus();
    }
  });
  return wrap;
}

function applySearch(query, count) {
  const q = query.trim().toLowerCase();
  const stars = poster.querySelectorAll("details.star-row");
  let total = 0;
  for (const star of stars) {
    let visible = 0;
    for (const card of star.querySelectorAll(".roadmap-card")) {
      const own = !q || (card.dataset.search || "").includes(q);
      const childHit = q && [...card.querySelectorAll(".roadmap-children .roadmap-card")].some((c) => (c.dataset.search || "").includes(q));
      card.hidden = !(own || childHit);
      if (q && own && !card.closest(".roadmap-children")) visible += 1;
      if (q && own && card.closest(".roadmap-children")) visible += 1;
    }
    // Children of a matching parent stay visible; the parent itself stays if any child matches.
    for (const parent of star.querySelectorAll(".roadmap-card:not([hidden])")) {
      if (!q || (parent.dataset.search || "").includes(q)) for (const c of parent.querySelectorAll(".roadmap-children .roadmap-card")) c.hidden = false;
    }
    total += visible;
    star.dataset.searching = q ? "1" : "";
    star.dataset.matches = q ? String(visible) : "";
    star.open = q ? visible > 0 : star.dataset.userOpen === "1";
  }
  count.textContent = q ? `${total} ${total === 1 ? "match" : "matches"}` : "";
}

function renderViewToggle(backlogCount) {
  const link = (id, label, count) =>
    el(
      "a",
      { href: `./?page=roadmap${id === "backlog" ? "&view=backlog" : ""}`, "aria-current": view === id ? "page" : null },
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
  const used = new Set(items.filter((item) => !isBacklog(item)).map((item) => item.quarter));
  const quarters = [...new Set([...QUARTERS, ...used])].sort((x, y) => quarterOrder(x).localeCompare(quarterOrder(y)));

  const byParent = new Map();
  for (const item of items) {
    if (!item.parent || !items.some((i) => i.id === item.parent)) continue;
    if (!byParent.has(item.parent)) byParent.set(item.parent, []);
    byParent.get(item.parent).push(item);
  }
  const allRoots = items.filter((item) => !item.parent || !items.some((i) => i.id === item.parent));
  const roots = allRoots.filter((item) => (view === "backlog") === isBacklog(item));
  const backlogCount = allRoots.filter(isBacklog).length;

  const counts = { done: 0, wip: 0, planned: 0 };
  for (const item of items) counts[item.status || "planned"] += 1;
  const mission = el(
    "section",
    { class: "mission" },
    el("p", { class: "eyebrow" }, "Mission"),
    el("h2", { class: "mission-text" }, atlas.mission || ""),
    el(
      "p",
      { class: "mission-sub" },
      `${stars.length} north stars · ${counts.done} shipped · ${counts.wip} in progress · ${counts.planned} planned`
    )
  );

  const rows = stars
    .map((star, index) => [star, roots.filter((item) => item.northStar === star.id), index])
    .filter(([, inStar]) => view === "timeline" || inStar.length > 0)
    .map(([star, inStar, index]) => renderStarRow(star, inStar, byParent, quarters, now, index, view));
  const orphans = roots.filter((item) => !stars.some((star) => star.id === item.northStar));
  if (orphans.length) {
    rows.push(renderStarRow({ id: "unassigned", title: "Not yet linked to a north star" }, orphans, byParent, quarters, now, stars.length, view));
  }
  if (!roots.length) rows.push(el("p", { class: "meta" }, view === "backlog" ? "The backlog is empty." : "No roadmap entries in atlas.yaml yet."));

  const intro = el("div", { class: "roadmap-intro" }, mission, el("div", { class: "roadmap-controls" }, renderSearch(), renderViewToggle(backlogCount)));
  if (view !== "timeline") {
    return el("div", { class: "roadmap-page" }, intro, el("p", { class: "backlog-note" }, "Not yet scheduled. Ranked by north star, then priority."), rows);
  }

  // Narrow screens: the timeline scrolls sideways on its own, the quarter header follows it and stays sticky.
  const headWrap = el("div", { class: "timeline-head-wrap" }, renderTimelineHead(quarters, now));
  const scroller = el("div", { class: "timeline-scroll", style: `--cols:${quarters.length}` }, el("div", { class: "timeline-track" }, rows));
  scroller.addEventListener("scroll", () => { headWrap.scrollLeft = scroller.scrollLeft; }, { passive: true });
  const fit = () => scroller.style.setProperty("--viewport", `${scroller.clientWidth}px`);
  window.addEventListener("resize", fit, { passive: true });
  requestAnimationFrame(() => { fit(); spotlightTarget(); });
  return el("div", { class: "roadmap-page" }, intro, headWrap, scroller);
}

// Key results page: one grid for the whole page so columns line up across stars; one status language.
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
  return el("span", { class: "kr-value" }, el("b", null, cur), tgt && el("span", { class: "kr-target" }, plain ? ` of ${tgt}` : ` · target ${tgt}`));
}

function krRow(kr) {
  const st = krStatus(kr);
  return el(
    "div",
    { class: `kr-line ${st.key}`, id: kr.id },
    el("div", { class: "kr-main" }, el("div", { class: "kr-title" }, kr.label), (kr.unit || kr.note) && el("div", { class: "kr-sub" }, [kr.unit, kr.note].filter(Boolean).join(" · "))),
    el("div", { class: "kr-col kr-col-status" }, el("span", { class: `status-pill ${st.key}` }, st.label)),
    el("div", { class: "kr-col kr-col-value" }, krValue(kr)),
    el("div", { class: "kr-col kr-col-progress" }, el("span", { class: "kr-bar" }, el("span", { style: `width:${kr.progress ?? 0}%` })), el("span", { class: "kr-pct" }, kr.progress == null ? "—" : `${kr.progress}%`)),
    el("div", { class: "kr-col kr-col-source" }, kr.sourceLink ? el("a", { href: kr.sourceLink }, kr.source.split(",")[0]) : kr.source ? el("span", null, kr.source) : el("span", { class: "kr-none" }, "to define"))
  );
}

function renderResults() {
  const stars = atlas.northStars || [];
  const items = roadmapItems();
  const all = stars.flatMap((star) => keyResultsOf(star));
  const measured = all.filter((kr) => kr.progress != null).length;

  const strip = el("ul", { class: "kr-strip-summary" },
    el("li", null, el("strong", null, `${measured} of ${all.length}`), " measured"),
    stars.map((star, i) => { const krs = keyResultsOf(star); const m = krs.filter((kr) => kr.progress != null).length; return el("li", null, el("a", { href: `#${star.id}`, title: star.title }, el("strong", null, `${m}/${krs.length}`), ` star ${String(i + 1).padStart(2, "0")}`)); }));

  const head = el("div", { class: "kr-line kr-head" },
    el("div", { class: "kr-main" }, "Key result"), el("div", { class: "kr-col" }, "Status"), el("div", { class: "kr-col" }, "Current · target"), el("div", { class: "kr-col" }, "Progress"), el("div", { class: "kr-col" }, "Source"));

  const blocks = stars.map((star, index) => {
    const krs = keyResultsOf(star);
    const linked = items.filter((item) => item.northStar === star.id);
    const counts = { done: 0, wip: 0, planned: 0 };
    for (const item of linked) counts[item.status || "planned"] += 1;
    return el(
      "section",
      { class: "results-star", id: star.id },
      el("header", { class: "star-head static" },
        el("span", { class: "star-index" }, String(index + 1).padStart(2, "0")),
        el("div", { class: "star-text" }, el("h2", { class: "star-title plain" }, star.title), star.summary && el("p", { class: "star-summary" }, star.summary)),
        el("ul", { class: "star-tally" },
          el("li", null, el("a", { href: `./?page=roadmap#star-${star.id}` }, el("strong", null, String(linked.length)), " initiatives")),
          counts.done > 0 && el("li", { class: "done" }, el("strong", null, String(counts.done)), " done"),
          counts.wip > 0 && el("li", { class: "wip" }, el("strong", null, String(counts.wip)), " in progress"))),
      el("div", { class: "kr-lines" }, krs.map(krRow))
    );
  });
  const note = el("p", { class: "results-note" }, "Draft, pending review. Measured means a real number exists; nothing is estimated.");
  return el("div", { class: "results-page" }, strip, note, head, blocks);
}

// ---- Dashboard: public metrics from data/metrics.json (one row per ISO week, collected by the Metrics action).
const SERIES = ["#3987e5", "#199e70", "#c98500"]; // categorical, fixed order, validated for the dark surface
const fmtNum = (n) => (n == null ? "—" : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}K` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(n));

function deltaPill(now, before, { invert = false } = {}) {
  if (before == null || now == null) return el("span", { class: "delta none" }, "no prior data");
  const diff = now - before;
  const pct = before ? Math.round((1000 * diff) / before) / 10 : null;
  const dir = diff > 0 ? "up" : diff < 0 ? "down" : "flat";
  const good = invert ? dir === "down" : dir === "up";
  const arrow = dir === "up" ? "↑" : dir === "down" ? "↓" : "→";
  const sign = diff > 0 ? "+" : diff < 0 ? "−" : "";
  return el("span", { class: `delta ${dir === "flat" ? "flat" : good ? "good" : "bad"}` }, `${arrow} ${sign}${fmtNum(Math.abs(diff))}${pct == null ? "" : ` (${sign}${Math.abs(pct)}%)`}`);
}

function statTile(label, value, delta, hint, feeds) {
  return el("div", { class: "tile" }, el("div", { class: "tile-label" }, label), el("div", { class: "tile-value" }, value), delta, hint && el("div", { class: "tile-hint" }, hint),
    feeds && el("a", { class: "tile-feeds", href: `./?page=results#${feeds.id}` }, `feeds key result: ${feeds.label}`));
}

// Axis labels thin out when there are many buckets: every point up to 12, then every nth, always the last.
const labelEvery = (n, i) => n <= 12 || i === n - 1 || i % Math.ceil(n / 8) === 0;

// Inline SVG line chart, one series, hover titles on points, selective direct labels (first and last).
function lineChart(points, { color = SERIES[0], height = 160, unit = "" } = {}) {
  const W = 520, H = height, px = 28, py = 16;
  const ys = points.map((p) => p.y);
  const max = Math.max(...ys, 1), min = 0;
  const x = (i) => px + (i * (W - 2 * px)) / Math.max(points.length - 1, 1);
  const y = (v) => H - py - ((v - min) * (H - 2 * py)) / (max - min || 1);
  const d = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.y).toFixed(1)}`).join(" ");
  const svg = `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="line chart">
    ${[0, 0.5, 1].map((t) => `<line class="grid" x1="${px}" x2="${W - px}" y1="${y(max * t).toFixed(1)}" y2="${y(max * t).toFixed(1)}"/><text class="axis" x="${px - 6}" y="${(y(max * t) + 4).toFixed(1)}" text-anchor="end">${fmtNum(Math.round(max * t))}</text>`).join("")}
    <path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>
    ${points.map((p, i) => `<g><circle cx="${x(i).toFixed(1)}" cy="${y(p.y).toFixed(1)}" r="4.5" fill="${color}" stroke="var(--card)" stroke-width="2"/><title>${p.label}: ${p.y.toLocaleString()}${unit}</title></g>`).join("")}
    ${points.map((p, i) => (i === 0 || i === points.length - 1 ? `<text class="dlabel" x="${x(i).toFixed(1)}" y="${(y(p.y) - 10).toFixed(1)}" text-anchor="middle">${fmtNum(p.y)}</text>` : "")).join("")}
    ${points.map((p, i) => (labelEvery(points.length, i) ? `<text class="axis" x="${x(i).toFixed(1)}" y="${H - 2}" text-anchor="middle">${p.label}</text>` : "")).join("")}
  </svg>`;
  const box = el("div", { class: "chart-box" }); box.innerHTML = svg; return box;
}

// Grouped bars: categories on x, up to three series, 2px gaps, hover titles, legend below.
function groupedBars(categories, series, { height = 160 } = {}) {
  const W = 520, H = height, px = 28, py = 14;
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const gw = (W - 2 * px) / Math.max(categories.length, 1);
  const bw = Math.min(28, (gw * 0.7) / series.length);
  const y = (v) => H - py - (v * (H - 2 * py)) / max;
  const svg = `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="bar chart">
    ${[0, 0.5, 1].map((t) => `<line class="grid" x1="${px}" x2="${W - px}" y1="${y(max * t).toFixed(1)}" y2="${y(max * t).toFixed(1)}"/><text class="axis" x="${px - 6}" y="${(y(max * t) + 4).toFixed(1)}" text-anchor="end">${fmtNum(Math.round(max * t))}</text>`).join("")}
    ${categories.map((c, ci) => series.map((s, si) => { const v = s.values[ci] || 0; const bx = px + ci * gw + (gw - bw * series.length - 2 * (series.length - 1)) / 2 + si * (bw + 2); return `<g><rect x="${bx.toFixed(1)}" y="${y(v).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0, H - py - y(v)).toFixed(1)}" rx="3" fill="${SERIES[si]}"/><title>${c} · ${s.label}: ${v}</title></g>`; }).join("")).join("")}
    ${categories.map((c, ci) => (labelEvery(categories.length, ci) ? `<text class="axis" x="${(px + ci * gw + gw / 2).toFixed(1)}" y="${H - 2}" text-anchor="middle">${c}</text>` : "")).join("")}
  </svg>`;
  const box = el("div", { class: "chart-box" }); box.innerHTML = svg;
  if (series.length > 1) box.append(el("ul", { class: "legend-row" }, series.map((s, i) => el("li", null, el("i", { style: `background:${SERIES[i]}` }), s.label))));
  return box;
}

// Horizontal bars, one series, direct value labels.
function hBars(rows, { color = SERIES[0] } = {}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return el("div", { class: "hbars" }, rows.map((r) => el("div", { class: "hbar", title: `${r.hint ? r.hint + " · " : ""}${r.label}: ${r.value.toLocaleString()}` },
    el("span", { class: "hbar-label" }, r.label),
    el("span", { class: "hbar-track" }, el("span", { class: "hbar-fill", style: `width:${(100 * r.value) / max}%;background:${color}` })),
    el("span", { class: "hbar-value" }, fmtNum(r.value)))));
}

function chartCard(title, value, delta, body, foot) {
  return el("article", { class: "chart-card" },
    el("header", { class: "chart-head" }, el("h3", null, title), value != null && el("span", { class: "chart-value" }, value), delta),
    body, foot && el("p", { class: "chart-foot" }, foot));
}

function dashSection(title, cards, open = true) {
  return el("details", { class: "dash-section", open }, el("summary", { class: "section-head" }, el("span", { class: "section-text" }, el("span", { class: "section-title-row" }, el("h2", { class: "section-title" }, title)))), el("div", { class: "chart-grid" }, cards));
}

// ---- Dashboard data model (schema 3): per-repo daily series + daily snapshots; the page sums the selected repos.
const GRAINS = { daily: "Daily", weekly: "Weekly", monthly: "Monthly" };
const params = new URLSearchParams(location.search);
const grain = GRAINS[params.get("range")] ? params.get("range") : "weekly";
const SEL_KEY = "atlas:dash:repos";

function isoWeekOf(dayStr) {
  const d = new Date(dayStr + "T00:00:00Z");
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const wd = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - wd);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return `${t.getUTCFullYear()}-W${String(Math.ceil(((t - y0) / 864e5 + 1) / 7)).padStart(2, "0")}`;
}
const bucketKey = (dayStr) => (grain === "daily" ? dayStr : grain === "weekly" ? isoWeekOf(dayStr) : dayStr.slice(0, 7));
const todayKey = () => bucketKey(new Date().toISOString().slice(0, 10));
const bucketLabel = (key) => {
  if (grain === "daily") { const d = new Date(key + "T00:00:00Z"); return d.toLocaleDateString("en", { month: "short", day: "numeric", timeZone: "UTC" }); }
  if (grain === "weekly") return key.replace(/^\d{4}-/, "");
  const d = new Date(key + "-01T00:00:00Z"); return d.toLocaleDateString("en", { month: "short", year: "2-digit", timeZone: "UTC" });
};
const MAX_BUCKETS = { daily: 30, weekly: 12, monthly: 12 };

// Sum a per-repo daily series over the selected repos into complete buckets of the current grain.
function seriesBuckets(perRepo, selected, { includeCurrent = false } = {}) {
  const sums = new Map();
  for (const repo of selected) for (const [d, n] of Object.entries((perRepo || {})[repo] || {})) sums.set(bucketKey(d), (sums.get(bucketKey(d)) || 0) + n);
  const now = todayKey();
  return [...sums].filter(([k]) => includeCurrent || k < now).sort().slice(-MAX_BUCKETS[grain]).map(([k, y]) => ({ key: k, label: bucketLabel(k), y }));
}
const lastTwo = (pts) => ({ now: pts.length ? pts[pts.length - 1].y : null, prev: pts.length > 1 ? pts[pts.length - 2].y : null, key: pts.length ? pts[pts.length - 1].key : null });

// Snapshot totals for the selection, per snapshot day; then bucketed as end-of-bucket values.
function snapshotSeries(snapshots, field, selected, reduce = (vals) => vals.reduce((a, b) => a + b, 0)) {
  const days = Object.keys(snapshots).sort();
  const perDay = days.map((d) => ({ d, v: reduce(selected.map((r) => (snapshots[d][field] || {})[r]).filter((v) => v != null)) }));
  const byBucket = new Map();
  for (const { d, v } of perDay) byBucket.set(bucketKey(d), v); // last snapshot in the bucket wins
  return [...byBucket].sort().slice(-MAX_BUCKETS[grain]).map(([k, y]) => ({ key: k, label: bucketLabel(k), y }));
}

function readSelection(all) {
  const fromUrl = params.get("repos");
  if (fromUrl) { const set = new Set(fromUrl.split(",")); return all.filter((r) => set.has(r)); }
  try { const saved = JSON.parse(localStorage.getItem(SEL_KEY) || "null"); if (Array.isArray(saved) && saved.length) return all.filter((r) => saved.includes(r)); } catch {}
  return all;
}
function saveSelection(selected, all) {
  try { selected.length === all.length ? localStorage.removeItem(SEL_KEY) : localStorage.setItem(SEL_KEY, JSON.stringify(selected)); } catch {}
}

function renderGrainSwitch() {
  const link = (id) => { const u = new URLSearchParams(location.search); u.set("page", "dashboard"); u.set("range", id); return el("a", { href: `./?${u}`, "aria-current": grain === id ? "page" : null }, GRAINS[id]); };
  return el("nav", { class: "view-toggle", "aria-label": "Granularity" }, Object.keys(GRAINS).map(link));
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
    onChange(chosen);
  };
  const list = el("div", { class: "repo-groups" }, groups.map(([id, names]) =>
    el("fieldset", { class: "repo-group" }, el("legend", null, labelOf(id)), names.map((n) => {
      const box = el("input", { type: "checkbox", value: n });
      box.checked = selected.includes(n);
      box.addEventListener("change", apply);
      boxes.set(n, box);
      const r = file.repos[n];
      const pkgLabel = r.package ? r.package.replace(/^@tetherto\//, "") : "";
      return el("label", { class: "repo-row", title: n }, box, el("span", { class: "repo-title" }, r.title), pkgLabel && pkgLabel !== r.title && el("span", { class: "repo-pkg" }, pkgLabel));
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

function buildDashboard(file, selected) {
  const snaps = file.snapshots || {};
  const snapDays = Object.keys(snaps).sort();
  const latest = snaps[snapDays[snapDays.length - 1]] || {};
  const sum = (obj) => selected.reduce((n, r) => n + ((obj || {})[r] || 0), 0);
  const uniq = (obj) => new Set(selected.flatMap((r) => (obj || {})[r] || [])).size;
  const D = file.daily || {};
  const dl = seriesBuckets(D.downloads, selected);
  const prsO = seriesBuckets(D.prsOpened, selected), prsM = seriesBuckets(D.prsMerged, selected);
  const xO = seriesBuckets(D.externalPrsOpened, selected), xM = seriesBuckets(D.externalPrsMerged, selected);
  const isO = seriesBuckets(D.issuesOpened, selected), isC = seriesBuckets(D.issuesClosed, selected);
  const starsSeries = snapshotSeries(snaps, "stars", selected);
  const backlogSeries = snapshotSeries(snaps, "openIssues", selected);
  const contribSeries = snapshotSeries(snaps, "contributors", selected, (lists) => new Set(lists.flat()).size);
  const dlLast = lastTwo(dl), starsLast = lastTwo(starsSeries);
  const unit = { daily: "day", weekly: "week", monthly: "month" }[grain];
  const align = (a, b) => { const keys = [...new Set([...a, ...b].map((p) => p.key))].sort(); const at = (s, k) => (s.find((p) => p.key === k) || {}).y || 0; return { cats: keys.map(bucketLabel), a: keys.map((k) => at(a, k)), b: keys.map((k) => at(b, k)) }; };
  const pr = align(prsO, prsM), xpr = align(xO, xM), iss = align(isO, isC);
  const published = (latest.published || []).filter((r) => selected.includes(r)).length;
  const withPkg = selected.filter((r) => file.repos[r].package).length;

  const tiles = el("div", { class: "tiles" },
    statTile(`npm downloads, last full ${unit}`, fmtNum(dlLast.now), deltaPill(dlLast.now, dlLast.prev), dlLast.key ? `${dlLast.key} · ${selected.filter((r) => file.repos[r].package).length} packages` : "no download data for this selection"),
    statTile("GitHub stars", fmtNum(sum(latest.stars)), deltaPill(starsLast.now, starsLast.prev), `${selected.length} repos · ${fmtNum(sum(latest.forks))} forks`),
    statTile(`External pull requests merged, last ${unit}`, String(lastTwo(xM).now ?? 0), deltaPill(lastTwo(xM).now ?? 0, lastTwo(xM).prev), `${lastTwo(xO).now ?? 0} opened`),
    statTile("Contributors", String(uniq(latest.contributors)), deltaPill(lastTwo(contribSeries).now, lastTwo(contribSeries).prev), "people with commits, bots excluded, unique across the selection"),
    statTile("Open issues", String(sum(latest.openIssues)), deltaPill(lastTwo(backlogSeries).now, lastTwo(backlogSeries).prev, { invert: true }), `${lastTwo(isO).now ?? 0} opened · ${lastTwo(isC).now ?? 0} closed · last ${unit}`),
    statTile("Modules published", String(published), el("span", { class: "delta none" }, `of ${withPkg} packages`), `${(atlas.modules || []).filter((m) => m.publisher && m.publisher !== file.org && m.status === "shipped").length} more by third parties, not in this count`)
  );

  const byPackage = selected.filter((r) => file.repos[r].package).map((r) => { const pts = seriesBuckets({ [r]: (D.downloads || {})[r] }, [r]); return { label: file.repos[r].package.replace(/^@tetherto\//, ""), hint: file.repos[r].title !== r ? file.repos[r].title : "", value: lastTwo(pts).now || 0 }; }).sort((a, b) => b.value - a.value).slice(0, 8);
  const byStars = selected.map((r) => ({ label: r, hint: file.repos[r].title !== r ? file.repos[r].title : "", value: (latest.stars || {})[r] || 0 })).sort((a, b) => b.value - a.value).slice(0, 8);

  const adoption = dashSection("Adoption & growth", [
    chartCard(`npm downloads per ${unit}`, fmtNum(dlLast.now), deltaPill(dlLast.now, dlLast.prev), dl.length ? lineChart(dl) : el("p", { class: "chart-foot" }, "No download data for this selection."), "Selected packages summed. npm reports a few days late, so the current period is left out."),
    chartCard(`Downloads by package, last full ${unit}`, null, null, hBars(byPackage, { color: SERIES[1] }), "Top eight of the selection."),
    chartCard("Stars by repository", fmtNum(sum(latest.stars)), null, hBars(byStars, { color: SERIES[2] }), "Top eight of the selection."),
    chartCard(`Stars over time`, null, null, starsSeries.length > 1 ? lineChart(starsSeries, { color: SERIES[2] }) : el("p", { class: "chart-foot" }, "Needs at least two daily snapshots; the first was taken " + (snapDays[0] || "today") + "."), "Total at the end of each period, from daily snapshots."),
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
    chartCard(`External contributors, ${windowLabel}`, String(Object.keys(authors).length), null, topAuthors.length ? hBars(topAuthors, { color: SERIES[1] }) : el("p", { class: "chart-foot" }, "No external pull requests in the window."), "Top five by pull requests opened over the periods shown; hover for GitHub's label and merges. A teammate or a bot showing up here means the internal list needs a fix."),
    chartCard(`Pull requests per ${unit}`, String(lastTwo(prsO).now ?? 0), null, groupedBars(pr.cats, [{ label: "Opened", values: pr.a }, { label: "Merged", values: pr.b }]), "Complete periods only."),
    chartCard(`External pull requests per ${unit}`, String(lastTwo(xO).now ?? 0), null, groupedBars(xpr.cats, [{ label: "Opened", values: xpr.a }, { label: "Merged", values: xpr.b }]), "Authors who are not members or collaborators of the org."),
    chartCard("Contributors over time", String(uniq(latest.contributors)), null, contribSeries.length > 1 ? lineChart(contribSeries, { color: SERIES[1] }) : el("p", { class: "chart-foot" }, "Needs at least two daily snapshots."), "Unique people across the selection, at the end of each period."),
  ]);
  const support = dashSection("Support & responsiveness", [
    chartCard(`Issues opened and closed per ${unit}`, String(sum(latest.openIssues)), deltaPill(lastTwo(backlogSeries).now, lastTwo(backlogSeries).prev, { invert: true }), groupedBars(iss.cats, [{ label: "Opened", values: iss.a }, { label: "Closed", values: iss.b }]), "Headline is the open backlog today."),
    chartCard("Open backlog over time", null, null, backlogSeries.length > 1 ? lineChart(backlogSeries, { color: SERIES[0] }) : hBars([{ label: "Open issues", value: sum(latest.openIssues) }, { label: "Open pull requests", value: sum(latest.openPrs) }]), backlogSeries.length > 1 ? "Open issues at the end of each period." : "Today; a curve appears after the second snapshot."),
  ]);
  const note = el("p", { class: "dash-note" }, `Public sources only: the npm registry and the GitHub API. ${selected.length} of ${Object.keys(file.repos).length} public WDK repos selected. Daily series cover the last 30 days and grow by one day per run; stars, contributors and open counts are daily snapshots, the first taken ${snapDays[0]}. Last collected ${String(file.updated).slice(0, 10)}. Community, newsletter and website figures are not public and are not shown.`);
  return [tiles, adoption, community, support, note];
}

async function renderDashboard() {
  const stamp = new Date().toISOString().slice(0, 10);
  const response = await fetch(`data/metrics.json?v=${ASSET_V || "0"}-${stamp}`);
  if (!response.ok) throw new Error("No data/metrics.json yet. Run bin/collect-metrics.mjs or the Metrics action.");
  const file = await response.json();
  if (file.schema !== 3) throw new Error("data/metrics.json is an older schema; run the collector again.");
  const all = Object.keys(file.repos || {}).sort();
  let selected = readSelection(all);
  const body = el("div", { class: "dash-body" }, buildDashboard(file, selected));
  const controls = el("div", { class: "dash-controls" }, renderGrainSwitch(), renderRepoPanel(file, selected, (chosen) => { selected = chosen; body.replaceChildren(...buildDashboard(file, selected)); }));
  return el("div", { class: "dash-page" }, controls, body);
}

const pageHeadings = {
  main: { title: "WDK Atlas", subtitle: "", hidden: true },   // the logo carries the brand; keep an h1 for assistive tech
  dev: {
    title: "Developer Resources",
    subtitle: "Docs, examples and tools for building with WDK. Not part of a shipped wallet.",
  },
  roadmap: { title: "", subtitle: "" },
  dashboard: {
    title: "Dashboard",
    subtitle: "Public adoption, community and support numbers, collected daily into the same repo.",
  },
  results: {
    title: "Key results",
    subtitle: "How each north star is measured.",
  },
  questions: {
    title: "Questions",
    subtitle: "Open questions for Jonathan and the team. Read from the questions section of NOTES.md.",
  },
};

// Questions page: unlisted. Ten taps on the logo reveal the link; the browser remembers it.
const QUESTIONS_KEY = "atlas:questions";
const QUESTIONS_TAPS = 10;

function questionsUnlocked() {
  try { return localStorage.getItem(QUESTIONS_KEY) === "on"; } catch { return false; }
}

function revealQuestions() {
  document.querySelector("#nav-questions").hidden = false;
}

function wireLogoTaps() {
  const brand = document.querySelector(".brand");
  let taps = 0;
  let timer = null;
  brand.addEventListener("click", (event) => {
    event.preventDefault();
    clearTimeout(timer);
    taps += 1;
    if (taps >= QUESTIONS_TAPS) {
      taps = 0;
      try { localStorage.setItem(QUESTIONS_KEY, "on"); } catch {}
      revealQuestions();
      location.href = "./?page=questions";
      return;
    }
    // A lone tap still goes home; a run of taps does not reload the page in between.
    timer = setTimeout(() => {
      if (taps === 1) location.href = brand.getAttribute("href");
      taps = 0;
    }, 400);
  });
}

// The "Questions for the maintainer" section of NOTES.md, up to the next second-level heading.
function questionsSection(markdown) {
  const lines = markdown.split("\n");
  const start = lines.findIndex((line) => /^##\s.*questions/i.test(line));
  if (start < 0) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^##\s/.test(line));
  return rest.slice(0, end < 0 ? rest.length : end).join("\n").trim();
}

async function renderQuestions() {
  const response = await fetch(versioned("NOTES.md"));
  if (!response.ok) throw new Error(`Could not load NOTES.md (${response.status}).`);
  const section = questionsSection(await response.text());
  if (!section) throw new Error("NOTES.md has no '## … Questions' section.");
  const prose = el("article", { class: "prose" });
  prose.innerHTML = marked.parse(section);
  return prose;
}

function renderPoster() {
  const heading = pageHeadings[page] || pageHeadings.main;
  const title = document.querySelector("#title");
  title.textContent = heading.title;
  title.classList.toggle("visually-hidden", Boolean(heading.hidden));
  document.querySelector("#subtitle").textContent = heading.subtitle;
  document.body.classList.add(`page-${page}`);

  for (const link of document.querySelectorAll(".nav a")) {
    link.toggleAttribute("aria-current", link.getAttribute("data-page") === page);
  }

  if (page === "roadmap") {
    poster.replaceChildren(el("div", { class: "atlas" }, renderRoadmap()));
    poster.hidden = false;
    return;
  }

  if (page === "dashboard") {
    renderDashboard()
      .then((node) => { poster.replaceChildren(el("div", { class: "atlas" }, node)); poster.hidden = false; })
      .catch((error) => showError(error.message));
    return;
  }

  if (page === "results") {
    poster.replaceChildren(el("div", { class: "atlas" }, renderResults()));
    poster.hidden = false;
    return;
  }

  if (page === "questions") {
    revealQuestions();
    renderQuestions()
      .then((prose) => {
        poster.replaceChildren(el("div", { class: "atlas" }, prose));
        poster.hidden = false;
      })
      .catch((error) => showError(error.message));
    return;
  }

  const onPage = atlas.sections.filter((section) => (section.page || "map") === page);
  if (page === "map") {
    poster.replaceChildren(el("div", { class: "atlas" }, renderCrossSection(onPage)));
    poster.hidden = false;
    return;
  }
  const sections = el("div", { class: "sections" });
  for (const section of onPage) {
    sections.append(renderSection(section, { collapsible: onPage.length > 1 }));
  }

  poster.replaceChildren(el("div", { class: "atlas" }, sections));
  poster.hidden = false;
}

let openAnchor = null;

// The details open as a popover under the module that was clicked, kept inside the viewport width.
function placeDrawer() {
  if (drawer.hidden || !openAnchor || !openAnchor.isConnected) return;
  const rect = openAnchor.getBoundingClientRect();
  const viewport = document.documentElement.clientWidth;
  const width = Math.min(360, viewport - 24);
  const left = Math.max(12, Math.min(rect.left, viewport - width - 12)) + window.scrollX;
  drawer.style.width = `${width}px`;
  drawer.style.left = `${left}px`;
  drawer.style.top = `${rect.bottom + window.scrollY + 8}px`;
}

function closeDrawer() {
  openId = null;
  openAnchor = null;
  updateActiveBand();
  drawer.hidden = true;
  drawer.replaceChildren();
  document.body.classList.remove("drawer-open");
  for (const node of poster.querySelectorAll("[aria-expanded='true']")) {
    node.setAttribute("aria-expanded", "false");
  }
  applyRelated(null);
  if (location.hash) history.replaceState(null, "", location.pathname);
}

function sectionMeta(item) {
  const section = (atlas.sections || []).find((entry) => entry.id === item.section);
  const lane = (section?.lanes || []).find((entry) => entry.id === item.band);
  return [section?.label, lane?.label].filter(Boolean).join(" · ");
}

function drawerContent(item) {
  const isStar = (atlas.northStars || []).includes(item);
  const meta = isStar
    ? "North star"
    : [
        item.status === "shipped" ? "live" : item.status,
        chainsOf(item).join(" · "),
        isEcosystem(item) ? `third party · ${item.publisher}` : item.publisher,
        item.kind,
        sectionMeta(item),
      ]
        .filter(Boolean)
        .join(" · ");

  const notes = (item.notes || []).map((note) => el("li", null, note));
  const pending = isStar ? [] : roadmapFor(item.id);
  const state = (entry) => `${entry.status}${entry.progress != null && entry.status === "wip" ? `, ${progressOf(entry)}%` : ""}`;
  const roadmap = pending
    .filter((entry) => !entry.parent || !pending.some((p) => p.id === entry.parent))
    .map((entry) => {
      const children = pending.filter((child) => child.parent === entry.id);
      return el(
        "li",
        null,
        el("a", { href: `./?page=roadmap#${entry.id}` }, entry.label),
        ` (${state(entry)})`,
        children.length > 0 && el("ul", null, children.map((child) => el("li", null, `${child.label} (${state(child)})`)))
      );
    });

  const rel = isStar ? { requires: [], requiredBy: [] } : relationsOf(item.id);
  const relList = (entries) =>
    el(
      "ul",
      { class: "relations" },
      entries.map((r) => {
        const target = itemById(r.id);
        return el(
          "li",
          null,
          el("a", { href: `#${r.id}`, "data-goto": r.id }, target.title || target.name || r.id),
          el("span", { class: "relation-type" }, target.title ? target.name || r.id : r.type)
        );
      })
    );

  const links = [];
  if (item.repo) links.push(el("a", { href: item.repo }, "GitHub"));
  if (item.docs) links.push(el("a", { href: item.docs }, "Docs"));

  return [
    el("button", { class: "drawer-close", type: "button", "aria-label": "Close" }, "\u00d7"),
    el("h2", { id: "drawer-title" }, item.title || item.name || item.id),
    item.title && el("p", { class: "meta mono" }, item.name || item.id),
    el("p", { class: "meta" }, meta),
    item.summary && el("p", null, item.summary),
    notes.length > 0 && el("ul", null, notes),
    rel.requires.length > 0 && el("p", { class: "meta" }, `Requires · ${rel.requires.length}`),
    rel.requires.length > 0 && relList(rel.requires),
    rel.requiredBy.length > 0 && el("p", { class: "meta" }, `Required by · ${rel.requiredBy.length}`),
    rel.requiredBy.length > 0 && relList(rel.requiredBy),
    roadmap.length > 0 && el("p", { class: "meta" }, "On the roadmap"),
    roadmap.length > 0 && el("ul", null, roadmap),
    links.length > 0 && el("div", { class: "drawer-links" }, links),
  ];
}

function openDrawer(id, anchor) {
  const item = itemById(id);
  if (!item) return;

  for (const node of poster.querySelectorAll("[aria-expanded]")) {
    const on = node.getAttribute("data-node") === id;
    node.setAttribute("aria-expanded", on ? "true" : "false");
  }
  openId = id;
  openAnchor = anchor;
  applyRelated(id);
  updateActiveBand();

  drawer.hidden = false;
  drawer.setAttribute("aria-labelledby", "drawer-title");
  drawer.replaceChildren(...drawerContent(item).filter(Boolean));

  document.body.classList.add("drawer-open");
  const section = anchor.closest("details");
  if (section && !anchor.closest("summary")) section.open = true;
  placeDrawer();
  drawer.scrollIntoView({ block: "nearest", behavior: "smooth" });

  if (location.hash !== `#${id}`) history.replaceState(null, "", `#${id}`);
}

function onPosterClick(event) {
  const th = event.target.closest(".mx-th");
  if (th) return toggleColumn(th);
  const target = event.target.closest("[data-id]");
  if (!target) {
    // A rail step, or the blank part of a band: make that layer the active one and go there.
    const step = event.target.closest(".xs > .step[data-section]");
    const band = !event.target.closest("a, button, summary, [data-id]") && event.target.closest(".xs > .band");
    const hit = step || band;
    if (!hit) return;
    const id = hit.getAttribute("data-section");
    pinBand(id);
    if (step) poster.querySelector(`.xs > .band[data-section="${id}"]`)?.scrollIntoView({ block: "start", behavior: "smooth" });
    return;
  }
  if (target.closest("summary")) event.preventDefault();
  const id = target.getAttribute("data-id");
  if (openId === id) closeDrawer();
  else openDrawer(id, target);
}

function onDrawerClick(event) {
  if (event.target.closest(".drawer-close")) return closeDrawer();
  const goto = event.target.closest("[data-goto]");
  if (!goto) return;
  event.preventDefault();
  event.stopPropagation();
  const id = goto.getAttribute("data-goto");
  const anchor = poster.querySelector(`[data-id="${id}"]`);
  if (anchor) {
    openDrawer(id, anchor);
    anchor.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
}

async function loadAtlas() {
  const response = await fetch(versioned("atlas.yaml"));
  if (!response.ok) {
    throw new Error(`Could not load atlas.yaml (${response.status}).`);
  }
  return jsyaml.load(await response.text());
}

async function main() {
  if (typeof jsyaml === "undefined") {
    showError("js-yaml failed to load from vendor/js-yaml.min.js.");
    return;
  }

  try {
    atlas = await loadAtlas();
  } catch (error) {
    showError(
      "Open this over HTTP, not as a file. From the repo: python3 -m http.server 4173"
    );
    console.error(error);
    return;
  }

  if (page === "roadmap" || page === "results") await loadMetrics();
  renderPoster();
  const togglePending = document.querySelector("#toggle-pending");
  function applyToggles() {
    poster.classList.toggle("hide-pending", !togglePending.checked);
    if (!togglePending.checked && openId) {
      const item = itemById(openId);
      if (item && (item.status === "wip" || item.status === "planned")) {
        closeDrawer();
      }
    }
  }
  togglePending.addEventListener("change", applyToggles);

  if (page === "map" || page === "dev") {
    const side = document.querySelector(".header-side");
    const search = renderSearch(applyMapSearch);
    search.classList.add("map-search");
    side.prepend(search);
  }
  if (questionsUnlocked()) revealQuestions();
  wireLogoTaps();

  window.addEventListener("hashchange", () => { if (page === "roadmap") spotlightTarget(); });

  const topbar = document.querySelector("#topbar");
  const onScroll = () => topbar.classList.toggle("is-scrolled", window.scrollY > 8);
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  poster.addEventListener("click", onPosterClick);
  wireRail();
  drawer.addEventListener("click", onDrawerClick);
  window.addEventListener("resize", placeDrawer);
  document.addEventListener("click", (event) => {
    if (openId && !event.target.closest("[data-id], #drawer")) closeDrawer();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeDrawer();
  });

  const initial = location.hash.replace(/^#/, "");
  if (initial) {
    const anchor = poster.querySelector(`[data-id="${initial}"]`);
    if (anchor) openDrawer(initial, anchor);
  }
}

main();
