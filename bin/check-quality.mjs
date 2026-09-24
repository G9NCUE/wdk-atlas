#!/usr/bin/env node
// The static half of the quality bar: everything that can be decided by reading the files.
// Contrast, type sizes, link handling, page weight, the vendored parser, the head tags a
// shared link needs. Anything that needs a real browser is checked elsewhere and is not
// silently assumed to pass here.
//
// Usage: node bin/check-quality.mjs [--json]
// Prints one line per gate, ids from the product spec, and exits 1 if any gate fails.
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { ROOT } from "./lib/load-atlas.mjs";
import { shippedSource, shippedScripts, importClosure, pageModule } from "./lib/shipped.mjs";

const read = (rel) => (existsSync(join(ROOT, rel)) ? readFileSync(join(ROOT, rel), "utf8") : "");
const html = read("index.html");
const css = read("styles.css");
// Every script the site serves, as one text: app.js is a shell over src/ now, and a gate that
// read the shell alone would pass whatever the pages did.
const js = shippedSource();
const entry = read("app.js");
// Both stylesheets, comments out, for the gates about what a reader sees. The top bar's rules
// moved to page.css and these gates went on reading styles.css alone.
const cssAll = `${css}\n${read("page.css")}`.replace(/\/\*[\s\S]*?\*\//g, "");

// Every style rule with the declarations that are its own. A pattern over innermost braces read
// a parent's declarations as part of its first child's selector, so a font-size set directly on
// a rule that also nests others was seen by nothing.
function cssRules(source) {
  const rules = [];
  const open = [{ selector: "", body: "" }];
  let piece = "";
  for (const ch of source) {
    if (ch === "{") { open.push({ selector: piece.trim().replace(/\s+/g, " "), body: "" }); piece = ""; }
    else if (ch === "}") { const rule = open.pop(); rule.body += piece; piece = ""; rules.push(rule); }
    else if (ch === ";") { open[open.length - 1].body += `${piece};`; piece = ""; }
    else piece += ch;
  }
  return rules.filter((r) => r.selector && !r.selector.startsWith("@"));
}
// What follows Atlas into somebody else's page. site.js looks things up by id and marks the
// body, as a site may; the rules about being a guest are for everything but it.
const guest = shippedSource({ guestOnly: true });

const KB = 1024;
const MIN_FONT_PX = 12;
const MIN_CONTRAST = 4.5;

// The bundles the site serves. Each hash was compared against the published package, not just
// taken from the file on disk: js-yaml 4.1.0's dist/js-yaml.min.js from the npm registry has
// this exact digest. Update a hash deliberately, in the commit that changes the file, and
// check it against upstream again when you do.
const VENDOR = {
  "vendor/js-yaml.min.js": {
    version: "4.1.0",
    source: "https://registry.npmjs.org/js-yaml/-/js-yaml-4.1.0.tgz -> package/dist/js-yaml.min.js",
    verified: "2026-09-20",
    sha256: "45dc3dd03dc07a06705a2c2989b8c7f709013f04bd5386e3279d4e447f07ebd7",
  },
};

// What a reader actually downloads for a page, compressed, excluding fonts. GitHub Pages
// serves these gzipped, so measuring the raw bytes overstated every page by three or four
// times and turned a respectable site into six failures.
//
// 2026-09-21, every bar down, and one per page. app.js was split into a shell and a module per
// page, fetched with import() when that page is the one shown, and this gate now follows the
// imports instead of charging every page for every script. Measured: map 73.31, dev 71.80,
// overview 133.59, roadmap 136.15, results 132.21, dashboard 137.76. The map lost 33 KB because
// it had been downloading the charts, the key results and the metric registry to draw none of
// them. Each bar sits about 1.5 KB over its measurement, for atlas.yaml to grow into: it is in
// every page's download and grows with the roadmap, and a content edit should not fail a
// performance gate. How the bars got here is in this file's history.
//
// 2026-09-22, the dashboard bar up by five: it now also fetches data/third-party.json, the
// packages built by others, which no other page reads and so no other page pays for. Measured
// with the file at eleven packages and a year of days each: dashboard 142.
// 2026-09-23, up by six more: fourteen packages in that file, three of them the org-hosted
// exceptions, each with an all-time total, a dependents count and its release dates, and a table
// of its own module that sorts and filters. The roadmap grew for the offsite too. Measured: 149.07.
// 2026-09-24, every bar re-based: atlas.yaml is 18.2 KB compressed, up 2.5 KB in three days of
// roadmap writing, and had used the headroom the bars left it. Measured: map 75.39, dev 73.79,
// overview 135.17, roadmap 138.59, results 133.65, dashboard 150.74; each bar 1.5 KB above.
const BUDGET_KB = { map: 77, dev: 75, overview: 137, roadmap: 140, results: 135, dashboard: 152 };

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

// Tokens as written in the block that declares them, resolved one level of var() indirection.
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
// Where a rule paints no background and none can be traced, these are the surfaces to judge it
// against. --card-elevated is deliberately absent: nothing rests on it, it appears only under a
// cursor or behind a tooltip, and both of those paint their own text white. Where a rule really
// does sit on it, backgroundOf resolves that directly and it is checked properly.
const RESTING_SURFACES = ["bg", "surface", "card"];

// The token values are the WDK design system's and are not Atlas's to change: they are
// byte-identical to the custom properties wdk.tether.io ships. So this gate does not ask
// whether a token is accessible in the abstract. It asks whether a token that cannot carry
// text is being used to carry text, which is a usage bug and fixable without touching the
// palette. --secondary, also part of the system, clears 6:1 on every surface.
function contrastGate() {
  const t = tokens(".wdk-atlas-site {");
  if (!t.bg) return { pass: false, detail: "no colour tokens found in the token block" };

  // Read each rule on its own terms. A rule that paints its own background is judged against
  // that background, which is how dark text on the orange accent stays correct. A rule that
  // does not is judged against every surface it could sit on.
  const rules = cssRules(cssAll);

  // The colour a background declaration actually paints, where that can be worked out:
  // a token, or a colour-mix of a token with another token or with the surface behind it.
  const backgroundOf = (body, behind) => {
    const decl = /background(?:-color)?:\s*([^;]+)/.exec(body);
    if (!decl || /gradient/.test(decl[1])) return null;
    const value = decl[1].trim();
    if (/^transparent$/.test(value)) return behind || null;
    const mix = /^color-mix\(\s*in\s+srgb\s*,\s*var\(--([\w-]+)\)\s+([\d.]+)%\s*,\s*(transparent|var\(--([\w-]+)\))\s*\)$/.exec(value);
    if (mix) {
      const top = t[mix[1]];
      const under = mix[3] === "transparent" ? behind : t[mix[4]];
      if (!top || !under) return null;
      const ratio = Number(mix[2]) / 100;
      return top.map((c, i) => Math.round(c * ratio + under[i] * (1 - ratio)));
    }
    const plain = /^var\(--([\w-]+)\)$/.exec(value);
    return plain && t[plain[1]] ? t[plain[1]] : null;
  };

  // A nested rule such as `.drawer a:hover` paints no background of its own, so look for the
  // rule that styles the leading class and use whatever that paints.
  const ancestorBackground = (selector) => {
    const lead = /^\.([\w-]+)/.exec(selector);
    if (!lead) return null;
    const owner = rules.find((r) => r.selector === `.${lead[1]}`);
    return owner ? backgroundOf(owner.body, null) : null;
  };

  const failures = new Map();
  for (const { selector, body } of rules) {
    // SVG paints text with fill, not color, so a chart label is invisible to a check that only
    // looks for one of them. Anything with a font declared alongside its fill is text.
    const fg = /(?:^|[;\s])color:\s*var\(--([\w-]+)\)/.exec(body)
      || (/font(?:-family|-size)?:/.test(body) ? /(?:^|[;\s])fill:\s*var\(--([\w-]+)\)/.exec(body) : null);
    if (!fg || !t[fg[1]]) continue;
    if (/::(?:before|after|placeholder)/.test(selector)) continue; // decoration, not body text
    const own = backgroundOf(body, null) || ancestorBackground(selector);
    // Named surfaces where one is known, so the report can say which; otherwise the resolved
    // colour on its own, and failing both, every surface the element could sit on.
    const against = own
      ? [{ name: own === t[fg[1]] ? "its own colour" : "its background", rgb: own }]
      : RESTING_SURFACES.filter((s) => t[s]).map((s) => ({ name: `--${s}`, rgb: t[s] }));
    for (const surface of against) {
      const ratio = contrast(t[fg[1]], surface.rgb);
      if (ratio >= MIN_CONTRAST) continue;
      const key = `${fg[1]}|${surface.name}|${selector}`;
      if (!failures.has(key)) failures.set(key, { fg: fg[1], surface: surface.name, ratio, where: selector.split(",")[0].trim() });
    }
  }
  const worst = (name) => Math.min(...SURFACE_TOKENS.filter((s) => t[s]).map((s) => contrast(t[name], t[s])));
  const spare = Object.keys(t).find((n) => /secondary|text-muted/.test(n) && worst(n) >= MIN_CONTRAST);

  // One line per colour pair, with how many rules hit it and one of them as an example, so the
  // report reads as a worklist rather than as a wall of the same fault repeated.
  const grouped = new Map();
  for (const f of failures.values()) {
    const key = `${f.fg}|${f.surface}`;
    const seen = grouped.get(key);
    if (seen) { seen.rules.add(f.where); continue; }
    grouped.set(key, { ...f, rules: new Set([f.where]) });
  }
  const list = [...grouped.values()].sort((a, b) => a.ratio - b.ratio);
  return {
    pass: list.length === 0,
    detail: list.length
      ? list.map((f) => `--${f.fg} on ${f.surface} is ${f.ratio.toFixed(2)}:1 in ${f.rules.size} rule${f.rules.size === 1 ? "" : "s"} (${[...f.rules][0]})`).join("; ")
      : `every colour used for text clears ${MIN_CONTRAST}:1 where it is used`,
    note: list.length && spare ? `--${spare} is in the design system and clears ${worst(spare).toFixed(1)}:1` : "",
  };
}

// A chart is drawn in a 520-unit box and displayed at about 366 pixels, so everything inside it
// reaches the reader around 0.7 of its declared size. Measured in a browser, 2026-09-20.
const CHART_SCALE = 366 / 520;

function fontFloorGate() {
  const small = [];
  // Read the stylesheet rule by rule so a size is attributed to the selector that declares it.
  for (const { selector, body } of cssRules(cssAll)) {
    const inChart = /(^|[\s,>])\.chart(?![\w-])/.test(selector);
    for (const m of body.matchAll(/font(?:-size)?:[^;]*?([\d.]+)px/g)) {
      const declared = Number(m[1]);
      const seen = inChart ? declared * CHART_SCALE : declared;
      if (seen >= MIN_FONT_PX) continue;
      small.push(`${selector.split(",")[0].trim()}: ${declared}px${inChart ? ` in drawing units, seen as ${seen.toFixed(1)}px` : ""}`);
    }
  }
  for (const m of js.matchAll(/font-size:\s*([\d.]+)px/g)) {
    if (Number(m[1]) < MIN_FONT_PX) small.push(`script: ${m[1]}px`);
  }
  for (const m of js.matchAll(/font-size="([\d.]+)"/g)) {
    if (Number(m[1]) < MIN_FONT_PX) small.push(`script: ${m[1]}px in SVG`);
  }
  const unique = [...new Set(small)];
  return { pass: unique.length === 0, detail: unique.length ? unique.join(", ") : `nothing below ${MIN_FONT_PX}px` };
}

const gz = (rel) => (existsSync(join(ROOT, rel)) ? gzipSync(readFileSync(join(ROOT, rel)), { level: 9 }).length : 0);

function pageWeightGate() {
  // What every page fetches whatever it shows, then, per page, the scripts that page reaches:
  // the two entry points, the module app.js fetches for it with import(), and everything those
  // import in turn. The map is no longer charged for the charts it never downloads.
  const fixed = gz("index.html") + gz("page.css") + gz("styles.css") + gz("vendor/js-yaml.min.js") + gz("atlas.yaml");
  const scriptsFor = (page) => importClosure(["site.js", "app.js", pageModule(page)]).reduce((n, rel) => n + gz(rel), 0);
  const metrics = gz("data/metrics.json");
  const summary = gz("data/summary.json");
  // The third-party packages are the Dashboard's alone, and the Dashboard alone pays for them.
  const thirdParty = gz("data/third-party.json");
  // Only the Map and Developer Resources can be served by the small file; every other page
  // reads the series, the snapshots or the per-repo readiness facts.
  const lightPages = ["map", "dev"];
  const rows = [];
  for (const [page, budget] of Object.entries(BUDGET_KB)) {
    const data = (lightPages.includes(page) && summary ? summary : metrics) + (page === "dashboard" ? thirdParty : 0);
    const total = (fixed + scriptsFor(page) + data) / KB;
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
  // A module script is deferred by definition. The word boundary has to go before the attribute
  // only: `type="module"` ends in a quote, so a trailing \b would never match.
  const blocking = [...html.matchAll(/<script(?![^>]*\b(?:defer|async)\b)(?![^>]*type="module")[^>]*src=/g)].length;
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

// ---------------------------------------------------------------- the asset version
// index.html carries ?v=N on the two stylesheets and on site.js, which hands it to app.js, which
// puts it on atlas.yaml. The modules under src/ and lib/ are imported by name and carry no
// version, so for them the number only records that a release happened; GitHub Pages keeps a
// copy for ten minutes either way. A change to any of these that does not move the number
// leaves a returning reader on the copy they already have. That is not theoretical: f01208e shipped an atlas.yaml written to take
// people's names out of the published data and left the version where it was.
//
// Answering this needs the history, not the files, so the gate runs git. Where there is no
// history to read it reports "not run" rather than passing.
// Files, and the two folders the script now mostly lives in. A change under src/ or lib/ with
// no bump used to pass: the gate was watching 2 of 22 shipped scripts.
const VERSIONED = ["site.js", "app.js", "src", "lib", "styles.css", "page.css", "atlas.yaml"];

const git = (args) => {
  try {
    return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch { return null; }
};
const versionIn = (text) => (/\bsite\.js\?v=(\d+)/.exec(text || "") || /\bapp\.js\?v=(\d+)/.exec(text || "") || [])[1] || null; // app.js: revisions from before site.js existed

function assetVersionGate() {
  if (git(["rev-parse", "--is-inside-work-tree"]) !== "true") return { skipped: true, detail: "no git history here, so the version cannot be compared with anything" };
  const current = versionIn(html);
  if (!current) return { pass: false, detail: "index.html does not carry ?v=N on site.js" };

  // Every copy of the version has to agree, or the reader gets a fresh script against a cached
  // stylesheet. examples/embed.html loads both from the same folder and counts as a copy.
  const disagree = [];
  for (const rel of ["index.html", "examples/embed.html"]) {
    const text = read(rel);
    if (!text) continue;
    for (const m of text.matchAll(/(?:site\.js|app\.js|styles\.css|page\.css)\?v=(\d+)/g)) {
      if (m[1] !== current) disagree.push(`${rel} has ?v=${m[1]}`);
    }
  }
  if (disagree.length) return { pass: false, detail: `the version is not the same everywhere: ${[...new Set(disagree)].join(", ")} against ?v=${current}` };

  // Uncommitted work first: what is on disk is what the next commit ships.
  // Names only, from the two commands that print nothing else. Parsing `status --porcelain` cut
  // a letter off the first file: git() trims, the first line lost its leading space, slice(3)
  // took one character too many, and a lone edit to app.js was never seen.
  const dirty = new Set([...(git(["diff", "--name-only", "HEAD"]) || "").split("\n"), ...(git(["ls-files", "--others", "--exclude-standard"]) || "").split("\n")].filter(Boolean));
  const covered = (rel) => VERSIONED.some((v) => rel === v || rel.startsWith(`${v}/`));
  const touched = [...dirty].filter(covered);
  if (touched.length && !dirty.has("index.html")) {
    return { pass: false, detail: `${touched.join(", ")} changed in the working tree and index.html still says ?v=${current}` };
  }

  // A version that differs from the committed one is a bump in the working tree, and it covers
  // everything else uncommitted beside it.
  const atHead = versionIn(git(["show", "HEAD:index.html"]));
  if (atHead && atHead !== current) return { pass: true, detail: `?v=${current} is a bump in the working tree, up from ?v=${atHead}` };

  // The commit that last moved the version: walk index.html's history newest first and stop at
  // the first revision carrying a different number. The one after it is the bump.
  const history = (git(["log", "--format=%H", "--", "index.html"]) || "").split("\n").filter(Boolean);
  let bump = null;
  for (const sha of history) {
    if (versionIn(git(["show", `${sha}:index.html`])) !== current) break;
    bump = sha;
  }
  if (!bump) return { skipped: true, detail: `?v=${current} was never committed, so there is no bump to compare against` };

  const stale = [];
  for (const rel of VERSIONED) {
    const last = git(["log", "-1", "--format=%H", "--", rel]);
    if (!last || last === bump) continue;
    // An ancestor of the bump changed before it, which is what we want.
    const before = git(["merge-base", "--is-ancestor", last, bump]) !== null;
    if (!before) stale.push(`${rel} (${last.slice(0, 7)})`);
  }
  return {
    pass: stale.length === 0,
    detail: stale.length
      ? `changed after ?v=${current} was set in ${bump.slice(0, 7)}: ${stale.join(", ")} — bump the suffixes in index.html and examples/embed.html`
      : `?v=${current} is newer than every file it busts`,
  };
}

const has = (source, re) => re.test(source);

// ---------------------------------------------------------------- gates
const GATES = [
  { id: "P1.1", what: "each page sets its own title and description",
    run: () => {
      const problems = [];
      if (!has(js, /document\.title\s*=/)) problems.push("no page sets document.title");
      if (!has(html, /<meta\s+name="description"/i)) problems.push("index.html has no meta description");
      // The tag being there says nothing about each page setting its own, which is the gate's name.
      if (!has(js, /setAttribute\("content",\s*pageDescriptions\[page\]\)/)) problems.push("the description is never set per page");
      const described = (/const pageDescriptions = \{([\s\S]*?)\n\s*\};/.exec(js) || ["", ""])[1];
      const missing = ["overview", "roadmap", "results", "dashboard", "map", "dev"].filter((p) => !new RegExp(`\\b${p}:\\s*"[^"]{20,}"`).test(described));
      if (missing.length) problems.push(`no description for ${missing.join(", ")}`);
      return { pass: problems.length === 0, detail: problems.join("; ") || "title and description are set per page" };
    } },
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
    run: () => {
      // The re-inked tokens are one print block and always there, so the word alone proved
      // nothing: the whole print stylesheet could be deleted under it. Rules have to be inside.
      const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");
      const inside = []; // the text between the braces of each @media print, and nothing after it
      for (const m of bare.matchAll(/@media\s+print\s*\{/g)) {
        let depth = 1, i = m.index + m[0].length;
        const from = i;
        for (; i < bare.length && depth > 0; i += 1) depth += bare[i] === "{" ? 1 : bare[i] === "}" ? -1 : 0;
        inside.push(bare.slice(from, i - 1));
      }
      const printed = cssRules(inside.join("\n")).filter((r) => !/^\.wdk-atlas(?:-site)?(?:\s*,\s*\.wdk-atlas(?:-site)?)*$/.test(r.selector));
      const hidesControls = inside.some((block) => /display:\s*none/.test(block));
      return { pass: printed.length > 3 && hidesControls, detail: printed.length > 3 && hidesControls ? `a print stylesheet of ${printed.length} rules` : "no print rules beyond the re-inked tokens" };
    } },
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
      const bare = css.replace(/\/\*[\s\S]*?\*\//g, ""); // a comment's asterisk used to count as the rule
      const blocks = (bare.match(/@media\s*\(prefers-reduced-motion/g) || []).length;
      const globalRule = /@media\s*\(prefers-reduced-motion[^{]*\{\s*\*\s*,/.test(bare);
      return { pass: blocks > 0 && globalRule, detail: globalRule ? "a global rule disables motion" : `${blocks} reduced-motion block(s), none of them global` };
    } },
  { id: "P3.3", what: "no information lives only in a title attribute",
    run: () => {
      // "title" is also an ordinary data key in this codebase, for page headings and for a
      // module's own title, so counting the word alone overstated the problem by a third.
      // Only a title passed to el() as an attribute becomes a tooltip nobody can reach by
      // touch or keyboard, and an empty one shows nothing at all.
      // A title only becomes a tooltip when it is handed to el() beside other attributes, so a
      // line is counted when it also carries class, href, type or an aria- attribute. A plain
      // object with a title field, such as a page heading or a stand-in north star, is data.
      // File by file, so a finding names a line someone can open: read as one text, it reported
      // "app.js line 2123" for a file of 395.
      const found = [];
      for (const rel of shippedScripts()) {
        const lines = read(rel).split("\n");
        lines.forEach((line, i) => {
          const inline = /\btitle:\s*(?!null\b|"")/.test(line) && /\bel\(|class:|href:|aria-/.test(line);
          // The attribute on a line of its own, inside an el( call opened just above.
          const ownLine = /^\s*title:\s*(?!null\b|"")/.test(line) && lines.slice(Math.max(0, i - 3), i).some((l) => /\b(?:el|svgEl)\([^)]*\{\s*$/.test(l));
          const assigned = /(?<!document)\.title\s*=(?!=)|setAttribute\(\s*["']title["']/.test(line);
          if (inline || ownLine || assigned) found.push(`${rel}:${i + 1}`);
        });
      }
      return { pass: found.length === 0, detail: found.length ? `${found.length} tooltip(s) unreachable by touch or keyboard: ${found.join(", ")}` : "nothing depends on a title attribute" };
    } },
  { id: "P5.2", what: "links built from data are scheme-checked",
    // Where el() sets the attribute, not anywhere in the file: the name survives in its own
    // definition, so the guard could be unhooked and the old pattern still found the word.
    run: () => ({ pass: has(js, /key === "href"[^\n]*\{\s*const safe = safeHref\(value\);\s*if \(safe\) node\.setAttribute\(key, safe\);/), detail: "el() sets href without passing it through safeHref" }) },
  { id: "P5.3", what: "nothing is built with innerHTML",
    run: () => {
      const count = (js.match(/\.innerHTML\s*=/g) || []).length;
      return { pass: count === 0, detail: count ? `${count} innerHTML assignment(s) in app.js` : "no innerHTML assignments" };
    } },
  { id: "P5.4", what: "the content security policy stays strict",
    run: () => {
      const policy = (/http-equiv="Content-Security-Policy"[\s\S]*?content="([^"]+)"/i.exec(html) || [])[1] || "";
      if (!policy) return { pass: false, detail: "no content security policy found in index.html" };
      const problems = [];
      for (const required of ["default-src 'none'", "script-src 'self'", "object-src 'none'", "base-uri 'self'"]) {
        if (!policy.includes(required)) problems.push(`missing ${required}`);
      }
      for (const loosened of ["'unsafe-inline'", "'unsafe-eval'", "*"]) {
        if (policy.includes(loosened)) problems.push(`loosened by ${loosened}`);
      }
      // Trusted Types is only demanded once nothing assigns markup, which is gate P5.3.
      const noMarkupSinks = !/\.innerHTML\s*=/.test(js);
      if (noMarkupSinks && !policy.includes("require-trusted-types-for 'script'")) problems.push("nothing assigns markup any more, so require-trusted-types-for 'script' should be set");
      return { pass: problems.length === 0, detail: problems.length ? problems.join("; ") : "strict, with trusted types required" };
    } },
  { id: "P5.5", what: "data-driven style values are clamped",
    run: () => {
      const raw = [...js.matchAll(/(?<![-\w])(?:width|height|left|right|top|bottom)\s*:\s*\$\{(?!clamp|pct|Math)[^}]+\}/g)].map((m) => m[0]);
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
  { id: "P7.1", what: "the script leaks no globals",
    run: () => {
      // A module has its own scope, so nothing it declares reaches a host page. What would
      // leak is an explicit assignment to window or globalThis.
      const site = read("site.js");
      const isModule = /<script[^>]*type="module"[^>]*site\.js/.test(html) && /import\(`\.\/app\.js/.test(site);
      const assigns = [...js.matchAll(/\b(?:window|globalThis)\.([\w$]+)\s*=/g)].map((m) => m[1]);
      const problems = [];
      if (!isModule) problems.push("index.html does not load site.js as a module, or site.js does not import app.js");
      if (assigns.length) problems.push(`assigns to ${[...new Set(assigns)].join(", ")}`);
      return { pass: problems.length === 0, detail: problems.join("; ") || "modules, and nothing is written to the global object" };
    } },
  { id: "P7.2", what: "styling cannot reach a host page",
    run: () => {
      // styles.css follows Atlas into every page that embeds it, so what it may say at the top
      // level is a short list: the fonts, the keyframes (prefixed, because their names are
      // global), the tokens, and the .wdk-atlas root that everything else is nested inside.
      // This used to look for html, body and bare elements; it passed while .search, .nav and
      // .legend sat at the top level, which a host is as likely to be using as we are.
      if (!read("page.css")) return { pass: false, detail: "page.css is missing, so the site's own rules have nowhere to live but styles.css" };
      const source = css.replace(/\/\*[\s\S]*?\*\//g, "");
      const top = []; // [selector, body] of every top-level block
      let depth = 0, start = 0, open = 0;
      for (let i = 0; i < source.length; i += 1) {
        if (source[i] === "{") { if (depth === 0) { top.push([source.slice(start, i).trim().replace(/\s+/g, " "), ""]); open = i + 1; } depth += 1; }
        else if (source[i] === "}") { depth -= 1; if (depth === 0) { top[top.length - 1][1] = source.slice(open, i); start = i + 1; } }
      }
      const isRoot = (sel) => sel.split(",").every((one) => /^\.wdk-atlas(?:-site)?$/.test(one.trim()));
      const allowed = (sel) => sel === "@font-face" || /^@keyframes wdk-atlas-[\w-]+$/.test(sel) || sel === "@media print" || isRoot(sel);
      const stray = top.map(([sel]) => sel).filter((sel) => !allowed(sel));
      // The print block at the top level re-inks the tokens and does nothing else.
      for (const [sel, body] of top) {
        if (sel !== "@media print") continue;
        for (const m of body.matchAll(/([^{}]+)\{[^{}]*\}/g)) if (!isRoot(m[1].trim().replace(/\s+/g, " "))) stray.push(`@media print { ${m[1].trim()} }`);
      }
      if (/:root\b/.test(source)) stray.push(":root");
      return { pass: stray.length === 0, detail: stray.length ? `${stray.length} rule(s) in styles.css sit outside Atlas's root: ${stray.slice(0, 6).join(" · ")}` : "every rule in styles.css is nested inside .wdk-atlas" };
    } },
  { id: "P7.3", what: "the data path is configurable",
    run: () => ({ pass: /import\.meta\.url/.test(js) && /searchParams\.get\("base"\)/.test(js),
      detail: "data is not resolved against this module with a base that can be overridden" }) },
  { id: "P7.5", what: "an embedding page needs one script tag",
    run: () => {
      const example = read("examples/embed.html");
      const problems = [];
      if (!example) problems.push("examples/embed.html is missing");
      else {
        if (example.includes("page.css")) problems.push("the example loads page.css, which belongs to this site alone");
        const tags = [...example.matchAll(/<script[^>]*src="([^"]+)"/g)].map((m) => m[1]);
        if (tags.length !== 1) problems.push(`the example loads ${tags.length} scripts; one is the point`);
        if (!/export function mount\(/.test(entry)) problems.push("app.js does not export mount()");
        // What mount() promises a host: nothing looked up by id, nothing hung on the body, and
        // the address left alone unless the host said otherwise.
        if (/getElementById\(|querySelector(?:All)?\(\s*["'`]#/.test(guest)) problems.push("app.js looks something up by id, which a second instance or a host page could also own");
        if (/document\.(?:body|documentElement)\.(?:classList|className|style|setAttribute|dataset)/.test(guest)) problems.push("a class, a style or an attribute is put on the host's body or root element");
        const writes = guest.split("\n").filter((l) => /history\.(?:replace|push)State|location\.(?:href|hash|search|pathname)\s*=|location\.(?:assign|replace|reload)\(/.test(l));
        const guarded = guest.includes("if (!syncUrl) return;") && guest.includes("if (syncUrl) { location.href = href; return; }");
        if (writes.length !== 2 || !guarded) problems.push("app.js writes to the address somewhere that is not behind syncUrl");
        if (!existsSync(join(ROOT, "examples/mount.html"))) problems.push("examples/mount.html, the programmatic example, is missing");
      }
      return { pass: problems.length === 0, detail: problems.join("; ") || "one script tag, its own markup, and no page-level styling" };
    } },
  { id: "P7.6", what: "the README says how to embed it",
    run: () => {
      const readme = read("README.md");
      return { pass: /##\s*Embed/i.test(readme), detail: "the README has no section on embedding Atlas in another site" };
    } },
  { id: "P4.8", what: "the repo says how to work in it",
    run: () => {
      // No package.json here by design, so the conventions have nowhere else to live.
      const missing = [".editorconfig", ".nvmrc", "CONTRIBUTING.md", ".github/pull_request_template.md"]
        .filter((rel) => !existsSync(join(ROOT, rel)));
      return { pass: missing.length === 0, detail: missing.length ? `missing ${missing.join(", ")}` : "editor, Node version, contributing guide and pull request template" };
    } },
  { id: "P4.9", what: "the asset version moves when a cached file does", run: assetVersionGate },
  { id: "P6.1", what: "nothing blocks the first paint", run: fontPreloadGate },
  { id: "P6.3", what: "pages stay inside their weight budget, compressed", run: pageWeightGate },
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
      console.log(`${r.id.padEnd(6)} ${r.skipped ? "not run" : r.pass ? "pass" : "fail"}  ${r.what}`);
      if (r.skipped || !r.pass || r.note) console.log(`       ${r.detail}${r.note ? ` · ${r.note}` : ""}`);
    }
    const skipped = results.filter((r) => r.skipped).length;
    const failed = results.filter((r) => !r.skipped && !r.pass).length;
    const ran = results.length - skipped;
    console.log(`\n${ran - failed} of ${ran} static gates pass${skipped ? `, ${skipped} not run` : ""}`);
  }
  process.exit(results.some((r) => !r.skipped && !r.pass) ? 1 : 0);
}
