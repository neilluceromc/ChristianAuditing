import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Task 7 (spec §7; Review Focus 4): the bell's read side against an in-memory Prisma. A notification belongs to a
 * team; read state belongs to a person (NotificationRead), so one teammate opening it leaves it unread for the rest.
 * Only the last 90 days count (NOTIFICATION_DAYS, the maintenance worker prunes older ones).
 */

type Row = Record<string, unknown>;

const h = vi.hoisted(() => ({
  notifications: [] as Array<Record<string, unknown>>,
  reads: [] as Array<Record<string, unknown>>,
  users: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/server/db/client", () => {
  type R = Record<string, unknown>;
  const same = (a: unknown, b: unknown) =>
    a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b || (a == null && b == null);
  const readsOf = (n: R) => h.reads.filter((r) => r.notificationId === n.id);
  const matches = (rec: R, where: R | undefined): boolean =>
    Object.entries(where ?? {}).every(([k, v]) => {
      if (k === "AND") return (v as R[]).every((w) => matches(rec, w));
      if (k === "OR") return (v as R[]).some((w) => matches(rec, w));
      if (k === "reads") {
        const rel = v as { none?: R; some?: R };
        if (rel.none) return !readsOf(rec).some((r) => matches(r, rel.none));
        if (rel.some) return readsOf(rec).some((r) => matches(r, rel.some));
      }
      if (v !== null && typeof v === "object" && !(v instanceof Date)) {
        const op = v as { in?: unknown[]; gte?: Date; lt?: Date | string; not?: unknown };
        const x = rec[k] as Date | string;
        if (op.in) return op.in.includes(rec[k]);
        if ("not" in op) return !same(rec[k], op.not);
        if (op.gte !== undefined) return x >= op.gte;
        if (op.lt !== undefined) return x < op.lt;
      }
      return same(rec[k], v);
    });
  const sorted = (rows: R[]) =>
    [...rows].sort(
      (a, b) => (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime() || String(b.id).localeCompare(String(a.id)),
    );
  return {
    prisma: {
      notification: {
        count: async ({ where }: { where: R }) => h.notifications.filter((n) => matches(n, where)).length,
        findMany: async ({ where, take, select }: { where: R; take?: number; select?: { reads?: { where: R } } }) =>
          sorted(h.notifications.filter((n) => matches(n, where)))
            .slice(0, take ?? Infinity)
            .map((n) => ({
              ...n,
              actor: n.actorId ? { name: h.users.find((u) => u.id === n.actorId)?.name ?? null } : null,
              reads: select?.reads ? readsOf(n).filter((r) => matches(r, select.reads!.where)) : undefined,
            })),
      },
    },
  };
});

import { listNotifications, unreadCount } from "./queries";

const NOW = new Date("2026-10-21T03:00:00Z");
const DAY = 86_400_000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);
const it1 = { id: "itA", role: "it_staff" as const };
const it2 = { id: "itB", role: "it_staff" as const };
const purchasing = { id: "pur", role: "purchasing_staff" as const };
const admin = { id: "adm", role: "admin" as const };

let seq = 0;
function note(team: string, extra: Row = {}): Row {
  const row = {
    id: `n${String(++seq).padStart(3, "0")}`, team, kind: "SENT_BACK", title: "BR-LT-0001 sent back by Finance",
    body: null, href: "/inventory/a1", actorId: "fin", entityType: "asset", entityId: "a1", createdAt: ago(1), ...extra,
  };
  h.notifications.push(row);
  return row;
}
const markRead = (n: Row, userId: string) => h.reads.push({ notificationId: n.id, userId, readAt: NOW });

beforeEach(() => {
  h.notifications = [];
  h.reads = [];
  h.users = [{ id: "fin", name: "Fe Reyes" }];
  seq = 0;
});

describe("unreadCount", () => {
  it("unread is per person", async () => {
    const n = note("IT");
    markRead(n, it1.id);
    expect(await unreadCount(it1, NOW)).toBe(0);
    expect(await unreadCount(it2, NOW)).toBe(1);
  });

  it("a team sees only its team", async () => {
    note("IT");
    note("PURCHASING");
    note("PURCHASING", { kind: "CHANGED" });
    note("FINANCE", { kind: "TO_CHECK" });
    expect(await unreadCount(it1, NOW)).toBe(1);
    expect(await unreadCount(purchasing, NOW)).toBe(2);
    expect(await unreadCount({ id: "f", role: "finance_staff" }, NOW)).toBe(1);
  });

  it("older than 90 days not counted", async () => {
    note("IT", { createdAt: ago(91) });
    note("IT", { createdAt: ago(89) });
    expect(await unreadCount(it1, NOW)).toBe(1);
  });

  it("an admin's count sums every team, by their own reads; a viewer is never rung", async () => {
    note("IT");
    const p = note("PURCHASING");
    note("FINANCE", { kind: "TO_CHECK" });
    note("IT", { createdAt: ago(91) });
    expect(await unreadCount(admin, NOW)).toBe(3);
    markRead(p, admin.id);
    expect(await unreadCount(admin, NOW)).toBe(2);
    // a teammate's read is theirs: Purchasing still has it unread, the admin's read changed nothing for them
    expect(await unreadCount(purchasing, NOW)).toBe(1);
    expect(await unreadCount({ id: "v", role: "viewer" }, NOW)).toBe(0);
  });
});

describe("listNotifications", () => {
  it("an admin reads every team's, each item with its team; naming a team narrows to it", async () => {
    note("IT", { createdAt: ago(3) });
    note("PURCHASING", { createdAt: ago(2), kind: "CHANGED" });
    note("FINANCE", { createdAt: ago(1), kind: "TO_CHECK" });
    const all = await listNotifications(admin, { tab: "all" }, NOW);
    expect(all.items.map((i) => [i.id, i.team])).toEqual([["n003", "FINANCE"], ["n002", "PURCHASING"], ["n001", "IT"]]);
    const it = await listNotifications(admin, { tab: "all", team: "IT" }, NOW);
    expect(it.items.map((i) => i.id)).toEqual(["n001"]);
    const changed = await listNotifications(admin, { tab: "changed" }, NOW);
    expect(changed.items.map((i) => i.team)).toEqual(["PURCHASING"]);
  });

  it("staff always get their own team, whatever team they pass", async () => {
    note("IT");
    note("PURCHASING");
    const { items } = await listNotifications(it1, { tab: "all", team: "PURCHASING" }, NOW);
    expect(items.map((i) => i.id)).toEqual(["n001"]);
  });

  it("a viewer has no team and so no notifications", async () => {
    note("IT");
    expect(await listNotifications({ id: "v", role: "viewer" }, { tab: "all" }, NOW)).toEqual({ items: [], next: null });
  });

  it("tabs narrow by kind; each item says who did it and whether this person read it", async () => {
    const a = note("IT", { kind: "SENT_BACK", createdAt: ago(3), body: "wrong serial" });
    note("IT", { kind: "TO_CHECK", createdAt: ago(2), title: "PO-0214 · 5 laptops from Purchasing to check" });
    note("IT", { kind: "TO_CHECK", createdAt: ago(1), actorId: null });
    markRead(a, it1.id);
    markRead(a, it2.id);
    const sent = await listNotifications(it1, { tab: "sent-back" }, NOW);
    expect(sent.items).toEqual([{
      id: a.id, team: "IT", kind: "SENT_BACK", title: a.title, body: "wrong serial", href: a.href, actorName: "Fe Reyes",
      createdAt: a.createdAt, read: true,
    }]);
    const toCheck = await listNotifications(it1, { tab: "to-check" }, NOW);
    expect(toCheck.items.map((i) => [i.id, i.read, i.actorName])).toEqual([["n003", false, null], ["n002", false, "Fe Reyes"]]);
    expect((await listNotifications(it1, { tab: "changed" }, NOW)).items).toEqual([]);
    expect((await listNotifications(it1, { tab: "all" }, NOW)).items.map((i) => i.id)).toEqual(["n003", "n002", "n001"]);
  });

  it("pages newest first by a cursor, with nothing older than 90 days", async () => {
    for (let d = 1; d <= 5; d++) note("IT", { createdAt: ago(d) });
    note("IT", { createdAt: ago(1) }); // same instant as n001: the id breaks the tie
    note("IT", { createdAt: ago(95) });
    const first = await listNotifications(it1, { tab: "all", take: 3 }, NOW);
    expect(first.items.map((i) => i.id)).toEqual(["n006", "n001", "n002"]);
    expect(first.next).not.toBeNull();
    const second = await listNotifications(it1, { tab: "all", take: 3, cursor: first.next! }, NOW);
    expect(second.items.map((i) => i.id)).toEqual(["n003", "n004", "n005"]);
    expect(second.next).toBeNull();
  });

  it("a malformed cursor starts from the newest", async () => {
    note("IT");
    const { items } = await listNotifications(it1, { tab: "all", cursor: "nonsense" }, NOW);
    expect(items).toHaveLength(1);
  });
});
