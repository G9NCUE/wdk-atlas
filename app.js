// Calendar arithmetic lives in lib/quarters.mjs so Node can test it without a DOM.
import { nextQuarter, sumSeries } from "./lib/quarters.mjs";
// Definitions live in lib/metrics-defs.mjs, so the page, the export and the gates read one copy.
import { metricDef, mayShowChange } from "./lib/metrics-defs.mjs";
// Building the files a reader takes away; pure, so Node tests them without a DOM.
import { metricCsv, metricJson, fileName } from "./lib/export.mjs";
// Telling a chosen install from one the dependency graph dragged along.
import { attribute, weightedCurrency } from "./lib/adoption.mjs";
// One table of public endpoints, shared with the gate that checks it covers every measurement.
import { originFor } from "./lib/origins.mjs";
// One answer-rate calculation, shared by the dashboard tile and the key result.
import { responseStats } from "./lib/support.mjs";

// WDK Atlas — one page per section of atlas.yaml, rendered in the browser with no build step.
//
// Data: atlas.yaml (modules, sections, north stars with key results, roadmap) and data/metrics.json
// (public metrics, written daily by the Metrics workflow). Both are fetched with the asset version
// from index.html, so bumping ?v=N there refreshes everything.
//
// Pages, in nav order: overview (the front page), roadmap, results, dashboard, map, dev.
// `page` below decides which one renders; each has its own section in this file.
//
// Everything this module needs to find its data comes from its own URL.
//
// document.currentScript is null inside a module, so reading the version from it returned
// nothing and atlas.yaml was being fetched unversioned; import.meta.url carries the query.
//
// The data is resolved against this file rather than against the page that loaded it. On the
// site those are the same directory. Embedded in another site they are not, and a path
// relative to the host page would look for the atlas beside whatever page happened to include
// it. Pass ?base= on the script tag to point somewhere else again.
const MODULE_URL = new URL(import.meta.url);
const ASSET_V = MODULE_URL.searchParams.get("v") || "";
const DATA_BASE = new URL(MODULE_URL.searchParams.get("base") || "./", MODULE_URL);
const dataUrl = (path) => {
  const url = new URL(path, DATA_BASE);
  if (ASSET_V) url.searchParams.set("v", ASSET_V);
  return url.href;
};

// Atlas expects a small set of elements to exist. index.html provides them. Anywhere else,
// it builds them itself, inside the element marked data-wdk-atlas or at the end of the body,
// so a host page can include one script tag and get a working atlas without copying markup it
// would then have to keep in step. Only the parts a page needs to render: no top bar, no
// navigation, no legend, since a host site has its own and would not want ours.
//
// This runs before anything below reads those elements, which is why it sits at the top.
function mount(host = document.querySelector("[data-wdk-atlas]") || document.body) {
  if (document.querySelector("#poster")) return; // the full site: nothing to build
  const frame = document.createElement("div");
  frame.className = "wdk-atlas-embed";
  const make = (tag, attrs) => {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    return node;
  };
  const header = make("header", { class: "site-header" });
  const headMain = make("div", { class: "header-main" });
  headMain.append(make("h1", { id: "title" }), make("p", { id: "subtitle", class: "subtitle" }));
  header.append(headMain, make("div", { class: "header-side" }));
  frame.append(
    header,
    make("p", { id: "error", class: "error", hidden: "" }),
    make("div", { id: "poster", class: "poster", hidden: "" }),
    make("aside", { id: "drawer", class: "drawer", role: "dialog", "aria-labelledby": "drawer-title", tabindex: "-1", hidden: "" }),
    make("footer", { id: "site-foot", class: "site-foot", hidden: "" }),
  );
  host.append(frame);
}
mount();
// Whether Atlas built its own frame, which means it is a guest on somebody else's page. The
// address bar then belongs to the host, so none of the filter state below is written to it.
const EMBEDDED = Boolean(document.querySelector(".wdk-atlas-embed"));

const poster = document.querySelector("#poster");
const drawer = document.querySelector("#drawer");
const errorEl = document.querySelector("#error");

let atlas = null;
let openId = null;
// The overview is the front page; the map lives at ?page=map ("main" kept as an alias for old links).
const PAGES = new Set(["overview", "roadmap", "results", "dashboard", "map", "dev"]);
// An unknown page used to render the Overview under the address that was asked for, so a link
// gone stale looked like it had worked and the reader was quietly given a different page.
const askedFor = new URLSearchParams(location.search).get("page") || "overview";
const page = (() => { const q = askedFor === "main" ? "map" : askedFor; return PAGES.has(q) ? q : "notfound"; })();

// Every filter that belongs in the address goes through here, so a link opens the way the
// sender left it. null deletes its parameter, keeping an unfiltered page on a plain address;
// an empty string is written, because "no repositories" is a state and "all" is the default.
// replaceState, not push: ten keystrokes should not be ten presses of the back button.
function setUrlParams(changes) {
  if (EMBEDDED) return; // the host owns its address bar
  const params = new URLSearchParams(location.search);
  for (const [key, value] of Object.entries(changes)) {
    if (value == null) params.delete(key);
    else params.set(key, value);
  }
  const qs = params.toString();
  history.replaceState(null, "", `${location.pathname}${qs ? "?" + qs : ""}${location.hash}`);
  refreshStateLinks();
}

// Links that carry the state forward: the timeline/backlog pair and the granularity switch.
// Both are built from location.search, so they go stale when a filter moves.
function refreshStateLinks() {
  for (const a of poster.querySelectorAll(".view-toggle a[data-view]")) a.href = viewHref(a.dataset.view);
  for (const a of poster.querySelectorAll(".view-toggle a[data-grain]")) a.href = grainHref(a.dataset.grain);
}

// On the site this marks the body; embedded it marks Atlas's own frame, so a host page does not
// end up wearing a class that belongs to us. The stylesheet matches either.
//
// Set here rather than in renderPoster, which does not run until atlas.yaml has been fetched and
// parsed. Until then no page class existed, so the stylesheet could not tell the pages apart and
// the header showed its most furnished state on all of them for as long as the fetch took.
(document.querySelector(".wdk-atlas-embed") || document.body).classList.add(`page-${page}`);

function showError(message) {
  errorEl.hidden = false;
  errorEl.textContent = message;
}

