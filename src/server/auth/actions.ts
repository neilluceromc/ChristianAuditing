"use server";

import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { signIn, signOut } from "./index";
import { prisma } from "../db/client";
import { normalizeEmail } from "@/lib/auth-shared";
import { ROLE_LANDING } from "@/lib/workspaces";

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
