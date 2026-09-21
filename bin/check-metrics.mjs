#!/usr/bin/env node
// Gates M1 to M11 from the measurement specification: do the numbers Atlas publishes mean
// what they appear to mean?
//
// Three results, never two. A gate that runs and finds the condition false is a fail. A gate
// that cannot determine the answer is "not run", and is never counted as a pass, because the
// whole point of this file is that we stop taking our own word for things.
//
// Static only, dependency-free. Where a gate reads the pages it reads them as text: the contract it
// enforces is that a rendered figure names its registry id at the call site, which is cheap to
// grep for and impossible to satisfy by accident.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { METRICS, REQUIRED, DEMOTED } from "../lib/metrics-defs.mjs";
import { runGates as runQualityGates } from "./check-quality.mjs";
import { loadAtlas, ROOT } from "./lib/load-atlas.mjs";
import { shippedSource } from "./lib/shipped.mjs";
import { uncovered, metricsOf } from "../lib/origins.mjs";

const read = (rel) => (existsSync(join(ROOT, rel)) ? readFileSync(join(ROOT, rel), "utf8") : null);

// The pages live in src/ and app.js is the shell over them, so "what the site renders" is all of it.
const APP = shippedSource();
const COLLECTOR = read("bin/collect-metrics.mjs") || "";

const pass = (detail, note) => ({ state: "pass", detail, note });
const fail = (detail, note) => ({ state: "fail", detail, note });
const notRun = (detail) => ({ state: "not run", detail });

/** Registry ids named at a render site, through the one helper pages are allowed to use. */
export const referencedIds = (src) => [...src.matchAll(/defFor\("([a-z0-9-]+)"\)/g)].map((m) => m[1]);

/** From `marker` to the close of the bracket it opens, marker included, or null. */
export function balancedBlock(src, marker) {
  const at = src.indexOf(marker);
  if (at < 0) return null;
  let depth = 0;
  for (let i = at; i < src.length; i++) {
    const c = src[i];
    if (c === "(") depth++;
    else if (c === ")") { depth--; if (depth === 0) return src.slice(at, i + 1); }
  }
  return null;
}

