#!/usr/bin/env node
// Structural check of atlas.yaml. bin/check-atlas.mjs compares the file with GitHub and npm;
// this one needs no network and answers a narrower question: is the file well formed? A typo in
// a key, a status that is not one of the three, a roadmap item naming a north star that does not
// exist: the site degrades silently on each of those, so they are caught here instead.
//
// Usage: node bin/validate-atlas.mjs [--json]
// Prints one line per gate (ids from the product spec) and exits 1 when any gate fails.
//   P4.1  structure, types, enums, ids and references
//   P1.4  every module and roadmap blurb is 50 words or fewer
import { loadAtlas } from "./lib/load-atlas.mjs";

export const WORD_LIMIT = 50;
const QUARTER = /^(20\d\d)Q([1-4])$/;
const STATUS_MODULE = ["shipped", "wip", "planned"];
const STATUS_ROADMAP = ["planned", "wip", "done"];
const PRIORITY = ["P0", "P1", "P2"];
const RELATION = ["requires", "under", "on", "implements"];

// kind -> [required fields, optional fields] of a key result metric
const METRIC = {
  share: [["field", "scope"], ["target"]],
  average: [["field", "scope"], ["target"]],
  count: [["source"], ["target"]],
  issueResponse: [["withinHours"], ["target"]],
  currency: [["target"], []],
  seriesTotal: [["series", "days", "target"], []],
};

const typeOf = (v) => (Array.isArray(v) ? "array" : v === null ? "null" : typeof v);
export const countWords = (s) => String(s || "").trim().split(/\s+/).filter(Boolean).length;
const isHttps = (s) => typeof s === "string" && /^https:\/\/[^\s]+$/.test(s);

// spec: { key: [type | [types], required] }
function shape(errors, where, obj, spec) {
  if (typeOf(obj) !== "object") { errors.push(`${where}: expected a mapping, found ${typeOf(obj)}`); return false; }
  for (const key of Object.keys(obj)) if (!(key in spec)) errors.push(`${where}: unknown key "${key}"`);
  for (const [key, [types, required]] of Object.entries(spec)) {
    const v = obj[key];
    if (v === undefined) { if (required) errors.push(`${where}: missing "${key}"`); continue; }
    const allowed = [].concat(types);
    if (!allowed.includes(typeOf(v))) errors.push(`${where}.${key}: expected ${allowed.join(" or ")}, found ${typeOf(v)}`);
    else if (typeOf(v) === "string" && !v.trim()) errors.push(`${where}.${key}: empty`);
  }
  return true;
}

function oneOf(errors, where, value, allowed) {
  if (value !== undefined && !allowed.includes(value)) errors.push(`${where}: "${value}" is not one of ${allowed.join(", ")}`);
}

function unique(errors, where, items) {
  const seen = new Set();
  for (const it of items) {
    if (typeOf(it) !== "object" || typeof it.id !== "string") continue;
    if (seen.has(it.id)) errors.push(`${where}: duplicate id "${it.id}"`);
    seen.add(it.id);
  }
  return seen;
}

const list = (v) => (Array.isArray(v) ? v : []);

