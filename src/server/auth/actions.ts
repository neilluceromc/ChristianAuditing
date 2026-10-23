"use server";

import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { auth, signIn, signOut } from "./index";
import { requireUser } from "./guards";
import { passwordMatches } from "./password-check";
import { clearSignInFailures, recordSignInFailure, signInPaused } from "./sign-in-limit";
import { prisma } from "../db/client";
import { flagDomain, normalizeEmail, safeNextPath } from "@/lib/auth-shared";
import { isQuickLoginEmail } from "@/lib/quick-login";
import { SIGN_IN_COPY } from "@/lib/sign-in-copy";
import { signUpProblem, type SignUpField } from "@/lib/signup-rules";
import { ROLE_LANDING, ROLE_WORKSPACES, WORKSPACE_META, type WorkspaceId } from "@/lib/workspaces";
import { saveUiPref } from "@/server/ui-prefs";

export interface AuthFormState {
  error?: string;
  field?: SignUpField;
  created?: boolean;
  /** Sign-up made a disabled account that an admin must approve; nobody was signed in. */
  pendingApproval?: boolean;
}

function safeNext(raw: FormDataEntryValue | null): string | undefined {
  return safeNextPath(raw);
}

/**
 * Users & access (spec §4.6). In order: a paused email is refused before its password is checked; the password is
 * checked once (bcrypt, the dummy hash for an unknown email); a wrong one is counted; a right one for an account
 * still waiting, or declined, gets its own copy and is not counted; a right one for an active account clears the
 * count, stamps lastSignInAt and signs in. Auth.js's signIn then runs the provider's authorize(), which checks the
 * password again: that second compare is the provider's own gate and happens only on success.
 */
export async function signInWithCredentials(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const email = normalizeEmail(String(formData.get("email") ?? "")).slice(0, 320);
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: SIGN_IN_COPY.wrong };
  if (await signInPaused(email)) return { error: SIGN_IN_COPY.paused };

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, passwordHash: true, disabled: true, approvalState: true },
  });
  if (!(await passwordMatches(password, user?.passwordHash))) {
    await recordSignInFailure(email);
    return { error: SIGN_IN_COPY.wrong };
  }
  // The right password from here on: only now may the copy say the account exists.
  if (user?.approvalState === "PENDING") return { error: SIGN_IN_COPY.pending };
  if (user?.approvalState === "DECLINED") return { error: SIGN_IN_COPY.declined };
  if (!user || user.disabled) return { error: SIGN_IN_COPY.wrong };

  await clearSignInFailures(email);
  await prisma.user.update({ where: { id: user.id }, data: { lastSignInAt: new Date() } });
  try {
    await signIn("credentials", { email, password, redirect: false });
  } catch (err) {
    if (err instanceof AuthError) return { error: SIGN_IN_COPY.wrong };
    throw err;
  }
  // Follow-up spec §7.1: every sign-in lands on Home unless a safe `next` link brought the person here. The role's
  // old landing (ROLE_LANDING) now lives only in the page guards.
  redirect(safeNext(formData.get("next")) ?? "/");
}

// Staging-only one-click sign-in; the quick-login provider makes the decision.
export async function quickSignIn(formData: FormData): Promise<void> {
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  if (!isQuickLoginEmail(email, process.env.QUICK_LOGIN_EMAILS)) redirect("/login?quick=refused");
  try {
    await signIn("quick-login", { email, redirect: false });
  } catch (err) {
    if (err instanceof AuthError) redirect("/login?quick=refused");
    throw err;
  }
  // Users & access (spec §4.1): every successful sign-in, by any provider, stamps lastSignInAt.
  await prisma.user.update({ where: { email }, data: { lastSignInAt: new Date() } });
  redirect(safeNext(formData.get("next")) ?? "/"); // Home, like every sign-in (spec §7.1)
}

export async function signOutAction() {
  // TEMPORARY (owner, 2026-10-21): clear Cris chats on sign-out; remove when history should persist.
  await clearCrisChats();
  await signOut({ redirectTo: "/login" });
}

/**
 * Phase 47 spec §5.5: a soft clear. The conversations are stamped `clearedAt` (the Cris box lists and resumes only
 * uncleared ones) and never deleted, because the daily question limit and the admin's monthly usage and cost are
 * counted from their CrisMessage rows. Pending Confirm/Undo actions go by userId: they have no foreign key. Read
 * from the session, not the DB guard, so a stale account's chats clear too; a failure never blocks signing out.
 */
