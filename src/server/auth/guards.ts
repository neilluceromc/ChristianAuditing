import { redirect } from "next/navigation";
import type { Role, User } from "@prisma/client";
import { auth } from "./index";
import { prisma } from "../db/client";
import { ROLE_LANDING } from "@/lib/workspaces";

/**
 * Layer-2 enforcement. Middleware (layer 1) can't reach the DB, so a
 * disabled account's JWT survives until it hits this guard — every page
 * and server action goes through requireUser or requireRole.
 */
export async function requireUser(): Promise<User> {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  // Stale JWT (user deleted/disabled/role-changed) goes to /logout, which
  // CLEARS the cookie — a bare /login redirect would loop: middleware sees a
  // "signed-in" token on /login and bounces straight back to the landing.
  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (!user || user.disabled) redirect("/logout");
  // The JWT freezes role at sign-in; if an admin has since changed it, force
  // re-auth so middleware's (token-based) gating can't drift from the DB.
  if (user.role !== session.user.role) redirect("/logout");
  return user;
}

export async function requireRole(...roles: Role[]): Promise<User> {
  const user = await requireUser();
  if (!roles.includes(user.role)) redirect(ROLE_LANDING[user.role]);
  return user;
}

/**
 * Guards for server actions: same checks as requireUser/requireRole but they
 * RETURN null instead of redirecting, so actions hand back the typed
 * `forbidden` result (spec §5) rather than navigating mid-mutation.
 */
export async function actionUser(): Promise<User | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (!user || user.disabled || user.role !== session.user.role) return null;
  return user;
}

export async function actionRole(...roles: Role[]): Promise<User | null> {
  const user = await actionUser();
  return user && roles.includes(user.role) ? user : null;
}
