import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

/*
 * Final review I3: the /purchases "Ready to register" tab count leaves out completed POs (they stay READY), as the
 * tab's own where does (purchaseWhere) — so the count equals the rows the tab lists.
 */

const h = vi.hoisted(() => ({ countWhere: [] as unknown[], po: null as Record<string, unknown> | null }));

vi.mock("@/server/db/client", () => ({
  prisma: {
    purchaseOrder: {
      groupBy: async () => [
        { state: "WITH_IT", _count: { _all: 3 } },
        { state: "READY", _count: { _all: 75 } },
        { state: "CANCELLED", _count: { _all: 16 } },
      ],
      count: async ({ where }: { where: unknown }) => {
        h.countWhere.push(where);
        return 71;
      },
      findUnique: async () => h.po,
    },
    asset: { groupBy: async () => [], count: async () => 0 },
  },
}));

import { getPurchase, stateCounts } from "./queries";

describe("stateCounts", () => {
  it("Ready to register counts READY POs that are not completed; All still counts every PO", async () => {
    expect(await stateCounts()).toEqual({ ALL: 94, WITH_IT: 3, SENT_BACK: 0, READY: 4, CANCELLED: 16 });
    expect(h.countWhere).toEqual([{ state: "READY", completedAt: { not: null } }]);
  });
});

describe("getPurchase (PO form redesign)", () => {
  it("carries the PO number, paid by, typed totals, the line units, and only the documents not removed", async () => {
    const at = new Date("2026-10-22T02:00:00Z");
    const doc = (id: string, kind: string, supersededAt: Date | null) => ({
      id, kind, fileName: `${id}.pdf`, createdAt: at, uploadedBy: { name: "Pat Lim" }, supersededAt,
    });
    h.po = {
      id: "po1", refNo: "PO-0214", state: "WITH_IT", createdAt: at, submittedAt: null, reviewedAt: null, completedAt: null,
      cancelledAt: null, cancelReason: null, requestedById: "u-pat", invoiceRef: "SI-0012", receiptRef: null,
      purchasedAt: new Date("2026-10-15T00:00:00Z"), fees: null,
      poNumber: "2025-0418", paidBy: "CREDIT_CARD", formV2: true, totalsConsistent: true,
      totalSales: new Prisma.Decimal("9100"), lessVat: new Prisma.Decimal("975"), netOfVat: new Prisma.Decimal("8125"), discount: null,
      amountDue: new Prisma.Decimal("8125"), addVat: new Prisma.Decimal("975"), totalAmountDue: new Prisma.Decimal("9100"),
      sentBackBy: null, sentBackNote: null, sentBackFields: [], sentBackAt: null, sentBackByUser: null,
      _count: { assets: 0 }, requestedBy: { name: "Pat Lim" }, reviewedBy: null, department: null,
      vendor: { id: "v1", name: "Octagon", archivedAt: null },
      documents: [doc("si-2", "invoice", null), doc("si-1", "invoice", at), doc("ws", "warranty-slip", null)],
      lines: [{
        id: "ln1", description: "Laptop", specs: null, categoryId: "cat-lt", category: { name: "Laptops", cls: "IT" },
        qty: 1, unitPrice: new Prisma.Decimal("9100"), unit: "pc", closedShort: 0, closedShortReason: null,
        itSlotNotes: null, financeNotes: null,
      }],
      notes: [],
    };
    const p = await getPurchase("po1");
    expect(p).toMatchObject({
      poNumber: "2025-0418", paidBy: "CREDIT_CARD", formV2: true, totalsConsistent: true,
      totals: { totalSales: 9100, lessVat: 975, netOfVat: 8125, discount: null, amountDue: 8125, addVat: 975, totalAmountDue: 9100 },
      supersededCount: 1,
    });
    expect(p!.units[0].unit).toBe("pc");
    expect(p!.documents.map((d) => d.id)).toEqual(["si-2", "ws"]);
  });
});
