import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ calls: [] as Array<{ model: string; where: unknown }> }));

vi.mock("@/server/db/client", () => ({
  prisma: {
    assetNote: {
      count: async (args: { where: Record<string, unknown> }) => {
        h.calls.push({ model: "assetNote", where: args.where });
        return args.where.resolvedAt === null ? 1 : 3;
      },
    },
    assetDocument: {
      count: async (args: { where: unknown }) => {
        h.calls.push({ model: "assetDocument", where: args.where });
        return 2;
      },
    },
  },
}));

const { recordTabCounts } = await import("./record-counts");

describe("recordTabCounts (Phase 47 Task 8)", () => {
  it("counts threads (no parent), unresolved threads and attachment documents for the asset", async () => {
    const counts = await recordTabCounts("a1");
    expect(counts).toEqual({ notes: 3, openNotes: 1, attachments: 2 });
    expect(h.calls).toContainEqual({ model: "assetNote", where: { assetId: "a1", parentId: null } });
    expect(h.calls).toContainEqual({ model: "assetNote", where: { assetId: "a1", parentId: null, resolvedAt: null } });
    expect(h.calls).toContainEqual({ model: "assetDocument", where: { assetId: "a1", kind: { startsWith: "attachment:" } } });
  });
});
