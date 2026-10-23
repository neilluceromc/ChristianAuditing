import { describe, expect, it, vi } from "vitest";

/*
 * Document preview (Task 1): a vendor's documents carry when each file was uploaded (an ISO string of createdAt) and
 * by whom (a name, or null for a row nobody uploaded), beside the date the table already shows.
 */

const h = vi.hoisted(() => ({ vendor: null as Record<string, unknown> | null }));

vi.mock("@/server/db/client", () => ({
  prisma: {
    vendor: { findUnique: async () => h.vendor },
    purchaseOrder: { findMany: async () => [] },
    asset: { findMany: async () => [] },
  },
}));

import { getSupplier } from "./queries";

describe("getSupplier documents", () => {
  it("each document carries uploadedAt and uploadedBy, and keeps its date and download link", async () => {
    const at = new Date("2026-10-22T01:41:00Z");
    h.vendor = {
      id: "v1", name: "Octagon", registeredName: null, category: null, contactPerson: null, phone: null, email: null,
      address: null, registrationNo: null, contractStatus: "ACTIVE", contractStart: null, contractEnd: null,
      contractTerms: null, notes: null, archivedAt: null, locked: false, createdAt: at, updatedAt: at,
      bankAccounts: [],
      documents: [
        { id: "d2", kind: "permit", fileName: "permit.pdf", createdAt: at, uploadedBy: { name: "Ana Reyes" } },
        { id: "d1", kind: "other", fileName: "old.png", createdAt: new Date("2026-10-01T00:00:00Z"), uploadedBy: null },
      ],
      _count: { requests: 0, assets: 0 },
    };
    const s = await getSupplier("v1", { requests: 1, assets: 1 });
    expect(s!.documents).toEqual([
      {
        id: "d2", kind: "permit", fileName: "permit.pdf", uploadedAt: "2026-10-22T01:41:00.000Z", uploadedBy: "Ana Reyes",
        at: "22 Oct 2026", downloadHref: "/purchases/suppliers/v1/documents/d2/download",
      },
      {
        id: "d1", kind: "other", fileName: "old.png", uploadedAt: "2026-10-01T00:00:00.000Z", uploadedBy: null,
        at: "01 Oct 2026", downloadHref: "/purchases/suppliers/v1/documents/d1/download",
      },
    ]);
  });
});
