"use server";

import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { signIn, signOut } from "./index";
import { requireUser } from "./guards";
import { prisma } from "../db/client";
import { isAllowedDomain, normalizeEmail } from "@/lib/auth-shared";
import { ROLE_LANDING, ROLE_WORKSPACES, WORKSPACE_META, type WorkspaceId } from "@/lib/workspaces";

export interface AuthFormState {
  error?: string;
}

function safeNext(raw: FormDataEntryValue | null): string | undefined {
  const next = String(raw ?? "");
  return next.startsWith("/") && !next.startsWith("//") ? next : undefined;
}

export async function signInWithCredentials(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  try {
    await signIn("credentials", {
      email: String(formData.get("email") ?? ""),
      password: String(formData.get("password") ?? ""),
      redirect: false,
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return { error: "Wrong email or password — or the account is disabled." };
    }
    throw err;
  }
  // Read the role straight from the DB by email — auth() called in the same
  // request right after signIn(redirect:false) reads the pre-login request
  // cookies and returns a stale/empty session (Auth.js v5 behavior).
  const user = await prisma.user.findUnique({ where: { email }, select: { role: true } });
  redirect(safeNext(formData.get("next")) ?? (user ? ROLE_LANDING[user.role] : "/"));
}

export async function signOutAction() {
  await signOut({ redirectTo: "/login" });
}

export async function signUp(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const name = String(formData.get("name") ?? "").trim();
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  const password = String(formData.get("password") ?? "");

  if (name.length < 2) return { error: "Enter your name." };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "Enter a valid email." };
  if (password.length < 10) return { error: "Password must be at least 10 characters." };

  const domainFlag = await prisma.featureFlag.findUnique({ where: { key: "allowed_domain" } });
  const domain =
    domainFlag?.enabled && typeof domainFlag.value === "string" ? domainFlag.value : null;
  if (!isAllowedDomain(email, domain)) {
    return { error: `Signup is limited to @${domain} addresses.` };
  }

  // Exact lookup on the normalized email — NOT mode:"insensitive" (ILIKE),
  // which treats %/_ in the input as wildcards: an unauthenticated enumeration
  // oracle on this public form. Same fix as the login path (commit dc33830).
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return { error: "An account with that email already exists." };

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    // Least privilege: every signup is a viewer; admins promote via /admin/users.
    data: { name, email, passwordHash, role: "viewer" },
  });
  await prisma.auditEntry.create({
    data: {
      actorId: user.id,
      actorLabel: user.name,
      entityType: "user",
      entityId: user.id,
      action: "signup",
      diff: { role: { from: null, to: "viewer" } },
    },
  });

  try {
    await signIn("credentials", { email, password, redirect: false });
  } catch {
    redirect("/login"); // account exists; worst case they sign in manually
  }
  redirect(ROLE_LANDING.viewer);
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
  redirect(WORKSPACE_META[ws].landing);
}
