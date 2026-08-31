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
  const chips = (module.roadmap || []).flatMap((item) => [
    chip(item, 0),
    ...(item.children || []).map((child) => chip(child, 1)),
  ]);
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

function renderSection(section) {
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

function renderPoster() {
  document.querySelector("#title").textContent = atlas.title || "WDK Atlas";
  document.querySelector("#subtitle").textContent = atlas.subtitle || "";

  const sections = el("div", { class: "sections" });
  for (const section of atlas.sections) {
    if ((section.page || "main") === page) sections.append(renderSection(section));
  }
  for (const link of document.querySelectorAll(".pages a")) {
    link.toggleAttribute("aria-current", link.getAttribute("data-page") === page);
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
  const roadmap = (item.roadmap || []).map((entry) =>
    el(
      "li",
      null,
      `${entry.label} (${entry.status || "planned"})`,
      entry.children?.length > 0 &&
        el("ul", null, entry.children.map((child) => el("li", null, `${child.label} (${child.status || "planned"})`)))
    )
  );

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
