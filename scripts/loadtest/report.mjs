// Phase 43 (spec §4): the load test's Markdown report.
//
//   node scripts/loadtest/report.mjs --in readers.json --in writers.json --label baseline \
//     --out docs/perf/2026-10-19-baseline.md
//
// Per route (readers) and per action (writers): count, p50, p95, max, errors; routes sorted by p95, slowest first;
// a header saying which of the spec's targets were met.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

/** Nearest-rank percentile: the smallest value with at least p % of the values at or below it. Null when empty. */
export function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1];
}

/** A reader request is an error unless it answered 2xx (a redirect means a lost session or a refused page). */
export function isError(row) {
  if ("status" in row) return !(row.status >= 200 && row.status < 300);
  return !row.skipped && row.ok === false;
}

const SLOW_TARGET_MS = 1_500;
const FAST_TARGET_MS = 1_000;
const MAX_MS = 5_000;
/** Spec §2 goal 3: Home and the reports get 1.5 s at p95. */
const HOME_AND_REPORTS = [/^\/(\?|$)/, /^\/equipment-by-client(\?|$)/, /^\/finance\/depreciation(\?|$)/, /^\/stock\/reports(\/|\?|$)/];

/** The p95 target, in ms, for a route or action key. A workspace suffix (`/ [admin]`) does not change the target. */
export function targetFor(key) {
  const route = key.replace(/ \[[a-z]+\]$/, "");
  return HOME_AND_REPORTS.some((re) => re.test(route)) ? SLOW_TARGET_MS : FAST_TARGET_MS;
}

/** Rows grouped by `keyOf`: count, skipped, p50, p95, max (ms) and errors, slowest p95 first. */
export function summarise(rows, keyOf) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyOf(row);
    const g = groups.get(key) ?? { key, ms: [], skipped: 0, errors: 0 };
    groups.set(key, g);
    if (row.skipped) {
      g.skipped += 1;
      continue;
    }
    g.ms.push(row.ms);
    if (isError(row)) g.errors += 1;
  }
  return [...groups.values()]
    .map(({ key, ms, skipped, errors }) => ({
      key,
      count: ms.length,
      skipped,
      p50: percentile(ms, 50),
      p95: percentile(ms, 95),
      max: ms.length ? Math.max(...ms) : null,
      errors,
    }))
    .sort((a, b) => (b.p95 ?? -1) - (a.p95 ?? -1) || a.key.localeCompare(b.key));
}

const keyOf = (row) => row.route ?? row.action;
const fmtMs = (ms) => (ms === null ? "–" : String(Math.round(ms)));
const fmtS = (ms) => `${(ms / 1000).toFixed(1)} s`;
const list = (items, n = 8) => items.slice(0, n).join(", ") + (items.length > n ? `, and ${items.length - n} more` : "");

/**
 * Spec §2 goal 3, judged on server time: reader page requests, and the writers' server-action POSTs (rows marked
 * `server`). A writer's browser step (click → success toast) also includes the browser's own work, so it is
 * reported but not gated — except for errors, which count wherever they happen.
 *
 * `met` is true, false, or null for "check by hand": a target with no rows to judge is never MET, and neither is the
 * action target when the writers ran but recorded no server-action timing (fix round 1).
 */
export function evaluateTargets(readers, writers) {
  const serverRows = writers.filter((w) => w.server);
  const gated = [...readers, ...serverRows];
  const groups = summarise(gated, keyOf);
  const writersUntimed = serverRows.length === 0 && writers.some((w) => !w.server && !w.skipped);

  function p95Target(key, limit, label, untimed = false) {
    const mine = groups.filter((g) => targetFor(g.key) === limit && g.p95 !== null);
    const over = mine.filter((g) => g.p95 > limit);
    const target = { key, name: `p95 ≤ ${fmtS(limit)} — ${label}` };
    if (over.length) {
      return { ...target, met: false, detail: `${over.length} over: ${list(over.map((g) => `\`${g.key}\` ${fmtMs(g.p95)} ms`))}` };
    }
    if (mine.length === 0) return { ...target, met: null, detail: "no requests to judge" };
    if (untimed) {
      return {
        ...target,
        met: null,
        detail: `all ${mine.length} page routes within ${fmtS(limit)}, but the writers ran and recorded no server-action timing — the actions are unjudged`,
      };
    }
    return { ...target, met: true, detail: `all ${mine.length} within ${fmtS(limit)}` };
  }

  const slow = gated.filter((r) => !r.skipped && r.ms > MAX_MS);
  const slowKeys = summarise(slow, keyOf).map((g) => `\`${g.key}\` ${fmtMs(g.max)} ms`);
  const readerErrors = readers.filter(isError);
  const writerErrors = writers.filter(isError);
  const errorKeys = summarise([...readerErrors, ...writerErrors], keyOf).map((g) => `\`${g.key}\` ×${g.count}`);
  const errorCount = readerErrors.length + writerErrors.length;

  return [
    p95Target("p95List", FAST_TARGET_MS, "lists, records and actions", writersUntimed),
    p95Target("p95Home", SLOW_TARGET_MS, "Home and the reports"),
    {
      key: "max5s",
      name: `No request over ${fmtS(MAX_MS)}`,
      met: slow.length === 0,
      detail: slow.length === 0
        ? `slowest ${fmtMs(gated.length ? Math.max(...gated.filter((r) => !r.skipped).map((r) => r.ms), 0) : null)} ms`
        : `${slow.length} over: ${list(slowKeys)}`,
    },
    {
      key: "errors",
      name: "No errors",
      met: errorCount === 0,
      detail: errorCount === 0
        ? "none"
        : `${errorCount} error${errorCount === 1 ? "" : "s"} (${readerErrors.length} reader, ${writerErrors.length} writer): ${list(errorKeys)}`,
    },
    {
      key: "dbTimeouts",
      name: "No database connection timeouts",
      met: null,
      detail: "not visible from outside the server — check the web container's log for P2024 / \"Timed out fetching a new connection\"",
    },
  ];
}

