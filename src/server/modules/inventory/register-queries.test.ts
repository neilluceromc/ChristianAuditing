import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * PO form redesign Task 3 (spec §5b.6): an IT category Purchasing created from a PO is usable on purchase orders only
 * until IT confirms it — direct Register (and the PO register page's category list) never offers it.
 */

const h = vi.hoisted(() => ({ cats: [] as Array<Record<string, unknown>> }));

vi.mock("@/server/db/client", () => {
  type W = { cls?: { in: string[] }; confirmedAt?: { not: null } };
  return {
    prisma: {
      assetCategory: {
        findMany: async ({ where }: { where: W }) =>
          h.cats
            .filter((c) => !where.cls || where.cls.in.includes(String(c.cls)))
            .filter((c) => !where.confirmedAt || c.confirmedAt != null)
            .map((c) => ({ ...c, tagPrefix: null, types: [] })),
      },
      asset: { groupBy: async () => [], findMany: async () => [] },
    },
  };
});

import { registerCatalog } from "./register-queries";

beforeEach(() => {
  h.cats = [
    { id: "cat-lt", name: "Laptops", cls: "IT", confirmedAt: new Date("2026-01-01T00:00:00Z") },
    { id: "cat-new", name: "Network cable", cls: "IT", confirmedAt: null },
    { id: "cat-ch", name: "Chairs", cls: "PURCHASING", confirmedAt: new Date("2026-01-01T00:00:00Z") },
  ];
});

describe("registerCatalog", () => {
  it("registerCatalog hides unconfirmed", async () => {
    const it = await registerCatalog(["IT"]);
    expect(it.map((c) => c.id)).toEqual(["cat-lt"]);
    const both = await registerCatalog(["IT", "PURCHASING"]);
    expect(both.map((c) => c.id).sort()).toEqual(["cat-ch", "cat-lt"]);
  });
});
