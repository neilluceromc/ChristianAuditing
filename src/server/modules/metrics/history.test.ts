import { beforeEach, describe, expect, it, vi } from "vitest";

/* Phase 46 (spec §2.4): metricHistory's one read (window, keys) and how it groups the rows back per key. */

const h = vi.hoisted(() => ({
  calls: [] as unknown[],
  rows: [] as Array<{ day: Date; key: string; value: bigint }>,
}));

vi.mock("@/server/db/client", () => ({
  prisma: {
    metricSnapshot: {
      findMany: async (args: unknown) => {
        h.calls.push(args);
        return h.rows;
      },
    },
  },
}));

import { metricHistory } from "./history";

// 03:00Z is 11:00 on 2026-10-20 in Manila
const NOW = new Date("2026-10-20T03:00:00Z");
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

beforeEach(() => {
  h.calls = [];
  h.rows = [];
});

describe("metricHistory", () => {
  it("reads once: the asked-for keys (deduped), days from today−52 to today", async () => {
    await metricHistory(["it.spare", "fin.bookC", "it.spare"], NOW);
    expect(h.calls).toEqual([
      {
        where: { key: { in: ["it.spare", "fin.bookC"] }, day: { gte: day("2026-08-29"), lte: day("2026-10-20") } },
        select: { day: true, key: true, value: true },
      },
    ]);
  });

  it("groups rows per key and reads each @db.Date as its YYYY-MM-DD day", async () => {
    h.rows = [
      { day: day("2026-10-20"), key: "it.spare", value: 125n },
      { day: day("2026-10-11"), key: "it.spare", value: 120n }, // fills 2026-10-13 (2 days earlier)
      { day: day("2026-09-01"), key: "fin.bookC", value: 4_844_200_000n },
    ];
    const r = await metricHistory(["it.spare", "fin.bookC", "admin.disabled"], NOW);
    expect(r).toEqual({
      "it.spare": [null, null, null, null, null, null, 120, 125],
      "fin.bookC": [4_844_200_000, null, null, null, null, null, null, null],
      "admin.disabled": [null, null, null, null, null, null, null, null],
    });
  });

  it("no keys → no read, an empty record", async () => {
    expect(await metricHistory([], NOW)).toEqual({});
    expect(h.calls).toHaveLength(0);
  });
});