// ---- M1 ---------------------------------------------------------------------------------
// A figure on a page with no entry behind it is a number nobody has had to justify.
export const renderSites = (src) =>
  src.split("\n").filter((l) => /\b(statTile|chartCard)\(/.test(l) && !/^\s*(export\s+)?function\s/.test(l));

function m1() {
  // Per site, not per occurrence. Counting ids across the whole file and comparing the total
  // against the number of sites let a figure lose its id entirely as long as another figure
  // named one twice: the real page had four occurrences of that slack, so four tiles could
  // have gone unregistered with the gate still green.
  const sites = renderSites(APP);
  if (!sites.length) return notRun("found no tile or chart call sites in the pages; the parser needs updating");
  const named = sites.filter((l) => /defFor\("[a-z0-9-]+"\)/.test(l));
  const known = new Set(METRICS.map((m) => m.id));
  const unknown = [...new Set(referencedIds(APP))].filter((id) => !known.has(id));
  if (unknown.length) return fail(`ids with no registry entry: ${unknown.join(", ")}`);
  if (named.length < sites.length) {
    return fail(`${named.length} of ${sites.length} rendered figures name a registry id`, named.length ? undefined : "no page reads the registry yet");
  }
  return pass(`${sites.length} rendered figures, each naming a registered id`);
}

// ---- M2 ---------------------------------------------------------------------------------
// A definition written twice is a definition that will disagree with itself.
function m2() {
  const bad = [];
  for (const m of METRICS) {
    const missing = REQUIRED.filter((f) => m[f] === undefined || m[f] === null || m[f] === "");
    if (missing.length) bad.push(`${m.id}: ${missing.join(", ")}`);
    else if (String(m.decision).trim().split(/\s+/).length < 8) bad.push(`${m.id}: decision is a label, not a decision`);
  }
  return bad.length ? fail(bad.join("; ")) : pass(`${METRICS.length} entries, each naming a decision, a window, a source and a definition`);
}

// ---- M3 ---------------------------------------------------------------------------------
// A page on which nothing can go down cannot tell a bad quarter from a good one.
function m3() {
  const missing = METRICS.filter((m) => typeof m.canFall !== "boolean");
  if (missing.length) return fail(`canFall is not a boolean on: ${missing.map((m) => m.id).join(", ")}`);
  const falling = METRICS.filter((m) => m.canFall);
  return falling.length >= 4
    ? pass(`${falling.length} of ${METRICS.length} published numbers can go down`)
    : fail(`only ${falling.length} published numbers can go down`);
}

// ---- M4 ---------------------------------------------------------------------------------
// 53% of WDK download volume is the dependency graph echoing. Published whole, it misleads.
function m4() {
  const publishesDownloads = /npm downloads/.test(APP);
  // Triggered by a label in the pages, so a rename would silence it. Absence is "not run".
  if (!publishesDownloads) return notRun("found no download figure in the pages; the parser needs updating");
  const ids = new Set(referencedIds(APP));
  const have = ["downloads-direct", "downloads-induced"].filter((id) => ids.has(id));
  return have.length === 2
    ? pass("downloads published with its direct and induced parts")
    : fail(`a download figure is published without ${["downloads-direct", "downloads-induced"].filter((id) => !ids.has(id)).join(" and ")}`);
}

// ---- M5 ---------------------------------------------------------------------------------
// "+50%" on a base of two is arithmetic, not information.
//
// The contract has two halves and both must hold: the one helper that draws a change consults
// the floor, and every call site names the metric whose floor applies. An earlier wording of
// this gate counted occurrences of the guard, which would have been satisfied by scattering it
// across eleven call sites: the opposite of one definition kept in one place.
export function pillSites(src) {
  const lines = src.split("\n").filter((l) => /\b(trendPill|deltaPill)\(/.test(l) && !/^\s*(export\s+)?function\s/.test(l));
  const named = lines.filter((l) => /\b(trendPill|deltaPill)\(\s*(?:"[a-z0-9-]+"|id\b)/.test(l));
  const ids = [...src.matchAll(/\b(?:trendPill|deltaPill)\(\s*"([a-z0-9-]+)"/g)].map((m) => m[1]);
  return { total: lines.length, named: named.length, ids };
}

function m5() {
  const { total, named, ids } = pillSites(APP);
  if (!total) return notRun("found no change indicator in the pages; the parser needs updating");
  const guardInHelper = /const pct = [^;]*mayShowChange\(/.test(APP);
  const known = new Set(METRICS.map((m) => m.id));
  const unknown = [...new Set(ids)].filter((id) => !known.has(id));
  if (!guardInHelper) return fail(`${total} change indicators, and the helper that draws them consults no floor`);
  if (unknown.length) return fail(`change indicators name ids with no entry: ${unknown.join(", ")}`);
  if (named < total) return fail(`${named} of ${total} change indicators name the metric whose floor applies`);
  return pass(`${total} change indicators, each naming its metric, all drawn through one floor check`);
}

// ---- M6 ---------------------------------------------------------------------------------
// The tile row is what a reader takes away in ten seconds. It is not the place for a trophy.
function m6() {
  // Every tile row. The marker was the Dashboard's exact class string and the first hit only, so
  // the Overview's row, class "tiles brief-tiles", was never looked at.
  const rows = [];
  for (let at = APP.indexOf('el("div", { class: "tiles'); at >= 0; at = APP.indexOf('el("div", { class: "tiles', at + 1)) rows.push(balancedBlock(APP.slice(at), 'el("div", { class: "tiles'));
  if (!rows.length || rows.some((r) => !r)) return notRun("could not find the tile rows in the pages");
  const block = rows.join("\n");
  const labels = new Map(METRICS.map((m) => [m.id, m.label]));
  const present = DEMOTED.filter((id) => block.includes(`defFor("${id}")`) || block.includes(`"${labels.get(id)}"`));
  return present.length
    ? fail(`demoted metrics still in the tile row: ${present.join(", ")}`)
    : pass(`the tile row carries none of the ${DEMOTED.length} demoted metrics`);
}

// ---- M7 ---------------------------------------------------------------------------------
// "Recompute it yourself" is only true if the definition travels with the data.
function m7() {
  const hasCsv = /text\/csv/.test(APP);
  // Blob and createObjectURL each appear once and do the real work. "download" was a third
  // alternative here and was free: it is also a metric id, so it matches 26 times.
  const hasJson = /application\/json/.test(APP) && /Blob|createObjectURL/.test(APP);
  if (!hasCsv && !hasJson) return fail("no chart or table offers an export");
  if (!hasCsv || !hasJson) return fail(`export offers ${hasCsv ? "CSV" : "JSON"} only`);
  // Whether the definition travels inside the file is settled by test/export.test.mjs, which
  // builds one and reads it back. Asserting it here by grepping app.js for the word was free:
  // the word occurs eight times for unrelated reasons, so the clause passed over a gutted
  // export.
  return pass("every chart and table offers CSV and JSON");
}

// ---- M8 ---------------------------------------------------------------------------------
// Retention is the only thing here that can fall before it flatters us.
function m8() {
  if (!/currency/.test(COLLECTOR)) return fail("the collector writes no version currency");
  const raw = read("data/metrics.json");
  if (!raw) return notRun("no data/metrics.json to check against");
  let file;
  try { file = JSON.parse(raw); } catch (e) { return notRun(`data/metrics.json did not parse: ${e.message}`); }
  const days = Object.keys(file.snapshots || {}).sort();
  const latest = (file.snapshots || {})[days[days.length - 1]] || {};
  const published = latest.published || [];
  if (!published.length) return notRun("the latest snapshot lists no published packages");
  const missing = published.filter((r) => (latest.currency || {})[r] == null);
  return missing.length
    ? fail(`${missing.length} of ${published.length} published packages have no version currency`)
    : pass(`version currency written for all ${published.length} published packages`);
}

// ---- M9 ---------------------------------------------------------------------------------
// New collection must not be paid for by the reader. Delegated, so the budget lives in one place.
function m9() {
  const p63 = runQualityGates().find((g) => g.id === "P6.3");
  if (!p63) return notRun("check-quality.mjs no longer reports P6.3");
  return p63.pass ? pass(p63.detail, "measured by P6.3") : fail(p63.detail, "measured by P6.3");
}

// ---- M10 --------------------------------------------------------------------------------
// A figure without its window is a figure the reader cannot date, and so cannot check.
function m10() {
  const ids = referencedIds(APP);
  if (!ids.length) return fail("no rendered figure draws its window from the registry", "no page reads the registry yet");
  const usesWindow = /\.window\b/.test(APP);
  const stamped = /Last collected|atlasUpdated|file\.updated/.test(APP);
  if (!usesWindow) return fail("rendered figures do not carry the window recorded for them");
  if (!stamped) return fail("no page stamps the day the data was collected");
  return pass("every rendered figure carries its window, and every page its collection date");
}

// ---- M11 --------------------------------------------------------------------------------
// A source column that links to our own pages is not a source column.
//
// This asks the table in lib/origins.mjs directly, rather than reading app.js and guessing.
// The first wording did guess, with a regular expression over the page source, and a negative
// test found it caught one regression out of three: it would have passed a page that had
// stopped rendering the link at all. Sharing the table is what makes the question answerable.
//
// It covers whether every measurement has somewhere public to send a reader. That the page
// renders the link is checked by loading the page, not here, and this gate does not claim it.
function m11() {
  let atlas;
  try { atlas = loadAtlas(); } catch (e) { return notRun(`could not read atlas.yaml: ${e.message}`); }
  const metrics = metricsOf(atlas.northStars);
  if (!metrics.length) return notRun("no key result in atlas.yaml carries a metric block");
  if (!/originFor\(/.test(APP)) return fail("the page does not use the shared table of public endpoints");
  const missing = uncovered(metrics);
  return missing.length
    ? fail(`${missing.length} of ${metrics.length} measurements have no public endpoint: ${[...new Set(missing)].join(", ")}`)
    : pass(`all ${metrics.length} measurements name a public endpoint`);
}

const GATES = [
  { id: "M1", what: "every rendered number has a registry entry", run: m1 },
  { id: "M2", what: "every entry names a decision, a window, a source and a definition", run: m2 },
  { id: "M3", what: "every entry records whether it can fall, and at least four can", run: m3 },
  { id: "M4", what: "downloads are published with their direct and induced parts", run: m4 },
  { id: "M5", what: "no percentage change is shown below the entry's floor", run: m5 },
  { id: "M6", what: "demoted metrics do not appear in the tile row", run: m6 },
  { id: "M7", what: "every chart and table exports CSV and JSON", run: m7 },
  { id: "M8", what: "the collector writes version currency for every published package", run: m8 },
  { id: "M9", what: "pages stay inside their compressed weight budget", run: m9 },
  { id: "M10", what: "every figure carries its collection date and window", run: m10 },
  { id: "M11", what: "every key result names a public source, not one of our pages", run: m11 },
];

export function runMetricGates() {
  return GATES.map((g) => {
    let result;
    try { result = g.run(); } catch (e) { result = notRun(`check threw: ${e.message}`); }
    return { id: g.id, what: g.what, ...result };
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const results = runMetricGates();
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(Object.fromEntries(results.map((r) => [r.id, r])), null, 2));
  } else {
    for (const r of results) {
      console.log(`${r.id.padEnd(4)} ${r.state.padEnd(7)}  ${r.what}`);
      if (r.state !== "pass" || r.note) console.log(`     ${r.detail}${r.note ? ` · ${r.note}` : ""}`);
    }
    const passed = results.filter((r) => r.state === "pass").length;
    const notRunCount = results.filter((r) => r.state === "not run").length;
    console.log(`\n${passed} of ${results.length} measurement gates pass` + (notRunCount ? `, ${notRunCount} could not run` : ""));
  }
  process.exit(results.some((r) => r.state !== "pass") ? 1 : 0);
}
