import type { Prisma, Role } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { teamOfRole, type Team } from "@/lib/intake-rules";
import { notificationCutoff } from "@/lib/retention";
import {
  decodeCursor, encodeCursor, NOTIFICATIONS_PAGE, tabKind, type NotificationTab, type NotificationView,
} from "@/lib/notifications";

/**
 * Task 7 (spec §7): the bell's read side. A notification rings a whole team; read state is per person
 * (NotificationRead), so one teammate opening it leaves it unread for the rest. Only the last 90 days show
 * (NOTIFICATION_DAYS — the maintenance worker prunes the rest). Admins are never rung: they get no count and must
 * name the team whose notifications they want to read.
 */

type Viewer = { id: string; role: Role };

/** The unread count on this person's bell: their team's notifications from the last 90 days they have not read. */
export async function unreadCount(user: Viewer, now: Date = new Date()): Promise<number> {
  const team = teamOfRole(user.role);
  if (!team) return 0;
  return prisma.notification.count({ where: unreadWhere(team, user.id, now) });
}

/** One team's notifications this person has not read, within the 90 days (shared with markAllRead). */
export function unreadWhere(team: Team, userId: string, now: Date): Prisma.NotificationWhereInput {
  return { team, createdAt: { gte: notificationCutoff(now) }, reads: { none: { userId } } };
}

export interface ListOptions {
  tab: NotificationTab;
  /** Required for an admin; ignored for anyone with a team (they always read their own). */
  team?: Team | null;
  cursor?: string | null;
  take?: number;
}

/** Whose notifications this person reads: their own team's, or (an admin) the team they name. */
export function readableTeam(user: Viewer, asked: Team | null | undefined): Team | null {
  const own = teamOfRole(user.role);
  if (own) return own;
  if (user.role !== "admin") return null;
  if (!asked) throw new Error("An admin must pick a team to read its notifications");
  return asked;
}

/** A page of one team's notifications, newest first, with this person's read state. `next` is the next page's cursor. */
export async function listNotifications(
  user: Viewer, opts: ListOptions, now: Date = new Date(),
): Promise<{ items: NotificationView[]; next: string | null }> {
  const team = readableTeam(user, opts.team);
  if (!team) return { items: [], next: null };
  const take = opts.take ?? NOTIFICATIONS_PAGE;
  const kind = tabKind(opts.tab);
  const after = decodeCursor(opts.cursor);
  const and: Prisma.NotificationWhereInput[] = [{ team, createdAt: { gte: notificationCutoff(now) } }];
  if (kind) and.push({ kind });
  // Keyset paging: strictly after the cursor's (createdAt, id) in the newest-first order.
  if (after) and.push({ OR: [{ createdAt: { lt: after.at } }, { createdAt: after.at, id: { lt: after.id } }] });

  const rows = await prisma.notification.findMany({
    where: { AND: and },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: take + 1,
    select: {
      id: true, kind: true, title: true, body: true, href: true, createdAt: true,
      actor: { select: { name: true } },
      reads: { where: { userId: user.id }, select: { userId: true } },
    },
  });
  const page = rows.slice(0, take);
  return {
    items: page.map((r) => ({
      id: r.id, kind: r.kind, title: r.title, body: r.body, href: r.href,
      actorName: r.actor?.name ?? null, createdAt: r.createdAt, read: r.reads.length > 0,
    })),
    next: rows.length > take ? encodeCursor(page[page.length - 1]) : null,
  };
}
