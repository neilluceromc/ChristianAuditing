import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Phase 43 (Task 4, item 4): leaverStates() — the Worklist's and IT Home's every-leaver read — must return exactly
 * what it returned before its read was narrowed. Prisma is a small in-memory fake over one fixture set that answers
 * any of the shapes involved (employee include or select; the approval read and its where), so the SAME expected rows
 * pin the old read and the new one. The fixtures cover every rule the rows are computed from: the offboarding
 * window (before / exactly at / after offboardingAt; no anchor at all), REJECTED, an EXECUTED boundary on a held
 * asset, an EXECUTION_FAILED decision, items already returned ("gone"), other approval types, approvals with no
 * asset, leavers sharing a name, a non-leaver, IT access and Microsoft 365.
 */

type Row = Record<string, unknown>;

const DAY = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

const h = vi.hoisted(() => ({
  employees: [] as Record<string, unknown>[],
  departments: [] as Record<string, unknown>[],
  assets: [] as Record<string, unknown>[],
  approvals: [] as Record<string, unknown>[],
  users: [] as Record<string, unknown>[],
  calls: [] as string[],
  args: {} as Record<string, unknown>,
}));

/** Enough of Prisma's where semantics for the reads under test: equals, not, gte, in, OR, AND. */
function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, cond]) => {
    if (key === "OR") return (cond as Row[]).some((w) => matches(row, w));
    if (key === "AND") return (cond as Row[]).every((w) => matches(row, w));
    const v = row[key];
    if (cond !== null && typeof cond === "object" && !(cond instanceof Date)) {
      const c = cond as Row;
      if ("not" in c && (c.not === null ? v === null : v === c.not)) return false;
      if ("gte" in c && !(v instanceof Date && v.getTime() >= (c.gte as Date).getTime())) return false;
      if ("in" in c && !(c.in as unknown[]).includes(v)) return false;
      return true;
    }
    return cond instanceof Date ? v instanceof Date && v.getTime() === cond.getTime() : v === cond;
  });
}

function pick(row: Row, select: Row): Row {
  const out: Row = {};
  for (const [key, sel] of Object.entries(select)) {
    if (sel === true) out[key] = row[key];
    else if (key === "claimedBy") {
      const u = h.users.find((x) => x.id === row.claimedById);
      out[key] = u ? pick(u, (sel as { select: Row }).select) : null;
    }
  }
  return out;
}

/** The employee's relations, as an include (sel === true) or a nested select would load them. */
function relation(e: Row, key: string, sel: unknown): unknown {
  const nested = sel === true ? null : (sel as { select?: Row; where?: Row });
  if (key === "department") {
    const d = h.departments.find((x) => x.id === e.departmentId)!;
    return nested?.select ? pick(d, nested.select) : d;
  }
  if (key === "assets") {
    const list = h.assets.filter((a) => a.assigneeId === e.id);
    return nested?.select ? list.map((a) => pick(a, nested.select!)) : list;
  }
  if (key === "approvals") {
    const list = h.approvals.filter((a) => a.employeeId === e.id && matches(a, nested?.where));
    return nested?.select ? list.map((a) => pick(a, nested.select!)) : list;
  }
  throw new Error(`fake prisma: no relation ${key}`);
}

const RELATIONS = new Set(["department", "assets", "approvals"]);

vi.mock("@/server/db/client", () => ({
  prisma: {
    employee: {
      findMany: async (args: { where: Row; orderBy: Array<Record<string, "asc">>; include?: Row; select?: Row }) => {
        h.calls.push("employee.findMany");
        h.args.employee = args;
        const rows = h.employees.filter((e) => matches(e, args.where));
        rows.sort((a, b) => {
          for (const o of args.orderBy) {
            const [k] = Object.keys(o);
            const x = String(a[k]), y = String(b[k]);
            if (x !== y) return x < y ? -1 : 1;
          }
          return 0;
        });
        return rows.map((e) => {
          if (args.include) {
            const out: Row = { ...e };
            for (const [k, sel] of Object.entries(args.include)) out[k] = relation(e, k, sel);
            return out;
          }
          const out: Row = {};
          for (const [k, sel] of Object.entries(args.select!)) out[k] = RELATIONS.has(k) ? relation(e, k, sel) : e[k];
          return out;
        });
      },
    },
    approval: {
      findMany: async (args: { where: Row; select: Row }) => {
        h.calls.push("approval.findMany");
        h.args.approval = args;
        return h.approvals.filter((a) => matches(a, args.where)).map((a) => pick(a, args.select));
      },
    },
  },
}));

import { leaverStates } from "./queries";

const ret = (id: string, assetId: string | null, state: string, createdAt: string, employeeId: string, extra: Row = {}): Row => ({
  id, refNo: `APR-${id}`, type: "lifecycle_return", state, createdAt: new Date(createdAt), assetId, employeeId,
  payload: { to: { status: "SPARE" }, reason: `why ${id}` }, claimedById: null, resolvedAt: null, ...extra,
});

