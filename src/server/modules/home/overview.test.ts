import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@prisma/client";

/* Phase 46 (spec §3.2, IT row): itOverview's wiring — live values, the history keys it reads, hrefs and deltas. */

const h = vi.hoisted(() => ({
  historyKeys: [] as string[],
  history: {} as Record<string, (number | null)[]>,
  counts: [] as unknown[],
}));

vi.mock("@/server/db/client", () => ({
  prisma: {
    approval: {
      count: async (args: { where: { AND: Array<Record<string, unknown>> } }) => {
        h.counts.push(args);
        return args.where.AND.some((w) => "slaAt" in w) ? 2 : 9; // past SLA : open
      },
    },
    $queryRaw: async () => [
      { action: "lifecycle.assign", createdAt: new Date("2026-10-19T02:00:00Z"), statusTo: "DEPLOYED", toPerson: true },
      { action: "lifecycle.assign executed", createdAt: new Date("2026-10-12T02:00:00Z"), statusTo: "DEPLOYED", toPerson: true },
      { action: "lifecycle.change-status executed", createdAt: new Date("2026-10-19T02:00:00Z"), statusTo: "DEFECTIVE", toPerson: null },
      // one replace: the old device's leg (returned) and the new device's leg (assigned)
      { action: "lifecycle.replace", createdAt: new Date("2026-10-18T02:00:00Z"), statusTo: "SPARE", toPerson: false },
      { action: "lifecycle.replace", createdAt: new Date("2026-10-18T02:00:00Z"), statusTo: "DEPLOYED", toPerson: true },
      { action: "lifecycle.triage", createdAt: new Date("2026-10-12T02:00:00Z"), statusTo: "DEFECTIVE", toPerson: null },
      { action: "lifecycle.triage", createdAt: new Date("2026-10-12T02:00:00Z"), statusTo: null, toPerson: null },
    ],
  },
}));
vi.mock("@/server/modules/metrics/history", () => ({
  metricHistory: async (keys: string[]) => {
    h.historyKeys = keys;
    return Object.fromEntries(keys.map((k) => [k, h.history[k] ?? Array(8).fill(null)]));
  },
}));
vi.mock("@/server/modules/inventory/queries", () => ({
  inventoryTileCounts: async () => ({ "in-stock": 12, deployed: 40, "on-loan": 2, "in-repair": 3, missing: 1, attention: 5 }),
}));
vi.mock("@/server/modules/employees/queries", () => ({
  kitGapsByGroup: async () => [{ id: "d1", name: "Acme", kind: "CLIENT", count: 4 }],
}));
vi.mock("./queries", () => ({
  worklist: async () => [],
  claimedByYou: async () => [{ id: "c1", refNo: "APR-1", line1: "Assign", sla: { text: "1 d overdue", overdue: true } }],
  fleet: async () => ({ total: 1, coverage: "", slices: [{ status: "SPARE", count: 1, share: 100, href: "/inventory?status=SPARE" }] }),
}));

import { itOverview } from "./overview";

const NOW = new Date("2026-10-20T03:00:00Z");
const user = (role: Role) => ({ id: "u1", role });

beforeEach(() => {
  h.historyKeys = [];
  h.history = {};
  h.counts = [];
});

describe("itOverview", () => {
  it("six tiles, each linked to the list page it counts", async () => {
    const o = await itOverview(user("it_staff"), NOW);
    expect(o.kpis.map((k) => [k.label, k.value, k.href])).toEqual([
      ["Spare", 12, "/inventory?status=SPARE"],
      ["Deployed", 40, "/inventory?status=DEPLOYED"],
      ["In repair", 3, "/inventory?status=DEFECTIVE"],
      ["Missing", 1, "/inventory?status=MISSING"],
      ["Need attention", 5, "/inventory?attention=1"],
      ["Approvals open", 9, "/approvals"],
    ]);
    expect(o.kpis[5].hint).toBe("2 past SLA");
  });

  it.each([
    ["it_staff", ["approvals.open.it", "approvals.open.none"]],
    ["admin", ["approvals.open.it", "approvals.open.purchasing", "approvals.open.none"]],
    ["viewer", ["approvals.open.it", "approvals.open.purchasing", "approvals.open.none"]],
  ] as Array<[Role, string[]]>)("%s: Approvals history reads exactly the classes its page shows", async (role, keys) => {
    await itOverview(user(role), NOW);
    expect(h.historyKeys.filter((k) => k.startsWith("approvals."))).toEqual(keys);
  });

  it("the spark ends at the live value and the delta is live minus 7 days ago", async () => {
    h.history["it.spare"] = [1, 2, 3, 4, 5, 6, 10, 11];
    h.history["approvals.open.it"] = [1, 1, 1, 1, 1, 1, 3, 3];
    h.history["approvals.open.none"] = [0, 0, 0, 0, 0, 0, 1, 1];
    const o = await itOverview(user("it_staff"), NOW);
    expect(o.kpis[0]).toMatchObject({ spark: [1, 2, 3, 4, 5, 6, 10, 12], delta: { kind: "count", value: 2 } });
    expect(o.kpis[5]).toMatchObject({ spark: [1, 1, 1, 1, 1, 1, 4, 9], delta: { kind: "count", value: 5 } });
    expect(o.kpis[1].delta).toEqual({ kind: "none" }); // no history yet → "collecting history"
  });

  it("a short history gives \"collecting history\", never NaN", async () => {
    h.history["it.missing"] = [4, 5];
    h.history["approvals.open.it"] = [1];
    const o = await itOverview(user("it_staff"), NOW);
    expect(o.kpis[3].delta).toEqual({ kind: "none" });
    expect(o.kpis[5].delta).toEqual({ kind: "none" });
  });

  it("trend, needs-you, make-up and breakdown come from their sources", async () => {
    const o = await itOverview(user("it_staff"), NOW);
    expect(o.trend.series.map((s) => [s.name, s.values.slice(-2)])).toEqual([
      ["Assigned", [1, 2]], ["Returned", [0, 1]], ["To repair", [1, 1]],
    ]);
    expect(o.trend.labels).toHaveLength(12);
    expect(o.needsYou).toEqual([expect.objectContaining({ title: "APR-1 · Assign", tone: "bad", href: "/approvals/c1" })]);
    expect(o.needsYouHref).toBe("/inventory/work");
    expect(o.makeUp.rows).toEqual([{ label: "Spare", value: 1, tone: "chart-3", href: "/inventory?status=SPARE" }]);
    expect(o.breakdown.rows).toEqual([{ label: "Acme", value: 4, href: "/employees?department=d1&gaps=1" }]);
  });

  it("a viewer holds no claims", async () => {
    const o = await itOverview(user("viewer"), NOW);
    expect(o.needsYou).toEqual([]);
  });
});
