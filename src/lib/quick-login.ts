import type { Role } from "@prisma/client";
import { normalizeEmail } from "./auth-shared";

// Staging-only one-click sign-in. QUICK_LOGIN_EMAILS (comma-separated) both
// switches the feature on and lists the accounts it may sign in as; unset or
// empty means off — no buttons and the quick-login provider is not registered.
export function parseQuickLoginEmails(raw: string | undefined): string[] {
  const out: string[] = [];
  for (const part of (raw ?? "").split(",")) {
    const email = normalizeEmail(part);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || out.includes(email)) continue;
    out.push(email);
  }
  return out;
}

export function isQuickLoginEmail(email: string, raw: string | undefined): boolean {
  const normalized = normalizeEmail(email);
  return normalized !== "" && parseQuickLoginEmails(raw).includes(normalized);
}

interface QuickLoginRow {
  id: string;
  email: string;
  name: string;
  role: Role;
  disabled: boolean;
}

// The quick-login provider's whole decision: the email must be on the list and
// the row must exist, match it and be enabled. Anything else signs in no one.
export function quickLoginUser(
  email: string,
  raw: string | undefined,
  row: QuickLoginRow | null,
): { id: string; email: string; name: string; role: Role } | null {
  if (!isQuickLoginEmail(email, raw) || !row || row.disabled) return null;
  if (normalizeEmail(row.email) !== normalizeEmail(email)) return null;
  return { id: row.id, email: row.email, name: row.name, role: row.role };
}
