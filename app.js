// WDK Atlas — the way in, and the frame every page is drawn inside.
//
// Nothing here runs on import. mount(element, options) draws one Atlas inside one element and
// returns a handle that takes it away again; a page can hold several. Loaded by a <script> tag
// instead, the module mounts itself once, which is the one-tag embed (see the end of the file).
//
// This file is the shell: the frame, the query and the address, which page to show, and the
// wiring between the parts. The parts are in src/:
//
//   dom.mjs           elements, safe links, clamped numbers. Pure; Node imports it to test.
//   model.mjs         reading atlas.yaml: modules, relations, roadmap items, quarters
//   data.mjs          the files Atlas fetches, once per address, and facts read straight off them
//   shared-views.mjs  what more than one page draws: search box, module button, planned toggle
//   drawer.mjs        the details of one module
//   series.mjs        buckets, tiles and charts from the metrics file
//   key-results.mjs   evaluating a key result from public data
//   pages/*.mjs       one module per page, fetched only when that page is the one shown
//
// Each part is a function of one context object (src/context.mjs): it takes what it needs by
// name and hands back what it provides. Data: atlas.yaml and data/metrics.json, resolved against
// this module's own address unless mount is told otherwise.
import { el, scrollTo } from "./src/dom.mjs";
import { fmtDay } from "./src/model.mjs";
import { createData, loadAtlasOnce, loadParser } from "./src/data.mjs";
import { createDrawer } from "./src/drawer.mjs";
import { use } from "./src/context.mjs";

// document.currentScript is null inside a module, so the version is read off import.meta.url.
// The data is resolved against this file rather than against the page that loaded it: on the
// site those are the same directory, embedded in another site they are not. Pass ?base= on the
// script tag, or base to mount(), to point somewhere else again.
const MODULE_URL = new URL(import.meta.url);
const ASSET_V = MODULE_URL.searchParams.get("v") || "";
const DEFAULT_BASE = new URL(MODULE_URL.searchParams.get("base") || "./", MODULE_URL);

// A page is fetched when it is the one to show, so the map never downloads the charts and the
// dashboard never downloads the grid. Written out rather than built from the name, so that the
// set of things import() can reach is visible here and is exactly these six.
const PAGE_MODULES = {
  overview: () => import("./src/pages/overview.mjs"),
  roadmap: () => import("./src/pages/roadmap.mjs"),
  results: () => import("./src/pages/results.mjs"),
  dashboard: () => import("./src/pages/dashboard.mjs"),
  map: () => import("./src/pages/map.mjs"),
  dev: () => import("./src/pages/dev.mjs"),
};

let instances = 0;

// ==========================================================================================================
// One instance. Everything inside createAtlas is per mount: its state, its frame, its listeners.
// Nothing below reads or writes anything outside the frame except through the options it was given.
// ==========================================================================================================