// Links whose address comes from atlas.yaml: only an https address, or one that stays on this
// site. bin/validate-atlas.mjs already refuses anything else in the file, so this is the second
// line rather than the first. It is here because the content security policy does not stop a
// javascript: address in every engine, and because the next person adding a link should not
// have to remember any of that.
function safeHref(value) {
  const href = String(value).trim();
  if (/^https:\/\/[^\s]+$/i.test(href)) return href;
  if (/^(?:\.{1,2}\/|\/(?!\/)|[#?])/.test(href)) return href; // relative, in-page, or a query
  return null;
}

// A percentage on its way into a style attribute. Anything that is not a finite number becomes
// zero, and the result is held between 0 and 100, so a stray value in the data cannot widen a
// bar past its track or inject anything into the declaration.
const pct = (n) => Math.max(0, Math.min(100, Number(n) || 0));

// An explicit behavior option beats the scroll-behavior rule in the stylesheet, so the
// preference has to be read here too. Checked at the moment of scrolling, because someone can
// change the setting without reloading the page.
const wantsLessMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const scrollTo = (node, options = {}) => node && node.scrollIntoView({ ...options, behavior: wantsLessMotion() ? "auto" : "smooth" });

function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value == null || value === false) continue;
      if (key === "class") node.className = value;
      else if (key === "style") for (const decl of String(value).split(";")) { const i = decl.indexOf(":"); if (i > 0) node.style.setProperty(decl.slice(0, i).trim(), decl.slice(i + 1).trim()); }
      else if (key === "href" || key === "src") { const safe = safeHref(value); if (safe) node.setAttribute(key, safe); }
      else node.setAttribute(key, value === true ? "" : value);
    }
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(child));
  }
  return node;
}

// The same helper for SVG, which needs its own namespace and takes every attribute through
// setAttribute. Charts are built with this rather than assembled as markup, so no string from
// the data is ever parsed as HTML and no escaping has to be remembered.
const SVG_NS = "http://www.w3.org/2000/svg";
function svgEl(tag, attrs, ...children) {
  const node = document.createElementNS(SVG_NS, tag);
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value == null || value === false) continue;
      // Styles go through the property, never the attribute. The content security policy has
      // no 'unsafe-inline' for styles, so a style attribute is dropped silently: the element
      // still appears, just with no colour. Setting each declaration is not blocked, which is
      // how el() has always done it.
      if (key === "style") {
        for (const decl of String(value).split(";")) {
          const i = decl.indexOf(":");
          if (i > 0) node.style.setProperty(decl.slice(0, i).trim(), decl.slice(i + 1).trim());
        }
        continue;
      }
      node.setAttribute(key, value === true ? "" : value);
    }
  }
  for (const child of children.flat(2)) {
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

const orgName = () => (atlas && atlas.audit && atlas.audit.org) || "tetherto";
const unscoped = (pkg) => (pkg || "").replace(new RegExp(`^@${orgName()}/`), "");

function isEcosystem(module) {
  return Boolean(module.publisher && module.publisher !== orgName());
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

// Progress only from a number someone set; an in-progress item without one shows no fill.
function progressOf(item) {
  const n = Number(item.progress);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : null;
}

function progressStyle(percent) {
  return percent == null ? null : `--p:${percent}%`;
}


// ==========================================================================================================
// Card renderer — the Developer Resources page
// Bigger cards with a title, package name and roadmap chips. The map uses the chip renderer instead.
// ==========================================================================================================

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
      el("span", { class: "module-name" }, module.title || module.name || module.id, module.private && lockMark()),
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
  const drawn = new Set();
  const column = (module) => {
    drawn.add(module.id);
    const children = modules.filter((child) => baseOf(child) === module.id && !drawn.has(child.id));
    return children.length ? el("div", { class: "module-column" }, renderModule(module), children.map(column)) : renderModule(module);
  };
  const columns = modules.filter((module) => !baseOf(module)).map(column);
  for (const module of modules) if (!drawn.has(module.id)) columns.push(column(module)); // a cycle: draw it as a root
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


// ==========================================================================================================
// Map page — chips, the chain x capability grid, and the rail
// The kit drawn as a cross-section: one band per section, wallets and protocols as a grid.
// ==========================================================================================================

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
  return [module.title, module.short, module.name, module.id, ...chainsOf(module), module.kind, module.publisher, module.status === "shipped" ? "live" : module.status, module.private ? "private" : "", module.summary]
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
// A private repo gets a lock, so a reader knows the link will not open for them.
const lockMark = () => el("span", withTip({ class: "lock", "aria-label": "private" }, "Private repository", "private"));

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
  const wanted = new URLSearchParams(location.search).get("chain");
  if (!wanted) return;
  const th = poster.querySelector(`.mx-th[data-col="${CSS.escape(wanted)}"]`);
  if (th) toggleColumn(th, { write: false });
}

function moduleChip(ref) {
  const id = typeof ref === "string" ? ref : ref.id;
  const module = itemById(id);
  if (!module) return el("span", withTip({ class: "roadmap-module missing" }, "Not on the map", id), id);
  const status = (typeof ref === "string" ? null : ref.status) || null;
  return el(
    "button",
    { class: `roadmap-module${status ? " " + status : ""}`, type: "button", "data-id": id, "data-node": id, "aria-expanded": "false" },
    module.title || module.name || id
  );
}


// ==========================================================================================================
// Roadmap page — the front page
// North star rows on a shared quarter timeline, plus a backlog view and search.
// ==========================================================================================================

const QUARTERS = ["2026Q1", "2026Q2", "2026Q3", "2026Q4", "2027Q1", "2027Q2"];
let view = new URLSearchParams(location.search).get("view") === "backlog" ? "backlog" : "timeline";

function currentQuarter(date = new Date()) {
  return `${date.getFullYear()}Q${Math.floor(date.getMonth() / 3) + 1}`;
}

function stateLabel(item) {
  return item.status === "wip" ? "in progress" : item.status === "done" ? "done" : "planned";
}

// Late: the quarter it was planned for has passed and it is not done. Computed, never typed.
function isLate(item) {
  return item.status !== "done" && Boolean(item.quarter) && item.quarter !== "backlog" && item.quarter < currentQuarter();
}

// Repo name behind a module's GitHub URL, the key the metrics file uses.
function repoNameOf(module) {
  const m = /github\.com\/[^/]+\/([^/#?]+)/.exec((module && module.repo) || "");
  return m ? m[1].replace(/\.git$/, "") : null;
}

// Owners of an initiative: the CODEOWNERS handles of the repos behind its modules. Public, never typed here.
function ownersOf(item) {
  if (!METRICS || !METRICS.owners) return [];
  const out = new Set();
  for (const ref of item.modules || []) {
    const m = itemById(typeof ref === "string" ? ref : ref.id);
    const r = repoNameOf(m);
    for (const h of (r && METRICS.owners[r]) || []) out.add(h);
  }
  return [...out];
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
    { class: `roadmap-card ${item.status || "planned"}${late ? " late" : ""}`, id: item.id, "data-roadmap": item.id, "data-search": search, "data-status": item.status || "planned", "data-partners": partners.length ? "1" : null, "data-late": late ? "1" : null },
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
        { class: `timeline-quarter${q === now ? " is-now" : ""}`, "data-quarter": q },
        quarterLabel(q),
        q === now && el("span", { class: "now-mark" }, "now")
      )
    )
  );
}

// Dashboard data, loaded once for the pages that read key results from it.

// ==========================================================================================================
// Key results — evaluation shared by the roadmap chips and the Key results page
// A key result is measured by hand in atlas.yaml, or by a `metric` block read from the dashboard data.
// ==========================================================================================================

