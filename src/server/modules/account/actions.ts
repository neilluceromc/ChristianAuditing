"use server";

import bcrypt from "bcryptjs";
import { z } from "zod";
import type { User } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { unstable_update } from "@/server/auth";
import { actionUser, passwordOwedUser } from "@/server/auth/guards";
import { passwordMatches } from "@/server/auth/password-check";
import { bumpSessionVersion, signedSessionUpdate } from "@/server/auth/session-version";
import { checkRate } from "@/server/rate-limit";
import { writeAudit } from "@/server/audit";
import { PASSWORD_COPY, passwordProblem } from "@/lib/password-rules";
import {
  conflict, forbidden, ok, rateLimited, validationError, zodFieldErrors, type ActionResult,
} from "@/server/action-result";

const CHANGED_MEANWHILE = "Your account changed while you were typing. Sign in again to carry on.";
const RATE_COPY = "Too many tries in a minute. Wait a moment, then try again.";

// bcrypt reads only the first 72 bytes; the cap only stops an absurd payload.
const pw = z.string().max(500);
const firstSchema = z.object({ password: pw, confirm: pw });
const changeSchema = z.object({ current: pw, password: pw, confirm: pw });

/** The new password's problem, by field, or null. `current` is the plain text the person typed (Account settings). */
function newPasswordErrors(password: string, confirm: string, current?: string): Record<string, string> | null {
  const problem = passwordProblem(password, { current });
  if (problem) return { password: problem };
  if (password !== confirm) return { confirm: PASSWORD_COPY.mismatch };
  return null;
}

/**
 * Saves the new hash, stamps passwordChangedAt, clears mustChangePassword and bumps the session version in ONE
 * transaction, with the audit. Guarded on the row this request read (its version, and whether a password was owed),
 * so an admin reset or another tab's save in between is a conflict, never a half-write. Then THIS device's token
 * takes the new version server-side (the signed update never reaches the browser); every other device signs out.
 */
async function saveOwnPassword(
  user: User,
  password: string,
  wasOwed: boolean,
): Promise<ActionResult<{ sessionVersion: number; passwordChangedAt: string }>> {
  const passwordHash = await bcrypt.hash(password, 10);
  const now = new Date();
  const version = await prisma.$transaction(async (tx) => {
    const written = await tx.user.updateMany({
      where: { id: user.id, sessionVersion: user.sessionVersion, mustChangePassword: wasOwed },
      data: { passwordHash, passwordChangedAt: now, mustChangePassword: false },
    });
    if (written.count === 0) return null;
    const next = await bumpSessionVersion(tx, user.id);
    await writeAudit(tx, {
      actorId: user.id,
      actorLabel: user.name,
      entityType: "user",
      entityId: user.id,
      action: "password.change",
      // Never the password or its hash: only when it changed, and that the owed flag cleared.
      diff: {
        passwordChangedAt: { from: user.passwordChangedAt?.toISOString() ?? null, to: now.toISOString() },
        ...(wasOwed ? { mustChangePassword: { from: true, to: false } } : {}),
      },
      source: "web",
    });
    return next;
  });
  if (version === null) return conflict(CHANGED_MEANWHILE);
  // Auth.js types the update as a Partial<Session>; the jwt callback (config.edge.ts) reads this signed shape instead.
  const update = await signedSessionUpdate(user.id, version, false);
  await unstable_update(update as unknown as Parameters<typeof unstable_update>[0]);
  // No revalidatePath: the page re-rendering in this response gains nothing (the Account card shows the returned
  // date; the first-sign-in page moves on to Home), so the action returns its result alone.
  return ok({ sessionVersion: version, passwordChangedAt: now.toISOString() });
}

/**
 * First sign-in (spec §4.3, PhoneFirst2): the person replaces the temporary password with their own. Open ONLY while
 * a new password is owed (passwordOwedUser); every other action is closed until then. Returns the new
 * sessionVersion; the session itself is already refreshed server-side, so the page only navigates on.
 */
export async function setOwnPassword(
  input: unknown,
): Promise<ActionResult<{ sessionVersion: number }>> {
  const user = await passwordOwedUser();
  if (!user) return forbidden();
  const rate = await checkRate(user.id, "mutation");
  if (!rate.allowed) return rateLimited(rate.retryAfterSec, RATE_COPY);
  const parsed = firstSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const { password, confirm } = parsed.data;

  const errors = newPasswordErrors(password, confirm);
  if (errors) return validationError(errors);
  // The browser never knows the temporary password, so "not the temporary one" is checked against its hash here.
  if (await passwordMatches(password, user.passwordHash)) {
    return validationError({ password: PASSWORD_COPY.sameAsTemporary });
  }

  const saved = await saveOwnPassword(user, password, true);
  return saved.ok ? ok({ sessionVersion: saved.data.sessionVersion }) : saved;
}

/**
 * Account settings (spec §4.5): change your own password. The current password is checked first, under the
 * mutation rate limit (every try counts, so guessing is capped), then the same rules as everywhere.
 */
export async function changeOwnPassword(
  input: unknown,
): Promise<ActionResult<{ sessionVersion: number; passwordChangedAt: string }>> {
  const user = await actionUser();
  if (!user) return forbidden();
  const rate = await checkRate(user.id, "mutation");
  if (!rate.allowed) return rateLimited(rate.retryAfterSec, RATE_COPY);
  const parsed = changeSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const { current, password, confirm } = parsed.data;

  if (!(await passwordMatches(current, user.passwordHash))) {
    const copy = PASSWORD_COPY.wrongCurrent;
    return { ok: false, kind: "validation", message: copy, fieldErrors: { current: copy } };
  }
  const errors = newPasswordErrors(password, confirm, current);
  if (errors) return validationError(errors);

  return saveOwnPassword(user, password, false);
}
