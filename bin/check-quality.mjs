#!/usr/bin/env node
// The static half of the quality bar: everything that can be decided by reading the files.
// Contrast, type sizes, link handling, page weight, the vendored parser, the head tags a
// shared link needs. Anything that needs a real browser is checked elsewhere and is not
// silently assumed to pass here.
//
// Usage: node bin/check-quality.mjs [--json]
// Prints one line per gate, ids from the product spec, and exits 1 if any gate fails.
import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { ROOT } from "./lib/load-atlas.mjs";

const read = (rel) => (existsSync(join(ROOT, rel)) ? readFileSync(join(ROOT, rel), "utf8") : "");
const size = (rel) => (existsSync(join(ROOT, rel)) ? statSync(join(ROOT, rel)).size : 0);
const html = read("index.html");
const css = read("styles.css");
const js = read("app.js");

const KB = 1024;
const MIN_FONT_PX = 12;
const MIN_CONTRAST = 4.5;

// js-yaml 4.1.0, the bundle the site serves. Recorded so a swapped file is noticed; update it
// deliberately, in the same commit that changes the vendored file.
const VENDOR = {
  "vendor/js-yaml.min.js": { version: "4.1.0", source: "https://github.com/nodeca/js-yaml", sha256: null },
};

// Uncompressed budget per page, excluding fonts. What a page fetches, not what the repo holds.
const BUDGET_KB = { map: 300, dev: 300, overview: 350, roadmap: 450, results: 450, dashboard: 750 };