let METRICS = null;
// The Metrics workflow rewrites this file daily without touching the asset version, and can push twice
// in one day, so a versioned URL is not enough: revalidate every load. The server answers 304 when the
// file has not changed, so this costs a round trip, not a download.
// The fetch in flight is remembered, not just its result. Two callers start before either
// resolves — the page renderer that renderPoster dispatches to asks for the file, and the
// freshness stamp asks again three lines later without awaiting — so remembering only the
// result fetched 445 KB twice on every visit to the dashboard and the overview.
let METRICS_FETCH = null;
function loadMetrics() {
  if (METRICS) return Promise.resolve(METRICS);
  if (!METRICS_FETCH) {
    METRICS_FETCH = fetch(dataUrl("data/metrics.json"), { cache: "no-cache" })
      .then((res) => (res.ok ? res.json() : null))
      .catch(() => null)
      .then((file) => { METRICS = file; METRICS_FETCH = null; return file; });
  }
  return METRICS_FETCH;
}

// The Map and the Developer Resources pages need four values: two dates for the footer stamp,
// the package to install and how many examples there are. They used to pull the whole 396 KB
// metrics file to read them. data/summary.json carries the same four in about a kilobyte, and
// falls back to the full file if it is missing, so an older deployment still works.
let SUMMARY = null;
// The fetch in flight is remembered here too, and for the same reason as above: the Developer
// Resources page asks for the summary to name the package while the freshness stamp asks for it
// again, and holding only the result fetched the file twice on every visit.
let SUMMARY_FETCH = null;
function loadSummary() {
  if (SUMMARY) return Promise.resolve(SUMMARY);
  if (!SUMMARY_FETCH) {
    SUMMARY_FETCH = fetch(dataUrl("data/summary.json"), { cache: "no-cache" })
      .then((res) => (res.ok ? res.json() : loadMetrics()))
      .catch(() => loadMetrics()) // the summary is missing on an older deployment; the full file still has it
      .then((file) => { SUMMARY = file; SUMMARY_FETCH = null; return file; });
  }
  return SUMMARY_FETCH;
}

// Scopes and facts the release-readiness key results read. All from the metrics file or the atlas.
const isStableVersion = (v) => Boolean(v) && !/-(alpha|beta|rc|next|canary|dev|pre)/i.test(v);
function publishedRepos() { return Object.entries((METRICS && METRICS.repos) || {}).filter(([, r]) => r.version).map(([n]) => n).sort(); }
function walletRepos() { return (atlas.modules || []).filter((m) => /^wdk-wallet-/.test(m.id) && !isEcosystem(m) && m.status === "shipped").map(repoNameOf).filter(Boolean); }
function latestSnapshot() { const snaps = (METRICS && METRICS.snapshots) || {}; const days = Object.keys(snaps).sort(); return days.length ? snaps[days[days.length - 1]] : null; }
// One repo's fact for a readiness field: true, false, or null when the collector has not measured it.
function readinessFact(field, repo, snap = latestSnapshot()) {
  if (field === "stable") return isStableVersion(METRICS && METRICS.repos[repo] && METRICS.repos[repo].version);
  if (!snap || !snap[field]) return null;
  const v = snap[field][repo];
  if (field === "ci") return v == null ? false : v === "success";
  return v === true;
}
const privateModules = () => (atlas.modules || []).filter((x) => x.private);
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
  const info = repo && METRICS && METRICS.repos ? METRICS.repos[repo] : null;
  return { org: orgName(), repo, pkg: info ? info.package : null, examplesUrl: examplesRepoUrl(), atlasUrl: dataHref("atlas.yaml") };
}

