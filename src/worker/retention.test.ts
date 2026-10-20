import { describe, expect, it, vi } from "vitest";

/* Phase 46 (spec §2.3): the hourly prune drops MetricSnapshot days older than 400 Manila days, and keeps the rest. */

const h = vi.hoisted(() => ({ snapshotWheres: [] as unknown[] }));

vi.mock("../server/db/client", () => {
  const none = { findMany: async () => [], deleteMany: async () => ({ count: 0 }) };
  return {
    prisma: {
      webhookDelivery: none,
      job: none,
      crisConversation: none,
      crisPendingAction: none,
      metricSnapshot: {
        deleteMany: async ({ where }: { where: unknown }) => {
          h.snapshotWheres.push(where);
          return { count: 3 };
        },
      },
    },
  };
});

import { pruneRetention } from "./retention";

describe("pruneRetention: MetricSnapshot", () => {
  it("deletes day < (Manila today − 400 days), so the 400th day back is kept", async () => {
    // 03:00Z is 2026-10-20 in Manila; 400 days before is 2025-09-15
    const r = await pruneRetention(new Date("2026-10-20T03:00:00Z"));
    expect(h.snapshotWheres).toEqual([{ day: { lt: new Date("2025-09-15T00:00:00.000Z") } }]);
    expect(r.metricSnapshots).toBe(3);
  });

  it("uses the Manila day: 16:00Z is already the next day, so the cutoff moves with it", async () => {
    h.snapshotWheres = [];
    await pruneRetention(new Date("2026-10-20T16:00:00Z"));
    expect(h.snapshotWheres).toEqual([{ day: { lt: new Date("2025-09-16T00:00:00.000Z") } }]);
  });
});