export function validate(atlas) {
  const errors = [];
  const long = [];

  if (!shape(errors, "atlas", atlas, {
    mission: ["string", true], about: ["string", true], audit: ["object", true], northStars: ["array", true],
    chains: ["array", true], sections: ["array", true], modules: ["array", true], roadmap: ["array", true],
  })) return { errors, long };

  // audit
  if (shape(errors, "audit", atlas.audit, {
    org: ["string", true], repoPattern: ["string", true], team: ["array", false], ignoreRepos: ["array", false],
    implicitRequires: ["array", false], consumerSections: ["array", false], ignorePattern: ["string", false],
  })) {
    for (const key of ["repoPattern", "ignorePattern"]) {
      if (typeof atlas.audit[key] === "string") { try { new RegExp(atlas.audit[key]); } catch { errors.push(`audit.${key}: not a valid regular expression`); } }
    }
    for (const key of ["team", "ignoreRepos", "consumerSections"]) {
      list(atlas.audit[key]).forEach((v, i) => { if (typeof v !== "string") errors.push(`audit.${key}[${i}]: expected string`); });
    }
  }

  // chains
  const chainIds = new Set();
  list(atlas.chains).forEach((c, i) => {
    if (!shape(errors, `chains[${i}]`, c, { id: ["string", true], label: ["string", true], also: ["array", false] })) return;
    chainIds.add(c.id);
    list(c.also).forEach((a) => chainIds.add(a));
  });
  unique(errors, "chains", list(atlas.chains));

  // sections, lanes, groups
  const laneIds = new Map(); // section id -> Set of lane ids
  const groupIds = new Set();
  list(atlas.sections).forEach((s, i) => {
    const where = `sections[${s && s.id ? s.id : i}]`;
    if (!shape(errors, where, s, {
      id: ["string", true], label: ["string", true], blurb: ["string", true], path: ["object", false], lanes: ["array", false],
      module: ["string", false], seal: ["string", false], matrix: ["array", false], why: ["object", false], page: ["string", false],
    })) return;
    const lanes = new Set();
    laneIds.set(s.id, lanes);
    if (s.path) shape(errors, `${where}.path`, s.path, { label: ["string", true], text: ["string", true] });
    if (s.why && shape(errors, `${where}.why`, s.why, { label: ["string", true], points: ["array", true] })) {
      list(s.why.points).forEach((p, j) => { if (typeof p !== "string") errors.push(`${where}.why.points[${j}]: expected string`); });
    }
    list(s.lanes).forEach((l, j) => {
      const lw = `${where}.lanes[${l && l.id ? l.id : j}]`;
      if (!shape(errors, lw, l, { id: ["string", true], label: ["string", true], blurb: ["string", false], groups: ["array", false] })) return;
      lanes.add(l.id);
      list(l.groups).forEach((g, k) => {
        if (shape(errors, `${lw}.groups[${g && g.id ? g.id : k}]`, g, { id: ["string", true], label: ["string", true], hint: ["string", false], signs: [["string", "null", "boolean"], false] })) groupIds.add(g.id);
      });
      unique(errors, `${lw}.groups`, list(l.groups));
    });
    unique(errors, `${where}.lanes`, list(s.lanes));
    list(s.matrix).forEach((m) => { if (!lanes.has(m)) errors.push(`${where}.matrix: "${m}" is not a lane of this section`); });
  });
  unique(errors, "sections", list(atlas.sections));

  // modules
  const moduleIds = unique(errors, "modules", list(atlas.modules));
  list(atlas.sections).forEach((s) => {
    if (s && typeof s.module === "string" && !moduleIds.has(s.module)) errors.push(`sections[${s.id}].module: unknown module "${s.module}"`);
  });
  list(atlas.modules).forEach((m, i) => {
    const where = `modules[${m && m.id ? m.id : i}]`;
    if (!shape(errors, where, m, {
      id: ["string", true], name: ["string", true], title: ["string", true], short: ["string", false], section: ["string", true],
      band: ["string", false], kind: ["string", false], status: ["string", true], publisher: ["string", true], chains: ["array", false],
      summary: ["string", true], notes: ["array", false], repo: ["string", false], docs: ["string", false], relations: ["array", false],
      progress: ["number", false], private: ["boolean", false], placeholder: ["boolean", false], package: ["string", false],
    })) return;
    oneOf(errors, `${where}.status`, m.status, STATUS_MODULE);
    if (typeof m.section === "string") {
      if (!laneIds.has(m.section)) errors.push(`${where}.section: unknown section "${m.section}"`);
      else if (m.band !== undefined && !laneIds.get(m.section).has(m.band)) errors.push(`${where}.band: "${m.band}" is not a lane of section "${m.section}"`);
    }
    if (m.kind !== undefined && !groupIds.has(m.kind)) errors.push(`${where}.kind: "${m.kind}" is not a group of any lane`);
    list(m.chains).forEach((c) => { if (!chainIds.has(c)) errors.push(`${where}.chains: unknown chain "${c}"`); });
    for (const key of ["repo", "docs"]) if (m[key] !== undefined && !isHttps(m[key])) errors.push(`${where}.${key}: must be an https link`);
    if (typeof m.progress === "number" && (m.progress < 0 || m.progress > 100)) errors.push(`${where}.progress: must be between 0 and 100`);
    list(m.notes).forEach((n, j) => { if (!["string", "object"].includes(typeOf(n))) errors.push(`${where}.notes[${j}]: expected string or mapping`); });
    list(m.relations).forEach((r, j) => {
      const rw = `${where}.relations[${j}]`;
      if (!shape(errors, rw, r, { type: ["string", true], target: ["string", true] })) return;
      oneOf(errors, `${rw}.type`, r.type, RELATION);
      if (typeof r.target === "string" && !moduleIds.has(r.target)) errors.push(`${rw}.target: unknown module "${r.target}"`);
      if (r.target === m.id) errors.push(`${rw}.target: a module cannot relate to itself`);
    });
    const words = countWords(m.summary);
    if (words > WORD_LIMIT) long.push({ where: `${where}.summary`, words });
  });

  // north stars and key results
  const starIds = unique(errors, "northStars", list(atlas.northStars));
  const krs = [];
  list(atlas.northStars).forEach((s, i) => {
    const where = `northStars[${s && s.id ? s.id : i}]`;
    if (!shape(errors, where, s, { id: ["string", true], title: ["string", true], summary: ["string", true], keyResults: ["array", true] })) return;
    list(s.keyResults).forEach((kr, j) => {
      const kw = `${where}.keyResults[${kr && kr.id ? kr.id : j}]`;
      if (!shape(errors, kw, kr, {
        id: ["string", true], label: ["string", true], note: ["string", false], metric: ["object", false],
        current: [["number", "string"], false], target: [["number", "string"], false], progress: ["number", false],
        unit: ["string", false], sourceLink: ["string", false],
      })) return;
      krs.push(kr);
      if (kr.sourceLink !== undefined && !isHttps(kr.sourceLink) && !/^\.\//.test(kr.sourceLink)) errors.push(`${kw}.sourceLink: must be an https link or start with ./`);
      if (typeOf(kr.metric) !== "object") return;
      const kind = kr.metric.kind;
      if (!(kind in METRIC)) { errors.push(`${kw}.metric.kind: "${kind}" is not one of ${Object.keys(METRIC).join(", ")}`); return; }
      const [required, optional] = METRIC[kind];
      const allowed = new Set(["kind", ...required, ...optional]);
      for (const key of Object.keys(kr.metric)) if (!allowed.has(key)) errors.push(`${kw}.metric: "${key}" is not used by kind "${kind}"`);
      for (const key of required) if (kr.metric[key] === undefined) errors.push(`${kw}.metric: kind "${kind}" needs "${key}"`);
    });
  });
  unique(errors, "keyResults", krs);

  // roadmap
  const roadmapIds = unique(errors, "roadmap", list(atlas.roadmap));
  list(atlas.roadmap).forEach((r, i) => {
    const where = `roadmap[${r && r.id ? r.id : i}]`;
    if (!shape(errors, where, r, {
      id: ["string", true], northStar: ["string", true], label: ["string", true], summary: ["string", true], quarter: ["string", true],
      status: ["string", true], priority: ["string", false], parent: ["string", false], modules: ["array", false],
      partners: ["array", false], progress: ["number", false],
    })) return;
    oneOf(errors, `${where}.status`, r.status, STATUS_ROADMAP);
    oneOf(errors, `${where}.priority`, r.priority, PRIORITY);
    if (typeof r.northStar === "string" && !starIds.has(r.northStar)) errors.push(`${where}.northStar: unknown north star "${r.northStar}"`);
    if (typeof r.quarter === "string" && r.quarter !== "backlog" && !QUARTER.test(r.quarter)) errors.push(`${where}.quarter: "${r.quarter}" is neither a quarter like 2026Q4 nor "backlog"`);
    if (r.parent !== undefined) {
      if (!roadmapIds.has(r.parent)) errors.push(`${where}.parent: unknown roadmap item "${r.parent}"`);
      if (r.parent === r.id) errors.push(`${where}.parent: an item cannot be its own parent`);
    }
    list(r.partners).forEach((p, j) => { if (typeof p !== "string" || !p.trim()) errors.push(`${where}.partners[${j}]: expected a non-empty string`); });
    list(r.modules).forEach((m, j) => {
      const mw = `${where}.modules[${j}]`;
      const id = typeof m === "string" ? m : m && m.id;
      if (typeOf(m) === "object") {
        shape(errors, mw, m, { id: ["string", true], status: ["string", false], progress: ["number", false] });
        oneOf(errors, `${mw}.status`, m.status, STATUS_ROADMAP);
        if (typeof m.progress === "number" && (m.progress < 0 || m.progress > 100)) errors.push(`${mw}.progress: must be between 0 and 100`);
      } else if (typeof m !== "string") errors.push(`${mw}: expected a module id or a mapping`);
      if (typeof id === "string" && !moduleIds.has(id)) errors.push(`${mw}: unknown module "${id}"`);
    });
    const words = countWords(r.summary);
    if (words > WORD_LIMIT) long.push({ where: `${where}.summary`, words });
  });

  return { errors, long };
}

// ---------------------------------------------------------------- command line
if (import.meta.url === `file://${process.argv[1]}`) {
  let result;
  try { result = validate(loadAtlas()); }
  catch (e) { result = { errors: [`atlas.yaml does not parse: ${e.message.split("\n")[0]}`], long: [] }; }
  const { errors, long } = result;
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ "P4.1": { pass: !errors.length, errors }, "P1.4": { pass: !long.length, long } }, null, 2));
  } else {
    console.log(`P4.1 ${errors.length ? "fail" : "pass"}  atlas.yaml structure, enums, ids and references${errors.length ? ` (${errors.length})` : ""}`);
    for (const e of errors) console.log(`       ${e}`);
    console.log(`P1.4 ${long.length ? "fail" : "pass"}  blurbs of ${WORD_LIMIT} words or fewer${long.length ? ` (${long.length} over)` : ""}`);
    for (const l of long) console.log(`       ${l.where}: ${l.words} words`);
  }
  process.exit(errors.length || long.length ? 1 : 0);
}
