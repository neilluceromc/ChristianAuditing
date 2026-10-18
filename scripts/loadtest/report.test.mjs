import { describe, expect, it } from "vitest";
import { buildReport, evaluateTargets, isError, percentile, summarise, targetFor } from "./report.mjs";

const range = (n) => Array.from({ length: n }, (_, i) => i + 1);

describe("percentile (nearest rank)", () => {
  it("p50 and p95 of 1..10", () => {
    expect(percentile(range(10), 50)).toBe(5);
    expect(percentile(range(10), 95)).toBe(10);
  });

  it("p50 and p95 of 1..20 and 1..100", () => {
    expect(percentile(range(20), 50)).toBe(10);
    expect(percentile(range(20), 95)).toBe(19);
    expect(percentile(range(100), 50)).toBe(50);
    expect(percentile(range(100), 95)).toBe(95);
  });

  it("sorts its input without changing it", () => {
    const values = [900, 100, 500, 300, 700];
    expect(percentile(values, 50)).toBe(500);
    expect(percentile(values, 95)).toBe(900);
    expect(values).toEqual([900, 100, 500, 300, 700]);
  });

  it("one value is every percentile; no values is null", () => {
    expect(percentile([42], 50)).toBe(42);
    expect(percentile([42], 95)).toBe(42);
    expect(percentile([], 95)).toBeNull();
  });
});

describe("isError", () => {
  it("a reader request is an error unless it answered 2xx", () => {
    expect(isError({ route: "/", ms: 1, status: 200 })).toBe(false);
    expect(isError({ route: "/", ms: 1, status: 302 })).toBe(true);
    expect(isError({ route: "/", ms: 1, status: 500 })).toBe(true);
    expect(isError({ route: "/", ms: 30_000, status: 0, error: "timeout" })).toBe(true);
  });

  it("a writer action is an error when not ok; a skipped one never is", () => {
    expect(isError({ action: "assign", ms: 1, ok: true })).toBe(false);
    expect(isError({ action: "assign", ms: 1, ok: false })).toBe(true);
    expect(isError({ action: "approve or reject", ms: 0, ok: true, skipped: true })).toBe(false);
  });
});

describe("targetFor (spec §2 goal 3)", () => {
  it("Home and the reports get 1.5 s, everything else 1.0 s", () => {
    expect(targetFor("/")).toBe(1500);
    expect(targetFor("/equipment-by-client?tab=internal")).toBe(1500);
    expect(targetFor("/finance/depreciation?tab=schedule&year=:year&cls=IT&cat=:id")).toBe(1500);
    expect(targetFor("/stock/reports")).toBe(1500);
    expect(targetFor("/inventory")).toBe(1000);
    expect(targetFor("/inventory/:id")).toBe(1000);
    expect(targetFor("server action · assign")).toBe(1000);
  });

  it("reads a workspace-keyed row by its route (fix round 1)", () => {
    expect(targetFor("/ [admin]")).toBe(1500);
    expect(targetFor("/ [finance]")).toBe(1500);
    expect(targetFor("/admin/users [admin]")).toBe(1000);
  });
});

