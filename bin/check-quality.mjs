#!/usr/bin/env node
// The static half of the quality bar: everything that can be decided by reading the files.
// Contrast, type sizes, link handling, page weight, the vendored parser, the head tags a
// shared link needs. Anything that needs a real browser is checked elsewhere and is not
// silently assumed to pass here.
//
// Usage: node bin/check-quality.mjs [--json]
// Prints one line per gate, ids from the product spec, and exits 1 if any gate fails.
import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { gzipSync } from "node:zlib";
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
const BUDGET_KB = { map: 100, dev: 100, overview: 140, roadmap: 140, results: 140, dashboard: 140 };

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
  const t = tokens(":root {");
  if (!t.bg) return { pass: false, detail: "no colour tokens found in the :root block" };

  // Read each rule on its own terms. A rule that paints its own background is judged against
  // that background, which is how dark text on the orange accent stays correct. A rule that
  // does not is judged against every surface it could sit on.
  const source = css.replace(/\/\*[\s\S]*?\*\//g, ""); // comments would otherwise read as selectors
  const rules = [...source.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({ selector: selector.trim(), body }));

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
    const painted = /(?:^|[;\s])color:\s*var\(--([\w-]+)\)/.exec(body)
      || (/font(?:-family|-size)?:/.test(body) ? /(?:^|[;\s])fill:\s*var\(--([\w-]+)\)/.exec(body) : null);
    const fg = painted;
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
  for (const [, selector, body] of css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const inChart = /(^|[\s,>])\.chart(?![\w-])/.test(selector);
    for (const m of body.matchAll(/font(?:-size)?:[^;]*?([\d.]+)px/g)) {
      const declared = Number(m[1]);
      const seen = inChart ? declared * CHART_SCALE : declared;
      if (seen >= MIN_FONT_PX) continue;
      small.push(`styles.css ${selector.trim().split(",")[0].trim()}: ${declared}px${inChart ? ` in drawing units, seen as ${seen.toFixed(1)}px` : ""}`);
    }
  }
  for (const source of [["app.js", js]]) {
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

const gz = (rel) => (existsSync(join(ROOT, rel)) ? gzipSync(readFileSync(join(ROOT, rel)), { level: 9 }).length : 0);

function pageWeightGate() {
  const shell = gz("index.html") + gz("styles.css") + gz("app.js") + gz("vendor/js-yaml.min.js") + gz("atlas.yaml");
  const metrics = gz("data/metrics.json");
  const summary = gz("data/summary.json");
  // Only the Map and Developer Resources can be served by the small file; every other page
  // reads the series, the snapshots or the per-repo readiness facts.
  const lightPages = ["map", "dev"];
  const rows = [];
  for (const [page, budget] of Object.entries(BUDGET_KB)) {
    const data = lightPages.includes(page) && summary ? summary : metrics;
    const total = (shell + data) / KB;
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
      // "title" is also an ordinary data key in this codebase, for page headings and for a
      // module's own title, so counting the word alone overstated the problem by a third.
      // Only a title passed to el() as an attribute becomes a tooltip nobody can reach by
      // touch or keyboard, and an empty one shows nothing at all.
      // A title only becomes a tooltip when it is handed to el() beside other attributes, so a
      // line is counted when it also carries class, href, type or an aria- attribute. A plain
      // object with a title field, such as a page heading or a stand-in north star, is data.
      const found = js.split("\n")
        .map((line, i) => ({ line, n: i + 1 }))
        .filter(({ line }) => /\btitle:\s*(?!null\b)/.test(line))
        .filter(({ line }) => !/\btitle:\s*""/.test(line))
        .filter(({ line }) => /\bel\(|class:|href:|aria-/.test(line));
      return { pass: found.length === 0, detail: found.length ? `${found.length} tooltip(s) unreachable by touch or keyboard, at app.js lines ${found.map((f) => f.n).join(", ")}` : "nothing depends on a title attribute" };
    } },
  { id: "P5.2", what: "links built from data are scheme-checked",
    run: () => ({ pass: has(js, /safeHref|isHttps|allowedScheme/), detail: "no scheme allow-list guards href values" }) },
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
  { id: "P7.1", what: "the script leaks no globals",
    run: () => {
      // A module has its own scope, so nothing it declares reaches a host page. What would
      // leak is an explicit assignment to window or globalThis.
      const isModule = /<script[^>]*type="module"[^>]*app\.js/.test(html);
      const assigns = [...js.matchAll(/\b(?:window|globalThis)\.([\w$]+)\s*=/g)].map((m) => m[1]);
      const problems = [];
      if (!isModule) problems.push("app.js is not loaded as a module, so everything it declares is global");
      if (assigns.length) problems.push(`assigns to ${[...new Set(assigns)].join(", ")}`);
      return { pass: problems.length === 0, detail: problems.join("; ") || "a module, and nothing is written to the global object" };
    } },
  { id: "P7.2", what: "styling cannot reach a host page",
    run: () => {
      // Rules for a whole page belong in page.css, which only this site loads. Anything in
      // styles.css that selects html, body or a bare element would follow Atlas into a host.
      const page = read("page.css");
      if (!page) return { pass: false, detail: "page.css is missing, so the page-level rules are still in styles.css" };
      const source = css.replace(/\/\*[\s\S]*?\*\//g, "");
      const bleeding = [];
      for (const [, selector] of source.matchAll(/([^{}]+)\{[^{}]*\}/g)) {
        for (const one of selector.split(",")) {
          const sel = one.trim();
          if (!sel || sel.startsWith("@") || sel.startsWith("%")) continue;
          if (/^(?:html|body|\*)\b(?![\w-])/.test(sel)) { bleeding.push(sel); continue; }
          // A bare element selector with no class anywhere in it restyles the host's own markup.
          if (/^[a-z][a-z0-9]*(?:\s*[,>+~]\s*[a-z][a-z0-9]*)*$/i.test(sel) && !/[.#\[]/.test(sel)) bleeding.push(sel);
        }
      }
      const unique = [...new Set(bleeding)];
      return { pass: unique.length === 0, detail: unique.length ? `${unique.length} rule(s) in styles.css reach past Atlas: ${unique.slice(0, 6).join(", ")}` : "every rule in styles.css is reached through Atlas's own root" };
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
        if (!/function mount\(/.test(js)) problems.push("app.js does not build its own markup when a page has none");
      }
      return { pass: problems.length === 0, detail: problems.join("; ") || "one script tag, its own markup, and no page-level styling" };
    } },
  { id: "P7.6", what: "the README says how to embed it",
    run: () => {
      const readme = read("README.md");
      return { pass: /##\s*Embed/i.test(readme), detail: "the README has no section on embedding Atlas in another site" };
    } },
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
      console.log(`${r.id.padEnd(6)} ${r.pass ? "pass" : "fail"}  ${r.what}`);
      if (!r.pass || r.note) console.log(`       ${r.detail}${r.note ? ` · ${r.note}` : ""}`);
    }
    const failed = results.filter((r) => !r.pass).length;
    console.log(`\n${results.length - failed} of ${results.length} static gates pass`);
  }
  process.exit(results.some((r) => !r.pass) ? 1 : 0);
}