const verdict = (t) => (t.met === null ? (t.key === "dbTimeouts" ? "CHECK LOG" : "CHECK") : t.met ? "MET" : "**MISSED**");

/** The whole Markdown report (LF line ends; the CLI writes CRLF). */
export function buildReport({ label, inputs, generatedAt }) {
  const readerRuns = inputs.filter((i) => i.data.kind === "readers");
  const writerRuns = inputs.filter((i) => i.data.kind === "writers");
  const readers = readerRuns.flatMap((i) => i.data.requests ?? []);
  const writers = writerRuns.flatMap((i) => i.data.actions ?? []);
  const targets = evaluateTargets(readers, writers);
  const missed = targets.filter((t) => t.met === false);
  // The database-timeout row is always a log check; any other unjudged target is worth saying in the headline.
  const toCheck = targets.filter((t) => t.met === null && t.key !== "dbTimeouts");

  const out = [];
  out.push(`# Load test — ${label}`, "");
  out.push(`Generated ${generatedAt} from ${inputs.map((i) => `\`${path.basename(i.file)}\``).join(", ")}.`, "");
  for (const run of [...readerRuns, ...writerRuns]) {
    const d = run.data;
    const who = d.kind === "readers" ? `${d.users ?? "?"} reader people (HTTP)` : `${d.users ?? "?"} writer people (one headless browser)`;
    out.push(`- **${d.kind}:** ${d.base ?? "?"} · ${d.minutes ?? "?"} min from ${d.startedAt ?? "?"} · ${who}`);
  }
  const skipped = writers.filter((w) => w.skipped).length;
  out.push(
    `- **volume:** ${readers.length} page requests · ${writers.filter((w) => !w.server && !w.skipped).length} writer steps` +
      ` (${skipped} skipped) · ${writers.filter((w) => w.server).length} server-action calls`,
    "",
  );

  out.push("## Targets (spec §2 goal 3, server time under the 15-person load)", "");
  const headline = missed.length
    ? `**Targets MISSED: ${missed.length}.**`
    : toCheck.length
      ? `**No target missed; ${toCheck.length} to check by hand.**`
      : "**All targets met.**";
  out.push(headline, "");
  out.push("| Target | Result | Detail |", "|---|---|---|");
  for (const t of targets) out.push(`| ${t.name} | ${verdict(t)} | ${t.detail} |`);
  out.push("");

  out.push("## Pages (readers), slowest p95 first", "");
  out.push("Times in ms, measured by the harness from request to the last byte of the HTML.", "");
  out.push("| Route | Target | Count | p50 | p95 | Max | Errors |", "|---|---|---:|---:|---:|---:|---:|");
  for (const g of summarise(readers, keyOf)) {
    out.push(`| \`${g.key}\` | ${fmtS(targetFor(g.key))} | ${g.count} | ${fmtMs(g.p50)} | ${fmtMs(g.p95)} | ${fmtMs(g.max)} | ${g.errors} |`);
  }
  out.push("");

  out.push("## Actions (writers), slowest p95 first", "");
  out.push(
    "Times in ms. A `server action · …` row is the server action's POST alone (request to response end, from the" +
      " browser's network timing) and is what the targets judge. Every other row is the whole step in the browser:" +
      " for a change, from the confirming click to the success toast (the action's round trip and the toast's render," +
      " before the page refresh, which starts after the toast); for an" +
      " `open …` row, the navigation to the page's load event. A skipped step (no spare free, empty approval queue, decision" +
      " cap reached) has no time and is not an error.",
    "",
  );
  out.push("| Action | Count | Skipped | p50 | p95 | Max | Errors |", "|---|---:|---:|---:|---:|---:|---:|");
  for (const g of summarise(writers, keyOf)) {
    out.push(`| \`${g.key}\` | ${g.count} | ${g.skipped} | ${fmtMs(g.p50)} | ${fmtMs(g.p95)} | ${fmtMs(g.max)} | ${g.errors} |`);
  }
  out.push("");

  const errors = [...readers, ...writers].filter(isError);
  if (errors.length) {
    out.push(`## Errors (first ${Math.min(20, errors.length)} of ${errors.length})`, "");
    for (const e of errors.slice(0, 20)) {
      const what = e.route ? `\`${e.route}\` → ${e.status}` : `\`${e.action}\``;
      out.push(`- ${e.user ?? "?"}: ${what}${e.error ? ` — ${String(e.error).replace(/\s+/g, " ").slice(0, 200)}` : ""}`);
    }
    out.push("");
  }
  return out.join("\n");
}

async function main() {
  const { values } = parseArgs({
    options: { in: { type: "string", multiple: true }, label: { type: "string" }, out: { type: "string" } },
  });
  if (!values.in?.length || !values.label || !values.out) {
    console.error("Usage: node scripts/loadtest/report.mjs --in <readers.json> [--in <writers.json>] --label <name> --out <file.md>");
    process.exit(2);
  }
  const inputs = [];
  for (const file of values.in) inputs.push({ file, data: JSON.parse(await readFile(file, "utf8")) });
  const md = buildReport({ label: values.label, inputs, generatedAt: new Date().toISOString() });
  await mkdir(path.dirname(path.resolve(values.out)), { recursive: true });
  await writeFile(values.out, md.replace(/\n/g, "\r\n") + "\r\n", "utf8");
  console.log(`Wrote ${values.out}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
