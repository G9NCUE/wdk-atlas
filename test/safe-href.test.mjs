// safeHref decides which addresses from atlas.yaml are allowed to become links. It lives in
// src/dom.mjs, which touches the document only when it is called, so Node can import the real
// function. This test used to lift it out of app.js with a regular expression and eval it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { safeHref } from "../src/dom.mjs";

test("keeps https addresses", () => {
  for (const href of [
    "https://github.com/tetherto/wdk",
    "https://docs.wallet.tether.io/guide",
    "HTTPS://EXAMPLE.COM/x",
  ]) assert.equal(safeHref(href), href);
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