const person = (id: string, name: string, employeeNo: string, extra: Row = {}): Row => ({
  id, name, employeeNo, title: `Title ${id}`, departmentId: "d1", employment: "OFFBOARDING",
  m365Status: null, offboardingAt: null, offboardingDueAt: null, joinedAt: DAY("2022-03-04"),
  entraStatus: null, autopilotStatus: null, argusStatus: null, vpn: null,
  createdAt: DAY("2022-03-04"), updatedAt: DAY("2026-10-01"), ...extra,
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-19T04:00:00.000Z"));
  h.calls.length = 0;
  h.users = [{ id: "u1", name: "Neil Lucero" }];
  h.departments = [{ id: "d1", name: "IT Operations", kind: "INTERNAL" }];
  h.employees = [
    person("e1", "Ana Cruz", "E-001", {
      offboardingAt: DAY("2026-10-01"), offboardingDueAt: DAY("2026-10-30"), m365Status: "active",
      entraStatus: "DONE", vpn: "Cloudflare WARP",
    }),
    person("e2", "Ben Dela", "E-002"), // no anchor: nothing historical is decided
    person("e3", "Carla Reyes", "E-003", {
      offboardingAt: DAY("2026-09-15"), offboardingDueAt: DAY("2026-10-10"), m365Status: "blocked",
      entraStatus: "REMOVED", autopilotStatus: "NOT_NEEDED", argusStatus: "NOT_YET", vpn: "None",
    }),
    person("e4", "Dan Ilagan", "E-004", { employment: "ACTIVE", offboardingAt: DAY("2026-10-01") }),
    person("e5", "Ana Cruz", "E-000", { offboardingAt: DAY("2026-10-12"), offboardingDueAt: DAY("2026-11-30") }),
    person("e6", "Eli Santos", "E-006", { offboardingAt: DAY("2026-10-02"), offboardingDueAt: DAY("2026-11-02") }),
  ];
  h.assets = [
    { id: "a1", assigneeId: "e1" }, { id: "a2", assigneeId: "e1" }, { id: "a3", assigneeId: "e1" },
    { id: "a4", assigneeId: "e2" }, { id: "a5", assigneeId: "e3" }, { id: "a7", assigneeId: "e4" },
    { id: "a10", assigneeId: "e6" },
  ];
  h.approvals = [
    // e1: a1 decided inside the window; an EXECUTED return from before the window does not count
    ret("p0", "a1", "EXECUTED", "2026-09-01T00:00:00Z", "e1"),
    ret("p1", "a1", "PENDING", "2026-10-05T00:00:00Z", "e1", { claimedById: "u1" }),
    // a2: only REJECTED, so still to decide
    ret("p2", "a2", "REJECTED", "2026-10-06T00:00:00Z", "e1"),
    // a3: decided, but its return failed to execute
    ret("p3", "a3", "EXECUTION_FAILED", "2026-10-07T00:00:00Z", "e1", {
      payload: { to: { status: "DEFECTIVE" } }, resolvedAt: new Date("2026-10-07T05:00:00Z"),
    }),
    // a9: already returned in this offboarding (no longer held) — decided and gone
    ret("p4", "a9", "EXECUTED", "2026-10-03T00:00:00Z", "e1"),
    // a8: not held, only rejected — neither decided nor counted
    ret("p5", "a8", "REJECTED", "2026-10-04T00:00:00Z", "e1"),
    // other types and asset-less returns never decide anything
    { ...ret("p6", "a2", "PENDING", "2026-10-08T00:00:00Z", "e1"), type: "lifecycle_assign" },
    ret("p7", null, "PENDING", "2026-10-08T00:00:00Z", "e1"),
    // e2 has no anchor: a return in their name is never in a window
    ret("p8", "a4", "PENDING", "2026-10-10T00:00:00Z", "e2"),
    // e3: a5 was returned (EXECUTED) and came back; the later PENDING decides this holding; a REJECTED after it
    ret("p9", "a5", "EXECUTED", "2026-09-20T00:00:00Z", "e3"),
    ret("p10", "a5", "PENDING", "2026-09-25T00:00:00Z", "e3", { payload: { to: { status: "MISSING" } } }),
    ret("p11", "a5", "REJECTED", "2026-09-26T00:00:00Z", "e3"),
    // a6: returned at exactly the offboarding instant — inside the window (>=)
    ret("p12", "a6", "EXECUTED", "2026-09-15T00:00:00.000Z", "e3"),
    // one millisecond before the window: outside it
    ret("p13", "a11", "EXECUTED", "2026-09-14T23:59:59.999Z", "e3"),
    // e4 is not a leaver
    ret("p14", "a7", "PENDING", "2026-10-05T00:00:00Z", "e4"),
    // e6: a PENDING whose payload names no outcome is not a decision; a return of a held asset in someone else's name
    ret("p15", "a10", "PENDING", "2026-10-05T00:00:00Z", "e6", { payload: { to: { assigneeId: null } } }),
    ret("p16", "a10", "PENDING", "2026-10-06T00:00:00Z", "e1"),
    // e1: after the earliest leaver's start (e3's) but before e1's own — outside e1's window, so a2 stays undecided
    ret("p17", "a2", "PENDING", "2026-09-20T00:00:00Z", "e1"),
  ];
});

