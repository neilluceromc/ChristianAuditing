import { describe, expect, it, vi } from "vitest";

/*
 * Document preview (Task 1): a stock lot's documents carry when each file was uploaded (an ISO string of createdAt)
 * and by whom (a name, or null for a row nobody uploaded), beside the date they already had.
 */

const h = vi.hoisted(() => ({ lots: [] as Record<string, unknown>[] }));

vi.mock("@/server/db/client", () => ({
  prisma: {
    stockLot: { findMany: async () => h.lots },
    stockAllocation: { groupBy: async () => [] },
  },
}));

import { itemLots } from "./queries";

describe("itemLots documents", () => {
  it("each lot document carries uploadedAt and uploadedBy, and keeps its date and download link", async () => {
    const at = new Date("2026-10-22T01:41:00Z");
    h.lots = [{
      id: "l1", origin: "RECEIVED", lotDate: at, expiresAt: null, unitCost: null, quantity: 5, reference: null,
      supplier: null, receivedBy: { name: "Ivan Tan" },
      documents: [
        { id: "d2", kind: "delivery-receipt", fileName: "dr.pdf", createdAt: at, uploadedBy: { name: "Ivan Tan" } },
        { id: "d1", kind: "other", fileName: "old.jpg", createdAt: at, uploadedBy: null },
      ],
    }];
    const lots = await itemLots("i1", "2026-10-23");
    expect(lots.open[0].documents).toEqual([
      {
        id: "d2", kind: "delivery-receipt", fileName: "dr.pdf", uploadedAt: "2026-10-22T01:41:00.000Z", uploadedBy: "Ivan Tan",
        at: "22 Oct 2026", downloadHref: "/stock/lots/l1/documents/d2/download",
      },
      {
        id: "d1", kind: "other", fileName: "old.jpg", uploadedAt: "2026-10-22T01:41:00.000Z", uploadedBy: null,
        at: "22 Oct 2026", downloadHref: "/stock/lots/l1/documents/d1/download",
      },
    ]);
  });
});