async function clearCrisChats(): Promise<void> {
  try {
    const userId = (await auth())?.user?.id;
    if (!userId) return;
    await prisma.$transaction([
      prisma.crisConversation.updateMany({ where: { userId, clearedAt: null }, data: { clearedAt: new Date() } }),
      prisma.crisPendingAction.deleteMany({ where: { userId } }),
    ]);
  } catch (err: unknown) {
    console.error("[cris] clearing chats on sign-out failed:", err);
  }
}

export async function signUp(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const name = String(formData.get("name") ?? "").trim();
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  const password = String(formData.get("password") ?? "");

  const domainFlag = await prisma.featureFlag.findUnique({ where: { key: "allowed_domain" } });
  const problem = signUpProblem({ name, email, password }, flagDomain(domainFlag));
  if (problem) return problem;

  // Exact lookup on the normalized email — NOT mode:"insensitive" (ILIKE),
  // which treats %/_ in the input as wildcards: an unauthenticated enumeration
  // oracle on this public form. Same fix as the login path (commit dc33830).
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return { error: "An account with that email already exists.", field: "email" };

  // Cloud staging: the app is on the open internet, so a new account waits, disabled, until an admin enables it.
  const needsApproval = process.env.SIGNUP_REQUIRES_APPROVAL === "1";
  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    // Least privilege: every signup is a viewer; admins promote via /admin/users.
    data: { name, email, passwordHash, role: "viewer", ...(needsApproval ? { disabled: true } : {}) },
  });
  await prisma.auditEntry.create({
    data: {
      actorId: user.id,
      actorLabel: user.name,
      entityType: "user",
      entityId: user.id,
      action: "signup",
      diff: {
        role: { from: null, to: "viewer" },
        ...(needsApproval ? { disabled: { from: null, to: true } } : {}),
      },
    },
  });

  // No session for an account that is waiting: sign-in would refuse it anyway (authorize() rejects disabled users).
  if (needsApproval) return { created: true, pendingApproval: true };

  try {
    await signIn("credentials", { email, password, redirect: false });
  } catch {
    redirect("/login"); // account exists; worst case they sign in manually
  }
  return { created: true };
}

export async function createBootstrapAdmin(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const name = String(formData.get("name") ?? "").trim();
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  const password = String(formData.get("password") ?? "");
  const domain = String(formData.get("domain") ?? "").trim().toLowerCase();

  if (name.length < 2) return { error: "Enter your name." };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "Enter a valid email." };
  if (password.length < 10) return { error: "Password must be at least 10 characters." };

  const passwordHash = await bcrypt.hash(password, 10);
  try {
    await prisma.$transaction(async (tx) => {
      const count = await tx.user.count();
      if (count > 0) throw new Error("BOOTSTRAP_CLOSED");
      const admin = await tx.user.create({
        data: { name, email, passwordHash, role: "admin", isPermanentAdmin: true },
      });
      await tx.featureFlag.upsert({
        where: { key: "allowed_domain" },
        update: { enabled: !!domain, value: domain || undefined },
        create: {
          key: "allowed_domain",
          enabled: !!domain,
          value: domain || undefined,
          description: "Signup domain restriction",
        },
      });
      await tx.auditEntry.create({
        data: {
          actorId: admin.id,
          actorLabel: admin.name,
          entityType: "user",
          entityId: admin.id,
          action: "bootstrap",
          diff: { role: { from: null, to: "admin" }, allowedDomain: { from: null, to: domain || null } },
        },
      });
    });
  } catch (err) {
    if (err instanceof Error && err.message === "BOOTSTRAP_CLOSED") {
      return { error: "Setup is already complete." };
    }
    throw err;
  }

  await signIn("credentials", { email, password, redirect: false });
  const jar = await cookies();
  jar.set("br.dept", "it", { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  redirect("/"); // "Create admin and open IT" — admin home with the IT workspace active
}

export async function switchWorkspace(ws: WorkspaceId) {
  const user = await requireUser();
  if (!ROLE_WORKSPACES[user.role].includes(ws)) redirect(ROLE_LANDING[user.role]);
  const jar = await cookies();
  jar.set("br.dept", ws, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  // Phase 47 spec §5.4: the workspace follows the person, not the browser. Like the toggles, a failed save never
  // blocks the switch: the cookie is already set, and only the next browser misses this choice.
  try {
    await saveUiPref({ workspace: ws });
  } catch (err: unknown) {
    console.error("[ui-prefs] saving the workspace failed:", err);
  }
  redirect(WORKSPACE_META[ws].landing);
}
