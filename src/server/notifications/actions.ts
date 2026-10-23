"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { actionUser } from "@/server/auth/guards";
import { forbidden, ok, validationError, zodFieldErrors, type ActionResult } from "@/server/action-result";
import { teamOfRole } from "@/lib/intake-rules";
import { BELL_ITEMS, NOTIFICATION_TABS, parseTeam, TEAMS, type NotificationView } from "@/lib/notifications";
import { listNotifications, readableTeams, unreadCount, unreadWhere } from "./queries";

/*
 * Task 7 (spec §7): the bell's writes are a person's own read state — like a UI preference, not audited and not
 * rate-limited (opening a notification must never spend the mutation budget). Signed out, nothing is written.
 * Anyone on a team reads only their team's notifications; an admin reads every team's (2026-10-23), or one they name.
 */

const idsSchema = z.object({ ids: z.array(z.string().min(1)).min(1).max(100) });
const teamSchema = z.object({ team: z.enum(TEAMS as [string, ...string[]]).optional() }).optional();
const tabSchema = z.object({ tab: z.enum(NOTIFICATION_TABS.map((t) => t.id) as [string, ...string[]]) });

/** Marks these notifications read for the signed-in person only; returns their new unread count. */
export async function markRead(input: unknown): Promise<ActionResult<{ count: number }>> {
  const user = await actionUser();
  if (!user) return forbidden();
  const parsed = idsSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const team = teamOfRole(user.role);
  if (!team && user.role !== "admin") return forbidden();
  // Only notifications this person may read: their team's (an admin: any team's).
  const found = await prisma.notification.findMany({
    where: { id: { in: [...new Set(parsed.data.ids)] }, ...(team ? { team } : {}) },
    select: { id: true },
  });
  if (found.length) {
    await prisma.notificationRead.createMany({
      data: found.map((n) => ({ notificationId: n.id, userId: user.id })),
      skipDuplicates: true,
    });
  }
  return ok({ count: await unreadCount(user) });
}

/**
 * Marks every notification of the person's team read for them — an admin: every team's, or the one named. Only this
 * person's reads are written: a teammate's (or another admin's) unread stays unread.
 */
export async function markAllRead(input?: unknown): Promise<ActionResult<{ marked: number }>> {
  const user = await actionUser();
  if (!user) return forbidden();
  const parsed = teamSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const teams = readableTeams(user, parseTeam(parsed.data?.team));
  if (!teams) return forbidden();
  const now = new Date();
  const unread = await prisma.notification.findMany({ where: unreadWhere(teams, user.id, now), select: { id: true } });
  if (unread.length) {
    await prisma.notificationRead.createMany({
      data: unread.map((n) => ({ notificationId: n.id, userId: user.id })),
      skipDuplicates: true,
    });
  }
  revalidatePath("/notifications");
  return ok({ marked: unread.length });
}

/** The bell's poll: the signed-in person's unread count (an admin: every team's; 0 signed out and for a viewer). */
export async function bellCount(): Promise<{ count: number }> {
  const user = await actionUser();
  if (!user) return { count: 0 };
  return { count: await unreadCount(user) };
}

/** The bell panel's tab: the newest few of the person's team (an admin: of every team, each with its team). */
export async function bellItems(input: unknown): Promise<{ items: NotificationView[] }> {
  const user = await actionUser();
  const parsed = tabSchema.safeParse(input);
  if (!user || !parsed.success || !readableTeams(user, null)) return { items: [] };
  const { items } = await listNotifications(
    user, { tab: parsed.data.tab as (typeof NOTIFICATION_TABS)[number]["id"], take: BELL_ITEMS },
  );
  return { items };
}
