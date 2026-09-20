// app.js is still one classic browser script, so it cannot be imported here yet. Until it is
// split into modules, the test lifts the function out of the source and runs it. The regex
// fails loudly if the function is renamed or reshaped, which is the behaviour we want: a test
// that quietly stops testing is worse than one that breaks.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../bin/lib/load-atlas.mjs";

const source = readFileSync(join(ROOT, "app.js"), "utf8");
const match = /function safeHref\(value\) \{[\s\S]*?\n\}/.exec(source);
assert.ok(match, "safeHref was not found in app.js; update this test with it");
const safeHref = new Function(`${match[0]}; return safeHref;`)();

test("keeps https addresses", () => {
  for (const href of [
    "https://github.com/tetherto/wdk",
    "https://docs.wallet.tether.io/guide",
    "HTTPS://EXAMPLE.COM/x",
  ]) assert.equal(safeHref(href), href.trim());
});

test("keeps addresses that stay on this site", () => {
  for (const href of [
    "./?page=roadmap#signers",
    "./?page=results#stable",
    "../sibling",
    "/absolute",
    "#anchor",
    "?range=weekly",
  ]) assert.equal(safeHref(href), href);
});

test("refuses anything that could run code", () => {
  for (const href of [
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    "  javascript:alert(1)  ",
    "java\tscript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "blob:https://example.com/abc",
  ]) assert.equal(safeHref(href), null, `${href} should be refused`);
});

test("refuses plain http and protocol-relative addresses", () => {
  // http would downgrade the connection; // borrows this page's scheme to reach another host.
  for (const href of ["http://example.com", "//evil.example.com/x"]) {
    assert.equal(safeHref(href), null, `${href} should be refused`);
  }
});

test("refuses an address with whitespace inside it", () => {
  assert.equal(safeHref("https://example.com/a b"), null);
});

test("trims an https address rather than refusing it", () => {
  assert.equal(safeHref("  https://example.com/x  "), "https://example.com/x");
});
