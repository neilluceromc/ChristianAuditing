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
  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (!user || user.disabled) redirect("/login");
  // The JWT freezes role at sign-in; if an admin has since changed it, force
  // re-auth so middleware's (token-based) gating can't drift from the DB.
  if (user.role !== session.user.role) redirect("/login");
  return user;
}

export async function requireRole(...roles: Role[]): Promise<User> {
  const user = await requireUser();
  if (!roles.includes(user.role)) redirect(ROLE_LANDING[user.role]);
  return user;
}
