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
  return !row.skipped && !row.aborted && row.ok === false;
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

/**
 * Rows grouped by `keyOf`: count, skipped, aborted, stopped, p50, p95, max (ms), errors and the first byte of aborted
 * responses, slowest p95 first. A skipped step, a server action aborted after its step succeeded (fix round 2) and
 * one cut off by the hard stop (fix round 3) are counted apart and carry no time; an aborted-after-success row's
 * `firstByteMs` (the server's first byte, fix round 3) is gathered on its own.
 */
export function summarise(rows, keyOf) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyOf(row);
    const g = groups.get(key) ?? { key, ms: [], firstByte: [], skipped: 0, aborted: 0, stopped: 0, errors: 0 };
    groups.set(key, g);
    if (row.skipped) {
      g.skipped += 1;
      continue;
    }
    if (row.aborted) {
      if (row.note === "aborted-at-stop") g.stopped += 1;
      else {
        g.aborted += 1;
        if (typeof row.firstByteMs === "number") g.firstByte.push(row.firstByteMs);
      }
      continue;
    }
    g.ms.push(row.ms);
    if (isError(row)) g.errors += 1;
  }
  return [...groups.values()]
    .map(({ key, ms, firstByte, skipped, aborted, stopped, errors }) => ({
      key,
      count: ms.length,
      skipped,
      aborted,
      stopped,
      p50: percentile(ms, 50),
      p95: percentile(ms, 95),
      max: ms.length ? Math.max(...ms) : null,
      errors,
      firstByte: { count: firstByte.length, p50: percentile(firstByte, 50), p95: percentile(firstByte, 95) },
    }))
    .sort((a, b) => (b.p95 ?? -1) - (a.p95 ?? -1) || a.key.localeCompare(b.key));
}

const keyOf = (row) => row.route ?? row.action;
const fmtMs = (ms) => (ms === null ? "–" : String(Math.round(ms)));
const fmtS = (ms) => `${(ms / 1000).toFixed(1)} s`;
const list = (items, n = 8) => items.slice(0, n).join(", ") + (items.length > n ? `, and ${items.length - n} more` : "");

/** Fix round 3: below this many fully timed server-action rows, an action is judged on its whole step instead. */
export const MIN_TIMED_SERVER_ROWS = 20;
const SERVER_PREFIX = "server action · ";

/**
 * Fix round 3: the basis each writer action is judged on, per server-action label. With at least
 * MIN_TIMED_SERVER_ROWS fully timed rows: the server time ("server"). Otherwise the action's own whole-step rows
 * (click to toast, a conservative upper bound: it contains the server time) when there are any ("step"). Otherwise
 * none (null, a CHECK). `timed` of `total` counts the fully timed rows among the label's server-action rows,
 * aborted-after-success ones included; rows cut off by the hard stop are not counted.
 */
export function actionBases(writers) {
  const byLabel = new Map();
  for (const w of writers) {
    if (!w.server || w.skipped || w.note === "aborted-at-stop" || !w.action.startsWith(SERVER_PREFIX)) continue;
    const label = w.action.slice(SERVER_PREFIX.length);
    const e = byLabel.get(label) ?? { label, timed: [], total: 0 };
    e.total += 1;
    if (!w.aborted) e.timed.push(w.ms);
    byLabel.set(label, e);
  }
  return [...byLabel.values()].map(({ label, timed, total }) => {
    const base = { label, timed: timed.length, total };
    if (timed.length >= MIN_TIMED_SERVER_ROWS) return { ...base, basis: "server", p95: percentile(timed, 95) };
    const steps = writers.filter((w) => !w.server && !w.skipped && w.ok !== false && w.action === label).map((w) => w.ms);
    if (steps.length) return { ...base, basis: "step", p95: percentile(steps, 95) };
    return { ...base, basis: null, p95: null };
  });
}

const describeAction = (a) => (a.basis
  ? `\`${a.label}\` ${fmtMs(a.p95)} ms on ${a.basis === "server" ? "server time" : "the whole step, click to toast"} (${a.timed} timed of ${a.total})`
  : `\`${a.label}\` unjudged (${a.timed} timed of ${a.total}, no whole-step rows)`);

/**
 * Spec §2 goal 3. Reader page requests are judged on their own time. A writer action is judged on its server-action
 * time when it has 20+ fully timed rows, else on its whole step (fix round 3, `actionBases`); the detail names the
 * basis and "N timed of M" for each action. Errors count wherever they happen.
 *
 * `met` is true, false, or null for "check by hand": a target with nothing to judge is never MET; nor is the action
 * target when an action has no basis, or when the writers ran but recorded no server action at all (fix round 1).
 */
