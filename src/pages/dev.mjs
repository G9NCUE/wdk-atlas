// Developer Resources: where to start, then the docs, examples and tools as cards.

import { el } from "../dom.mjs";
import { isStableVersion, progressOf, progressStyle, createModel } from "../model.mjs";
import { createData } from "../data.mjs";
import { createSharedViews } from "../shared-views.mjs";
import { use } from "../context.mjs";

export default function createDevPage(ctx) {
  use(ctx, createModel);
  use(ctx, createData);
  use(ctx, createSharedViews);

  const { atlas, poster, itemById, isEcosystem, chainsOf, roadmapFor, latestSnapshot, loadSummary,
     searchTextOf, lockMark, buildModuleControls } = ctx;

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
            { class: "band-group is-empty" },
            el("h3", { class: "group-label" }, group.label)
          )
        );
        continue;
      }
      rows.push(
        el(
          "div",
          { class: "band-group" },
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
          { class: "band-group" },
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
      { class: "lane" },
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

  return {
    render() {
      const onPage = atlas.sections.filter((section) => (section.page || "map") === "dev");
      return el("div", { class: "sections" }, onPage.map((section) => renderSection(section, { collapsible: onPage.length > 1 })));
    },
    // The package name and its version come from the summary file, which the page fetches for its
    // freshness stamp anyway. The catalogue is drawn first either way.
    mounted() {
      buildModuleControls();
      loadSummary().then((data) => {
        const start = renderStartHere(data);
        if (start) poster.querySelector(".atlas").prepend(start);
      });
    },
  };
}
