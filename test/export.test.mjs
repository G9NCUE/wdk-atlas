// An export is a promise that a stranger can check our arithmetic, so the two things that
// matter are that the numbers survive the trip and that the definition travels with them.
// The quoting cases below are the ones that would quietly corrupt a file rather than fail.
import { test } from "node:test";
import assert from "node:assert/strict";
import { csvField, toCsv, metricCsv, metricJson, fileName } from "../lib/export.mjs";

const def = {
  id: "downloads",
  label: "npm downloads",
  question: "Did anyone choose to install WDK?",
  definition: 'Downloads, summed. Counts "every" tarball fetch, comma and all',
  source: "npm registry",
  window: "last complete period",
  decision: "Which packages to invest in next.",
  canFall: true,
};
const meta = { title: "npm downloads per week", collected: "2026-09-19", scope: "39 packages" };

test("leaves a plain field alone and quotes only what needs it", () => {
  assert.equal(csvField("2026-W37"), "2026-W37");
  assert.equal(csvField(61000), "61000");
  assert.equal(csvField("a,b"), '"a,b"');
  assert.equal(csvField('say "hi"'), '"say ""hi"""');
  assert.equal(csvField("line\nbreak"), '"line\nbreak"');
});

test("an empty cell and a missing cell are both empty, never the word undefined", () => {
  assert.equal(csvField(null), "");
  assert.equal(csvField(undefined), "");
  assert.equal(csvField(""), "");
  assert.equal(csvField(0), "0", "zero is a number, not an absence");
});

test("rows join with CRLF, which is what a .csv is expected to use", () => {
  assert.equal(toCsv([["a", "b"], ["c", "d"]]), "a,b\r\nc,d");
});

test("the definition travels with the data, ahead of it", () => {
  const csv = metricCsv(def, meta, ["period", "downloads"], [["2026-W37", 61000]]);
  const lines = csv.split("\r\n");
  assert.equal(lines[0], "metric,npm downloads");
  assert.ok(csv.includes("last complete period"), "the window is in the file");
  assert.ok(csv.includes("npm registry"), "the source is in the file");
  assert.ok(lines.includes("period,downloads"), "the data header survives");
  assert.ok(lines.includes("2026-W37,61000"), "the data survives");
});

test("a definition containing a comma and a quote does not break the file", () => {
  const csv = metricCsv(def, meta, ["a"], [["1"]]);
  const defLine = csv.split("\r\n").find((l) => l.startsWith("definition,"));
  assert.ok(defLine.startsWith('definition,"'), "the definition is quoted");
  assert.ok(defLine.includes('""every""'), "inner quotes are doubled");});

test("a blank line separates the definition from the data", () => {
  const lines = metricCsv(def, meta, ["period"], [["x"]]).split("\r\n");
  const blank = lines.indexOf("");
  assert.ok(blank > 0, "there is a blank line");
  assert.equal(lines[blank + 1], "period", "the data header follows it");
});

test("the JSON keeps the definition whole and names every value", () => {
  const out = JSON.parse(metricJson(def, meta, ["period", "downloads"], [["2026-W37", 61000]]));
  assert.equal(out.metric.definition, def.definition);
  assert.equal(out.metric.canFall, true);
  assert.equal(out.collected, "2026-09-19");
  assert.deepEqual(out.rows[0], { period: "2026-W37", downloads: 61000 });
});

test("a short row becomes nulls rather than shifting the columns", () => {
  const out = JSON.parse(metricJson(def, meta, ["a", "b", "c"], [["x"]]));
  assert.deepEqual(out.rows[0], { a: "x", b: null, c: null });
});

test("the file name is safe, dated, and does not repeat itself", () => {
  assert.equal(fileName(def, meta, "csv"), "wdk-atlas-downloads-npm-downloads-per-week-2026-09-19.csv");
  assert.equal(fileName(def, { title: "npm downloads", collected: "2026-09-19" }, "json"), "wdk-atlas-downloads-2026-09-19.json");
  assert.match(fileName(def, { title: "Downloads by package!" }, "csv"), /^[a-z0-9.-]+$/);
});
