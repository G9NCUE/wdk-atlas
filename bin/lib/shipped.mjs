// The scripts a browser can be sent, and which of them one page actually asks for. The gates
// used to read app.js and call that "the script"; it is now a shell over src/, so they read the
// lot, and the weight gate follows the imports the way a browser does.
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname, normalize } from "node:path";
import { ROOT } from "./load-atlas.mjs";

const walk = (rel) => (existsSync(join(ROOT, rel)) ? readdirSync(join(ROOT, rel), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(rel, e.name)) : e.name.endsWith(".mjs") ? [join(rel, e.name)] : [])) : []);

/** Every script the site can serve, entry points first. lib/ too: the pages import it, so the
 *  browser fetches it, and a gate that skipped it passed an innerHTML written there. */
export const shippedScripts = () => ["app.js", "site.js", ...walk("src").sort(), ...walk("lib").sort()].filter((rel) => existsSync(join(ROOT, rel)));

/** All of them as one text, each preceded by its path, for the gates that read the source.
 *  guestOnly leaves out site.js, which is this site's furniture and never enters a host page. */
export const shippedSource = ({ guestOnly = false } = {}) => shippedScripts().filter((rel) => !guestOnly || rel !== "site.js").map((rel) => `// ==== ${rel}\n${readFileSync(join(ROOT, rel), "utf8")}`).join("\n");

/** Where a page's own module lives. app.js imports these with import(), one per page. */
export const pageModule = (page) => `src/pages/${page}.mjs`;

/**
 * Everything reached from `entries` by static import, entries included. Dynamic import() is not
 * followed: that is the point of it, and the caller names the page module it wants counted.
 */
export function importClosure(entries) {
  const seen = new Set();
  const visit = (rel) => {
    const file = normalize(rel.replace(/[?#].*$/, "")); // a versioned specifier is still that file
    if (seen.has(file)) return;
    // Loudly. Skipping what could not be found weighed a page without its own module when the
    // file was renamed, and answered a smaller number rather than an error.
    if (!existsSync(join(ROOT, file))) throw new Error(`${file} is imported but is not there`);
    seen.add(file);
    const text = readFileSync(join(ROOT, file), "utf8");
    // import … from, export … from, and the bare import "x" that names nothing.
    for (const m of text.matchAll(/^\s*(?:import|export)\s[^"'()]*?from\s*["'](\.{1,2}\/[^"']+)["']|^\s*import\s*["'](\.{1,2}\/[^"']+)["']/gm)) visit(join(dirname(file), m[1] || m[2]));
  };
  entries.forEach(visit);
  return [...seen];
}
