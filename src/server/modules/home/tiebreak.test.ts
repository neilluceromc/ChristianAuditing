import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Phase 43 (final review, Minor 1): the Home reads that order on a column that can tie and then `take` N carry an
 * `id` tiebreak as the last key, so the capped slice cannot reorder between runs when the planner swaps a sort for
 * an index scan. Seeded rows share one now(), so those ties are real.
 */

const h = vi.hoisted(() => ({
  approvalFindMany: vi.fn(),
  assetFindMany: vi.fn(),
  employeeFindMany: vi.fn(),
}));
vi.mock("@/server/db/client", () => ({
  prisma: {
    approval: { findMany: h.approvalFindMany },
    asset: { findMany: h.assetFindMany },
    employee: { findMany: h.employeeFindMany },
  },
}));

import { claimedByYou, hireWorkRows, warrantyRunway } from "./queries";

beforeEach(() => {
  h.approvalFindMany.mockReset().mockResolvedValue([]);
  h.assetFindMany.mockReset().mockResolvedValue([]);
  h.employeeFindMany.mockReset().mockResolvedValue([]);
});

describe("Home reads break ties on id", () => {
  it("claimedByYou: slaAt asc, then id asc, take 5", async () => {
    await claimedByYou("u1", "admin");
    const args = h.approvalFindMany.mock.calls[0][0];
    expect(args.orderBy).toEqual([{ slaAt: "asc" }, { id: "asc" }]);
    expect(args.take).toBe(5);
  });

  it("warrantyRunway: warrantyUntil asc, then id asc, take 8", async () => {
    await warrantyRunway(new Date("2026-10-19T04:00:00.000Z"));
    const args = h.assetFindMany.mock.calls[0][0];
    expect(args.orderBy).toEqual([{ warrantyUntil: "asc" }, { id: "asc" }]);
    expect(args.take).toBe(8);
  });

  it("hireWorkRows: joinedAt asc, then id asc", async () => {
    await hireWorkRows(new Date("2026-10-19T04:00:00.000Z"));
    expect(h.employeeFindMany.mock.calls[0][0].orderBy).toEqual([{ joinedAt: "asc" }, { id: "asc" }]);
  });
});
