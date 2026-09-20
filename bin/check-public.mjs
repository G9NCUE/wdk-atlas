#!/usr/bin/env node
// Everything in this repo is published. This script reads the shipped files the way an outsider
// would and reports what looks like it was written for an internal reader: a person named in a
// decision, a tracker link, an unannounced third party, an objective still marked as a draft.
//
// It reports. It never edits. Judging whether a finding is genuinely private needs a human, so
// each one is queued for review and, once decided, recorded by fingerprint so it stays quiet.
//
// The detectors are deliberately structural — shapes and phrasings, not a list of real names.
// A list of the people and partners to watch for would itself be the leak, so it lives outside
// the repo: set ATLAS_REVIEW_DIR to a directory holding, optionally,
//   terms.txt         one term per line, # comments allowed; matched whole-word, case-insensitive
//   acknowledged.txt  one fingerprint per line, findings already decided
//
// Usage: node bin/check-public.mjs [--json] [--fingerprints]
// Gate P5.1. Exits 1 on findings that have never been reviewed, 0 when all are acknowledged.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { ROOT, readAtlasText, parseAtlas } from "./lib/load-atlas.mjs";

const REVIEW_DIR = process.env.ATLAS_REVIEW_DIR || "";
const QUARTERS_AHEAD = 3; // a public date further out than this reads as a commitment
const SEP = "␟"; // printable separator, kept out of the hashed text itself

// A finding is (category, file, evidence). The fingerprint stays stable when surrounding lines
// move, so a decision survives edits elsewhere in the file.
const fingerprint = (category, file, text) =>
  createHash("sha256").update([category, file, text.trim().toLowerCase()].join(SEP)).digest("hex").slice(0, 12);

const readLines = (rel) => {
  const path = join(ROOT, rel);
  return existsSync(path) ? readFileSync(path, "utf8").split("\n") : null;
};

const readList = (name) => {
  if (!REVIEW_DIR) return [];
  const path = join(REVIEW_DIR, name);
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").split("\n").map((l) => l.replace(/#.*/, "").trim()).filter(Boolean);
};

// ---------------------------------------------------------------- detectors over text lines
// Each: { id, why, test(line) -> matched substring | null }. Kept generic on purpose.
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const privateTerms = readList("terms.txt");
const privateRe = privateTerms.length ? new RegExp(`\\b(?:${privateTerms.map(escape).join("|")})\\b`, "i") : null;

const first = (line, re) => { const m = line.match(re); return m ? m[0].trim() : null; };

// Atlas parsed once, shared by the detectors and the structural checks.
let atlasCache;
function atlasDoc() {
  if (atlasCache === undefined) {
    try { atlasCache = parseAtlas(readAtlasText()); } catch { atlasCache = null; } // the validator reports parse failures
  }
  return atlasCache;
}

// Capitalised words that are product vocabulary rather than people: chain names, publishers,
// module titles. Taken from the data, so nothing has to be listed here by hand.
let vocabCache;
function productWords() {
  if (vocabCache) return vocabCache;
  vocabCache = new Set();
  const a = atlasDoc();
  const add = (s) => String(s || "").split(/[^A-Za-z]+/).forEach((w) => { if (/^[A-Z][a-z]{2,}$/.test(w)) vocabCache.add(w); });
  if (a) {
    for (const c of a.chains || []) { add(c && c.id); add(c && c.label); (c && c.also || []).forEach(add); }
    for (const m of a.modules || []) { add(m && m.publisher); add(m && m.title); add(m && m.name); }
    for (const s of a.sections || []) add(s && s.label);
  }
  return vocabCache;
}

// The name in a "decision with a person" match, when it is not product vocabulary.
const personName = (hit) => {
  const words = hit.match(/\b[A-Z][a-z]{2,}\b/g) || [];
  return words.find((w) => !productWords().has(w)) || null;
};

