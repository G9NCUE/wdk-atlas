// The small companion to data/metrics.json.
//
// Every page shows when the atlas and the metrics were last updated, and the developer page
// names the package to install. Those few values used to cost a 396 KB download, because the
// only file that held them also holds a year of daily series for 55 repositories. This is the
// same facts in about a kilobyte, so a page that needs nothing else fetches nothing else.
//
// One definition of what goes in it, used by the collector when it writes. The site reads the
// file it produces; nothing under bin/ is served.

const SUMMARY_SCHEMA = 1;

export function summarise(file) {
  const days = Object.keys(file.snapshots || {}).sort();
  const latest = days.length ? file.snapshots[days[days.length - 1]] : null;
  const assembler = (file.repos || {}).wdk || null;
  return {
    schema: SUMMARY_SCHEMA,
    // What the footer stamp on every page needs.
    atlasUpdated: file.atlasUpdated || null,
    updated: file.updated || null,
    // What the Developer Resources page needs to name the package and count the examples.
    assembler: assembler ? { package: assembler.package || null, version: assembler.version || null } : null,
    examples: latest && typeof latest.examples === "number" ? latest.examples : null,
  };
}
