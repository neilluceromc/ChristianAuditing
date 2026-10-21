import type { NotificationKind, Prisma, Role, Team } from "@prisma/client";
import { teamOfRole } from "@/lib/intake-rules";

/**
 * Spec §7: one bell notification for a whole team. Always called inside the action's own transaction (spec §8:
 * "written in the same transaction as the action that causes them, so they can't drift") — it takes the caller's
 * TransactionClient and never opens one of its own. A batch is one call, so one row ("PO-0214 · 5 laptops", not five).
 *
 * "Changed by another team" never rings the actor's own team: Purchasing fixing its own numbers is not news to
 * Purchasing. An admin has no team (teamOfRole → null), so an admin's change still rings Purchasing.
 */
export interface NotifyInput {
  team: Team;
  kind: NotificationKind;
  title: string;
  body?: string | null;
  href: string;
  actorId: string;
  entityType: string;
  entityId: string;
  /** The actor's role when the caller already has it; otherwise CHANGED reads it. */
  actorRole?: Role;
}

export async function notify(tx: Prisma.TransactionClient, n: NotifyInput): Promise<void> {
  if (n.kind === "CHANGED") {
    const role = n.actorRole ?? (await tx.user.findUnique({ where: { id: n.actorId }, select: { role: true } }))?.role;
    if (role && teamOfRole(role) === n.team) return;
  }
  await tx.notification.create({
    data: {
      team: n.team,
      kind: n.kind,
      title: n.title,
      body: n.body ? n.body : null,
      href: n.href,
      actorId: n.actorId,
      entityType: n.entityType,
      entityId: n.entityId,
    },
  });
}