const examplesRepoUrl = () => `https://github.com/${orgName()}/${(atlas.audit && atlas.audit.examplesRepo) || "wdk-examples"}`;

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
  if (!METRICS || !METRICS.daily) { out.note = "Dashboard data not loaded."; return out; }
  const D = METRICS.daily;
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
    if (METRICS && METRICS.since && METRICS.since > from) out.note = `Collection starts ${METRICS.since}, so the window is not yet full.`;
    return out;
  }
  if (m.kind === "currency") {
    const snap = latestSnapshot();
    out.origin = originFor(m, originContext(publishedRepos()[0]));
    out.data = dataHref("data/metrics.json");
    if (!snap || !snap.onLatest) { out.note = "Not collected yet; the next metrics run adds it."; return out; }
    const pct = weightedCurrency(snap.onLatest, chosenInstalls(METRICS, Object.keys(METRICS.repos || {})));
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

function renderStarRow(star, items, byParent, quarters, now, index, mode = "timeline") {
  const counts = { done: 0, wip: 0, planned: 0, late: 0 };
  for (const item of items) { counts[item.status || "planned"] += 1; if (isLate(item)) counts.late += 1; }
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
              { class: `timeline-col${q === now ? " is-now" : ""}`, "data-quarter": q },
              items.filter((item) => (item.quarter || "backlog") === q).sort((x, y) => rank(x).localeCompare(rank(y))).map(card)
            )
          )
        );
  // Rows open by default: a folded roadmap reads as an empty page. The reader's own folds are remembered per view.
  const details = el(
    "details",
    { class: "star-row", id: `star-${star.id}`, "data-star": star.id, open: true },
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
  const id = location.hash.replace(/^#/, "");
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
  statuses: (() => {
    const raw = (new URLSearchParams(location.search).get("status") || "").split(",").filter((s) => STATUSES.includes(s));
    return new Set(raw.length ? raw : STATUSES);
  })(),
  partners: new URLSearchParams(location.search).get("partners") === "1",
  count: null,
};
const filterNarrowed = () => filter.statuses.size < STATUSES.length || filter.partners;

// Write the current filters into the address bar so a filtered roadmap can be shared, and keep the view links in step.
function syncFilterUrl() {
  setUrlParams({
    status: filter.statuses.size === STATUSES.length ? null : STATUSES.filter((s) => filter.statuses.has(s)).join(","),
    partners: filter.partners ? "1" : null,
  });
}

function renderSearch(apply = applyFilters, what = "initiatives") {
  const input = el("input", { class: "search-input", type: "search", placeholder: `Search ${what}…`, "aria-label": `Search ${what}`, autocomplete: "off" });
  const count = el("span", { class: "search-count", "aria-live": "polite" });
  const wrap = el("label", { class: "search" }, input, count);
  const run = () => {
    filter.query = input.value;
    filter.count = count;
    apply(input.value, count);
    // ?q= was read on load and never written, so a shareable search had to be built by hand.
    setUrlParams({ q: input.value.trim() || null });
  };
  input.addEventListener("input", run);
  // ?q= prefills the search, so a filtered view can be shared as a link.
  const initial = new URLSearchParams(location.search).get("q") || "";
  if (initial) input.value = initial;
  if (initial || (apply === applyFilters && filterNarrowed())) requestAnimationFrame(run);
  document.addEventListener("keydown", (event) => {
    if (event.key === "/" && document.activeElement !== input && !event.metaKey && !event.ctrlKey) {
      event.preventDefault();
      input.focus();
    }
  });
  return wrap;
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
  const params = new URLSearchParams(location.search);
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
  const wanted = location.hash.replace(/^#/, "");
  if (view === "timeline" && wanted && items.some((item) => item.id === wanted && isBacklog(item))) view = "backlog";
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
      withTip({ class: "mission-sub" }, countedTip(), "Counted from the atlas"),
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

  const shown = { done: 0, wip: 0, planned: 0, partners: 0 };
  for (const item of roots.flatMap((root) => [root, ...(byParent.get(root.id) || [])])) { shown[item.status || "planned"] += 1; if ((item.partners || []).length) shown.partners += 1; }
  const intro = el("div", { class: "roadmap-intro" }, mission, el("div", { class: "roadmap-controls" }, renderSearch(), renderStatusFilter(shown), renderPartnerToggle(shown.partners), renderViewToggle(backlogCount)));
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

// ==========================================================================================================
// Key results page
// One grid for every star so the columns line up; one status per row: measured, pending, to define.
// ==========================================================================================================

function krStatus(kr) {
  if (kr.progress != null) return { key: "measured", label: "Measured" };
  if (kr.fromDashboard || kr.source) return { key: "pending", label: "Not measured yet" };
  return { key: "undefined", label: "To define" };
}

// A value with more behind it (`valueTitle`, one line per item) gets a CSS tooltip that opens on hover and on
// keyboard focus at once; a native title needs a still pointer for a second and never shows on touch.
const tipAttrs = (tip, text) => (tip ? { class: "has-tip", "data-tip": tip, tabindex: "0", "aria-label": `${text}: ${tip.split("\n").join(", ")}` } : {});

// Merge a tip into attributes that already carry classes. Spreading tipAttrs directly would
// replace the class list rather than add to it, which silently strips an element's styling.
const withTip = (attrs, tip, text) => {
  const extra = tipAttrs(tip, text);
  if (!extra.class) return attrs;
  return { ...attrs, ...extra, class: [attrs.class, extra.class].filter(Boolean).join(" ") };
};

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
    const counts = { done: 0, wip: 0, planned: 0 };
    for (const item of linked) counts[item.status || "planned"] += 1;
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
  // Removed at the PM's call on 2026-09-20. The counted-versus-collected distinction survives
  // in the tip on every tally, and each row's source column names the public endpoint behind
  // its number, which makes the point where a reader is already looking.
  return el("div", { class: "results-page" }, strip, head, blocks);
}

// ---- Dashboard: public metrics from data/metrics.json, collected daily by the Metrics workflow.

// ==========================================================================================================
// Dashboard page
// Public metrics from data/metrics.json. Charts are inline SVG; no charting library.
// ==========================================================================================================

// Kept as references, not as resolved values, and applied through style rather than through a
// fill attribute. A resolved value would be frozen at load: the print stylesheet redefines
// these tokens to darker inks, and a chart drawn from a copy taken on screen would ignore it.
const SERIES = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)"];
const fmtNum = (n) => (n == null ? "—" : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}K` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(n));

// A change indicator, guarded by the floor recorded for the metric. Below the floor the reader
// gets the count and nothing else: a rise from one merged pull request to ten is "+9", not
// "+900%", because the percentage says more about the size of the base than about the work.
function deltaPill(id, now, before, { invert = false, note = "" } = {}) {
  if (before == null || now == null) return el("span", { class: "delta none" }, "no prior data");
  const diff = now - before;
  const pct = before && mayShowChange(id, before) ? Math.round((1000 * diff) / before) / 10 : null;
  const dir = diff > 0 ? "up" : diff < 0 ? "down" : "flat";
  const good = invert ? dir === "down" : dir === "up";
  const arrow = dir === "up" ? "↑" : dir === "down" ? "↓" : "→";
  const sign = diff > 0 ? "+" : diff < 0 ? "−" : "";
  return el("span", withTip({ class: `delta ${dir === "flat" ? "flat" : good ? "good" : "bad"}` }, note || "", "change"), `${arrow} ${sign}${fmtNum(Math.abs(diff))}${pct == null ? "" : ` (${sign}${Math.abs(pct)}%)`}`, note && el("span", { class: "delta-note" }, note));
}

// Trend against the average of the previous four periods, which is what a reader means by "is it up".
// Falls back to the previous period while fewer than five exist.
function trendPill(id, pts) {
  const short = { daily: "day", weekly: "wk", monthly: "mo" }[grain];
  if (pts.length >= 5) {
    const last = pts[pts.length - 1].y, base = pts.slice(-5, -1).reduce((a, p) => a + p.y, 0) / 4;
    return deltaPill(id, last, Math.round(base), { note: `vs 4-${short} avg` });
  }
  const { now, prev } = lastTwo(pts);
  return deltaPill(id, now, prev, { note: prev == null ? "" : `vs prev ${short}` });
}

// The one way a page is allowed to reach a definition. A figure with no entry behind it is a
// number nobody has had to justify, so it renders saying exactly that rather than looking
// finished; bin/check-metrics.mjs refuses the build long before a reader would see it.
function defFor(id) {
  return metricDef(id) || { id, label: id, definition: "No definition recorded for this figure.", source: "unknown", window: "unknown" };
}

// Counted, not collected. Rows in atlas.yaml say what we have written down; figures from npm
// and GitHub say what is true of the world. They sit side by side on three pages, in the same
// type, and nothing told a reader which was which. The registry already says why that matters,
// so the warning comes from there rather than being written out again here.
const countedTip = () => defTip(defFor("atlas-counts"));

// What is counted, then where it came from and over what window on one line. Kept to two lines
// because a tile that needs a paragraph to be read is not a tile.
const defTip = (def) => `${def.definition}\n${def.source} · ${def.window}`;

function statTile(def, label, value, delta, hint, feeds) {
  return el("div", { class: "tile" }, el("div", withTip({ class: "tile-label" }, defTip(def), label), label), el("div", { class: "tile-value" }, value), delta, hint && el("div", { class: "tile-hint" }, hint),
    feeds && el("a", withTip({ class: "tile-feeds", href: `./?page=results#${feeds.id}` }, feeds.label, "Key result"), "\u2192"));
}

// Axis labels thin out when there are many buckets: every point up to 12, then every nth, always the last.
const labelEvery = (n, i) => n <= 12 || i === n - 1 || i % Math.ceil(n / 8) === 0;

