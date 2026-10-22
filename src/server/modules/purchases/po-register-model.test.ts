import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PurchaseDetail } from "./queries";

/*
 * Task 3 fix round 1 (spec §5b.5–6): the PO register page's model. registerCatalog leaves unconfirmed categories out,
 * but a line's own new IT category must still be in the page's catalog — with its types (the server asks for one
 * whenever the category has types) and models — while "choose another" offers confirmed IT categories only.
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

import { poRegisterModel } from "./po-register-model";

const CONFIRMED = new Date("2026-01-01T00:00:00Z");

const unit = (over: Record<string, unknown>) => ({
  id: "ln1", index: 1, description: "network cables", specs: null, categoryId: "cat-new", categoryName: "Network cable",
  cls: "IT", categoryConfirmed: false, qty: 3, unit: "pc", unitPrice: 900, price: "₱900.00", lineTotal: "₱2,700.00",
  registered: 0, closedShort: 0, closedShortReason: null, remaining: 3, progressLabel: "0 of 3 registered",
  itSlotNotes: null, financeNotes: null, ...over,
});

const po = (units: Array<Record<string, unknown>>) => ({ id: "po1", refNo: "PO-0215", state: "WITH_IT", units }) as unknown as PurchaseDetail;

beforeEach(() => {
  h.cats = [
    { id: "cat-lt", name: "Laptops", cls: "IT", confirmedAt: CONFIRMED, types: [] },
    { id: "cat-new", name: "Network cable", cls: "IT", confirmedAt: null, types: [{ id: "type-c6", name: "Cat6" }] },
    { id: "cat-ap", name: "Access point", cls: "IT", confirmedAt: null, types: [] },
    { id: "cat-ch", name: "Chairs", cls: "PURCHASING", confirmedAt: CONFIRMED, types: [] },
  ];
});

describe("poRegisterModel", () => {
  it("gives a line with a new IT category its types, and offers only confirmed IT categories to replace it", async () => {
    const { lines, catalog } = await poRegisterModel(
      po([unit({}), unit({ id: "ln2", index: 2, description: "laptops", categoryId: "cat-lt", categoryName: "Laptops", categoryConfirmed: true })]),
      "it_staff",
    );
    expect(lines.map((l) => [l.id, l.categoryConfirmed, l.registered, l.blocked])).toEqual([
      ["ln1", false, 0, null], ["ln2", true, 0, null],
    ]);

    // The line's own category is in the catalog, with its types — as the form looks it up.
    const own = catalog.find((c) => c.id === lines[0].categoryId);
    expect(own).toMatchObject({ id: "cat-new", confirmed: false, types: [{ id: "type-c6", name: "Cat6" }] });

    // Another PO's unconfirmed category is not pulled in; "choose another" is the confirmed IT ones.
    expect(catalog.some((c) => c.id === "cat-ap")).toBe(false);
    expect(catalog.filter((c) => c.cls === "IT" && c.confirmed).map((c) => c.id)).toEqual(["cat-lt"]);
  });
});
