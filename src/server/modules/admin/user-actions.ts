"use server";

import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Prisma, User } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { unstable_update } from "@/server/auth";
import { actionRole } from "@/server/auth/guards";
import { bumpSessionVersion, signedSessionUpdate } from "@/server/auth/session-version";
import { clearCurrentPasswordFailures, clearSignInFailures } from "@/server/auth/sign-in-limit";
import { generateTempPassword } from "@/server/auth/temp-password";
import { checkRate } from "@/server/rate-limit";
import { writeAudit } from "@/server/audit";
import { asActionResult, isUniqueViolation } from "@/server/prisma-errors";
import { flagDomain, normalizeEmail } from "@/lib/auth-shared";
import {
  PERMANENT_LOCK, ROLE_OPTIONS, disableChange, emailProblem, lockReason, roleChange, selfRoleChangeWarning,
} from "@/lib/admin-users";
import { CHANGED_TRY_AGAIN } from "@/lib/lifecycle";
import type { AuditDiff } from "@/lib/audit-diff";
import {
  conflict, forbidden, ok, rateLimited, validationError, zodFieldErrors, type ActionResult,
} from "@/server/action-result";

/*
 * Users & access (spec §4.4): every admin account action. Each one runs as an admin (actionRole), under the mutation
 * rate limit, in ONE transaction whose writes are guarded on what it read (updateMany with a where-guard: a row that
 * moved in between is a conflict, never a half-write), with its audit entry in the same transaction.
 *
 * PRECONDITION (see prisma-errors.ts): returning a failure from a transaction callback COMMITS it, so in every
 * callback below each `return conflict(...)` / `return validationError(...)` precedes the first write. The one
 * exception is the guarded write's own `count === 0`, which wrote nothing.
 *
 * Session versions: a change to ANOTHER person (role, email, password reset, turning off) bumps their version and the
 * guards sign them out at their next request; their session is never updated from here. Only when an admin changes
 * their OWN account is THIS session given the new version (signedSessionUpdate), as Account settings does.
 *
 * The permanent admin is refused for every action here with PERMANENT_LOCK, and every guarded write restates
 * `isPermanentAdmin: false`, so the lock holds in the query too.
 */

const GONE = "That user no longer exists.";
const PAGE = "/admin/users";

/** The fields the rules and guards below read. Never the password hash. */
const TARGET_SELECT = {
  id: true, name: true, email: true, role: true, isPermanentAdmin: true, disabled: true, approvalState: true,
  sessionVersion: true, mustChangePassword: true, passwordChangedAt: true, employeeId: true, updatedAt: true,
} as const satisfies Prisma.UserSelect;

type Target = Prisma.UserGetPayload<{ select: typeof TARGET_SELECT }>;
type Tx = Prisma.TransactionClient;

const EMPLOYEE_TAKEN = "That employee already has an account.";
const EMPLOYEE_NOT_ACTIVE = "Only an active employee can be linked.";
const EMPLOYEE_GONE = "That employee record no longer exists.";
const EMAIL_TAKEN = "Another account already uses that email.";

const id = z.string().min(1);
const name = z.string().trim().min(2, "Enter their full name.").max(120, "Keep the name under 120 characters.");
const email = z.string().max(320);
const role = z.enum(ROLE_OPTIONS);
const employeeId = z.string().min(1).nullable();

const loadTarget = (tx: Tx, userId: string): Promise<Target | null> =>
  tx.user.findUnique({ where: { id: userId }, select: TARGET_SELECT });

async function allowedDomain(tx: Tx): Promise<string | null> {
  return flagDomain(await tx.featureFlag.findUnique({ where: { key: "allowed_domain" } }));
}

/** The email field's problem (its shape, the allowed domain, another account's), or null. Already normalized. */
async function emailFieldProblem(tx: Tx, normalized: string, exceptUserId: string | null): Promise<string | null> {
  const holder = await tx.user.findUnique({ where: { email: normalized }, select: { id: true } });
  return emailProblem(normalized, await allowedDomain(tx), !!holder && holder.id !== exceptUserId);
}

/** Linking an employee: it must exist, be ACTIVE, and have no other account (one account per employee). */
async function employeeProblem(tx: Tx, empId: string, userId: string | null): Promise<string | null> {
  const employee = await tx.employee.findUnique({
    where: { id: empId },
    select: { id: true, employment: true, user: { select: { id: true } } },
  });
  if (!employee) return EMPLOYEE_GONE;
  if (employee.user && employee.user.id !== userId) return EMPLOYEE_TAKEN;
  if (employee.employment !== "ACTIVE") return EMPLOYEE_NOT_ACTIVE;
  return null;
}

