// Reading atlas.yaml once it is parsed: looking a module up, what it requires and is required by,
// which roadmap items touch it. The first half is arithmetic on quarters and progress that needs
// no atlas at all; createModel closes over one.

export function quarterLabel(q) {
  if (!q || q === "backlog") return "Backlog";
  const m = /^(\d{4})Q([1-4])$/.exec(q);
  return m ? `Q${m[2]} ${m[1]}` : q;
}

export function quarterOrder(q) {
  return !q || q === "backlog" ? "9999" : q;
}

// Progress only from a number someone set; an in-progress item without one shows no fill.
export function progressOf(item) {
  const n = Number(item.progress);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : null;
}

export function progressStyle(percent) {
  return percent == null ? null : `--p:${percent}%`;
}

export function currentQuarter(date = new Date()) {
  return `${date.getFullYear()}Q${Math.floor(date.getMonth() / 3) + 1}`;
}

export function stateLabel(item) {
  return item.status === "wip" ? "in progress" : item.status === "done" ? "done" : "planned";
}

// How many of these are done, in progress, planned, and late. Five pages counted this, each in
// its own words; an item with no status counts as planned in all of them.
export function countByStatus(items) {
  const counts = { done: 0, wip: 0, planned: 0, late: 0 };
  for (const item of items) { counts[item.status || "planned"] += 1; if (isLate(item)) counts.late += 1; }
  return counts;
}

// Late: the quarter it was planned for has passed and it is not done. Computed, never typed.
export function isLate(item) {
  return item.status !== "done" && Boolean(item.quarter) && item.quarter !== "backlog" && item.quarter < currentQuarter();
}

// Repo name behind a module's GitHub URL, the key the metrics file uses.
export function repoNameOf(module) {
  const m = /github\.com\/[^/]+\/([^/#?]+)/.exec((module && module.repo) || "");
  return m ? m[1].replace(/\.git$/, "") : null;
}

export const isStableVersion = (v) => Boolean(v) && !/-(alpha|beta|rc|next|canary|dev|pre)/i.test(v);

export const fmtDay = (iso) => (iso ? new Date(iso).toLocaleDateString("en", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "—");

// Progress for an initiative: its own number, else the average of the numbers set on its modules. Never a default.
export function itemProgress(item) {
  if (Number.isFinite(Number(item.progress))) return Math.max(0, Math.min(100, Math.round(item.progress)));
  const given = (item.modules || []).map((ref) => Number(ref && ref.progress)).filter(Number.isFinite);
  return given.length ? Math.round(given.reduce((a, b) => a + b, 0) / given.length) : null;
}

export function createModel(ctx) {
  const { atlas } = ctx;

  function itemById(id) {
    return atlas.modules.find((module) => module.id === id);
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

  const privateModules = () => (atlas.modules || []).filter((x) => x.private);

  function walletRepos() { return (atlas.modules || []).filter((m) => /^wdk-wallet-/.test(m.id) && !isEcosystem(m) && m.status === "shipped").map(repoNameOf).filter(Boolean); }

  const examplesRepoUrl = () => `https://github.com/${orgName()}/${(atlas.audit && atlas.audit.examplesRepo) || "wdk-examples"}`;

  return {
    chainsOf, examplesRepoUrl, isEcosystem, itemById, orgName, privateModules, relationsOf,
    roadmapFor, roadmapItems, unscoped, walletRepos,
  };
}
