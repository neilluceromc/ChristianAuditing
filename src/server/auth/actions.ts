"use server";

import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { auth, signIn, signOut } from "./index";
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
  const session = await auth();
  if (!session?.user) return { error: "Sign-in failed. Try again." };
  redirect(safeNext(formData.get("next")) ?? ROLE_LANDING[session.user.role]);
}

export async function signOutAction() {
  await signOut({ redirectTo: "/login" });
}
