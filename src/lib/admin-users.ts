import type { Role } from "@prisma/client";

/** Admin first: the select reads as a privilege ladder, most-privileged at the top. */
export const ROLE_OPTIONS: Role[] = ["admin", "it_staff", "purchasing_staff", "finance_staff", "viewer"];

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Admin",
  it_staff: "IT staff",
  purchasing_staff: "Purchasing staff",
  finance_staff: "Finance staff",
  viewer: "Viewer",
};

/** Only the fields the rules below read, so a caller can pass a narrow select. */
export interface TargetUser {
  id: string;
  role: Role;
  isPermanentAdmin: boolean;
  disabled: boolean;
}

export type RuleResult = { allowed: true } | { allowed: false; reason: string };

const PERMANENT_LOCK =
  "This is the permanent admin account — its role and access can't be changed, so the system can never be locked out of itself.";

/**
 * Why this row cannot be edited at all, or null when it can. The page prints
 * this beside a LOCKED chip so the constraint is STATED (card 3h) rather than
 * discovered through a failed save, and the actions call the same rules below,
 * so a hand-rolled request is refused on exactly the same grounds.
 */
export function lockReason(target: TargetUser): string | null {
  return target.isPermanentAdmin ? PERMANENT_LOCK : null;
}

/**
 * Scope decision #3: demoting yourself is allowed. It is recoverable — the
 * permanent admin can put it back — and forbidding it would mean an admin
 * tidying up their own over-privilege has to ask someone else to do it.
 *
 * `next` and `actorId` are unused today and are part of the signature on
 * purpose: every caller already has them, so adding a rule that needs either
 * one is a change to this function alone rather than to four call sites.
 */
export function roleChange(target: TargetUser, next: Role, actorId: string): RuleResult {
  void next;
  void actorId;
  const locked = lockReason(target);
  return locked ? { allowed: false, reason: locked } : { allowed: true };
}

/**
 * Wider than card 3h asks for, deliberately (scope decision #1): `authorize()`
 * returns null for a disabled user, so disabling the permanent admin ends every
 * route back into the system just as completely as demoting them would.
 *
 * Self-disable is refused for the opposite reason to self-demotion — it ends
 * your own session with no way back for you specifically, so it reads as an
 * accident rather than an intent.
 *
 * The refusal names ANY other admin, not the permanent one: an ordinary admin
 * may disable another ordinary admin (nothing here forbids it), so pointing at
 * the permanent account would send someone to bother one specific person for
 * something any of their colleagues can do. It also keeps this string free of
 * the words "permanent admin", which is what lets the tests tell this branch
 * apart from the lock branch above — see the note in the test file.
 */
export function disableChange(target: TargetUser, next: boolean, actorId: string): RuleResult {
  const locked = lockReason(target);
  if (locked) return { allowed: false, reason: locked };
  if (next && target.id === actorId) {
    return {
      allowed: false,
      reason:
        "You can't disable your own account — you'd be signed out with no way back in. Another admin can do it for you.",
    };
  }
  return { allowed: true };
}
