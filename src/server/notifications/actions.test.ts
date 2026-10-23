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
      if (k === "AND") return (v as Row[]).every((w) => matches(n, w));
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
        findMany: async ({ where, take, select }: { where: Row; take?: number; select?: { reads?: { where: { userId: string } } } }) =>
          h.notifications.filter((n) => matches(n, where)).slice(0, take ?? Infinity).map((n) => (select?.reads
            ? {
              ...n, kind: "SENT_BACK", title: "t", body: null, href: "/x", actor: null,
              reads: h.reads.filter((r) => r.notificationId === n.id && r.userId === select.reads!.where.userId),
            }
            : { id: n.id })),
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

import { bellCount, bellItems, markAllRead, markRead } from "./actions";

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

  it("an admin marks every team's for themself alone, or one team's when named", async () => {
    h.reads = [{ notificationId: "n1", userId: "itA" }];
    h.user = { id: "adm", name: "Ada", role: "admin" };
    expect(await markAllRead({ team: "PURCHASING" })).toEqual({ ok: true, data: { marked: 1 } });
    expect(h.reads).toEqual([{ notificationId: "n1", userId: "itA" }, { notificationId: "n3", userId: "adm" }]);
    expect(await markAllRead()).toEqual({ ok: true, data: { marked: 2 } });
    expect(h.reads.filter((r) => r.userId === "adm").map((r) => r.notificationId).sort()).toEqual(["n1", "n2", "n3"]);
    // nobody else's read state moved: IT's other person still has both of IT's unread, Ivy still has n2
    expect(h.reads.filter((r) => r.userId !== "adm")).toEqual([{ notificationId: "n1", userId: "itA" }]);
    h.user = { id: "itB", name: "Ben", role: "it_staff" };
    expect(await bellCount()).toEqual({ count: 2 });
  });
});

describe("the admin's bell", () => {
  it("counts every team's unread and lists them, each with its team", async () => {
    h.user = { id: "adm", name: "Ada", role: "admin" };
    expect(await bellCount()).toEqual({ count: 3 });
    const { items } = await bellItems({ tab: "all" });
    expect(items.map((i) => [i.id, i.team]).sort()).toEqual([["n1", "IT"], ["n2", "IT"], ["n3", "PURCHASING"]]);
    expect(await markRead({ ids: ["n3"] })).toEqual({ ok: true, data: { count: 2 } });
  });

  it("a viewer's bell has nothing", async () => {
    h.user = { id: "v", name: "Vic", role: "viewer" };
    expect(await bellItems({ tab: "all" })).toEqual({ items: [] });
  });
});
