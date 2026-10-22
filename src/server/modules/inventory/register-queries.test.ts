import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * PO form redesign Task 3 (spec §5b.6): an IT category Purchasing created from a PO is usable on purchase orders only
 * until IT confirms it — direct Register never offers it. The PO register page passes its lines' own categories in
 * `include`, so a line's new category still brings its types and models.
 */

const h = vi.hoisted(() => ({ cats: [] as Array<Record<string, unknown>> }));

vi.mock("@/server/db/client", () => {
  type W = { cls: { in: string[] }; OR: Array<{ confirmedAt?: { not: null }; id?: { in: string[] } }> };
  const pass = (c: Record<string, unknown>, w: W) =>
    w.cls.in.includes(String(c.cls)) &&
    w.OR.some((o) => (o.confirmedAt ? c.confirmedAt != null : o.id ? o.id.in.includes(String(c.id)) : false));
  return {
    prisma: {
      assetCategory: {
        findMany: async ({ where }: { where: W }) => h.cats.filter((c) => pass(c, where)).map((c) => ({ ...c, tagPrefix: null })),
      },
      asset: { groupBy: async () => [], findMany: async () => [] },
    },
  };
});

import { registerCatalog } from "./register-queries";

const CONFIRMED = new Date("2026-01-01T00:00:00Z");

beforeEach(() => {
  h.cats = [
    { id: "cat-lt", name: "Laptops", cls: "IT", confirmedAt: CONFIRMED, types: [] },
    { id: "cat-new", name: "Network cable", cls: "IT", confirmedAt: null, types: [{ id: "type-c6", name: "Cat6" }] },
    { id: "cat-ch", name: "Chairs", cls: "PURCHASING", confirmedAt: CONFIRMED, types: [] },
  ];
});

describe("registerCatalog", () => {
  it("registerCatalog hides unconfirmed", async () => {
    const it = await registerCatalog(["IT"]);
    expect(it.map((c) => c.id)).toEqual(["cat-lt"]);
    expect(it[0].confirmed).toBe(true);
    const both = await registerCatalog(["IT", "PURCHASING"]);
    expect(both.map((c) => c.id).sort()).toEqual(["cat-ch", "cat-lt"]);
  });

  it("includes an unconfirmed category when its id is in `include`, marked unconfirmed, with its types", async () => {
    const cats = await registerCatalog(["IT"], ["cat-new"]);
    expect(cats.map((c) => [c.id, c.confirmed])).toEqual([["cat-lt", true], ["cat-new", false]]);
    expect(cats.find((c) => c.id === "cat-new")!.types).toEqual([{ id: "type-c6", name: "Cat6" }]);
    // `include` never widens the classes asked for.
    expect((await registerCatalog(["PURCHASING"], ["cat-new"])).map((c) => c.id)).toEqual(["cat-ch"]);
  });
});