// ---------------------------------------------------------------- colour
// WCAG relative luminance and contrast, from hsl() as the tokens are written.
function hslToRgb(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)].map((v) => Math.round(v * 255));
}
const luminance = ([r, g, b]) => {
  const c = [r, g, b].map((v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (fg, bg) => {
  const [a, b] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
};

// Tokens as written in the :root block, resolved one level of var() indirection.
function tokens(block) {
  const source = css.slice(css.indexOf(block), css.indexOf("}", css.indexOf(block)));
  const found = {};
  for (const m of source.matchAll(/--([\w-]+):\s*([^;]+);/g)) found[m[1]] = m[2].trim();
  const resolve = (v, depth = 0) => {
    const ref = /^var\(--([\w-]+)\)$/.exec(v);
    return ref && depth < 4 && found[ref[1]] ? resolve(found[ref[1]], depth + 1) : v;
  };
  const colours = {};
  for (const [name, raw] of Object.entries(found)) {
    const value = resolve(raw);
    const m = /^hsl\(\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%\s*\)$/.exec(value);
    if (m) colours[name] = hslToRgb(Number(m[1]), Number(m[2]), Number(m[3]));
  }
  return colours;
}

const SURFACE_TOKENS = ["bg", "surface", "card", "card-elevated"];

// The token values are the WDK design system's and are not Atlas's to change: they are
// byte-identical to the custom properties wdk.tether.io ships. So this gate does not ask
// whether a token is accessible in the abstract. It asks whether a token that cannot carry
// text is being used to carry text, which is a usage bug and fixable without touching the
// palette. --secondary, also part of the system, clears 6:1 on every surface.
function contrastGate() {
  const t = tokens(":root {");
  if (!t.bg) return { pass: false, detail: "no colour tokens found in the :root block" };

  // Read each rule on its own terms. A rule that paints its own background is judged against
  // that background, which is how dark text on the orange accent stays correct. A rule that
  // does not is judged against every surface it could sit on.
  const failures = new Map();
  const source = css.replace(/\/\*[\s\S]*?\*\//g, ""); // comments would otherwise read as selectors
  for (const [, selector, body] of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const fg = /(?:^|[;\s])color:\s*var\(--([\w-]+)\)/.exec(body);
    if (!fg || !t[fg[1]]) continue;
    if (/::(?:before|after|placeholder)|\bfill:/.test(selector)) continue; // decoration, not body text
    // Only a flat background can be judged. A colour-mix or a gradient resolves at paint time,
    // so those rules fall back to the surfaces the element could sit on.
    const bgDecl = /background(?:-color)?:\s*([^;]+)/.exec(body);
    const flat = bgDecl && !/color-mix|gradient/.test(bgDecl[1]) ? /var\(--([\w-]+)\)/.exec(bgDecl[1]) : null;
    const against = flat && t[flat[1]] ? [flat[1]] : SURFACE_TOKENS.filter((s) => t[s]);
    for (const surface of against) {
      const ratio = contrast(t[fg[1]], t[surface]);
      if (ratio >= MIN_CONTRAST) continue;
      const key = `${fg[1]}|${surface}`;
      if (!failures.has(key)) failures.set(key, { fg: fg[1], surface, ratio, where: selector.trim().split(",")[0].trim() });
    }
  }
  const worst = (name) => Math.min(...SURFACE_TOKENS.filter((s) => t[s]).map((s) => contrast(t[name], t[s])));
  const spare = Object.keys(t).find((n) => /secondary|text/.test(n) && worst(n) >= MIN_CONTRAST);
  const list = [...failures.values()].sort((a, b) => a.ratio - b.ratio);
  return {
    pass: list.length === 0,
    detail: list.length ? list.map((f) => `--${f.fg} on --${f.surface} is ${f.ratio.toFixed(2)}:1 (${f.where})`).join("; ")
      : `every colour used for text clears ${MIN_CONTRAST}:1 where it is used`,
    note: list.length && spare ? `--${spare} is in the design system and clears ${worst(spare).toFixed(1)}:1` : "",
  };
}

function fontFloorGate() {
  const small = [];
  for (const source of [["styles.css", css], ["app.js", js]]) {
    for (const m of source[1].matchAll(/font-size:\s*([\d.]+)px/g)) {
      if (Number(m[1]) < MIN_FONT_PX) small.push(`${source[0]}: ${m[1]}px`);
    }
    for (const m of source[1].matchAll(/font-size="([\d.]+)"/g)) {
      if (Number(m[1]) < MIN_FONT_PX) small.push(`${source[0]}: ${m[1]}px in SVG`);
    }
  }
  const unique = [...new Set(small)];
  return { pass: unique.length === 0, detail: unique.length ? unique.join(", ") : `nothing below ${MIN_FONT_PX}px` };
}

function pageWeightGate() {
  const shell = size("index.html") + size("styles.css") + size("app.js") + size("vendor/js-yaml.min.js");
  const atlas = size("atlas.yaml");
  const metrics = size("data/metrics.json");
  const summary = size("data/summary.json");
  // Which pages pull the full metrics file. The light pages should read the summary instead.
  const lightPages = ["map", "dev", "overview"];
  const pulls = /loadMetrics\(\)/.test(js);
  const rows = [];
  for (const [page, budget] of Object.entries(BUDGET_KB)) {
    const light = lightPages.includes(page);
    const data = light && summary ? summary : metrics;
    const total = (shell + atlas + (pulls ? data : 0)) / KB;
    rows.push({ page, kb: Math.round(total), budget, pass: total <= budget });
  }
  const over = rows.filter((r) => !r.pass);
  return {
    pass: over.length === 0,
    detail: over.length ? over.map((r) => `${r.page} ${r.kb}KB over ${r.budget}KB`).join(", ")
      : rows.map((r) => `${r.page} ${r.kb}KB`).join(", "),
  };
}

function vendorGate() {
  const problems = [];
  for (const [rel, expected] of Object.entries(VENDOR)) {
    if (!existsSync(join(ROOT, rel))) { problems.push(`${rel} is missing`); continue; }
    const actual = createHash("sha256").update(readFileSync(join(ROOT, rel))).digest("hex");
    if (!expected.sha256) problems.push(`${rel} has no recorded hash yet (is ${actual.slice(0, 16)}…, ${expected.version} from ${expected.source})`);
    else if (expected.sha256 !== actual) problems.push(`${rel} does not match its recorded hash`);
  }
  return { pass: problems.length === 0, detail: problems.length ? problems.join("; ") : "vendored files match their recorded hashes" };
}

function fontPreloadGate() {
  const fonts = existsSync(join(ROOT, "assets/fonts")) ? readdirSync(join(ROOT, "assets/fonts")).filter((f) => f.endsWith(".woff2")) : [];
  const preloaded = [...html.matchAll(/<link[^>]+rel="preload"[^>]+href="([^"]+)"/g)].map((m) => m[1]);
  const blocking = [...html.matchAll(/<script(?![^>]*\b(?:defer|async|type="module")\b)[^>]*src=/g)].length;
  const problems = [];
  if (blocking) problems.push(`${blocking} render-blocking script tag(s)`);
  if (fonts.length && !preloaded.some((p) => p.includes(".woff2"))) problems.push(`${fonts.length} self-hosted fonts, none preloaded`);
  return { pass: problems.length === 0, detail: problems.length ? problems.join("; ") : "scripts are deferred and fonts are preloaded" };
}

function readmeClaimGate() {
  const readme = read("README.md");
  const atlas = read("atlas.yaml");
  const problems = [];
  // A claim the shipped data contradicts. The roster in atlas.yaml names accounts, so a README
  // promising the opposite is wrong until one of the two changes.
  const claimsNoNames = /never\s+names\s+(?:org|organisation|organization)\s+members/i.test(readme);
  const rosterSize = (atlas.match(/^\s{2}team:\n(?:\s{4}-\s+\S+\n)+/m) || [""])[0].split("\n").filter((l) => /^\s{4}-/.test(l)).length;
  if (claimsNoNames && rosterSize > 0) problems.push(`README says org members are never named, but atlas.yaml lists ${rosterSize}`);
  return { pass: problems.length === 0, detail: problems.length ? problems.join("; ") : "no README claim contradicts the shipped data" };
}

const has = (source, re) => re.test(source);

// ---------------------------------------------------------------- gates
const GATES = [
  { id: "P1.1", what: "each page sets its own title and description",
    run: () => ({ pass: has(js, /document\.title\s*=/) && has(html, /<meta\s+name="description"/i),
      detail: [has(js, /document\.title\s*=/) ? null : "no page sets document.title", has(html, /<meta\s+name="description"/i) ? null : "index.html has no meta description"].filter(Boolean).join("; ") || "title and description are set" }) },
  { id: "P1.5", what: "a shared link previews correctly",
    run: () => {
      const missing = [];
      if (!has(html, /property="og:title"/)) missing.push("og:title");
      if (!has(html, /property="og:description"/)) missing.push("og:description");
      if (!has(html, /property="og:image"/)) missing.push("og:image");
      if (!has(html, /name="twitter:card"/)) missing.push("twitter:card");
      if (has(html, /property="og:image"/)) {
        const src = (/property="og:image"[^>]*content="([^"]+)"/.exec(html) || [])[1] || "";
        if (src && !/^https?:/.test(src) && !existsSync(join(ROOT, src))) missing.push(`the image file ${src}`);
      }
      return { pass: missing.length === 0, detail: missing.length ? `missing ${missing.join(", ")}` : "link preview tags are present" };
    } },
  { id: "P1.8", what: "the pages print legibly",
    run: () => ({ pass: has(css, /@media\s+print/), detail: has(css, /@media\s+print/) ? "a print stylesheet exists" : "no @media print rule" }) },
  { id: "P1.10", what: "the README matches the shipped data", run: readmeClaimGate },
  { id: "P2.1", what: `text tokens clear ${MIN_CONTRAST}:1`, run: contrastGate },
  { id: "P2.2a", what: `no type below ${MIN_FONT_PX}px`, run: fontFloorGate },
  { id: "P2.2b", what: "chart colours come from the design system",
    run: () => {
      const literals = [...js.matchAll(/#[\da-f]{6}\b/gi)].map((m) => m[0]);
      return { pass: literals.length === 0, detail: literals.length ? `${literals.length} colour literal(s) in app.js: ${[...new Set(literals)].join(", ")}` : "no colour literals in the script" };
    } },
  // P2.3 (a light theme) is struck: the WDK design system is dark only, so Atlas is too.
  // Print legibility is covered by P1.8.
  { id: "P3.1", what: "a skip link comes first",
    run: () => ({ pass: has(html, /class="skip[^"]*"|href="#main"/), detail: "no skip link in index.html" }) },
  { id: "P3.2", what: "reduced motion is honoured everywhere",
    run: () => {
      const blocks = (css.match(/@media\s*\(prefers-reduced-motion/g) || []).length;
      const globalRule = /@media\s*\(prefers-reduced-motion[^{]*\{\s*[^}]*\*/.test(css);
      return { pass: blocks > 0 && globalRule, detail: globalRule ? "a global rule disables motion" : `${blocks} reduced-motion block(s), none of them global` };
    } },
  { id: "P3.3", what: "no information lives only in a title attribute",
    run: () => {
      const count = (js.match(/\btitle:\s*(?!null)/g) || []).length;
      return { pass: count === 0, detail: count ? `${count} title attribute(s) set from the script` : "nothing depends on a title attribute" };
    } },
  { id: "P5.2", what: "links built from data are scheme-checked",
    run: () => ({ pass: has(js, /safeHref|isHttps|allowedScheme/), detail: "no scheme allow-list guards href values" }) },
  { id: "P5.3", what: "nothing is built with innerHTML",
    run: () => {
      const count = (js.match(/\.innerHTML\s*=/g) || []).length;
      return { pass: count === 0, detail: count ? `${count} innerHTML assignment(s) in app.js` : "no innerHTML assignments" };
    } },
  { id: "P5.5", what: "data-driven style values are clamped",
    run: () => {
      const raw = [...js.matchAll(/width:\$\{(?!clamp|pct|Math)[^}]+\}/g)].map((m) => m[0]);
      return { pass: raw.length === 0, detail: raw.length ? `${raw.length} unclamped width value(s): ${raw.slice(0, 2).join(", ")}` : "style values pass through a clamp" };
    } },
  { id: "P5.6", what: "a referrer policy is set",
    run: () => ({ pass: has(html, /name="referrer"/i), detail: "no referrer policy meta tag" }) },
  { id: "P5.7", what: "vendored files match their recorded hashes", run: vendorGate },
  { id: "P5.8", what: "the ignore rules cover secrets and build output",
    run: () => {
      const ignore = read(".gitignore");
      const missing = ["*.env", ".env", "*.key", "report.json", "report.md"].filter((p) => !ignore.includes(p.replace("*", "")));
      return { pass: missing.length === 0, detail: missing.length ? `not ignored: ${missing.join(", ")}` : "secrets and build output are ignored" };
    } },
  { id: "P6.1", what: "nothing blocks the first paint", run: fontPreloadGate },
  { id: "P6.3", what: "pages stay inside their weight budget", run: pageWeightGate },
];

export function runGates() {
  return GATES.map((g) => {
    let result;
    try { result = g.run(); } catch (e) { result = { pass: false, detail: `check threw: ${e.message}` }; }
    return { id: g.id, what: g.what, ...result };
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const results = runGates();
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(Object.fromEntries(results.map((r) => [r.id, r])), null, 2));
  } else {
    for (const r of results) {
      console.log(`${r.id.padEnd(6)} ${r.pass ? "pass" : "fail"}  ${r.what}`);
      if (!r.pass || r.note) console.log(`       ${r.detail}${r.note ? ` · ${r.note}` : ""}`);
    }
    const failed = results.filter((r) => !r.pass).length;
    console.log(`\n${results.length - failed} of ${results.length} static gates pass`);
  }
  process.exit(results.some((r) => !r.pass) ? 1 : 0);
}
