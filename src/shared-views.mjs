// What more than one page draws: the search box, the button that stands for a module, the planned
// toggle and legend of the two pages that show modules, and the dimming of everything a selected
// module is not related to.

import { el, withTip } from "./dom.mjs";
import { createModel } from "./model.mjs";
import { use } from "./context.mjs";

export function createSharedViews(ctx) {
  use(ctx, createModel);

  const { poster, headerSide, query, signal, setUrlParams, itemById, relationsOf, chainsOf,
     roadmapFor } = ctx;

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

  function pendingFor(id) {
    return roadmapFor(id).filter((entry) => entry.status !== "done");
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

  function renderSearch(apply, what, { runAtStart = false } = {}) {
    const input = el("input", { class: "search-input", type: "search", placeholder: `Search ${what}…`, "aria-label": `Search ${what}`, autocomplete: "off" });
    const count = el("span", { class: "search-count", "aria-live": "polite" });
    const wrap = el("label", { class: "search" }, input, count);
    const run = () => {
      apply(input.value, count);
      // ?q= was read on load and never written, so a shareable search had to be built by hand.
      setUrlParams({ q: input.value.trim() || null });
    };
    input.addEventListener("input", run);
    // ?q= prefills the search, so a filtered view can be shared as a link.
    const initial = query.get("q") || "";
    if (initial) input.value = initial;
    if (initial || runAtStart) requestAnimationFrame(run);
    // Not while the reader is typing somewhere else: this listens on the whole document, and in a
    // host page that document has text fields of its own in which "/" is just a character.
    const typing = (node) => Boolean(node) && (/^(?:INPUT|TEXTAREA|SELECT)$/.test(node.tagName) || node.isContentEditable);
    document.addEventListener("keydown", (event) => {
      if (event.key === "/" && !typing(document.activeElement) && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        input.focus();
      }
    }, { signal });
    return wrap;
  }

  // The planned toggle and the status legend, on the two pages that draw modules. Built here, not
  // written into index.html: an embedded map has them too, and no other page can flash them.
  function buildModuleControls() {
    const box = el("input", { type: "checkbox", checked: true });
    const apply = () => {
      poster.classList.toggle("hide-pending", !box.checked);
      const open = !box.checked && ctx.openedId() ? itemById(ctx.openedId()) : null;
      if (open && (open.status === "wip" || open.status === "planned")) ctx.closeDrawer();
    };
    // This hides everything unshipped, which changes what the page says more than any other
    // control, so a link carries it.
    if (query.get("planned") === "0") { box.checked = false; apply(); }
    box.addEventListener("change", () => { apply(); setUrlParams({ planned: box.checked ? null : "0" }); });
    const search = renderSearch(applyMapSearch, "packages");
    search.classList.add("map-search");
    const swatch = (kind, text, sample) => el("li", null, el("span", { class: `swatch ${kind}` }, sample), ` ${text}`);
    headerSide.replaceChildren(
      search,
      el("label", { class: "pending-toggle" }, box, el("span", { class: "pending-toggle-switch", "aria-hidden": "true" }), "Include planned & in progress features"),
      el("ul", { class: "legend", "aria-label": "Status legend" }, swatch("live", "live"), swatch("wip", "in progress"), swatch("planned", "planned"), swatch("ecosystem", "third party", "Name")));
  }

  return {
    applyRelated, buildModuleControls, lockMark, moduleChip, pendingFor,
    renderSearch, searchTextOf,
  };
}