afterEach(() => {
  vi.useRealTimers();
});

const EXPECTED = [
  {
    id: "e5", name: "Ana Cruz", employeeNo: "E-000", title: "Title e5", department: "IT Operations", departmentId: "d1",
    m365: null, itAccess: 0, itemsOut: 0, decided: 0, total: 0, undecided: 0,
    started: DAY("2026-10-12"), joined: "04 Mar 2022", dueAt: DAY("2026-11-30"), employment: "OFFBOARDING",
    failed: null, attention: { kind: "ready", label: "ready to complete", severity: 1000 },
  },
  {
    id: "e1", name: "Ana Cruz", employeeNo: "E-001", title: "Title e1", department: "IT Operations", departmentId: "d1",
    // held a1 (p1) and a3 (p3, failed) decided, a2 not; gone a9 (p4) and a10 (p16, filed in e1's name) decided
    m365: "active", itAccess: 2, itemsOut: 3, decided: 4, total: 5, undecided: 1,
    started: DAY("2026-10-01"), joined: "04 Mar 2022", dueAt: DAY("2026-10-30"), employment: "OFFBOARDING",
    failed: { refNo: "APR-p3", approvalId: "p3" },
    attention: { kind: "failed", label: "return failed · APR-p3", severity: 6000 },
  },
  {
    id: "e2", name: "Ben Dela", employeeNo: "E-002", title: "Title e2", department: "IT Operations", departmentId: "d1",
    m365: null, itAccess: 0, itemsOut: 1, decided: 0, total: 1, undecided: 1,
    started: null, joined: "04 Mar 2022", dueAt: null, employment: "OFFBOARDING",
    failed: null, attention: { kind: "no-date", label: "no completion date", severity: 4000 },
  },
  {
    id: "e3", name: "Carla Reyes", employeeNo: "E-003", title: "Title e3", department: "IT Operations", departmentId: "d1",
    m365: "blocked", itAccess: 0, itemsOut: 1, decided: 2, total: 2, undecided: 0,
    started: DAY("2026-09-15"), joined: "04 Mar 2022", dueAt: DAY("2026-10-10"), employment: "OFFBOARDING",
    failed: null, attention: { kind: "overdue", label: "overdue by 9 d", severity: 5009 },
  },
  {
    id: "e6", name: "Eli Santos", employeeNo: "E-006", title: "Title e6", department: "IT Operations", departmentId: "d1",
    m365: null, itAccess: 0, itemsOut: 1, decided: 0, total: 1, undecided: 1,
    started: DAY("2026-10-02"), joined: "04 Mar 2022", dueAt: DAY("2026-11-02"), employment: "OFFBOARDING",
    failed: null, attention: { kind: "undecided", label: "1 to decide", severity: 3001 },
  },
];

describe("leaverStates (Phase 43: the same rows from a narrower read)", () => {
  it("returns every leaver's row exactly as before, in name / number / id order", async () => {
    expect(await leaverStates()).toEqual(EXPECTED);
  });

  it("gives the same rows whatever order the database hands the approvals back in", async () => {
    h.approvals.reverse();
    expect(await leaverStates()).toEqual(EXPECTED);
  });

  it("reads only the employee fields the rows are built from, not whole rows", async () => {
    await leaverStates();
    const args = h.args.employee as { include?: unknown; select: Record<string, unknown> };
    expect(args.include).toBeUndefined();
    expect(Object.keys(args.select).sort()).toEqual([
      "argusStatus", "assets", "autopilotStatus", "department", "departmentId", "employeeNo", "employment", "entraStatus",
      "id", "joinedAt", "m365Status", "name", "offboardingAt", "offboardingDueAt", "title", "vpn",
    ]);
    expect(args.select.department).toEqual({ select: { name: true } });
    expect(args.select.assets).toEqual({ select: { id: true } });
  });

  it("reads only returns that can decide something: anchored leavers', from the earliest start, never REJECTED", async () => {
    await leaverStates();
    expect(h.calls).toEqual(["employee.findMany", "approval.findMany"]);
    const { where } = h.args.approval as { where: Record<string, unknown> };
    expect(where).toEqual({
      type: "lifecycle_return",
      assetId: { not: null },
      state: { not: "REJECTED" },
      employeeId: { in: ["e5", "e1", "e3", "e6"] }, // e2 has no start, so no window
      createdAt: { gte: DAY("2026-09-15") }, // e3's start, the earliest
    });
  });

  it("skips the approval read when no leaver has a start to window from", async () => {
    h.employees = h.employees.filter((e) => e.id === "e2");
    const rows = await leaverStates();
    expect(rows.map((r) => [r.id, r.decided, r.undecided])).toEqual([["e2", 0, 1]]);
    expect(h.calls).toEqual(["employee.findMany"]);
  });

  it("no leavers, no rows", async () => {
    h.employees = [];
    expect(await leaverStates()).toEqual([]);
  });
});