// Inline SVG line chart, one series, hover titles on points, selective direct labels (first and last).
function lineChart(points, { color = SERIES[0], height = 190, unit = "", marks = null } = {}) {
  const W = 520, H = height, px = 46, py = 22;
  const ys = points.map((p) => p.y);
  const max = Math.max(...ys, 1), min = 0;
  const x = (i) => px + (i * (W - 2 * px)) / Math.max(points.length - 1, 1);
  const y = (v) => H - py - ((v - min) * (H - 2 * py)) / (max - min || 1);
  const d = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.y).toFixed(1)}`).join(" ");

  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, class: "chart", role: "img", "aria-label": "line chart" },
    [0, 0.5, 1].flatMap((t) => [
      svgEl("line", { class: "grid", x1: px, x2: W - px, y1: y(max * t).toFixed(1), y2: y(max * t).toFixed(1) }),
      svgEl("text", { class: "axis", x: px - 6, y: (y(max * t) + 4).toFixed(1), "text-anchor": "end" }, fmtNum(Math.round(max * t))),
    ]),
    svgEl("path", { d, fill: "none", style: `stroke:${color}`, "stroke-width": 2, "stroke-linejoin": "round" }),
    points.map((p, i) => svgEl("g", null,
      svgEl("circle", { cx: x(i).toFixed(1), cy: y(p.y).toFixed(1), r: 4.5, style: `fill:${color}`, stroke: "var(--card)", "stroke-width": 2 }),
      svgEl("title", null, `${p.label}: ${p.y.toLocaleString()}${unit}`))),
    points.map((p, i) => (i === 0 || i === points.length - 1
      ? svgEl("text", { class: "dlabel", x: x(i).toFixed(1), y: (y(p.y) - 10).toFixed(1), "text-anchor": "middle" }, fmtNum(p.y))
      : null)),
    points.map((p, i) => (labelEvery(points.length, i)
      ? svgEl("text", { class: "axis", x: x(i).toFixed(1), y: H - 2, "text-anchor": "middle" }, p.label)
      : null)),
    points.map((p, i) => {
      const list = marks && marks.get(p.key);
      if (!list || !list.length) return null;
      return svgEl("g", { class: "mark" },
        svgEl("path", { d: `M${(x(i) - 3.5).toFixed(1)},${H - py + 3} h7 l-3.5,5 z`, fill: "var(--muted)" }),
        svgEl("title", null, `${list.length} npm release${list.length === 1 ? "" : "s"}: ${list.join(", ")}`));
    }));

  return el("div", { class: "chart-box" }, svg);
}

// Which npm releases fall in each bucket of the current grain, for the selected repos.
function releaseMarks(file, selected) {
  const marks = new Map();
  for (const r of selected) for (const [d, ver] of Object.entries((file.releases || {})[r] || {})) {
    const k = bucketKey(d); if (!marks.has(k)) marks.set(k, []);
    marks.get(k).push(`${unscoped(file.repos[r] && file.repos[r].package) || r} ${ver}`);
  }
  return marks;
}

// Grouped bars: categories on x, up to three series, 2px gaps, hover titles, legend below.
function groupedBars(categories, series, { height = 190 } = {}) {
  const W = 520, H = height, px = 46, py = 22;
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const gw = (W - 2 * px) / Math.max(categories.length, 1);
  const bw = Math.min(28, (gw * 0.7) / series.length);
  const y = (v) => H - py - (v * (H - 2 * py)) / max;
  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, class: "chart", role: "img", "aria-label": "bar chart" },
    [0, 0.5, 1].flatMap((t) => [
      svgEl("line", { class: "grid", x1: px, x2: W - px, y1: y(max * t).toFixed(1), y2: y(max * t).toFixed(1) }),
      svgEl("text", { class: "axis", x: px - 6, y: (y(max * t) + 4).toFixed(1), "text-anchor": "end" }, fmtNum(Math.round(max * t))),
    ]),
    categories.map((c, ci) => series.map((s, si) => {
      const v = s.values[ci] || 0;
      const bx = px + ci * gw + (gw - bw * series.length - 2 * (series.length - 1)) / 2 + si * (bw + 2);
      return svgEl("g", null,
        svgEl("rect", { x: bx.toFixed(1), y: y(v).toFixed(1), width: bw.toFixed(1), height: Math.max(0, H - py - y(v)).toFixed(1), rx: 3, style: `fill:${SERIES[si]}` }),
        svgEl("title", null, `${c} · ${s.label}: ${v}`));
    })),
    categories.map((c, ci) => (labelEvery(categories.length, ci)
      ? svgEl("text", { class: "axis", x: (px + ci * gw + gw / 2).toFixed(1), y: H - 2, "text-anchor": "middle" }, c)
      : null)));

  const box = el("div", { class: "chart-box" }, svg);
  if (series.length > 1) box.append(el("ul", { class: "legend-row" }, series.map((s, i) => el("li", null, el("i", { style: `background:${SERIES[i]}` }), s.label))));
  return box;
}

// Horizontal bars, one series, direct value labels.
// One line per row: the name and the number. A package already says what it is in its name, so
// a second line repeating it in prose doubled the height of every chart to tell the reader
// nothing they could act on. Whatever else is known about a row stays in the export, where a
// column costs nothing and a reader has asked for the detail.
function hBars(rows, { color = SERIES[0], unit = "", scale = null } = {}) {
  const max = scale || Math.max(1, ...rows.map((r) => r.value));
  return el("div", { class: "hbars" }, rows.map((r) => el("div", { class: "hbar" },
    el("span", { class: "hbar-label" }, r.label),
    el("span", { class: "hbar-track" }, el("span", { class: "hbar-fill", style: `width:${pct((100 * r.value) / max)}%;background:${color}` })),
    el("span", { class: "hbar-value" }, `${fmtNum(r.value)}${unit}`))));
}

// Handing a file to the reader. The address is a blob this page built a moment ago from its
// own data, so it never passes through the link allow-list, which exists to judge addresses
// that came from somewhere else. It is revoked once the browser has taken it.
function downloadText(name, mime, text) {
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

// Two buttons, one file each. Both carry the definition, because a column of numbers with no
// statement of what was counted is the same unfalsifiable claim in another file format.
function exportControls(def, data) {
  const meta = { title: data.title, collected: data.collected, scope: data.scope };
  const make = (label, ext, mime, build) => {
    const button = el("button", withTip({ class: "export-btn", type: "button" }, `${def.definition}\nSource: ${def.source}\nWindow: ${def.window}`, `Download ${label}`), label);
    button.addEventListener("click", () => downloadText(fileName(def, meta, ext), mime, build(def, meta, data.columns, data.rows)));
    return button;
  };
  return el("div", { class: "export", role: "group", "aria-label": `Download ${data.title}` },
    make("CSV", "csv", "text/csv", metricCsv), make("JSON", "json", "application/json", metricJson));
}

function chartCard(def, title, value, delta, body, foot, data) {
  return el("article", { class: "chart-card" },
    el("header", { class: "chart-head" }, el("h3", withTip({}, defTip(def), title), title), value != null && el("span", { class: "chart-value" }, value), delta,
      data && data.rows && data.rows.length ? exportControls(def, { ...data, title }) : null),
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
// First and last day a bucket key covers, so a bucket counts only when the data covers all of it.
function bucketRange(key) {
  if (grain === "daily") return [key, key];
  if (grain === "monthly") { const [y, m] = key.split("-").map(Number); const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); return [`${key}-01`, last]; }
  const [y, w] = key.split("-W").map(Number); const jan4 = new Date(Date.UTC(y, 0, 4)); const monday = new Date(jan4); monday.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() || 7) - 1) + (w - 1) * 7);
  const sunday = new Date(monday); sunday.setUTCDate(monday.getUTCDate() + 6);
  return [monday.toISOString().slice(0, 10), sunday.toISOString().slice(0, 10)];
}
// Days the data covers: downloads from their own first and last day; event series from the collector's window start to yesterday.
function coverageOf(perRepo, file, event) {
  const days = Object.values(perRepo || {}).flatMap((x) => Object.keys(x)).sort();
  const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  if (event) return [file.since || days[0] || yesterday, yesterday];
  return [days[0] || yesterday, days[days.length - 1] || yesterday];
}
function seriesBuckets(perRepo, selected, { coverage = null } = {}) {
  const sums = new Map();
  for (const repo of selected) for (const [d, n] of Object.entries((perRepo || {})[repo] || {})) sums.set(bucketKey(d), (sums.get(bucketKey(d)) || 0) + n);
  const now = todayKey();
  const complete = (k) => { if (k >= now) return false; if (!coverage) return true; const [a, b] = bucketRange(k); return a >= coverage[0] && b <= coverage[1]; };
  return [...sums].filter(([k]) => complete(k)).sort().slice(-MAX_BUCKETS[grain]).map(([k, y]) => ({ key: k, label: bucketLabel(k), y }));
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
  // has(), not get(): an empty ?repos= means nothing selected, which is a state a link carries.
  if (params.has("repos")) { const set = new Set((params.get("repos") || "").split(",").filter(Boolean)); return all.filter((r) => set.has(r)); }
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
  const [y, m] = since.split("-").map(Number);
  const firstFull = since.endsWith("-01") ? new Date(Date.UTC(y, m - 1, 1)) : new Date(Date.UTC(y, m, 1));
  const done = new Date(Date.UTC(firstFull.getUTCFullYear(), firstFull.getUTCMonth() + 1, 1));
  return new Date().toISOString().slice(0, 10) >= done.toISOString().slice(0, 10);
}
const grainHref = (id) => { const u = new URLSearchParams(location.search); u.set("page", "dashboard"); u.set("range", id); return `./?${u}`; };

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

// When a series has no complete period at this grain, say why and when one arrives, rather than
// drawing an empty chart that reads as broken.
function coverageNote(coverage) {
  const unit = { daily: "day", weekly: "week", monthly: "month" }[grain];
  const start = coverage && coverage[0];
  if (!start) return `No complete ${unit} of data yet.`;
  let first;
  if (grain === "monthly") {
    const [y, m] = start.split("-").map(Number);
    const firstFull = start.endsWith("-01") ? new Date(Date.UTC(y, m - 1, 1)) : new Date(Date.UTC(y, m, 1));
    const done = new Date(Date.UTC(firstFull.getUTCFullYear(), firstFull.getUTCMonth() + 1, 1));
    first = `${firstFull.toLocaleDateString("en", { month: "long", year: "numeric", timeZone: "UTC" })}, complete on ${done.toLocaleDateString("en", { day: "numeric", month: "long", timeZone: "UTC" })}`;
  } else if (grain === "weekly") {
    first = `the first full week after ${start}`;
  } else {
    first = `the first full day after ${start}`;
  }
  return `No complete ${unit} yet. Collection starts ${start}; the first one is ${first}.`;
}

function buildDashboard(file, selected) {
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
  const unit = { daily: "day", weekly: "week", monthly: "month" }[grain];
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
  return [tiles, adoption, community, support, readiness, note];
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
  const file = await loadMetrics();
  if (!file) throw new Error("No data/metrics.json yet. Run bin/collect-metrics.mjs or the Metrics action.");
  if (file.schema !== 3) throw new Error("data/metrics.json is an older schema; run the collector again.");
  const all = Object.keys(file.repos || {}).sort();
  let selected = readSelection(all);
  const body = el("div", { class: "dash-body" }, buildDashboard(file, selected));
  const controls = el("div", { class: "dash-controls" }, renderGrainSwitch(file), renderRepoPanel(file, selected, (chosen) => { selected = chosen; body.replaceChildren(...buildDashboard(file, selected)); }));
  return el("div", { class: "dash-page" }, controls, body);
}


// ==========================================================================================================
// Page headings, the Overview page and the freshness line
// ==========================================================================================================

// Every page gets a heading and a tab title. Where the page already opens with the mission or
// the map, the heading is there but not drawn: the design stays as it is while the document
// outline, the browser history and a shared link all say which page this is.
const pageHeadings = {
  main: { title: "WDK Visual Map", subtitle: "", hidden: true },  // the logo carries the brand
  map: { title: "WDK Visual Map", subtitle: "", hidden: true },
  dev: {
    title: "Developer Resources",
    subtitle: "Docs, examples and tools for building with WDK. Not part of a shipped wallet.",
  },
  roadmap: { title: "Roadmap", subtitle: "", hidden: true },
  overview: { title: "Overview", subtitle: "", hidden: true },
  dashboard: {
    title: "Dashboard",
    subtitle: "Adoption, community and support, collected daily from npm and GitHub.",
  },
  results: {
    title: "Key results",
    subtitle: "What each north star is measured by.",
  },
  notfound: {
    title: "Page not found",
    subtitle: "",
  },
};

// What a search result or a pasted link shows. All six pages shipped index.html's one
// description, so every link previewed as the front page whatever it led to.
const pageDescriptions = {
  overview: "Where WDK stands: three north stars, this quarter, and the headline numbers, recomputed from npm and GitHub.",
  roadmap: "Every WDK initiative on one quarter timeline, by north star, with what is late and what needs a partner.",
  results: "What each WDK north star is measured by, what is not measured, and the public source behind each figure.",
  dashboard: "Public WDK adoption, community and support numbers, collected daily from npm and GitHub.",
  map: "Every WDK package as a stack, from the app down to the chains, with its state and chain coverage.",
  dev: "How to start building with WDK: the package to install, the reference apps, and the examples.",
  notfound: "This address does not name a page of the WDK Atlas.",
};

// ---- Overview: the front page. What WDK is, where each north star stands, this quarter, the headline
// numbers and the risks. Everything on it is derived from atlas.yaml and the metrics file.

const fmtDay = (iso) => (iso ? new Date(iso).toLocaleDateString("en", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "—");

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
  const unit = { daily: "day", weekly: "week", monthly: "month" }[grain];
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
  const counts = { done: 0, wip: 0, planned: 0 };
  for (const item of items) counts[item.status || "planned"] += 1;
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
    const c = { done: 0, wip: 0, planned: 0, late: 0 };
    for (const item of linked) { c[item.status || "planned"] += 1; if (isLate(item)) c.late += 1; }
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

// Footer on every page: when the atlas last changed and when the numbers were last collected.
function renderFreshness(file) {
  const foot = document.querySelector("#site-foot");
  if (!foot || !file) return;
  foot.replaceChildren(
    `Atlas updated ${fmtDay(file.atlasUpdated)} · metrics collected ${fmtDay(file.updated)} · public sources only: npm and GitHub · `,
    (() => { const gh = document.querySelector(".gh-link"); return gh ? el("a", { href: gh.href }, "source") : null; })());
  foot.hidden = false;
}


// ==========================================================================================================
// Shell — page routing, the details drawer, events and boot
// renderPoster picks the page; the drawer is shared by the map and the developer page.
// ==========================================================================================================

// A reader who landed on a wrong address needs the list of pages, not an apology. The six are
// the six; nothing here is read from the data.
const PAGE_LINKS = [
  ["./", "Overview", "Where WDK stands, in 60 seconds"],
  ["./?page=roadmap", "Roadmap", "What is next, and what is late"],
  ["./?page=results", "Key results", "What is measured, and what is not"],
  ["./?page=dashboard", "Dashboard", "The numbers, and where they come from"],
  ["./?page=map", "WDK Visual Map", "What exists, on which chain, in what state"],
  ["./?page=dev", "Developer Resources", "How to start building"],
];

function renderNotFound() {
  return el(
    "section",
    { class: "notfound" },
    el("h2", { class: "mission-text" }, "There is no page at this address."),
    el("p", { class: "meta" }, "The link asked for ", el("code", null, `?page=${String(askedFor).slice(0, 60)}`), ". Atlas has six pages:"),
    el("ul", { class: "notfound-list" }, PAGE_LINKS.map(([href, label, blurb]) =>
      el("li", null, el("a", { href }, label), el("span", { class: "meta" }, blurb))))
  );
}

function renderPoster() {
  const heading = pageHeadings[page] || pageHeadings.main;
  const title = document.querySelector("#title");
  title.textContent = heading.title;
  title.classList.toggle("visually-hidden", Boolean(heading.hidden));
  document.querySelector("#subtitle").textContent = heading.subtitle;
  // Six pages once shared one tab title, so browser history and a pasted link said nothing
  // about where they led.
  document.title = `${heading.title} · WDK Atlas`;
  const description = document.querySelector('meta[name="description"]');
  if (description && pageDescriptions[page]) description.setAttribute("content", pageDescriptions[page]);

  for (const link of document.querySelectorAll(".nav a")) {
    link.toggleAttribute("aria-current", link.getAttribute("data-page") === page);
  }

  if (page === "notfound") {
    poster.replaceChildren(el("div", { class: "atlas" }, renderNotFound()));
    poster.hidden = false;
    return;
  }

  if (page === "overview") {
    renderOverview()
      .then((node) => { poster.replaceChildren(el("div", { class: "atlas" }, node)); poster.hidden = false; })
      .catch((error) => showError(error.message));
    return;
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

  const onPage = atlas.sections.filter((section) => (section.page || "map") === page);
  if (page === "map") {
    poster.replaceChildren(el("div", { class: "atlas" }, renderCrossSection(onPage)));
    poster.hidden = false;
    applyChainFromUrl();
    return;
  }
  const sections = el("div", { class: "sections" });
  for (const section of onPage) {
    sections.append(renderSection(section, { collapsible: onPage.length > 1 }));
  }

  const atlasNode = el("div", { class: "atlas" }, sections);
  poster.replaceChildren(atlasNode);
  poster.hidden = false;
  // The package name and its version come from the metrics file, which every page already
  // fetches for the freshness stamp. Waiting for it costs nothing and keeps the install line
  // true; the catalogue below is drawn first either way.
  if (page === "dev") {
    loadSummary().then((data) => {
      const start = renderStartHere(data);
      if (start) atlasNode.prepend(start);
    });
  }
}

// The Developer Resources page listed packages and left the reader to work out where to begin.
// Three ways in, each one built from the data rather than written down here, so the package
// name, its version and the number of examples cannot drift from what is actually published.
function renderStartHere(data) {
  const assembler = (atlas.modules || []).find((m) => m.id === "wdk");
  // Either shape works: the summary names the assembler directly, the full metrics file keeps
  // it among every repo.
  const published = (data && data.assembler) || (data && data.repos && data.repos.wdk) || null;
  const pkg = published && published.package;
  const version = published && published.version;
  const examplesRepo = (atlas.modules || []).find((m) => m.id === "wdk-examples");
  const exampleCount = data && typeof data.examples === "number"
    ? data.examples
    : (() => { const snap = latestSnapshot(); return snap && typeof snap.examples === "number" ? snap.examples : null; })();
  const starters = (atlas.modules || []).filter((m) => m.section === "app" && m.status === "shipped");

  const cards = [];

  if (pkg) {
    cards.push(el("article", { class: "start-card" },
      el("h3", null, "Install the kit"),
      el("p", null, "One package creates every wallet and hands each protocol the account it works on."),
      el("code", { class: "start-code" }, `npm i ${pkg}`),
      el("p", { class: "start-note" },
        version ? `Published as ${version}. ` : "",
        isStableVersion(version) ? "" : "Still a beta release, as every package here is today. ",
        assembler && assembler.repo ? el("a", { href: assembler.repo }, "Source on GitHub") : null)));
  }

  if (starters.length) {
    cards.push(el("article", { class: "start-card" },
      el("h3", null, "Start from a working app"),
      el("p", null, `${starters.length === 1 ? "One reference app" : `${starters.length} reference apps`}, each a whole wallet you can run and read: ${starters.map((m) => m.title.replace(/^Starter app, /, "")).join(", ")}.`),
      el("p", { class: "start-note" }, el("a", { href: "./?page=map#wdk-starter-react-native" }, "See them on the map"))));
  }

  if (examplesRepo && examplesRepo.repo) {
    cards.push(el("article", { class: "start-card" },
      el("h3", null, "Read the examples"),
      el("p", null, exampleCount == null
        ? "Short, self-contained recipes for one task at a time."
        : `${exampleCount} short recipes, each self-contained and doing one thing.`),
      el("p", { class: "start-note" }, el("a", { href: examplesRepo.repo }, "Open the examples repo"))));
  }

  if (!cards.length) return null;
  return el("section", { class: "start-here" },
    el("h2", { class: "start-title" }, "Start here"),
    el("div", { class: "start-grid" }, cards));
}

let openAnchor = null;

// Below this width a popover anchored to a chip covers the chip. The same content becomes a
// sheet along the bottom edge instead.
const SHEET_WIDTH = 720;
const wantsSheet = () => window.matchMedia(`(max-width: ${SHEET_WIDTH - 1}px)`).matches;

// The details open as a popover under the module that was clicked, kept inside the viewport width.
function placeDrawer() {
  if (drawer.hidden || !openAnchor || !openAnchor.isConnected) return;
  // The stylesheet places the sheet, so the inline geometry from a wider viewport has to go:
  // an inline width beats a class, and the sheet would keep the popover's 360px.
  if (wantsSheet()) {
    drawer.classList.add("is-sheet");
    drawer.style.removeProperty("width");
    drawer.style.removeProperty("left");
    drawer.style.removeProperty("top");
    return;
  }
  drawer.classList.remove("is-sheet");
  const rect = openAnchor.getBoundingClientRect();
  const viewport = document.documentElement.clientWidth;
  const width = Math.min(360, viewport - 24);
  const left = Math.max(12, Math.min(rect.left, viewport - width - 12)) + window.scrollX;
  drawer.style.width = `${width}px`;
  drawer.style.left = `${left}px`;
  drawer.style.top = `${rect.bottom + window.scrollY + 8}px`;
}

function closeDrawer() {
  // Where the reader was before the drawer took the focus. Only taken back if the drawer still
  // holds it: closing by clicking somewhere else must not drag them away from what they clicked.
  const returnTo = drawer.contains(document.activeElement) ? openAnchor : null;
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
  if (returnTo && returnTo.isConnected) returnTo.focus();
  if (!EMBEDDED && location.hash) history.replaceState(null, "", location.pathname + location.search);
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
        item.private ? "private repo" : null,
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
  // A private repo's link 404s for every reader, so show where it stands instead of offering it.
  if (item.repo && !item.private) links.push(el("a", { href: item.repo }, "GitHub"));
  if (item.private) links.push(el("span", { class: "meta" }, "Repository not public yet"));
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
  scrollTo(drawer, { block: "nearest" });
  // The role announced a dialog while the focus stayed on the chip behind it, so a screen
  // reader never read a word of what opened. The drawer takes it, not the close button, so
  // that its title is read first.
  drawer.focus({ preventScroll: true });

  // Same rule as setUrlParams: on a host page a #wdk-wallet we wrote could collide with the
  // host's own anchors, or move it. The drawer is open either way; only the address is spared.
  if (!EMBEDDED && location.hash !== `#${id}`) history.replaceState(null, "", `#${id}`);
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
    if (step) scrollTo(poster.querySelector(`.xs > .band[data-section="${CSS.escape(id)}"]`), { block: "start" });
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
  const anchor = poster.querySelector(`[data-id="${CSS.escape(id)}"]`);
  if (anchor) {
    openDrawer(id, anchor);
    scrollTo(anchor, { block: "nearest" });
    return;
  }
  const target = itemById(id);
  if (target) location.href = `./?page=${target.section === "dev" ? "dev" : "map"}#${id}`;
}