const DETECTORS = [
  // Case matters here: the name has to look like a name, so no /i flag. The verbs carry both
  // cases instead, because a sentence often opens with one.
  { id: "person-in-decision", why: "reads as a decision attributed to a named person",
    test: (l) => {
      const hit = first(l, /\b(?:[Aa]greed|[Dd]iscussed|[Cc]onfirmed|[Dd]ecided|[Aa]ligned|[Ss]poke)\s+with\s+[A-Z][a-z]{2,}\b|\b[A-Z][a-z]{2,}\s+(?:agreed|offered|confirmed|owns|said|asked|suggested|prefers)\b|\bto\s+(?:confirm|check|agree)\s+with\s+[A-Z][a-z]{2,}\b|\b[Aa]sk\s+[A-Z][a-z]{2,}\b/);
      return hit && personName(hit) ? hit : null;
    } },
  { id: "tracker-or-workspace", why: "names an internal tracker or workspace",
    test: (l) => first(l, /\b(?:asana|jira|linear\.app|notion|confluence|atlassian|slack|basecamp|monday\.com)\b|\b(?:tracked|logged|filed)\s+in\s+\w+/i) },
  { id: "internal-document", why: "refers to a document an outside reader cannot open",
    test: (l) => first(l, /\b(?:OKR|KPI)\s+(?:sheet|doc|document|deck)\b|\b(?:internal|private|shared)\s+(?:sheet|doc|document|deck|spreadsheet)\b|\bgoogle\s+(?:sheet|doc)\b/i) },
  { id: "marked-internal", why: "says in so many words that it is not for outside readers",
    test: (l) => first(l, /\binternal\s+(?:use\s+only|only|track)\b|\bconfidential\b|\bdo\s+not\s+share\b|\bnot\s+for\s+(?:public|external)\b|\bunder\s+NDA\b/i) },
  { id: "unreviewed-decision", why: "publishes something still marked as unapproved",
    test: (l) => first(l, /\bpending\s+(?:review|approval|sign-?off)\b|\bawaiting\s+(?:review|approval|sign-?off)\b|\bnot\s+yet\s+(?:approved|signed\s*off)\b|\bprovisional\b|\bunapproved\b/i) },
  { id: "internal-uncertainty", why: "exposes internal uncertainty about scope or ownership",
    test: (l) => first(l, /\bscope\s+(?:undefined|unconfirmed|unclear)\b|\bowner(?:ship)?\s+(?:not\s+yet\s+defined|unclear|undefined|to\s+be\s+confirmed)\b|\bunconfirmed\b|\bpending\s+demand\b/i) },
  { id: "private-link", why: "links to a place an outside reader cannot reach",
    test: (l) => first(l, /https?:\/\/(?:[\w.-]*\.)?(?:asana\.com|atlassian\.net|notion\.so|slack\.com|docs\.google\.com|drive\.google\.com|sharepoint\.com|dropbox\.com)[^\s"')]*|https?:\/\/[\w.-]*\.(?:internal|local|corp)\b[^\s"')]*/i) },
  { id: "contact-detail", why: "publishes a personal contact detail",
    test: (l) => first(l, /\b[\w.+-]+@(?!(?:example|users\.noreply)\.)[\w-]+\.[\w.]{2,}\b/) },
  { id: "local-path", why: "leaks a path from someone's machine",
    test: (l) => first(l, /(?:\/Users\/|\/home\/|[A-Z]:\\Users\\)[\w.-]+[/\\][\w.\-/\\]*/) },
  ...(privateRe ? [{ id: "private-term", why: "matches a term from the private review list",
    test: (l) => first(l, privateRe) }] : []),
];

function scanText(rel, findings) {
  const lines = readLines(rel);
  if (!lines) return;
  lines.forEach((line, i) => {
    if (!line.trim()) return;
    for (const d of DETECTORS) {
      const hit = d.test(line);
      if (hit) findings.push({ category: d.id, why: d.why, file: rel, line: i + 1, evidence: hit.slice(0, 120) });
    }
  });
}

// ---------------------------------------------------------------- structural checks
function scanStructure(findings) {
  const atlas = atlasDoc();
  const text = readLines("atlas.yaml") || [];

  // A published roster of organisation members. Shape only: a list of login-shaped strings under
  // a people-ish key. GitHub keeps private membership hidden, so publishing it undoes that.
  if (atlas && atlas.audit) {
    for (const [key, value] of Object.entries(atlas.audit)) {
      if (!Array.isArray(value) || value.length < 5) continue;
      if (!/team|member|people|staff|owner|maintainer/i.test(key)) continue;
      const logins = value.filter((v) => typeof v === "string" && /^[A-Za-z\d](?:[A-Za-z\d]|-(?=[A-Za-z\d])){0,38}$/.test(v));
      if (logins.length < value.length * 0.8) continue;
      const line = text.findIndex((l) => new RegExp(`^\\s*${key}:`).test(l)) + 1;
      findings.push({ category: "published-roster", why: `publishes ${logins.length} account names under audit.${key}; organisation membership is private on GitHub`,
        file: "atlas.yaml", line: line || 1, evidence: `audit.${key}: ${logins.length} entries` });
    }
  }

  // Quarters far enough out that a public reader reads them as commitments.
  if (atlas && Array.isArray(atlas.roadmap)) {
    const now = new Date();
    const horizon = now.getFullYear() * 4 + Math.floor(now.getMonth() / 3) + QUARTERS_AHEAD;
    const far = atlas.roadmap.filter((r) => {
      const m = /^(20\d\d)Q([1-4])$/.exec((r && r.quarter) || "");
      return m && Number(m[1]) * 4 + Number(m[2]) - 1 > horizon;
    });
    if (far.length) findings.push({ category: "far-dated-plan", why: `${far.length} roadmap items are dated more than ${QUARTERS_AHEAD} quarters out, which reads as a commitment`,
      file: "atlas.yaml", line: 1, evidence: far.map((r) => r.id).sort().join(", ").slice(0, 120) });
  }

  // Third parties named as dependencies of work that has not shipped.
  if (atlas && Array.isArray(atlas.roadmap)) {
    for (const r of atlas.roadmap) {
      if (!Array.isArray(r.partners) || r.status === "done") continue;
      const line = text.findIndex((l) => new RegExp(`^\\s*-?\\s*id:\\s*${r.id}\\s*$`).test(l)) + 1;
      findings.push({ category: "named-third-party", why: "names an outside party on work that has not shipped",
        file: "atlas.yaml", line: line || 1, evidence: `${r.id}: ${r.partners.join(", ")}`.slice(0, 120) });
    }
  }

  // Contributor names in the metrics file, and hashes a list in this same repo can reverse.
  const metricsPath = join(ROOT, "data/metrics.json");
  if (!existsSync(metricsPath)) return;
  let metrics = null;
  try { metrics = JSON.parse(readFileSync(metricsPath, "utf8")); } catch { return; }
  const contributors = metrics.contributors && typeof metrics.contributors === "object" ? Object.values(metrics.contributors) : [];
  const names = new Set(contributors.flat().filter((v) => typeof v === "string"));
  if (names.size) findings.push({ category: "aggregated-identities", why: `gathers ${names.size} account names from ${contributors.length} repos into one downloadable file`,
    file: "data/metrics.json", line: 1, evidence: `contributors: ${names.size} unique names` });
  const hashed = Array.isArray(metrics.team) ? metrics.team.filter((v) => typeof v === "string" && /^[a-f\d]{64}$/.test(v)) : [];
  const roster = atlas && atlas.audit && Array.isArray(atlas.audit.team) ? atlas.audit.team : [];
  if (hashed.length && roster.length) findings.push({ category: "reversible-hash", why: `${hashed.length} unsalted hashes stand next to a plain-text list of ${roster.length} candidates in the same repo, so they invert instantly`,
    file: "data/metrics.json", line: 1, evidence: `team: ${hashed.length} hashes, audit.team: ${roster.length} names` });
}

// ---------------------------------------------------------------- run
export function scan() {
  const findings = [];
  for (const rel of ["atlas.yaml", "README.md", "index.html", "app.js", "styles.css"]) scanText(rel, findings);
  scanStructure(findings);
  const acknowledged = new Set(readList("acknowledged.txt").map((l) => l.split(/\s+/)[0]));
  for (const f of findings) {
    f.id = fingerprint(f.category, f.file, f.evidence);
    f.acknowledged = acknowledged.has(f.id);
  }
  findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  return findings;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const findings = scan();
  const fresh = findings.filter((f) => !f.acknowledged);
  if (process.argv.includes("--fingerprints")) {
    for (const f of findings) console.log(`${f.id}  ${f.category}  ${f.file}:${f.line}`);
  } else if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ "P5.1": { pass: !fresh.length, findings } }, null, 2));
  } else {
    console.log(`P5.1 ${fresh.length ? "fail" : "pass"}  shipped files reviewed for internal content (${findings.length} found, ${fresh.length} not yet reviewed)`);
    if (!REVIEW_DIR) console.log("       ATLAS_REVIEW_DIR is unset, so no private term list or decisions were loaded");
    for (const f of findings) {
      console.log(`       ${f.acknowledged ? "reviewed" : "NEW     "} ${f.id}  ${f.file}:${f.line}  ${f.category}`);
      console.log(`                ${f.why}`);
      console.log(`                ${f.evidence}`);
    }
  }
  process.exit(fresh.length ? 1 : 0);
}
