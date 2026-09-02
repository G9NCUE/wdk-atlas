const poster = document.querySelector("#poster");
const drawer = document.querySelector("#drawer");
const errorEl = document.querySelector("#error");

let atlas = null;
let openId = null;
const page = new URLSearchParams(location.search).get("page") || "main";

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

function isWallet(module) {
  return module.band === "wallets";
}

function isProtocol(module) {
  return module.band === "protocols";
}

function chainsOverlap(a, b) {
  const left = new Set(chainsOf(a));
  if (!left.size) return false;
  return chainsOf(b).some((chain) => left.has(chain));
}

function compatibleIds(id) {
  const item = itemById(id);
  const ids = new Set();
  if (!item) return ids;
  const wantWallet = isProtocol(item);
  const wantProtocol = isWallet(item);
  if (!wantWallet && !wantProtocol) return ids;
  for (const module of atlas.modules) {
    if (module.id === id) continue;
    if (wantWallet && !isWallet(module)) continue;
    if (wantProtocol && !isProtocol(module)) continue;
    if (chainsOverlap(item, module)) ids.add(module.id);
  }
  return ids;
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

function applyRelated(id) {
  const rel = id ? relationsOf(id) : { requires: [], requiredBy: [] };
  const linked = new Set([...rel.requires, ...rel.requiredBy].map((r) => r.id));
  const compatible = id ? compatibleIds(id) : new Set();
  for (const node of poster.querySelectorAll(".module-stack")) {
    const nid = node.getAttribute("data-id");
    node.classList.toggle("is-open", nid === id);
    node.classList.toggle("is-related", linked.has(nid));
    node.classList.toggle("is-compatible", nid !== id && !linked.has(nid) && compatible.has(nid));
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
  const chips = roadmapFor(module.id).map((item) => chip(item, item.parent ? 1 : 0));
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
    { class: "module-stack", "data-id": module.id },
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
        el("span", { class: "ecosystem-mark" }, `Ecosystem · ${module.publisher}`)
    ),
    chips.length > 0 && el("ul", { class: "roadmap" }, chips)
  );
}