async function loadAtlas() {
  const response = await fetch(dataUrl("atlas.yaml"));
  if (!response.ok) {
    throw new Error(`Could not load atlas.yaml (${response.status}).`);
  }
  return jsyaml.load(await response.text());
}

async function main() {
  // index.html loads the parser in its own tag. A page that embeds Atlas should not have to
  // know that, so when it is absent this fetches it from beside this module. One script tag
  // is then the whole integration.
  if (typeof jsyaml === "undefined") {
    try {
      await new Promise((resolve, reject) => {
        const tag = document.createElement("script");
        tag.src = dataUrl("vendor/js-yaml.min.js");
        tag.onload = resolve;
        tag.onerror = () => reject(new Error("could not be fetched"));
        document.head.append(tag);
      });
    } catch {
      showError("The YAML parser could not be loaded. Atlas needs vendor/js-yaml.min.js beside app.js.");
      return;
    }
  }
  if (typeof jsyaml === "undefined") {
    showError("The YAML parser loaded but did not register. Check that vendor/js-yaml.min.js is the published bundle.");
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
  // A page that needs nothing else reads the small file instead of the large one.
  const needsFullMetrics = !["map", "dev", "notfound"].includes(page);
  (needsFullMetrics ? loadMetrics() : loadSummary()).then(renderFreshness);
  // Site furniture an embedding page does not get: each is wired only if it is there.
  const togglePending = document.querySelector("#toggle-pending");
  function applyToggles() {
    poster.classList.toggle("hide-pending", togglePending ? !togglePending.checked : false);
    if (togglePending && !togglePending.checked && openId) {
      const item = itemById(openId);
      if (item && (item.status === "wip" || item.status === "planned")) {
        closeDrawer();
      }
    }
  }
  if (togglePending) {
    // This hides everything unshipped, which changes what the page says more than any other
    // control, and was the one piece of state a link could not carry.
    if (new URLSearchParams(location.search).get("planned") === "0") {
      togglePending.checked = false;
      applyToggles();
    }
    togglePending.addEventListener("change", () => {
      applyToggles();
      setUrlParams({ planned: togglePending.checked ? null : "0" });
    });
  }

  if (page === "map" || page === "dev") {
    const side = document.querySelector(".header-side");
    const search = renderSearch(applyMapSearch, "packages");
    search.classList.add("map-search");
    side.prepend(search);
  }
  // On GitHub Pages the source lives at github.com/<owner>/<repo>; derive it so forks link to themselves.
  const gh = document.querySelector(".gh-link");
  const pagesHost = /^([^.]+)\.github\.io$/.exec(location.hostname);
  if (gh && pagesHost) gh.href = `https://github.com/${pagesHost[1]}/${location.pathname.split("/").filter(Boolean)[0] || ""}`;

  // Phones: the nav folds behind a menu button. Closes on a link, on Escape and on a tap outside.
  const navToggle = document.querySelector(".nav-toggle");
  if (navToggle) {
    const setMenu = (open) => { navToggle.setAttribute("aria-expanded", open ? "true" : "false"); document.body.classList.toggle("menu-open", open); };
    navToggle.addEventListener("click", () => setMenu(navToggle.getAttribute("aria-expanded") !== "true"));
    document.addEventListener("click", (event) => { if (document.body.classList.contains("menu-open") && !event.target.closest(".topbar-left")) setMenu(false); });
    document.addEventListener("keydown", (event) => { if (event.key === "Escape") setMenu(false); });
  }

  window.addEventListener("hashchange", () => { if (page === "roadmap") spotlightTarget(); });

  const topbar = document.querySelector("#topbar");
  if (topbar) {
    const onScroll = () => topbar.classList.toggle("is-scrolled", window.scrollY > 8);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }

  poster.addEventListener("click", onPosterClick);
  wireRail();
  drawer.addEventListener("click", onDrawerClick);
  window.addEventListener("resize", placeDrawer);
  document.addEventListener("click", (event) => {
    if (openId && !event.target.closest("[data-id], #drawer, .mx-th")) closeDrawer();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && openId) closeDrawer();
  });

  const initial = location.hash.replace(/^#/, "");
  if (initial) {
    const anchor = poster.querySelector(`[data-id="${CSS.escape(initial)}"]`);
    if (anchor) openDrawer(initial, anchor);
  }
}

main();