function createAtlas(target, options, remount) {
  const base = new URL(options.base || DEFAULT_BASE, document.baseURI);

  const dataUrl = (path) => {
    const url = new URL(path, base);
    if (ASSET_V) url.searchParams.set("v", ASSET_V);
    return url.href;
  };

  // Whether the address bar is ours. On the site it is: filters, the open module and the page all
  // live in it. Anywhere else it belongs to the host, and the same state is kept here instead.
  const syncUrl = Boolean(options.syncUrl);
  const query = new URLSearchParams(syncUrl ? location.search : options.query || "");
  if (options.page && !query.has("page")) query.set("page", options.page);
  let hash = syncUrl ? location.hash : options.hash || "";

  // One signal for every listener put on the window or the document, so taking an instance away
  // takes those with it. Listeners inside the frame go when the frame does.
  const controller = new AbortController();
  const { signal } = controller;

  // The overview is the front page; the map lives at ?page=map ("main" kept as an alias for old links).

  // An unknown page used to render the Overview under the address that was asked for, so a link
  // gone stale looked like it had worked and the reader was quietly given a different page.
  const askedFor = query.get("page") || "overview";
  const page = (() => { const q = askedFor === "main" ? "map" : askedFor; return Object.hasOwn(PAGE_MODULES, q) ? q : "notfound"; })();

  // The frame. Everything Atlas draws lives inside this element and is looked up here, so two
  // instances cannot find each other's parts and nothing in the host's document is claimed by id.
  const drawerTitleId = `wdk-atlas-drawer-title-${(instances += 1)}`;
  const titleEl = el("h1");
  const subtitleEl = el("p", { class: "subtitle" });
  const headerSide = el("div", { class: "header-side" });
  const errorEl = el("p", { class: "error", hidden: true });
  const poster = el("div", { class: "poster", hidden: true });
  const drawer = el("aside", { class: "drawer", role: "dialog", "aria-labelledby": drawerTitleId, tabindex: "-1", hidden: true });
  const footEl = el("footer", { class: "site-foot", hidden: true });
  const root = el("div", { class: `wdk-atlas page-${page}` },
    el("header", { class: "site-header" }, el("div", { class: "header-main" }, titleEl, subtitleEl), headerSide),
    errorEl, poster, drawer, footEl);
  target.append(root);

  // Every filter that belongs in the address goes through here, so a link opens the way the
  // sender left it. null deletes its parameter, keeping an unfiltered page on a plain address;
  // an empty string is written, because "no repositories" is a state and "all" is the default.
  // replaceState, not push: ten keystrokes should not be ten presses of the back button.
  function setUrlParams(changes) {
    for (const [key, value] of Object.entries(changes)) {
      if (value == null) query.delete(key);
      else query.set(key, value);
    }
    writeAddress();
    for (const fn of urlListeners) fn(); // links built from the query go stale when it moves
  }

  // The query and the hash are this instance's own. Only an Atlas that was given the page
  // (syncUrl) copies them to the address bar; anywhere else the address belongs to the host.
  function writeAddress() {
    if (!syncUrl) return;
    const qs = query.toString();
    history.replaceState(null, "", `${location.pathname}${qs ? "?" + qs : ""}${hash}`);
  }

  function setHash(next) {
    if (next === hash) return;
    hash = next;
    writeAddress();
  }

  // Following one of Atlas's own links. On the site that is a page load. In a host page it would
  // send the host's address somewhere it has never heard of, so the instance is replaced in place.
  function navigate(href) {
    if (syncUrl) { location.href = href; return; }
    const url = new URL(href, "https://atlas.invalid/");
    remount({ query: url.search, hash: url.hash });
  }

  function showError(message) {
    errorEl.hidden = false;
    errorEl.textContent = message;
  }

  // Every page gets a heading and a tab title. Where the page already opens with the mission or
  // the map, the heading is there but not drawn: the design stays as it is while the document
  // outline, the browser history and a shared link all say which page this is.
  const pageHeadings = {
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

  // Footer on every page: when the atlas last changed and when the numbers were last collected.
  function renderFreshness(file) {
    if (!file) return;
    footEl.replaceChildren(
      `Atlas updated ${fmtDay(file.atlasUpdated)} · metrics collected ${fmtDay(file.updated)} · public sources only: npm and GitHub`,
      options.sourceUrl ? " · " : null,
      options.sourceUrl ? el("a", { href: options.sourceUrl }, "source") : null);
    footEl.hidden = false;
  }

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

  // What every part is handed. The parts add to it as they are made (see src/context.mjs).
  const urlListeners = [];
  const drawerListeners = [];
  const ctx = {
    made: new Set(),
    root, poster, drawer, headerSide, drawerTitleId, query, signal, dataUrl,
    setUrlParams, setHash, navigate,
    getHash: () => hash,
    onUrlChange: (fn) => urlListeners.push(fn),
    onDrawerChange: (fn) => drawerListeners.push(fn),
    drawerChanged: () => { for (const fn of drawerListeners) fn(); },
    atlas: null,
  };

  function renderHeading() {
    const heading = pageHeadings[page];
    titleEl.textContent = heading.title;
    titleEl.classList.toggle("visually-hidden", Boolean(heading.hidden));
    subtitleEl.textContent = heading.subtitle;
    // Six pages once shared one tab title, so browser history and a pasted link said nothing
    // about where they led. Only where Atlas was given the document: a host page has a title and
    // a description of its own, and embedding Atlas used to overwrite both.
    if (options.setTitle) {
      document.title = `${heading.title} · WDK Atlas`;
      const description = document.querySelector('meta[name="description"]');
      if (description) description.setAttribute("content", pageDescriptions[page]);
    }
  }

  const show = (node) => {
    poster.replaceChildren(el("div", { class: "atlas" }, node));
    poster.hidden = false;
  };

  async function boot() {
    try {
      await loadParser(dataUrl("vendor/js-yaml.min.js"));
    } catch (error) {
      showError(error.message);
      return;
    }
    try {
      ctx.atlas = await loadAtlasOnce(dataUrl("atlas.yaml"));
    } catch (error) {
      showError("Open this over HTTP, not as a file. From the repo: python3 -m http.server 4173");
      console.error(error);
      return;
    }
    if (signal.aborted) return; // taken away while the data was on its way

    use(ctx, createData);
    use(ctx, createDrawer); // which makes the model and the shared views it is built on

    renderHeading();
    let view = null;
    if (page === "notfound") {
      show(renderNotFound());
    } else {
      try {
        const { default: createPage } = await PAGE_MODULES[page]();
        view = createPage(ctx);
        const node = await view.render();
        if (signal.aborted) return;
        show(node);
      } catch (error) {
        showError(error.message);
        return;
      }
    }
    // A page that needs nothing else reads the small file instead of the large one.
    const needsFullMetrics = !["map", "dev", "notfound"].includes(page);
    (needsFullMetrics ? ctx.loadMetrics() : ctx.loadSummary()).then(renderFreshness);
    if (view && view.mounted) view.mounted();

    // A click on anything that stands for a module opens its details, on whichever page it is.
    poster.addEventListener("click", (event) => {
      const chip = event.target.closest("[data-id]");
      if (!chip) return;
      if (chip.closest("summary")) event.preventDefault();
      const id = chip.getAttribute("data-id");
      if (ctx.openedId() === id) ctx.closeDrawer();
      else ctx.openDrawer(id, chip);
    });
    drawer.addEventListener("click", ctx.onDrawerClick);
    window.addEventListener("resize", ctx.placeDrawer, { signal });
    document.addEventListener("click", (event) => {
      if (ctx.openedId() && !event.target.closest("[data-id], .drawer, .mx-th")) ctx.closeDrawer();
    }, { signal });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && ctx.openedId()) ctx.closeDrawer();
    }, { signal });

    if (syncUrl) {
      window.addEventListener("hashchange", () => { hash = location.hash; if (view && view.hashChanged) view.hashChanged(); }, { signal });
    } else {
      // Atlas's own links are "./?page=…" and "#…". Here the address is not ours, so they are
      // followed inside the frame. Captured, because some sit under handlers that stop the click.
      root.addEventListener("click", (event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        const link = event.target.closest("a[href]");
        if (!link || link.hasAttribute("data-goto")) return;
        const href = link.getAttribute("href");
        if (href.startsWith("#")) {
          event.preventDefault();
          scrollTo(root.querySelector(`[id="${CSS.escape(href.slice(1))}"]`), { block: "start" });
        } else if (/^\.\/(?:[?#]|$)/.test(href)) {
          event.preventDefault();
          navigate(href);
        }
      }, { capture: true });
    }

    const initial = hash.replace(/^#/, "");
    if (initial) {
      const anchor = poster.querySelector(`[data-id="${CSS.escape(initial)}"]`);
      if (anchor) ctx.openDrawer(initial, anchor);
    }
  }

  boot();
  return {
    page,
    navigate,
    destroy() {
      controller.abort();
      root.remove();
    },
  };
}

// ==========================================================================================================
// The way in
// ==========================================================================================================

/**
 * Draw one Atlas inside `target`.
 *
 *   page      "overview" | "roadmap" | "results" | "dashboard" | "map" | "dev". Default "overview".
 *   base      where atlas.yaml, data/ and vendor/ live. Default: beside this module.
 *   syncUrl   true when the whole page is Atlas's: the page, the filters and the open module are read
 *             from the address and written back to it. Default false: the address is the host's.
 *   setTitle  true to set document.title and the meta description per page. Default false.
 *   sourceUrl a link for the footer's "source", if there is one to give.
 *
 * Returns { page, setPage(page), destroy() }. destroy removes the frame and every listener.
 */
export function mount(target, options = {}) {
  if (!(target instanceof Element)) throw new TypeError("mount(target): target has to be an element");
  let current = null;
  const start = (over) => {
    current = createAtlas(target, { ...options, ...over }, (next) => {
      current.destroy();
      start({ page: null, ...next }); // the link that was followed names its page, or means the front one
    });
  };
  start({});
  return {
    get page() { return current.page; },
    setPage: (page) => current.navigate(`./?page=${encodeURIComponent(page)}`),
    destroy: () => current.destroy(),
  };
}

// The one-tag embed. A module that was imported has no <script> element pointing at it; one
// that was loaded by a tag does, and that tag is the whole integration, so it mounts itself:
// inside the element marked data-wdk-atlas, or where the tag sits. data-page picks the page.
const self = [...document.scripts].find((script) => script.src === import.meta.url);
if (self) {
  let target = document.querySelector("[data-wdk-atlas]");
  if (!target) {
    target = document.createElement("div");
    if (document.body.contains(self)) self.after(target);
    else document.body.append(target);
  }
  mount(target, { page: target.dataset.page });
}
