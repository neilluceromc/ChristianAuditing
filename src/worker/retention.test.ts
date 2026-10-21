import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Phase 46 (spec §2.3): the hourly prune drops MetricSnapshot days older than 400 Manila days, and keeps the rest.
 * Task 7 (spec §7): it drops bell notifications older than 90 days; their per-person reads go with them (the
 * NotificationRead foreign key cascades).
 */

type Note = { id: string; createdAt: Date };

const h = vi.hoisted(() => ({
  snapshotWheres: [] as unknown[],
  notifications: [] as Note[],
  reads: [] as Array<{ notificationId: string; userId: string }>,
  notificationWheres: [] as unknown[],
}));

vi.mock("../server/db/client", () => {
  const none = { findMany: async () => [], deleteMany: async () => ({ count: 0 }) };
  return {
    prisma: {
      webhookDelivery: none,
      job: none,
      crisConversation: none,
      crisPendingAction: none,
      // The FK's ON DELETE CASCADE, as Postgres applies it (asserted against the migration below).
      notification: {
        findMany: async ({ where, take }: { where: { createdAt: { lt: Date } }; take: number }) => {
          h.notificationWheres.push(where);
          return h.notifications.filter((n) => n.createdAt < where.createdAt.lt).slice(0, take).map((n) => ({ id: n.id }));
        },
        deleteMany: async ({ where }: { where: { id: { in: string[] }; createdAt: { lt: Date } } }) => {
          const gone = h.notifications.filter((n) => where.id.in.includes(n.id) && n.createdAt < where.createdAt.lt);
          const ids = new Set(gone.map((n) => n.id));
          h.notifications = h.notifications.filter((n) => !ids.has(n.id));
          h.reads = h.reads.filter((r) => !ids.has(r.notificationId));
          return { count: gone.length };
        },
      },
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

beforeEach(() => {
  h.snapshotWheres = [];
  h.notifications = [];
  h.reads = [];
  h.notificationWheres = [];
});

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

describe("pruneRetention: notifications (Task 7, spec §7)", () => {
  const NOW = new Date("2026-10-21T03:00:00Z");
  const ago = (days: number, ms = 0) => new Date(NOW.getTime() - days * 86_400_000 + ms);

  it("drops notifications older than 90 days with their reads, keeps the rest, and reports how many", async () => {
    h.notifications = [
      { id: "old1", createdAt: ago(120) },
      { id: "old2", createdAt: ago(90, -1) },
      { id: "edge", createdAt: ago(90) },
      { id: "new", createdAt: ago(3) },
    ];
    h.reads = [
      { notificationId: "old1", userId: "a" }, { notificationId: "old2", userId: "b" },
      { notificationId: "edge", userId: "a" }, { notificationId: "new", userId: "a" },
    ];
    const r = await pruneRetention(NOW);
    expect(r.notifications).toBe(2);
    expect(h.notifications.map((n) => n.id)).toEqual(["edge", "new"]);
    expect(h.reads.map((x) => x.notificationId)).toEqual(["edge", "new"]);
    expect(h.notificationWheres[0]).toEqual({ createdAt: { lt: ago(90) } });
  });

  it("the reads cascade at the database: NotificationRead's foreign key is ON DELETE CASCADE", () => {
    const sql = readFileSync(
      path.resolve(__dirname, "../../prisma/migrations/20261022090000_purchase_orders/migration.sql"), "utf8",
    );
    expect(sql).toMatch(
      /ALTER TABLE "NotificationRead" ADD CONSTRAINT "NotificationRead_notificationId_fkey" FOREIGN KEY \("notificationId"\) REFERENCES "Notification"\("id"\) ON DELETE CASCADE/,
    );
  });
});
