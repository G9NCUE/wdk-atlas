// Turning the metrics file into things to look at: daily series summed into complete weeks or
// months, the tiles and the change beside them, and the three kinds of chart, all inline SVG.
// The Dashboard and the Overview both draw from here, and the key results read the buckets.

import { el, pct, svgEl, withTip } from "./dom.mjs";
import { isoWeekOf } from "./../lib/steady.mjs";
import { use } from "./context.mjs";
import { metricDef, mayShowChange } from "./../lib/metrics-defs.mjs";
import { metricCsv, metricJson, fileName } from "./../lib/export.mjs";

export function createSeries(ctx) {
  const { query } = ctx;

  // Kept as references, not as resolved values, and applied through style rather than through a
  // fill attribute. A resolved value would be frozen at load: the print stylesheet redefines
  // these tokens to darker inks, and a chart drawn from a copy taken on screen would ignore it.
  const SERIES = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)"];

  const fmtNum = (n) => (n == null ? "—" : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}K` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(n));

  // A change indicator, guarded by the floor recorded for the metric. Below the floor the reader
  // gets the count and nothing else: a rise from one merged pull request to ten is "+9", not
  // "+900%", because the percentage says more about the size of the base than about the work.
  function deltaPill(id, now, before, { invert = false, note = "" } = {}) {
    if (before == null || now == null) return el("span", { class: "delta none" }, "no prior data");
    const diff = now - before;
    const pct = before && mayShowChange(id, before) ? Math.round((1000 * diff) / before) / 10 : null;
    const dir = diff > 0 ? "up" : diff < 0 ? "down" : "flat";
    const good = invert ? dir === "down" : dir === "up";
    const arrow = dir === "up" ? "↑" : dir === "down" ? "↓" : "→";
    const sign = diff > 0 ? "+" : diff < 0 ? "−" : "";
    return el("span", withTip({ class: `delta ${dir === "flat" ? "flat" : good ? "good" : "bad"}` }, note || "", "change"), `${arrow} ${sign}${fmtNum(Math.abs(diff))}${pct == null ? "" : ` (${sign}${Math.abs(pct)}%)`}`, note && el("span", { class: "delta-note" }, note));
  }

  // Trend against the average of the previous four periods, which is what a reader means by "is it up".
  // Falls back to the previous period while fewer than five exist.
  function trendPill(id, pts) {
    const short = { daily: "day", weekly: "wk", monthly: "mo" }[grain];
    if (pts.length >= 5) {
      const last = pts[pts.length - 1].y, base = pts.slice(-5, -1).reduce((a, p) => a + p.y, 0) / 4;
      return deltaPill(id, last, Math.round(base), { note: `vs 4-${short} avg` });
    }
    const { now, prev } = lastTwo(pts);
    return deltaPill(id, now, prev, { note: prev == null ? "" : `vs prev ${short}` });
  }

  // The one way a page is allowed to reach a definition. A figure with no entry behind it is a
  // number nobody has had to justify, so it renders saying exactly that rather than looking
  // finished; bin/check-metrics.mjs refuses the build long before a reader would see it.
  function defFor(id) {
    return metricDef(id) || { id, label: id, tip: "No definition recorded for this figure.", definition: "No definition recorded for this figure.", source: "unknown", window: "unknown" };
  }

  // Counted, not collected. Rows in atlas.yaml say what we have written down; figures from npm
  // and GitHub say what is true of the world. They sit side by side on three pages, in the same
  // type, and nothing told a reader which was which. The registry already says why that matters,
  // so the warning comes from there rather than being written out again here.
  const countedTip = () => defTip(defFor("atlas-counts"));

  // The hover is the one-line tip; the definition, the source and the window travel with every export.
  const defTip = (def) => def.tip;

  function statTile(def, label, value, delta, hint, feeds) {
    return el("div", { class: "tile" }, el("div", withTip({ class: "tile-label" }, defTip(def), label), label), el("div", { class: "tile-value" }, value), delta, hint && el("div", { class: "tile-hint" }, hint),
      feeds && el("a", withTip({ class: "tile-feeds", href: `./?page=results#${feeds.id}` }, feeds.label, "Key result"), "\u2192"));
  }

  // Which category labels an axis draws: the last, and enough of the rest to read without
  // overlapping. A month label ("Sep 25") is twice the width of a week's ("W37"), so the monthly
  // axis keeps five where the others keep eight; twelve months at full width ran into each other.
  const labelEvery = (n, i) => {
    const [all, room] = grain === "monthly" ? [5, 5] : [12, 8];
    return n <= all || i === n - 1 || i % Math.ceil(n / room) === 0;
  };

  // Inline SVG line chart, one series, hover titles on points, selective direct labels (first and last).
  function lineChart(points, { marks = null } = {}) {
    const W = 520, H = 190, px = 46, py = 22, color = SERIES[0];
    const ys = points.map((p) => p.y);
    const max = Math.max(...ys, 1), min = 0;
    const x = (i) => px + (i * (W - 2 * px)) / Math.max(points.length - 1, 1);
    const y = (v) => H - py - ((v - min) * (H - 2 * py)) / (max - min || 1);
    const d = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.y).toFixed(1)}`).join(" ");

    const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, class: "chart", role: "img", "aria-label": "line chart" },
      [0, 0.5, 1].flatMap((t) => [
        svgEl("line", { class: "grid", x1: px, x2: W - px, y1: y(max * t).toFixed(1), y2: y(max * t).toFixed(1) }),
        svgEl("text", { class: "axis", x: px - 6, y: (y(max * t) + 4).toFixed(1), "text-anchor": "end" }, fmtNum(Math.round(max * t))),
      ]),
      svgEl("path", { d, fill: "none", style: `stroke:${color}`, "stroke-width": 2, "stroke-linejoin": "round" }),
      points.map((p, i) => svgEl("g", null,
        svgEl("circle", { cx: x(i).toFixed(1), cy: y(p.y).toFixed(1), r: 4.5, style: `fill:${color}`, stroke: "var(--card)", "stroke-width": 2 }),
        svgEl("title", null, `${p.label}: ${p.y.toLocaleString()}`))),
      points.map((p, i) => (i === 0 || i === points.length - 1
        ? svgEl("text", { class: "dlabel", x: x(i).toFixed(1), y: (y(p.y) - 10).toFixed(1), "text-anchor": "middle" }, fmtNum(p.y))
        : null)),
      points.map((p, i) => (labelEvery(points.length, i)
        ? svgEl("text", { class: "axis", x: x(i).toFixed(1), y: H - 2, "text-anchor": "middle" }, p.label)
        : null)),
      points.map((p, i) => {
        const list = marks && marks.get(p.key);
        if (!list || !list.length) return null;
        return svgEl("g", { class: "mark" },
          svgEl("path", { d: `M${(x(i) - 3.5).toFixed(1)},${H - py + 3} h7 l-3.5,5 z`, fill: "var(--muted)" }),
          svgEl("title", null, `${list.length} npm release${list.length === 1 ? "" : "s"}: ${list.join(", ")}`));
      }));

    return el("div", { class: "chart-box" }, svg);
  }

  // Which npm releases fall in each bucket of the current grain: `releasesOf(name)` is that
  // name's { day: version } map, `labelOf(name)` what the tick calls it.
  function releaseMarks(releasesOf, names, labelOf = (n) => n) {
    const marks = new Map();
    for (const n of names) for (const [d, ver] of Object.entries(releasesOf(n) || {})) {
      const k = bucketKey(d); if (!marks.has(k)) marks.set(k, []);
      marks.get(k).push(`${labelOf(n)} ${ver}`);
    }
    return marks;
  }

  // Grouped bars: categories on x, up to three series, 2px gaps, hover titles, legend below.
  function groupedBars(categories, series) {
    const W = 520, H = 190, px = 46, py = 22;
    const max = Math.max(1, ...series.flatMap((s) => s.values));
    const gw = (W - 2 * px) / Math.max(categories.length, 1);
    const bw = Math.min(28, (gw * 0.7) / series.length);
    const y = (v) => H - py - (v * (H - 2 * py)) / max;
    const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, class: "chart", role: "img", "aria-label": "bar chart" },
      [0, 0.5, 1].flatMap((t) => [
        svgEl("line", { class: "grid", x1: px, x2: W - px, y1: y(max * t).toFixed(1), y2: y(max * t).toFixed(1) }),
        svgEl("text", { class: "axis", x: px - 6, y: (y(max * t) + 4).toFixed(1), "text-anchor": "end" }, fmtNum(Math.round(max * t))),
      ]),
      categories.map((c, ci) => series.map((s, si) => {
        const v = s.values[ci] || 0;
        const bx = px + ci * gw + (gw - bw * series.length - 2 * (series.length - 1)) / 2 + si * (bw + 2);
        return svgEl("g", null,
          svgEl("rect", { x: bx.toFixed(1), y: y(v).toFixed(1), width: bw.toFixed(1), height: Math.max(0, H - py - y(v)).toFixed(1), rx: 3, style: `fill:${SERIES[si]}` }),
          svgEl("title", null, `${c} · ${s.label}: ${v}`));
      })),
      categories.map((c, ci) => (labelEvery(categories.length, ci)
        ? svgEl("text", { class: "axis", x: (px + ci * gw + gw / 2).toFixed(1), y: H - 2, "text-anchor": "middle" }, c)
        : null)));

    const box = el("div", { class: "chart-box" }, svg);
    if (series.length > 1) box.append(el("ul", { class: "legend-row" }, series.map((s, i) => el("li", null, el("i", { style: `background:${SERIES[i]}` }), s.label))));
    return box;
  }

  // Horizontal bars, one series, direct value labels.
  // One line per row: the name and the number. A package already says what it is in its name, so
  // a second line repeating it in prose doubled the height of every chart to tell the reader
  // nothing they could act on. Whatever else is known about a row stays in the export, where a
  // column costs nothing and a reader has asked for the detail.
  function hBars(rows, { color = SERIES[0], unit = "", scale = null } = {}) {
    const max = scale || Math.max(1, ...rows.map((r) => r.value));
    return el("div", { class: "hbars" }, rows.map((r) => el("div", { class: "hbar" },
      el("span", { class: "hbar-label" }, r.label),
      el("span", { class: "hbar-track" }, el("span", { class: "hbar-fill", style: `width:${pct((100 * r.value) / max)}%;background:${color}` })),
      el("span", { class: "hbar-value" }, `${fmtNum(r.value)}${unit}`))));
  }

  // Handing a file to the reader. The address is a blob this page built a moment ago from its
  // own data, so it never passes through the link allow-list, which exists to judge addresses
  // that came from somewhere else. It is revoked once the browser has taken it.
  function downloadText(name, mime, text) {
    const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  // Two buttons, one file each. Both carry the definition, because a column of numbers with no
  // statement of what was counted is the same unfalsifiable claim in another file format.
  function exportControls(def, data) {
    const meta = { title: data.title, collected: data.collected, scope: data.scope };
    const make = (label, ext, mime, build) => {
      const button = el("button", withTip({ class: "export-btn", type: "button" }, `${label} with the definition, the source and the window inside`, `Download ${label}`), label);
      button.addEventListener("click", () => downloadText(fileName(def, meta, ext), mime, build(def, meta, data.columns, data.rows)));
      return button;
    };
    return el("div", { class: "export", role: "group", "aria-label": `Download ${data.title}` },
      make("CSV", "csv", "text/csv", metricCsv), make("JSON", "json", "application/json", metricJson));
  }

  function chartCard(def, title, value, delta, body, foot, data) {
    return el("article", { class: "chart-card" },
      el("header", { class: "chart-head" }, el("h3", withTip({}, defTip(def), title), title), value != null && el("span", { class: "chart-value" }, value), delta,
        data && data.rows && data.rows.length ? exportControls(def, { ...data, title }) : null),
      body, foot && el("p", { class: "chart-foot" }, foot));
  }

  function dashSection(title, cards) {
    return el("details", { class: "dash-section", open: true }, el("summary", { class: "section-head" }, el("span", { class: "section-text" }, el("span", { class: "section-title-row" }, el("h2", { class: "section-title" }, title)))), el("div", { class: "chart-grid" }, cards));
  }

  // ---- Dashboard data model (schema 3): per-repo daily series + daily snapshots; the page sums the selected repos.
  const GRAINS = { daily: "Daily", weekly: "Weekly", monthly: "Monthly" };


  const grain = GRAINS[query.get("range")] ? query.get("range") : "weekly";
  const unit = { daily: "day", weekly: "week", monthly: "month" }[grain];

  const bucketKey = (dayStr) => (grain === "daily" ? dayStr : grain === "weekly" ? isoWeekOf(dayStr) : dayStr.slice(0, 7));

  const todayKey = () => bucketKey(new Date().toISOString().slice(0, 10));

  const bucketLabel = (key) => {
    if (grain === "daily") { const d = new Date(key + "T00:00:00Z"); return d.toLocaleDateString("en", { month: "short", day: "numeric", timeZone: "UTC" }); }
    if (grain === "weekly") return key.replace(/^\d{4}-/, "");
    const d = new Date(key + "-01T00:00:00Z"); return d.toLocaleDateString("en", { month: "short", year: "2-digit", timeZone: "UTC" });
  };

  const MAX_BUCKETS = { daily: 30, weekly: 12, monthly: 12 };

  // First and last day a bucket key covers, so a bucket counts only when the data covers all of it.
  function bucketRange(key) {
    if (grain === "daily") return [key, key];
    if (grain === "monthly") { const [y, m] = key.split("-").map(Number); const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); return [`${key}-01`, last]; }
    const [y, w] = key.split("-W").map(Number); const jan4 = new Date(Date.UTC(y, 0, 4)); const monday = new Date(jan4); monday.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() || 7) - 1) + (w - 1) * 7);
    const sunday = new Date(monday); sunday.setUTCDate(monday.getUTCDate() + 6);
    return [monday.toISOString().slice(0, 10), sunday.toISOString().slice(0, 10)];
  }

  // Days the data covers: downloads from their own first and last day; event series from the collector's window start to yesterday.
  function coverageOf(perRepo, file, event) {
    const days = Object.values(perRepo || {}).flatMap((x) => Object.keys(x)).sort();
    const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
    if (event) return [file.since || days[0] || yesterday, yesterday];
    return [days[0] || yesterday, days[days.length - 1] || yesterday];
  }

  // Sum a per-repo daily series over the selected repos into complete buckets of the current grain.
  function seriesBuckets(perRepo, selected, { coverage }) {
    const sums = new Map();
    for (const repo of selected) for (const [d, n] of Object.entries((perRepo || {})[repo] || {})) sums.set(bucketKey(d), (sums.get(bucketKey(d)) || 0) + n);
    const now = todayKey();
    const complete = (k) => { if (k >= now) return false; const [a, b] = bucketRange(k); return a >= coverage[0] && b <= coverage[1]; };
    return [...sums].filter(([k]) => complete(k)).sort().slice(-MAX_BUCKETS[grain]).map(([k, y]) => ({ key: k, label: bucketLabel(k), y }));
  }

  const lastTwo = (pts) => ({ now: pts.length ? pts[pts.length - 1].y : null, prev: pts.length > 1 ? pts[pts.length - 2].y : null, key: pts.length ? pts[pts.length - 1].key : null });

  // Snapshot totals for the selection, per snapshot day; then bucketed as end-of-bucket values.
  function snapshotSeries(snapshots, field, selected, reduce = (vals) => vals.reduce((a, b) => a + b, 0)) {
    const days = Object.keys(snapshots).sort();
    const perDay = days.map((d) => ({ d, v: reduce(selected.map((r) => (snapshots[d][field] || {})[r]).filter((v) => v != null)) }));
    const byBucket = new Map();
    for (const { d, v } of perDay) byBucket.set(bucketKey(d), v); // last snapshot in the bucket wins
    return [...byBucket].sort().slice(-MAX_BUCKETS[grain]).map(([k, y]) => ({ key: k, label: bucketLabel(k), y }));
  }

  // The first calendar month the data covers whole, and the day after it ends.
  function firstFullMonth(start) {
    const [y, m] = start.split("-").map(Number);
    const firstFull = start.endsWith("-01") ? new Date(Date.UTC(y, m - 1, 1)) : new Date(Date.UTC(y, m, 1));
    return [firstFull, new Date(Date.UTC(firstFull.getUTCFullYear(), firstFull.getUTCMonth() + 1, 1))];
  }

  // When a series has no complete period at this grain, say why and when one arrives, rather than
  // drawing an empty chart that reads as broken.
  function coverageNote(coverage) {
    const start = coverage && coverage[0];
    if (!start) return `No complete ${unit} of data yet.`;
    let first;
    if (grain === "monthly") {
      const [firstFull, done] = firstFullMonth(start);
      first = `${firstFull.toLocaleDateString("en", { month: "long", year: "numeric", timeZone: "UTC" })}, complete on ${done.toLocaleDateString("en", { day: "numeric", month: "long", timeZone: "UTC" })}`;
    } else if (grain === "weekly") {
      first = `the first full week after ${start}`;
    } else {
      first = `the first full day after ${start}`;
    }
    return `No complete ${unit} yet. Collection starts ${start}; the first one is ${first}.`;
  }

  return {
    firstFullMonth, unit, GRAINS, SERIES, bucketKey, bucketLabel, chartCard, countedTip, coverageNote, coverageOf,
    dashSection, defFor, defTip, deltaPill, exportControls, fmtNum, grain, groupedBars, hBars,
    lastTwo, lineChart, releaseMarks, seriesBuckets, snapshotSeries, statTile, trendPill,
  };
}
