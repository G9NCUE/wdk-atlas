// Taking the numbers away with you.
//
// "Every number can be recomputed by a stranger" is the promise the whole site rests on, and
// until now it meant reading data/metrics.json and working out for yourself which slice of it
// a chart had drawn. An export closes that gap, but only if the definition travels with the
// data: a column of numbers with no statement of what was counted, over what window, from
// which source, is the same unfalsifiable claim in a different file format.
//
// Pure functions, so Node can test them without a DOM and the browser can call them directly.

/** One CSV field: quoted when it has to be, doubled quotes inside, never a stray newline. */
export function csvField(value) {
  if (value === null || value === undefined) return "";
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Rows of cells to CSV text. CRLF, because that is what spreadsheets expect of a .csv. */
export const toCsv = (rows) => rows.map((row) => row.map(csvField).join(",")).join("\r\n");

/**
 * The definition, as the header block of the file. Written as ordinary two-column rows rather
 * than as comment lines, so a parser that knows nothing about this file still reads them.
 */
function headerRows(def, meta = {}) {
  const rows = [
    ["metric", def.label],
    ["question", def.question],
    ["definition", def.definition],
    ["source", def.source],
    ["window", def.window],
  ];
  if (def.decision) rows.push(["decision", def.decision]);
  if (meta.title) rows.push(["chart", meta.title]);
  if (meta.collected) rows.push(["collected", meta.collected]);
  if (meta.scope) rows.push(["scope", meta.scope]);
  return rows;
}

/** A chart or table as CSV: the definition, a blank line, then the data. */
export function metricCsv(def, meta, columns, rows) {
  return toCsv([...headerRows(def, meta), [], columns, ...rows]);
}

/** The same as JSON, with the definition kept whole rather than flattened into rows. */
export function metricJson(def, meta, columns, rows) {
  return JSON.stringify(
    {
      metric: {
        id: def.id,
        label: def.label,
        question: def.question,
        definition: def.definition,
        source: def.source,
        window: def.window,
        decision: def.decision,
        canFall: def.canFall,
      },
      chart: meta.title || null,
      collected: meta.collected || null,
      scope: meta.scope || null,
      columns,
      rows: rows.map((row) => Object.fromEntries(columns.map((c, i) => [c, row[i] ?? null]))),
    },
    null,
    2
  );
}

/** A file name that survives a download folder: lower case, no spaces, dated. */
export function fileName(def, meta, extension) {
  const part = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const bits = ["wdk-atlas", part(def.id), part(meta.title) === part(def.label) ? "" : part(meta.title), part(meta.collected)];
  return `${bits.filter(Boolean).join("-")}.${extension}`;
}