export function evaluateTargets(readers, writers) {
  // Timed server actions only: an aborted row has no time (fix round 2).
  const serverRows = writers.filter((w) => w.server && !w.aborted);
  const gated = [...readers, ...serverRows];
  const routeGroups = summarise(readers, keyOf);
  const actions = actionBases(writers);
  const writersUntimed = actions.length === 0 && writers.some((w) => !w.server && !w.skipped);

  function listTarget() {
    const limit = FAST_TARGET_MS;
    const target = { key: "p95List", name: `p95 ≤ ${fmtS(limit)} — lists, records and actions` };
    const routes = routeGroups.filter((g) => targetFor(g.key) === limit && g.p95 !== null);
    const judged = actions.filter((a) => a.basis);
    const unjudged = actions.filter((a) => !a.basis);
    const overRoutes = routes.filter((g) => g.p95 > limit).map((g) => `\`${g.key}\` ${fmtMs(g.p95)} ms`);
    const overActions = judged.filter((a) => a.p95 > limit).map(describeAction);
    const actionText = actions.length ? `; actions: ${actions.map(describeAction).join(", ")}` : "";
    if (overRoutes.length || overActions.length) {
      const over = [...overRoutes, ...overActions];
      return { ...target, met: false, detail: `${over.length} over: ${list(over)}${actionText}` };
    }
    if (routes.length + judged.length === 0 && unjudged.length === 0) {
      return { ...target, met: null, detail: writersUntimed ? "no requests to judge; the writers ran but recorded no server-action timing" : "no requests to judge" };
    }
    const within = `all ${routes.length} routes and ${judged.length} actions within ${fmtS(limit)}`;
    if (unjudged.length) return { ...target, met: null, detail: `${within}, ${unjudged.length} unjudged${actionText}` };
    if (writersUntimed) {
      return {
        ...target,
        met: null,
        detail: `${within}, but the writers ran and recorded no server-action timing — the actions are unjudged`,
      };
    }
    return { ...target, met: true, detail: `${within}${actionText}` };
  }

  function homeTarget() {
    const limit = SLOW_TARGET_MS;
    const target = { key: "p95Home", name: `p95 ≤ ${fmtS(limit)} — Home and the reports` };
    const mine = routeGroups.filter((g) => targetFor(g.key) === limit && g.p95 !== null);
    const over = mine.filter((g) => g.p95 > limit);
    if (over.length) {
      return { ...target, met: false, detail: `${over.length} over: ${list(over.map((g) => `\`${g.key}\` ${fmtMs(g.p95)} ms`))}` };
    }
    if (mine.length === 0) return { ...target, met: null, detail: "no requests to judge" };
    return { ...target, met: true, detail: `all ${mine.length} within ${fmtS(limit)}` };
  }

  const slow = gated.filter((r) => !r.skipped && !r.aborted && r.ms > MAX_MS);
  const slowKeys = summarise(slow, keyOf).map((g) => `\`${g.key}\` ${fmtMs(g.max)} ms`);
  const readerErrors = readers.filter(isError);
  const writerErrors = writers.filter(isError);
  const errorKeys = summarise([...readerErrors, ...writerErrors], keyOf).map((g) => `\`${g.key}\` ×${g.count}`);
  const errorCount = readerErrors.length + writerErrors.length;

  return [
    listTarget(),
    homeTarget(),
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
      ` (${skipped} skipped) · ${writers.filter((w) => w.server && !w.aborted).length} timed server-action calls` +
      ` (${writers.filter((w) => w.aborted && w.note !== "aborted-at-stop").length} aborted after success,` +
      ` ${writers.filter((w) => w.note === "aborted-at-stop").length} cut off by the hard stop)`,
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
      " browser's network timing). The targets judge an action on it only when it has at least" +
      ` ${MIN_TIMED_SERVER_ROWS} fully timed rows; with fewer, on the action's whole step instead (an upper bound),` +
      " and the Targets table says which basis and how many rows were timed. Every other row is the whole step in the browser:" +
      " for a change, from the confirming click to the success toast (the action's round trip and the toast's render," +
      " before the page refresh, which starts after the toast); for an" +
      " `open …` row, the navigation until the page's heading shows (its streamed content revealed). A skipped step (no spare free, empty approval queue, decision" +
      " cap reached) has no time and is not an error. *Aborted after success* counts server-action responses the" +
      " browser cut off (net::ERR_ABORTED) after their step had already succeeded: not errors, and not timed;" +
      " *First byte* is the server's first byte for those of them the browser had timed (count · p50 · p95)," +
      " a lower bound on their server time. Responses cut off by the hard stop are counted in neither.",
    "",
  );
  out.push(
    "| Action | Count | Skipped | p50 | p95 | Max | Errors | Aborted after success | First byte (n · p50 · p95) |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|",
  );
  for (const g of summarise(writers, keyOf)) {
    const fb = g.firstByte.count ? `${g.firstByte.count} · ${fmtMs(g.firstByte.p50)} · ${fmtMs(g.firstByte.p95)}` : "–";
    out.push(`| \`${g.key}\` | ${g.count} | ${g.skipped} | ${fmtMs(g.p50)} | ${fmtMs(g.p95)} | ${fmtMs(g.max)} | ${g.errors} | ${g.aborted} | ${fb} |`);
  }
  out.push("");

  // Fix round 2: why steps were skipped, so a run that barely exercised a change says so. A reason's diagnostic
  // detail (in parentheses) varies per loop, so reasons are grouped on the text before it, with one example kept.
  const skips = new Map();
  for (const w of writers.filter((x) => x.skipped)) {
    const reason = String(w.reason ?? "no reason recorded");
    const key = `${w.action}\u0000${reason.split(" (")[0]}`;
    const s = skips.get(key) ?? { action: w.action, reason: reason.split(" (")[0], count: 0, example: reason };
    s.count += 1;
    skips.set(key, s);
  }
  if (skips.size) {
    out.push("## Skipped steps, by reason", "");
    out.push("| Step | Reason | Count | Example |", "|---|---|---:|---|");
    for (const s of [...skips.values()].sort((a, b) => b.count - a.count)) {
      const example = s.example === s.reason ? "" : s.example.replace(/\|/g, "/").slice(0, 200);
      out.push(`| \`${s.action}\` | ${s.reason} | ${s.count} | ${example} |`);
    }
    out.push("");
  }

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
