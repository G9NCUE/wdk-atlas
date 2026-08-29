const poster = document.querySelector("#poster");
const tooltip = document.querySelector("#tooltip");
const errorEl = document.querySelector("#error");

let atlas = null;
let openId = null;

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

function applyRelated(id) {
  const neighbors = id ? compatibleIds(id) : null;
  for (const node of poster.querySelectorAll(".module-stack")) {
    const nid = node.getAttribute("data-id");
    const isOpen = nid === id;
    const isRelated = Boolean(neighbors && neighbors.has(nid));
    node.classList.toggle("is-open", isOpen);
    node.classList.toggle("is-related", isRelated);
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
  const chips = (module.roadmap || []).map((item) => {
    const chipProgress = progressOf(item);
    return el(
      "li",
      {
        class: `roadmap-item ${item.status || "planned"}`,
        style: progressStyle(chipProgress),
      },
      item.label || item
    );
  });
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
      el("span", { class: "module-name" }, module.name || module.id),
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

function renderBandBody(band, modules) {
  const groups = band.groups || [];
  if (!groups.length) {
    return el("div", { class: "band-modules" }, modules.map(renderModule));
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
        el("div", { class: "band-modules" }, items.map(renderModule))
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
        el("div", { class: "band-modules" }, rest.map(renderModule))
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

  return el(
    "section",
    { class: "section", "data-section": section.id },
    el(
      "header",
      { class: "section-head" },
      el("h2", { class: "section-title" }, section.label),
      section.blurb && el("p", { class: "section-blurb" }, section.blurb)
    ),
    body
  );
}

function renderPoster() {
  document.querySelector("#title").textContent = atlas.title || "WDK Atlas";
  document.querySelector("#subtitle").textContent = atlas.subtitle || "";

  const sections = el("div", { class: "sections" });
  for (const section of atlas.sections) {
    sections.append(renderSection(section));
  }

  poster.replaceChildren(el("div", { class: "atlas" }, sections));
  poster.hidden = false;
}

function closeTooltip() {
  openId = null;
  tooltip.hidden = true;
  tooltip.replaceChildren();
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

function tooltipContent(item) {
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
    el("li", null, `${entry.label} (${entry.status || "planned"})`)
  );

  const links = [];
  if (item.repo) links.push(el("a", { href: item.repo }, "GitHub"));
  if (item.docs) links.push(el("a", { href: item.docs }, "Docs"));

  return [
    el("h2", { id: "tooltip-title" }, item.name || item.title || item.id),
    el("p", { class: "meta" }, meta),
    item.summary && el("p", null, item.summary),
    notes.length > 0 && el("ul", null, notes),
    roadmap.length > 0 && el("p", { class: "meta" }, "Pending work"),
    roadmap.length > 0 && el("ul", null, roadmap),
    links.length > 0 && el("div", { class: "tooltip-links" }, links),
  ];
}

function openTooltip(id, anchor) {
  const item = itemById(id);
  if (!item) return;

  for (const node of poster.querySelectorAll("[aria-expanded]")) {
    const on = node.getAttribute("data-node") === id;
    node.setAttribute("aria-expanded", on ? "true" : "false");
  }
  applyRelated(id);

  openId = id;
  tooltip.hidden = false;
  tooltip.setAttribute("aria-labelledby", "tooltip-title");
  tooltip.replaceChildren(...tooltipContent(item).filter(Boolean));

  const rect = anchor.getBoundingClientRect();
  const width = tooltip.offsetWidth;
  const height = tooltip.offsetHeight;
  let left = rect.left;
  let top = rect.bottom + 8;
  if (left + width > window.innerWidth - 12) {
    left = window.innerWidth - width - 12;
  }
  if (left < 12) left = 12;
  if (top + height > window.innerHeight - 12) top = rect.top - height - 8;
  if (top < 12) top = 12;
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;

  if (location.hash !== `#${id}`) history.replaceState(null, "", `#${id}`);
}

function onPosterClick(event) {
  const target = event.target.closest("[data-id]");
  if (!target) return;
  const id = target.getAttribute("data-id");
  if (openId === id) closeTooltip();
  else openTooltip(id, target);
}

function onDocumentClick(event) {
  if (tooltip.hidden) return;
  if (tooltip.contains(event.target)) return;
  if (event.target.closest("[data-id]")) return;
  closeTooltip();
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
        closeTooltip();
      }
    }
  }
  togglePending.addEventListener("change", applyToggles);

  poster.addEventListener("click", onPosterClick);
  document.addEventListener("click", onDocumentClick);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeTooltip();
  });

  const initial = location.hash.replace(/^#/, "");
  if (initial) {
    const anchor = poster.querySelector(`[data-id="${initial}"]`);
    if (anchor) openTooltip(initial, anchor);
  }
}

main();