/**
 * The transaction, with Prisma's designed conflicts mapped (asActionResult) and a unique-index race (two admins
 * saving the same email or employee link at once: `User_email_key`, `User_email_lower_key`, `User_employeeId_key`)
 * reported on the field it belongs to.
 */
async function inTransaction<T>(run: (tx: Tx) => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    return await asActionResult(() => prisma.$transaction(run), { goneMessage: GONE });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return JSON.stringify(err.meta?.target ?? "").includes("employeeId")
        ? validationError({ employeeId: EMPLOYEE_TAKEN })
        : validationError({ email: EMAIL_TAKEN });
    }
    throw err;
  }
}

/** After an admin's change to their OWN account committed with a bump: keep THIS session (the other devices sign out). */
async function keepOwnSession(actor: User, version: number): Promise<void> {
  // Auth.js types the update as a Partial<Session>; the jwt callback (config.edge.ts) reads this signed shape instead.
  const update = await signedSessionUpdate(actor.id, version, actor.mustChangePassword);
  await unstable_update(update as unknown as Parameters<typeof unstable_update>[0]);
}

const auditBase = (actor: User, target: { id: string }) => ({
  actorId: actor.id,
  actorLabel: actor.name,
  entityType: "user",
  entityId: target.id,
  source: "web" as const,
});

// ---------------------------------------------------------------------------------------------------------------
// Create

const createSchema = z.object({ name, email, role, employeeId: employeeId.optional() });

/**
 * Add user (spec §4.4): an APPROVED account with a generated temporary password that the person must replace at
 * their first sign-in. The temporary password is returned here exactly once; only its bcrypt hash is stored, and it
 * is never in the audit entry.
 */
