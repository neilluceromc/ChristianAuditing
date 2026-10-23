import type { AccountApprovalState, GroupKind, Role } from "@prisma/client";
import { isAllowedDomain, normalizeEmail } from "./auth-shared";
import { ROLE_WORKSPACES, WORKSPACE_META, type WorkspaceId } from "./workspaces";

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

/**
 * Users & access (spec §4.4, owner 2026-10-24): the permanent admin's account is locked against EVERY admin action
 * on Users & access (role, turning it off, password reset, name, email, employee link, approve, decline). Its owner
 * changes their own password in Account settings; a forgotten one is recovered with `npm run admin:recover`.
 */
export const PERMANENT_LOCK = "The permanent admin's account can only be changed by its owner.";

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
  if (next) return canTurnOff({ id: actorId }, target);
  const locked = lockReason(target);
  return locked ? { allowed: false, reason: locked } : { allowed: true };
}

/**
 * Users & access (spec §4.4): may `actor` turn `target`'s account off? Never the permanent admin (the lock), never
 * your own account (you'd be signed out with no way back in). The panel greys its switch out with this reason, and
 * setUserDisabled refuses on the same grounds.
 */
export function canTurnOff(actor: { id: string }, target: TargetUser): RuleResult {
  const locked = lockReason(target);
  if (locked) return { allowed: false, reason: locked };
  if (target.id === actor.id) {
    return {
      allowed: false,
      reason:
        "You can't turn off your own account — you'd be signed out with no way back in. Another admin can do it for you.",
    };
  }
  return { allowed: true };
}

/**
 * Users & access (spec §4.4): the email field's problem, or null. In order: the shape, the allowed domain (null =
 * unrestricted), then whether another account already uses it (the caller looks that up on the normalized email).
 */
export function emailProblem(email: string, domain: string | null, takenByOther: boolean): string | null {
  const normalized = normalizeEmail(email);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized)) return "Enter a valid email.";
  if (!isAllowedDomain(normalized, domain)) return `Use an @${domain} address.`;
  if (takenByOther) return "Another account already uses that email.";
  return null;
}

/** What a role opens, as the role-change note says it: "all four workspaces" for admin, else roleWorkspaces. */
function opensPhrase(role: Role): string {
  return role === "admin" ? "all four workspaces" : roleWorkspaces(role);
}

/**
 * Users & access (spec §4.4, verbatim): the note under the role cards when a different role is picked, or null when
 * the role isn't changing. "Moves {first name} from {old} to {new}: opens {new} instead of {old}. They're signed out
 * when you save."
 */
export function roleChangeNote(name: string, from: Role, to: Role): string | null {
  if (from === to) return null;
  const first = name.trim().split(/\s+/)[0] || name;
  return (
    `Moves ${first} from ${ROLE_LABELS[from]} to ${ROLE_LABELS[to]}: ` +
    `opens ${opensPhrase(to)} instead of ${opensPhrase(from)}. They're signed out when you save.`
  );
}

/** Users & access (spec §4.4): the five statuses, in the status filter's order. */
export const USER_STATUSES = ["PENDING", "ACTIVE", "MUST_SET_PASSWORD", "DISABLED", "DECLINED"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const USER_STATUS_LABEL: Record<UserStatus, string> = {
  PENDING: "Waiting for approval",
  ACTIVE: "Active",
  MUST_SET_PASSWORD: "Must set password",
  DISABLED: "Disabled",
  DECLINED: "Declined",
};

/**
 * An account's status. The approval state comes first: a waiting or declined sign-up is also turned off (so older
 * code refuses it too), but it reads as waiting or declined, never as "Disabled". `userStatusWhere`
 * (admin-lists.ts) is the same mapping as a query.
 */
export function userStatus(row: {
  approvalState: AccountApprovalState;
  disabled: boolean;
  mustChangePassword: boolean;
}): UserStatus {
  if (row.approvalState === "PENDING") return "PENDING";
  if (row.approvalState === "DECLINED") return "DECLINED";
  if (row.disabled) return "DISABLED";
  if (row.mustChangePassword) return "MUST_SET_PASSWORD";
  return "ACTIVE";
}

/** An employee's group as the list shows it: the department's name, or "Client: X" for a client. */
export function groupLabel(group: { name: string; kind: GroupKind }): string {
  return group.kind === "CLIENT" ? `Client: ${group.name}` : group.name;
}

/**
 * `lockReason`'s sibling: one string, two surfaces. The JWT freezes role at
 * sign-in, so `requireUser` compares it to the DB on every request and bounces
 * a mismatch to `/logout` — meaning an admin who changes their OWN role (to
 * ANY other role, not only a demotion) gets signed out on their very next
 * request, mid-session, with no warning. This is a WARNING, not a refusal:
 * scope decision #3 permits self-demotion on purpose, and this doesn't touch
 * that — it only makes the consequence visible before the click, the way
 * `lockReason` makes the permanent-admin lock visible before the click. Task
 * 3's page prints this text pre-click; the action returns the same flag so
 * the page can also render the post-click state truthfully.
 */
export function selfRoleChangeWarning(target: TargetUser, next: Role, actorId: string): string | null {
  if (target.id !== actorId || next === target.role) return null;
  return `You're changing your own role — you'll be signed out and will need to sign back in as ${ROLE_LABELS[next]}.`;
}

/**
 * Card 3h's ARTBOARD (not its prose) specs a `Workspaces` column the table
 * dropped silently — brief §2 puts `it_staff` and `viewer` in the SAME
 * workspace with different access, so the role name alone doesn't answer
 * what picking one actually grants. Derived from ROLE_WORKSPACES /
 * WORKSPACE_META rather than a hand-copied string per role, so it can't
 * drift from the table those two already define.
 */
export function roleWorkspaces(role: Role): string {
  const ids = ROLE_WORKSPACES[role];
  const all = Object.keys(WORKSPACE_META) as WorkspaceId[];
  const base = ids.length === all.length ? "all four" : ids.map((id) => WORKSPACE_META[id].label).join(" · ");
  // viewer shares it_staff's workspace but not its write access — the artboard
  // marks that with a suffix rather than a fifth workspace that doesn't exist.
  return role === "viewer" ? `${base} · read-only` : base;
}
