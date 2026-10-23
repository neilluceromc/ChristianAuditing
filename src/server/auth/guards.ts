import { cache } from "react";
import { redirect } from "next/navigation";
import type { Role, User } from "@prisma/client";
import { auth } from "./index";
import { prisma } from "../db/client";
import { ROLE_LANDING } from "@/lib/workspaces";
import { markRefusal } from "./refusal";

/** Users & access (spec §4.3): the "Choose your own password" page, the one page open while a password is owed. */
export const PASSWORD_PAGE = "/welcome/password";

/** Phase 41: the signed-in person a server action acts as — what `actionUser()` returns once it is not null. */
export type SessionUser = User;

/**
 * Layer-2 enforcement. Middleware (layer 1) can't reach the DB, so a
 * disabled account's JWT survives until it hits this guard — every page
 * and server action goes through requireUser or requireRole.
 *
 * Phase 43: wrapped in React `cache()`, so the layout's call and the page's
 * (and requireRole's) share ONE session read and ONE user read per request —
 * a redirect thrown here is the same redirect for every caller. `cache()` is
 * request-scoped (a fresh store per server render; outside one it does not
 * memoise), never a module-level memo, so nothing outlives the request.
 */
export const requireUser = cache(async (): Promise<User> => {
  const user = await readRequestUser();
  // Users & access (spec §4.3): while a new password is owed every page sends the person to choose one. Middleware
  // already redirects on the token's copy; this is the database's word, as defence in depth.
  if (user.mustChangePassword) redirect(PASSWORD_PAGE);
  return user;
});

/**
 * The guard for /welcome/password only: the same sign-in checks as requireUser (a stale or disabled account still
 * goes to /logout), but it admits the person only WHILE a new password is owed; anyone else goes Home.
 */
export const requirePasswordOwedUser = cache(async (): Promise<User> => {
  const user = await readRequestUser();
  if (!user.mustChangePassword) redirect("/");
  return user;
});

type TokenUser = { role: Role; sessionVersion: number };

/**
 * Users & access (spec §4.2): the account's row no longer matches the token. A changed role (the JWT freezes it at
 * sign-in, and middleware gates routes on it), a bumped sessionVersion (a password reset or change, a role change,
 * turning the account off, an email change: "signed out everywhere"), or an account that is not APPROVED.
 */
function staleToken(user: User, token: TokenUser): boolean {
  return user.role !== token.role || user.sessionVersion !== token.sessionVersion || user.approvalState !== "APPROVED";
}

/** The signed-in, current, approved account, or a redirect; shared by requireUser and requirePasswordOwedUser. */
const readRequestUser = cache(async (): Promise<User> => {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  // Stale JWT (user deleted/disabled/role-changed/signed out everywhere/not approved) goes to /logout, which
  // CLEARS the cookie — a bare /login redirect would loop: middleware sees a
  // "signed-in" token on /login and bounces straight back to the landing.
  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (!user || user.disabled) redirect("/logout");
  // The JWT freezes role and sessionVersion at sign-in; if either has since moved, force re-auth so
  // middleware's (token-based) gating can't drift from the DB.
  if (staleToken(user, session.user)) redirect("/logout");
  return user;
});

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
  const user = await readActionUser();
  if (user?.mustChangePassword) {
    // Users & access (spec §4.3, Review Focus #2): every action is refused until the person chooses their own
    // password. The mark makes the caller's own `forbidden()` read "Choose your own password first".
    markRefusal("password_owed");
    return null;
  }
  return user;
}

/**
 * The guard for setOwnPassword only: the same checks as actionUser, but it returns the account only WHILE a new
 * password is owed (and null otherwise), so the one action open at first sign-in is closed at every other time.
 */
export async function passwordOwedUser(): Promise<User | null> {
  const user = await readActionUser();
  return user?.mustChangePassword ? user : null;
}

async function readActionUser(): Promise<User | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (!user || user.disabled || staleToken(user, session.user)) return null;
  return user;
}

export async function actionRole(...roles: Role[]): Promise<User | null> {
  const user = await actionUser();
  return user && roles.includes(user.role) ? user : null;
}