// A module that requires another one in the same list goes under it, as a column.
function renderColumns(modules) {
  const ids = new Set(modules.map((module) => module.id));
  const baseOf = (module) =>
    (module.relations || []).find((rel) => ids.has(rel.target) && rel.target !== module.id)?.target;
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

function renderRoadmapItem(item, children) {
  const percent = progressOf(item);
  return el(
    "article",
    { class: `roadmap-card ${item.status || "planned"}`, id: item.id, "data-roadmap": item.id, style: progressStyle(percent) },
    el(
      "div",
      { class: "roadmap-card-head" },
      item.priority && el("span", { class: `priority ${String(item.priority).toLowerCase()}` }, item.priority),
      el("h3", { class: "roadmap-card-title" }, item.label),
      el("span", { class: "roadmap-card-status" }, item.status === "wip" ? "in progress" : item.status || "planned"),
      percent != null && item.status === "wip" && el("span", { class: "roadmap-card-progress" }, `${percent}%`)
    ),
    item.summary && el("p", { class: "roadmap-card-summary" }, item.summary),
    (item.modules || []).length > 0 && el("div", { class: "roadmap-modules" }, (item.modules || []).map(moduleChip)),
    children.length > 0 && el("div", { class: "roadmap-children" }, children)
  );
}

// Roadmap page: the root list grouped by quarter; umbrella items nest the items that name them as parent.
function renderRoadmap() {
  const items = roadmapItems();
  const counts = { wip: 0, planned: 0, done: 0 };
  for (const item of items) counts[item.status || "planned"] = (counts[item.status || "planned"] || 0) + 1;
  const touched = new Set(items.flatMap((i) => (i.modules || []).map((r) => (typeof r === "string" ? r : r.id))));
  const summary = el(
    "ul",
    { class: "roadmap-summary" },
    el("li", null, el("strong", null, String(counts.wip)), "in progress"),
    el("li", null, el("strong", null, String(counts.planned)), "planned"),
    el("li", null, el("strong", null, String(counts.done)), "done"),
    el("li", null, el("strong", null, String(touched.size)), "modules touched")
  );

  const byParent = new Map();
  for (const item of items) {
    if (!item.parent || !items.some((i) => i.id === item.parent)) continue;
    if (!byParent.has(item.parent)) byParent.set(item.parent, []);
    byParent.get(item.parent).push(item);
  }
  const roots = items.filter((item) => !item.parent || !items.some((i) => i.id === item.parent));
  const quarters = [...new Set(roots.map((item) => item.quarter || "backlog"))].sort((x, y) =>
    quarterOrder(x).localeCompare(quarterOrder(y))
  );
  const rank = (item) => `${item.priority || "P9"}${item.status === "wip" ? 0 : 1}`;

  const groups = quarters.map((quarter) => {
    const inQuarter = roots
      .filter((item) => (item.quarter || "backlog") === quarter)
      .sort((x, y) => rank(x).localeCompare(rank(y)));
    return el(
      "section",
      { class: "section roadmap-quarter", "data-quarter": quarter },
      el("h2", { class: "section-title" }, quarterLabel(quarter)),
      el(
        "div",
        { class: "roadmap-cards" },
        inQuarter.map((item) =>
          renderRoadmapItem(item, (byParent.get(item.id) || []).map((child) => renderRoadmapItem(child, [])))
        )
      )
    );
  });
  if (!items.length) groups.push(el("p", { class: "meta" }, "No roadmap entries in atlas.yaml yet."));
  return el("div", { class: "roadmap-page" }, summary, groups);
}

const pageHeadings = {
  main: { title: "WDK Atlas", subtitle: "", hidden: true },   // the logo carries the brand; keep an h1 for assistive tech
  dev: {
    title: "Developer Resources",
    subtitle: "Docs, examples and tools for building with WDK. Not part of a shipped wallet.",
  },
  roadmap: {
    title: "Roadmap",
    subtitle: "What is in progress and what is planned, by quarter, from the same atlas.yaml as the map.",
  },
};

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

  const onPage = atlas.sections.filter((section) => (section.page || "main") === page);
  const sections = el("div", { class: "sections" });
  for (const section of onPage) {
    sections.append(renderSection(section, { collapsible: onPage.length > 1 }));
  }

  poster.replaceChildren(el("div", { class: "atlas" }, sections));
  poster.hidden = false;
}

function closeDrawer() {
  openId = null;
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
        isEcosystem(item) ? `ecosystem · ${item.publisher}` : item.publisher,
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
      entries.map((r) =>
        el("li", null, el("a", { href: `#${r.id}`, "data-goto": r.id }, itemById(r.id).name), el("span", { class: "relation-type" }, r.type))
      )
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
    rel.requires.length > 0 && el("p", { class: "meta" }, "Requires"),
    rel.requires.length > 0 && relList(rel.requires),
    rel.requiredBy.length > 0 && el("p", { class: "meta" }, "Required by"),
    rel.requiredBy.length > 0 && relList(rel.requiredBy),
    roadmap.length > 0 && el("p", { class: "meta" }, "Pending work"),
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
  applyRelated(id);

  drawer.hidden = false;
  drawer.setAttribute("aria-labelledby", "drawer-title");
  drawer.replaceChildren(...drawerContent(item).filter(Boolean));

  document.body.classList.add("drawer-open");
  const section = anchor.closest("details");
  if (section && !anchor.closest("summary")) section.open = true;

  if (location.hash !== `#${id}`) history.replaceState(null, "", `#${id}`);
}

function onPosterClick(event) {
  const target = event.target.closest("[data-id]");
  if (!target) return;
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
  const response = await fetch("atlas.yaml");
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

  const topbar = document.querySelector("#topbar");
  const onScroll = () => topbar.classList.toggle("is-scrolled", window.scrollY > 8);
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  poster.addEventListener("click", onPosterClick);
  drawer.addEventListener("click", onDrawerClick);
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