export async function createUser(input: unknown): Promise<ActionResult<{ id: string; tempPassword: string }>> {
  const actor = await actionRole("admin");
  if (!actor) return forbidden();
  const rate = await checkRate(actor.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const data = { ...parsed.data, email: normalizeEmail(parsed.data.email), employeeId: parsed.data.employeeId ?? null };

  const tempPassword = generateTempPassword();
  const passwordHash = await bcrypt.hash(tempPassword, 10); // outside the transaction: no connection waits on bcrypt
  const now = new Date();

  const result = await inTransaction(async (tx) => {
    const emailError = await emailFieldProblem(tx, data.email, null);
    if (emailError) return validationError({ email: emailError });
    if (data.employeeId) {
      const linkError = await employeeProblem(tx, data.employeeId, null);
      if (linkError) return validationError({ employeeId: linkError });
    }
    const created = await tx.user.create({
      data: {
        name: data.name, email: data.email, role: data.role, employeeId: data.employeeId, passwordHash,
        mustChangePassword: true, passwordChangedAt: now, approvalState: "APPROVED", createdById: actor.id,
      },
      select: { id: true },
    });
    await writeAudit(tx, {
      ...auditBase(actor, created),
      action: "user.create",
      // Never the password, its hash or the temporary password.
      diff: {
        name: { from: null, to: data.name },
        email: { from: null, to: data.email },
        role: { from: null, to: data.role },
        ...(data.employeeId ? { employeeId: { from: null, to: data.employeeId } } : {}),
        mustChangePassword: { from: null, to: true },
      },
    });
    return ok({ id: created.id });
  });
  if (!result.ok) return result;
  revalidatePath(PAGE);
  return ok({ id: result.data.id, tempPassword });
}

// ---------------------------------------------------------------------------------------------------------------
// Edit

const updateSchema = z.object({
  id,
  name: name.optional(),
  email: email.optional(),
  employeeId: employeeId.optional(),
  role: role.optional(),
  /** The row's `updatedAt` as the panel read it (UserRow.updatedAt). */
  expectedUpdatedAt: z.string().min(1),
});

/**
 * The panel's Save (spec §4.4): every changed field (name, email, employee link, role) in ONE guarded write. A role
 * or email change bumps the person's session version (signed out everywhere); an employee-link or name change does
 * not. Refused when the row changed since the panel read it (`expectedUpdatedAt`), with nothing written. Audit: the
 * role as `role-change` (as before), the other fields as `user.update`.
 */
export async function updateUser(
  input: unknown,
): Promise<ActionResult<{ changed: boolean; signsOutActor: boolean; updatedAt: string }>> {
  const actor = await actionRole("admin");
  if (!actor) return forbidden();
  const rate = await checkRate(actor.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const next = parsed.data;

  let bumpedTo: number | null = null;
  const result = await inTransaction(async (tx) => {
    const target = await loadTarget(tx, next.id);
    if (!target) return conflict(GONE);
    if (target.isPermanentAdmin) return conflict(PERMANENT_LOCK);
    if (target.updatedAt.toISOString() !== next.expectedUpdatedAt) return conflict(CHANGED_TRY_AGAIN);

    const nextEmail = next.email === undefined ? undefined : normalizeEmail(next.email);
    const changes: Prisma.UserUncheckedUpdateManyInput = {};
    const diff: AuditDiff = {};
    if (next.name !== undefined && next.name !== target.name) {
      changes.name = next.name;
      diff.name = { from: target.name, to: next.name };
    }
    if (nextEmail !== undefined && nextEmail !== target.email) {
      const emailError = await emailFieldProblem(tx, nextEmail, target.id);
      if (emailError) return validationError({ email: emailError });
      changes.email = nextEmail;
      diff.email = { from: target.email, to: nextEmail };
    }
    if (next.employeeId !== undefined && next.employeeId !== target.employeeId) {
      if (next.employeeId) {
        const linkError = await employeeProblem(tx, next.employeeId, target.id);
        if (linkError) return validationError({ employeeId: linkError });
      }
      changes.employeeId = next.employeeId;
      diff.employeeId = { from: target.employeeId, to: next.employeeId };
    }
    const roleChanged = next.role !== undefined && next.role !== target.role;
    if (roleChanged) {
      const verdict = roleChange(target, next.role!, actor.id);
      if (!verdict.allowed) return conflict(verdict.reason);
      changes.role = next.role;
    }
    const signsOutActor = roleChanged && selfRoleChangeWarning(target, next.role!, actor.id) !== null;
    if (Object.keys(changes).length === 0) {
      return ok({ changed: false, signsOutActor: false, updatedAt: target.updatedAt.toISOString() });
    }

    const written = await tx.user.updateMany({
      where: { id: target.id, updatedAt: target.updatedAt, isPermanentAdmin: false },
      data: changes,
    });
    if (written.count === 0) return conflict(CHANGED_TRY_AGAIN);
    // Spec §4.2: a role or email change signs the person out everywhere; relinking the employee record does not.
    if (roleChanged || diff.email) bumpedTo = await bumpSessionVersion(tx, target.id);
    if (roleChanged) {
      await writeAudit(tx, {
        ...auditBase(actor, target),
        action: "role-change",
        diff: { role: { from: target.role, to: next.role } },
      });
    }
    if (Object.keys(diff).length > 0) await writeAudit(tx, { ...auditBase(actor, target), action: "user.update", diff });
    const after = await tx.user.findUnique({ where: { id: target.id }, select: { updatedAt: true } });
    return ok({ changed: true, signsOutActor, updatedAt: (after?.updatedAt ?? new Date()).toISOString() });
  });
  if (!result.ok) return result;
  if (bumpedTo !== null && next.id === actor.id) await keepOwnSession(actor, bumpedTo);
  if (result.data.changed) revalidatePath(PAGE);
  return result;
}

const roleSchema = z.object({
  userId: id,
  // zod 4 accepts ROLE_OPTIONS's plain `Role[]` directly and preserves the
  // element type, so `parsed.data.role` below is already `Role` — no cast.
  role,
});

/**
 * The role alone (the old Users & roles table). Kept beside updateUser: the same rule, the same guard on the
 * before-value, and (spec §4.2) a session-version bump.
 */
export async function setUserRole(
  input: unknown,
): Promise<ActionResult<{ changed: boolean; signsOutActor: boolean }>> {
  const actor = await actionRole("admin");
  if (!actor) return forbidden();
  const rate = await checkRate(actor.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = roleSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const nextRole = parsed.data.role;

  let bumpedTo: number | null = null;
  const result = await inTransaction(async (tx) => {
    const target = await loadTarget(tx, parsed.data.userId);
    if (!target) return conflict(GONE);
    // Called by the server independently of the UI: a hand-rolled request is refused on the page's own grounds.
    const verdict = roleChange(target, nextRole, actor.id);
    if (!verdict.allowed) return conflict(verdict.reason);
    // A warning, not a refusal (scope decision #3): an admin changing their OWN role is signed out at their next
    // request, because the token's role no longer matches.
    const signsOutActor = selfRoleChangeWarning(target, nextRole, actor.id) !== null;
    if (target.role === nextRole) return ok({ changed: false, signsOutActor }); // no-op: don't pollute the trail

    const written = await tx.user.updateMany({
      where: { id: target.id, role: target.role, isPermanentAdmin: false },
      data: { role: nextRole },
    });
    if (written.count === 0) return conflict("Someone else just changed that user's role — refresh.");
    bumpedTo = await bumpSessionVersion(tx, target.id);
    await writeAudit(tx, {
      ...auditBase(actor, target),
      action: "role-change",
      diff: { role: { from: target.role, to: nextRole } },
    });
    return ok({ changed: true, signsOutActor });
  });
  if (!result.ok) return result;
  if (bumpedTo !== null && parsed.data.userId === actor.id) await keepOwnSession(actor, bumpedTo);
  if (result.data.changed) revalidatePath(PAGE);
  return result;
}

// ---------------------------------------------------------------------------------------------------------------
// Turn on / off

const disableSchema = z.object({
  userId: id,
  disabled: z.boolean(),
  /** Optional: the row's `updatedAt` as the panel read it; when given, a row changed since is a conflict. */
  expectedUpdatedAt: z.string().min(1).optional(),
});

/**
 * The "Account active" switch (spec §4.4). Never the permanent admin, never your own account (canTurnOff), never a
 * sign-up still waiting or declined (Approve and Decline decide those). Turning an account off or on bumps its
 * session version, so no token from before the change survives it.
 */
export async function setUserDisabled(input: unknown): Promise<ActionResult<{ changed: boolean }>> {
  const actor = await actionRole("admin");
  if (!actor) return forbidden();
  const rate = await checkRate(actor.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = disableSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const next = parsed.data.disabled;
  const expected = parsed.data.expectedUpdatedAt;

  const result = await inTransaction(async (tx) => {
    const target = await loadTarget(tx, parsed.data.userId);
    if (!target) return conflict(GONE);
    const locked = lockReason(target);
    if (locked) return conflict(locked);
    if (target.approvalState !== "APPROVED") {
      return conflict("This sign-up hasn't been approved — approve or decline it instead.");
    }
    if (expected !== undefined && target.updatedAt.toISOString() !== expected) return conflict(CHANGED_TRY_AGAIN);
    const verdict = disableChange(target, next, actor.id);
    if (!verdict.allowed) return conflict(verdict.reason);
    if (target.disabled === next) return ok({ changed: false });

    const written = await tx.user.updateMany({
      where: {
        id: target.id, disabled: target.disabled, approvalState: "APPROVED", isPermanentAdmin: false,
        ...(expected !== undefined ? { updatedAt: target.updatedAt } : {}),
      },
      data: { disabled: next },
    });
    if (written.count === 0) {
      return conflict(expected !== undefined ? CHANGED_TRY_AGAIN : "Someone else just changed that user's access — refresh.");
    }
    await bumpSessionVersion(tx, target.id);
    await writeAudit(tx, {
      ...auditBase(actor, target),
      action: next ? "disable" : "enable",
      diff: { disabled: { from: target.disabled, to: next } },
    });
    return ok({ changed: true });
  });
  if (!result.ok) return result;
  if (result.data.changed) revalidatePath(PAGE);
  return result;
}

// ---------------------------------------------------------------------------------------------------------------
// Reset password

const resetSchema = z.object({ id });

/**
 * Reset password… (spec §4.4): a new temporary password, returned here exactly once. The person must choose their
 * own at their next sign-in, is signed out everywhere (bump), and their sign-in pause and Account settings
 * wrong-password count are cleared. Not the permanent admin (the lock; `npm run admin:recover` is its way back), not
 * your own account (Account settings is the place), and not a sign-up that hasn't been approved.
 */
export async function resetUserPassword(input: unknown): Promise<ActionResult<{ tempPassword: string }>> {
  const actor = await actionRole("admin");
  if (!actor) return forbidden();
  const rate = await checkRate(actor.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = resetSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));

  const tempPassword = generateTempPassword();
  const passwordHash = await bcrypt.hash(tempPassword, 10);
  const now = new Date();

  const result = await inTransaction(async (tx) => {
    const target = await loadTarget(tx, parsed.data.id);
    if (!target) return conflict(GONE);
    if (target.isPermanentAdmin) return conflict(PERMANENT_LOCK);
    if (target.id === actor.id) return conflict("Change your own password in Account settings.");
    if (target.approvalState !== "APPROVED") {
      return conflict("This sign-up hasn't been approved — approve it first; they keep the password they chose.");
    }
    // Guarded on the version read: a reset or password change landing in between is a conflict, not a double reset.
    const written = await tx.user.updateMany({
      where: { id: target.id, sessionVersion: target.sessionVersion, isPermanentAdmin: false },
      data: { passwordHash, mustChangePassword: true, passwordChangedAt: now },
    });
    if (written.count === 0) return conflict(CHANGED_TRY_AGAIN);
    await bumpSessionVersion(tx, target.id);
    await writeAudit(tx, {
      ...auditBase(actor, target),
      action: "password.reset",
      // Never the password, its hash or the temporary password: only when it was set, and that one is owed.
      diff: {
        passwordChangedAt: { from: target.passwordChangedAt?.toISOString() ?? null, to: now.toISOString() },
        ...(target.mustChangePassword ? {} : { mustChangePassword: { from: false, to: true } }),
      },
    });
    return ok({ email: target.email, id: target.id });
  });
  if (!result.ok) return result;
  // Spec §4.6: an admin reset clears the sign-in pause for that email, and the Account settings count for the account.
  await clearSignInFailures(result.data.email);
  await clearCurrentPasswordFailures(result.data.id);
  revalidatePath(PAGE);
  return ok({ tempPassword });
}

// ---------------------------------------------------------------------------------------------------------------
// Approve / decline a sign-up

const approveSchema = z.object({ id, role, employeeId: employeeId.optional() });

/**
 * Approve sign-up (spec §4.4, §4.6): APPROVED and turned on in the same write, with the role the admin picked and
 * the employee link (when given). From PENDING, or later from DECLINED. Guarded on the approval state read, so two
 * admins deciding at once can't both win. The person keeps the password they chose: nothing is owed.
 */
export async function approveSignup(input: unknown): Promise<ActionResult<null>> {
  const actor = await actionRole("admin");
  if (!actor) return forbidden();
  const rate = await checkRate(actor.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = approveSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const next = parsed.data;
  const now = new Date();

  const result = await inTransaction(async (tx) => {
    const target = await loadTarget(tx, next.id);
    if (!target) return conflict(GONE);
    if (target.isPermanentAdmin) return conflict(PERMANENT_LOCK);
    if (target.approvalState !== "PENDING" && target.approvalState !== "DECLINED") {
      return conflict("This account isn't waiting for approval — refresh.");
    }
    const linkChanged = next.employeeId !== undefined && next.employeeId !== target.employeeId;
    if (linkChanged && next.employeeId) {
      const linkError = await employeeProblem(tx, next.employeeId, target.id);
      if (linkError) return validationError({ employeeId: linkError });
    }
    const written = await tx.user.updateMany({
      where: { id: target.id, approvalState: target.approvalState, isPermanentAdmin: false },
      data: {
        approvalState: "APPROVED", disabled: false, role: next.role,
        ...(linkChanged ? { employeeId: next.employeeId } : {}),
        approvalDecidedAt: now, approvalDecidedById: actor.id,
      },
    });
    if (written.count === 0) return conflict("Someone else just decided this sign-up — refresh.");
    await writeAudit(tx, {
      ...auditBase(actor, target),
      action: "user.approve",
      diff: {
        approvalState: { from: target.approvalState, to: "APPROVED" },
        ...(target.disabled ? { disabled: { from: true, to: false } } : {}),
        ...(next.role !== target.role ? { role: { from: target.role, to: next.role } } : {}),
        ...(linkChanged ? { employeeId: { from: target.employeeId, to: next.employeeId } } : {}),
      },
    });
    return ok(null);
  });
  if (result.ok) revalidatePath(PAGE);
  return result;
}

const declineSchema = z.object({ id });

/**
 * Decline (spec §4.4): DECLINED, and the account stays turned off. Only a PENDING sign-up; guarded on that state.
 * The person can't sign in, and an admin may still approve them later from the Declined filter.
 */
export async function declineSignup(input: unknown): Promise<ActionResult<null>> {
  const actor = await actionRole("admin");
  if (!actor) return forbidden();
  const rate = await checkRate(actor.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = declineSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const now = new Date();

  const result = await inTransaction(async (tx) => {
    const target = await loadTarget(tx, parsed.data.id);
    if (!target) return conflict(GONE);
    if (target.isPermanentAdmin) return conflict(PERMANENT_LOCK);
    if (target.approvalState !== "PENDING") return conflict("This sign-up isn't waiting for approval — refresh.");
    const written = await tx.user.updateMany({
      where: { id: target.id, approvalState: "PENDING", isPermanentAdmin: false },
      data: { approvalState: "DECLINED", disabled: true, approvalDecidedAt: now, approvalDecidedById: actor.id },
    });
    if (written.count === 0) return conflict("Someone else just decided this sign-up — refresh.");
    await writeAudit(tx, {
      ...auditBase(actor, target),
      action: "user.decline",
      diff: {
        approvalState: { from: "PENDING", to: "DECLINED" },
        ...(target.disabled ? {} : { disabled: { from: false, to: true } }),
      },
    });
    return ok(null);
  });
  if (result.ok) revalidatePath(PAGE);
  return result;
}