describe("summarise", () => {
  it("groups by key with count, p50, p95, max and errors, sorted by p95 descending", () => {
    const rows = [
      ...range(20).map((ms) => ({ route: "/inventory", ms, status: 200 })),
      { route: "/", ms: 3000, status: 200 },
      { route: "/", ms: 100, status: 500 },
    ];
    const out = summarise(rows, (r) => r.route);
    expect(out.map((g) => g.key)).toEqual(["/", "/inventory"]);
    expect(out[1]).toMatchObject({ key: "/inventory", count: 20, p50: 10, p95: 19, max: 20, errors: 0, skipped: 0 });
    expect(out[0]).toMatchObject({ key: "/", count: 2, p50: 100, p95: 3000, max: 3000, errors: 1 });
  });

  it("leaves aborted-after-success server actions out of the timings and the errors, but counts them (fix round 2)", () => {
    const rows = [
      { action: "server action · assign", ms: 300, ok: true, server: true },
      { action: "server action · assign", ms: 0, ok: true, server: true, aborted: true, note: "aborted-after-success" },
    ];
    const [g] = summarise(rows, (r) => r.action);
    expect(g).toMatchObject({ count: 1, aborted: 1, skipped: 0, p50: 300, p95: 300, max: 300, errors: 0 });
    expect(isError(rows[1])).toBe(false);
  });

  it("counts aborts at the hard stop apart from aborted-after-success, and gathers first-byte times (fix round 3)", () => {
    const rows = [
      { action: "server action · assign", ms: 0, ok: true, server: true, aborted: true, note: "aborted-after-success", firstByteMs: 120 },
      { action: "server action · assign", ms: 0, ok: true, server: true, aborted: true, note: "aborted-after-success", firstByteMs: 140 },
      { action: "server action · assign", ms: 0, ok: true, server: true, aborted: true, note: "aborted-after-success" },
      { action: "server action · assign", ms: 0, ok: true, server: true, aborted: true, note: "aborted-at-stop" },
    ];
    const [g] = summarise(rows, (r) => r.action);
    expect(g).toMatchObject({ count: 0, aborted: 3, stopped: 1, errors: 0, firstByte: { count: 2, p50: 120, p95: 140 } });
  });

  it("leaves skipped writer steps out of the timings but counts them", () => {
    const rows = [
      { action: "approve or reject", ms: 400, ok: true },
      { action: "approve or reject", ms: 0, ok: true, skipped: true },
      { action: "approve or reject", ms: 0, ok: true, skipped: true },
    ];
    const [g] = summarise(rows, (r) => r.action);
    expect(g).toMatchObject({ count: 1, skipped: 2, p50: 400, p95: 400, max: 400, errors: 0 });
  });
});

