import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Task 7 (spec §7): the bell's writes are the signed-in person's own read state. Someone on a team marks only their
 * team's notifications; an admin marks any team's, and must name the team for "Mark all read".
 */

type Row = Record<string, unknown>;

const h = vi.hoisted(() => ({
  user: null as null | { id: string; name: string; role: string },
  notifications: [] as Array<Record<string, unknown>>,
  reads: [] as Array<{ notificationId: string; userId: string }>,
}));

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/server/auth/guards", () => ({ actionUser: async () => h.user }));
vi.mock("@/server/db/client", () => {
  const matches = (n: Row, where: Row): boolean =>
    Object.entries(where).every(([k, v]) => {
      if (k === "reads") return !h.reads.some((r) => r.notificationId === n.id && r.userId === (v as { none: { userId: string } }).none.userId);
      if (v !== null && typeof v === "object" && !(v instanceof Date)) {
        const op = v as { in?: unknown[]; gte?: Date };
        if (op.in) return op.in.includes(n[k]);
        if (op.gte) return (n[k] as Date) >= op.gte;
      }
      return n[k] === v;
    });
  return {
    prisma: {
      notification: {
        findMany: async ({ where }: { where: Row }) => h.notifications.filter((n) => matches(n, where)).map((n) => ({ id: n.id })),
        count: async ({ where }: { where: Row }) => h.notifications.filter((n) => matches(n, where)).length,
      },
      notificationRead: {
        createMany: async ({ data }: { data: Array<{ notificationId: string; userId: string }> }) => {
          const fresh = data.filter((d) => !h.reads.some((r) => r.notificationId === d.notificationId && r.userId === d.userId));
          h.reads.push(...fresh);
          return { count: fresh.length };
        },
      },
    },
  };
});

import { bellCount, markAllRead, markRead } from "./actions";

const now = () => new Date();
beforeEach(() => {
  h.user = { id: "itA", name: "Ivy", role: "it_staff" };
  h.reads = [];
  h.notifications = [
    { id: "n1", team: "IT", createdAt: now() },
    { id: "n2", team: "IT", createdAt: now() },
    { id: "n3", team: "PURCHASING", createdAt: now() },
  ];
});

describe("markRead", () => {
  it("marks for this person only, and only their team's", async () => {
    const r = await markRead({ ids: ["n1", "n3"] });
    expect(r).toEqual({ ok: true, data: { count: 1 } });
    expect(h.reads).toEqual([{ notificationId: "n1", userId: "itA" }]);
    h.user = { id: "itB", name: "Ben", role: "it_staff" };
    expect(await bellCount()).toEqual({ count: 2 });
  });

  it("twice is still once", async () => {
    await markRead({ ids: ["n1"] });
    await markRead({ ids: ["n1"] });
    expect(h.reads).toHaveLength(1);
  });

  it("a viewer has no team and marks nothing; signed out is refused", async () => {
    h.user = { id: "v", name: "Vic", role: "viewer" };
    expect((await markRead({ ids: ["n1"] })).ok).toBe(false);
    h.user = null;
    expect((await markRead({ ids: ["n1"] })).ok).toBe(false);
    expect(await bellCount()).toEqual({ count: 0 });
    expect(h.reads).toEqual([]);
  });
});

describe("markAllRead", () => {
  it("marks the person's own team, whatever team they name", async () => {
    const r = await markAllRead({ team: "PURCHASING" });
    expect(r).toEqual({ ok: true, data: { marked: 2 } });
    expect(h.reads.map((x) => x.notificationId)).toEqual(["n1", "n2"]);
  });

  it("an admin must name the team", async () => {
    h.user = { id: "adm", name: "Ada", role: "admin" };
    expect((await markAllRead()).ok).toBe(false);
    expect(await markAllRead({ team: "PURCHASING" })).toEqual({ ok: true, data: { marked: 1 } });
    expect(h.reads).toEqual([{ notificationId: "n3", userId: "adm" }]);
  });
});
