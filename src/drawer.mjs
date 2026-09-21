// The details of one module: a popover under the chip that was clicked, a sheet along the bottom
// edge on a phone. It owns which module is open; whoever needs to follow that listens for
// drawerChanged rather than being called by name, so the drawer does not know there is a map.

import { el, scrollTo } from "./dom.mjs";
import { progressOf, createModel } from "./model.mjs";
import { createSharedViews } from "./shared-views.mjs";
import { use } from "./context.mjs";

export function createDrawer(ctx) {
  use(ctx, createModel);
  use(ctx, createSharedViews);

  const { root, poster, drawer, setHash, navigate, atlas, drawerChanged, drawerTitleId, itemById,
    relationsOf, isEcosystem, chainsOf, roadmapFor, applyRelated } = ctx;

  let openId = null;

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
    // Measured from the frame, which is the drawer's containing block, rather than from the
    // document: inside a host page the two are different places, and a drawer placed by document
    // coordinates landed wherever the host's own layout happened to put the frame's origin.
    const rect = openAnchor.getBoundingClientRect();
    const frame = root.getBoundingClientRect();
    const viewport = document.documentElement.clientWidth;
    const width = Math.min(360, viewport - 24);
    const left = Math.max(12, Math.min(rect.left, viewport - width - 12)) - frame.left;
    drawer.style.width = `${width}px`;
    drawer.style.left = `${left}px`;
    drawer.style.top = `${rect.bottom - frame.top + 8}px`;
  }

  function closeDrawer() {
    // Where the reader was before the drawer took the focus. Only taken back if the drawer still
    // holds it: closing by clicking somewhere else must not drag them away from what they clicked.
    const returnTo = drawer.contains(document.activeElement) ? openAnchor : null;
    openId = null;
    openAnchor = null;
    drawer.hidden = true;
    drawer.replaceChildren();
    for (const node of poster.querySelectorAll("[aria-expanded='true']")) {
      node.setAttribute("aria-expanded", "false");
    }
    applyRelated(null);
    drawerChanged();
    if (returnTo && returnTo.isConnected) returnTo.focus();
    setHash("");
  }

  function sectionMeta(item) {
    const section = (atlas.sections || []).find((entry) => entry.id === item.section);
    const lane = (section?.lanes || []).find((entry) => entry.id === item.band);
    return [section?.label, lane?.label].filter(Boolean).join(" · ");
  }

  function drawerContent(item) {
    const meta = [
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
    const pending = roadmapFor(item.id);
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

    const rel = relationsOf(item.id);
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
      el("h2", { id: drawerTitleId }, item.title || item.name || item.id),
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
    drawerChanged();

    drawer.hidden = false;
    drawer.replaceChildren(...drawerContent(item).filter(Boolean));

    const section = anchor.closest("details");
    if (section && !anchor.closest("summary")) section.open = true;
    placeDrawer();
    scrollTo(drawer, { block: "nearest" });
    // The role announced a dialog while the focus stayed on the chip behind it, so a screen
    // reader never read a word of what opened. The drawer takes it, not the close button, so
    // that its title is read first.
    drawer.focus({ preventScroll: true });

    setHash(`#${id}`);
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
    if (target) navigate(`./?page=${target.section === "dev" ? "dev" : "map"}#${id}`);
  }

  const openedId = () => openId;

  return {
    closeDrawer, onDrawerClick, openDrawer, openedId, placeDrawer,
  };
}