describe("evaluateTargets", () => {
  it("meets every target on a quiet run", () => {
    const readers = [{ route: "/inventory", ms: 300, status: 200 }, { route: "/", ms: 1200, status: 200 }];
    const writers = [{ action: "server action · assign", ms: 200, ok: true, server: true }];
    const results = evaluateTargets(readers, writers);
    expect(results.filter((t) => t.met === false)).toEqual([]);
  });

  it("misses each target with the route that broke it named", () => {
    const readers = [
      ...range(20).map(() => ({ route: "/inventory", ms: 1100, status: 200 })),
      ...range(20).map(() => ({ route: "/", ms: 1600, status: 200 })),
      { route: "/audit", ms: 6000, status: 200 },
      { route: "/audit", ms: 10, status: 500 },
    ];
    const writers = [{ action: "assign", ms: 900, ok: false, error: "Timeout" }];
    const byName = Object.fromEntries(evaluateTargets(readers, writers).map((t) => [t.key, t]));
    expect(byName.p95List.met).toBe(false);
    expect(byName.p95List.detail).toContain("/inventory");
    expect(byName.p95Home.met).toBe(false);
    expect(byName.p95Home.detail).toContain("/");
    expect(byName.max5s.met).toBe(false);
    expect(byName.max5s.detail).toContain("/audit");
    expect(byName.errors.met).toBe(false);
    expect(byName.errors.detail).toMatch(/2 error/);
  });

  it("a target with no rows to judge reads CHECK (met null), not MET (fix round 1)", () => {
    const byName = Object.fromEntries(evaluateTargets([{ route: "/inventory", ms: 100, status: 200 }], []).map((t) => [t.key, t]));
    expect(byName.p95List.met).toBe(true);
    expect(byName.p95Home.met).toBeNull();
    expect(byName.p95Home.detail).toMatch(/no requests/);
  });

  it("writers that ran but recorded no server-action timing make the action target CHECK, not MET (fix round 1)", () => {
    const readers = [{ route: "/inventory", ms: 100, status: 200 }];
    const writers = [{ action: "assign", ms: 900, ok: true }, { action: "approve or reject", ms: 0, ok: true, skipped: true }];
    const byName = Object.fromEntries(evaluateTargets(readers, writers).map((t) => [t.key, t]));
    expect(byName.p95List.met).toBeNull();
    expect(byName.p95List.detail).toMatch(/no server-action/);
    // … but a reader route over target still reads MISSED.
    const slow = [...readers, ...Array.from({ length: 5 }, () => ({ route: "/audit", ms: 1200, status: 200 }))];
    expect(Object.fromEntries(evaluateTargets(slow, writers).map((t) => [t.key, t])).p95List.met).toBe(false);
  });

  // ---- fix round 3: an action is judged on server time only with 20+ fully timed rows ----
  const server = (label, ms, extra = {}) => ({ action: `server action · ${label}`, ms, ok: true, server: true, ...extra });
  const aborted = (label) => server(label, 0, { aborted: true, note: "aborted-after-success" });
  const step = (label, ms) => ({ action: label, ms, ok: true });
  const byKey = (readers, writers) => Object.fromEntries(evaluateTargets(readers, writers).map((t) => [t.key, t]));

  it("judges an action on its server time when it has at least 20 fully timed rows", () => {
    const writers = [...range(20).map(() => server("assign", 300)), step("assign", 2500)];
    const t = byKey([], writers).p95List;
    expect(t.met).toBe(true);
    expect(t.detail).toMatch(/`assign` 300 ms on server time \(20 timed of 20\)/);
  });

  it("under 20 fully timed rows, judges the action on its whole step instead (a conservative upper bound)", () => {
    const writers = [...range(19).map(() => server("assign", 300)), aborted("assign"), step("assign", 1200), step("assign", 900)];
    const t = byKey([{ route: "/inventory", ms: 100, status: 200 }], writers).p95List;
    expect(t.met).toBe(false);
    expect(t.detail).toMatch(/`assign` 1200 ms on the whole step, click to toast \(19 timed of 20\)/);
  });

  it("an action whose server rows were all aborted still counts, judged on its whole step", () => {
    const writers = [aborted("assign"), aborted("assign"), step("assign", 900)];
    const t = byKey([{ route: "/inventory", ms: 100, status: 200 }], writers).p95List;
    expect(t.met).toBe(true);
    expect(t.detail).toMatch(/all 1 routes and 1 actions within 1\.0 s/);
    expect(t.detail).toMatch(/`assign` 900 ms on the whole step, click to toast \(0 timed of 2\)/);
  });

  it("an action with neither basis reads CHECK and is named", () => {
    const writers = [server("people search", 60), step("assign", 400), ...range(20).map(() => server("assign", 300))];
    const t = byKey([{ route: "/inventory", ms: 100, status: 200 }], writers).p95List;
    expect(t.met).toBeNull();
    expect(t.detail).toMatch(/`people search` unjudged \(1 timed of 1, no whole-step rows\)/);
    expect(byKey([], writers).errors.met).toBe(true);
  });
});

