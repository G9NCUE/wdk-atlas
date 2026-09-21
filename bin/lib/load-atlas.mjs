// Loads atlas.yaml with the YAML parser the site already ships in vendor/, so the scripts need
// no package.json. The parser is a browser bundle: it runs in a bare vm context and leaves
// `jsyaml` behind. One copy of this trick, shared by every script in bin/.
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

let parser = null;
function yaml() {
  if (!parser) {
    const ctx = {};
    createContext(ctx);
    runInContext(readFileSync(join(ROOT, "vendor/js-yaml.min.js"), "utf8"), ctx);
    parser = ctx.jsyaml;
  }
  return parser;
}

export function readAtlasText() {
  return readFileSync(join(ROOT, "atlas.yaml"), "utf8");
}

export function parseAtlas(text) {
  return yaml().load(text);
}

export function loadAtlas() {
  return parseAtlas(readAtlasText());
}
