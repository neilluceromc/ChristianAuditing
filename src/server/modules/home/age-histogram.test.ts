import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";

/*
 * Phase 43 (Task 4, item 6): ageHistogram counts the five buckets in SQL instead of loading every IT asset's
 * purchasedAt. home.test.ts proves the bounds split exactly where ageBucket does; this pins the SQL that uses them —
 * the IT class only, nulls in no bucket, each bucket's predicate against the right bound — and the mapping back.
 */

const h = vi.hoisted(() => ({ queryRaw: vi.fn() }));
vi.mock("@/server/db/client", () => ({ prisma: { $queryRaw: h.queryRaw } }));

import { ageBucketBounds } from "@/lib/home";
import { ageHistogram } from "./queries";

const NOW = new Date("2026-10-19T04:00:00.000Z");

beforeEach(() => {
  h.queryRaw.mockReset();
  h.queryRaw.mockResolvedValue([{ lt1: 5n, y1: 4n, y2: 0n, y3: 2n, y4: 9n }]);
});

describe("ageHistogram (Phase 43: counted in SQL)", () => {
  it("returns the five buckets in order with the database's counts", async () => {
    expect(await ageHistogram(NOW)).toEqual([
      { bucket: "<1y", count: 5 }, { bucket: "1–2y", count: 4 }, { bucket: "2–3y", count: 0 },
      { bucket: "3–4y", count: 2 }, { bucket: "4y+", count: 9 },
    ]);
    expect(h.queryRaw).toHaveBeenCalledTimes(1);
  });

  it("counts IT assets against the four bounds, comparing the stored UTC timestamps", async () => {
    await ageHistogram(NOW);
    const sql = h.queryRaw.mock.calls[0][0] as Prisma.Sql;
    const b = (i: number) => `($${i}::timestamptz AT TIME ZONE 'UTC')`;
    expect(sql.text.replace(/\s+/g, " ").trim()).toBe(
      "SELECT " +
        `COUNT(*) FILTER (WHERE "purchasedAt" > ${b(1)}) AS "lt1", ` +
        `COUNT(*) FILTER (WHERE "purchasedAt" <= ${b(2)} AND "purchasedAt" > ${b(3)}) AS "y1", ` +
        `COUNT(*) FILTER (WHERE "purchasedAt" <= ${b(4)} AND "purchasedAt" > ${b(5)}) AS "y2", ` +
        `COUNT(*) FILTER (WHERE "purchasedAt" <= ${b(6)} AND "purchasedAt" > ${b(7)}) AS "y3", ` +
        `COUNT(*) FILTER (WHERE "purchasedAt" <= ${b(8)}) AS "y4" ` +
        `FROM "Asset" WHERE "cls" = 'IT'::"AssetClass"`,
    );
    const [b0, b1, b2, b3] = ageBucketBounds(NOW);
    expect(sql.values).toEqual([b0, b0, b1, b1, b2, b2, b3, b3]);
  });
});