describe("buildReport", () => {
  const inputs = [
    {
      file: "readers.json",
      data: {
        kind: "readers", base: "http://host:3000", minutes: 6, users: 15, startedAt: "2026-10-19T00:00:00.000Z",
        requests: [
          { route: "/inventory", ms: 200, status: 200, user: "perf01" },
          { route: "/inventory/:id", ms: 900, status: 200, user: "perf01" },
          { route: "/", ms: 50, status: 200, user: "perf15" },
        ],
      },
    },
    {
      file: "writers.json",
      data: {
        kind: "writers", base: "http://host:3000", minutes: 6, startedAt: "2026-10-19T00:00:00.000Z",
        actions: [
          { action: "assign", ms: 800, ok: true, user: "perf01" },
          { action: "server action · assign", ms: 250, ok: true, server: true, user: "perf01" },
          { action: "approve or reject", ms: 0, ok: true, skipped: true, user: "perf15" },
        ],
      },
    },
  ];

  it("writes a header with the label and the targets, then routes by p95 descending, then actions", () => {
    const md = buildReport({ label: "baseline", inputs, generatedAt: "2026-10-19T01:00:00.000Z" });
    expect(md).toMatch(/^# Load test — baseline/);
    expect(md).toContain("All targets met");
    const record = md.indexOf("| `/inventory/:id`");
    const list = md.indexOf("| `/inventory` ");
    const home = md.indexOf("| `/` ");
    expect(record).toBeGreaterThan(0);
    expect(record).toBeLessThan(list);
    expect(list).toBeLessThan(home);
    expect(md).toContain("| `assign` |");
    // Action table columns: Action | Count | Skipped | p50 | p95 | Max | Errors — the skipped step has no timings.
    expect(md).toContain("| `approve or reject` | 0 | 1 | – | – | – | 0 |");
  });

  it("does not claim the click-to-toast time includes the page refresh (the toast fires before router.refresh)", () => {
    const md = buildReport({ label: "baseline", inputs, generatedAt: "2026-10-19T01:00:00.000Z" });
    expect(md).not.toMatch(/page refresh and render/);
    expect(md).toMatch(/before the page refresh/);
  });

  it("says when nothing was missed but some targets need checking by hand", () => {
    const noServer = structuredClone(inputs);
    noServer[1].data.actions = noServer[1].data.actions.filter((a) => !a.server);
    const md = buildReport({ label: "baseline", inputs: noServer, generatedAt: "2026-10-19T01:00:00.000Z" });
    expect(md).not.toContain("All targets met");
    expect(md).toMatch(/No target missed; 1 to check/);
  });

  it("shows the aborted-after-success count in the actions table (fix round 2)", () => {
    const withAbort = structuredClone(inputs);
    withAbort[1].data.actions.push({ action: "server action · assign", ms: 0, ok: true, server: true, aborted: true, note: "aborted-after-success", user: "perf01" });
    const md = buildReport({ label: "baseline", inputs: withAbort, generatedAt: "2026-10-19T01:00:00.000Z" });
    expect(md).toContain("| Action | Count | Skipped | p50 | p95 | Max | Errors | Aborted after success | First byte (n · p50 · p95) |");
    expect(md).toContain("| `server action · assign` | 1 | 0 | 250 | 250 | 250 | 0 | 1 |");
    expect(md).toContain("All targets met");
  });

  it("shows the first byte of aborted responses per server-action key (fix round 3)", () => {
    const withAbort = structuredClone(inputs);
    withAbort[1].data.actions.push(
      { action: "server action · assign", ms: 0, ok: true, server: true, aborted: true, note: "aborted-after-success", firstByteMs: 120, user: "perf01" },
      { action: "server action · assign", ms: 0, ok: true, server: true, aborted: true, note: "aborted-after-success", firstByteMs: 160, user: "perf02" },
    );
    const md = buildReport({ label: "baseline", inputs: withAbort, generatedAt: "2026-10-19T01:00:00.000Z" });
    expect(md).toContain("| `server action · assign` | 1 | 0 | 250 | 250 | 250 | 0 | 2 | 2 · 120 · 160 |");
    expect(md).toContain("| `assign` | 1 | 0 | 800 | 800 | 800 | 0 | 0 | – |");
  });

  it("lists skipped steps by reason, grouping on the text before the diagnostic detail (fix round 2)", () => {
    const skipped = structuredClone(inputs);
    skipped[1].data.actions.push(
      { action: "assign", ms: 0, ok: true, skipped: true, reason: "no scale-seed spare on the Spare list (page 2: 25 rows, 0 scale tags)" },
      { action: "assign", ms: 0, ok: true, skipped: true, reason: "no scale-seed spare on the Spare list (page 3: 0 rows, 0 scale tags)" },
    );
    const md = buildReport({ label: "baseline", inputs: skipped, generatedAt: "2026-10-19T01:00:00.000Z" });
    expect(md).toContain("## Skipped steps, by reason");
    expect(md).toContain("| `assign` | no scale-seed spare on the Spare list | 2 | no scale-seed spare on the Spare list (page 2: 25 rows, 0 scale tags) |");
    expect(md).toContain("| `approve or reject` | no reason recorded | 1 |  |");
  });

  it("says which targets were missed", () => {
    const slow = structuredClone(inputs);
    slow[0].data.requests.push({ route: "/audit", ms: 7000, status: 200, user: "perf03" });
    const md = buildReport({ label: "after", inputs: slow, generatedAt: "2026-10-19T01:00:00.000Z" });
    expect(md).toContain("MISSED");
    expect(md).toContain("/audit");
  });
});
