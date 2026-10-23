import type { Prisma } from "@prisma/client";
import { prisma } from "../db/client";
import { normalizeEmail } from "@/lib/auth-shared";

/**
 * Users & access (spec §4.6, Review Focus #5): three failed sign-ins for one email within 15 minutes pause that email
 * for 15 minutes from the third. Counted per lower-cased email whether or not an account exists, so the pause never
 * reveals which emails have accounts. A successful sign-in or an admin reset clears the count; the worker prunes
 * rows older than a day.
 */
export const SIGN_IN_LIMIT = { tries: 3, windowMs: 15 * 60_000 };

/**
 * Users & access fix round 1 (M5): wrong CURRENT passwords in Account settings, per account. Five within 15 minutes
 * pause that account's password change for 15 minutes from the fifth. Same table, lock and arithmetic as sign-in.
 */
export const CURRENT_PASSWORD_LIMIT = { tries: 5, windowMs: 15 * 60_000 };

type Limit = { tries: number; windowMs: number };

/**
 * The bucket key for an account's current-password tries. Upper-case on purpose: every sign-in key goes through
 * normalizeEmail (lower-cased), so no sign-in attempt, whatever "email" is typed, can ever land in, fill or clear
 * this bucket.
 */
export const currentPasswordKey = (userId: string) => `CURRENT:${userId}`;

/** The first key of the two-key advisory lock: sign-in attempts' own namespace, apart from any other lock. */
const LOCK_NAMESPACE = 410_024;

const key = (emailKey: string) => normalizeEmail(emailKey).slice(0, 320);
type Db = Pick<Prisma.TransactionClient, "signInAttempt">;

/**
 * True while some three failures fall within 15 minutes of each other and the latest of them is under 15 minutes
 * old. While paused no attempt is recorded (the password isn't checked), so the pause ends 15 minutes after the
 * third failure, not later.
 */
async function pausedIn(db: Db, emailKey: string, now: Date, limit: Limit = SIGN_IN_LIMIT): Promise<boolean> {
  const { tries, windowMs } = limit;
  // A pausing run ends inside the last window and starts at most a window before that: two windows back is enough.
  const rows = await db.signInAttempt.findMany({
    where: { emailKey, createdAt: { gt: new Date(now.getTime() - 2 * windowMs) } },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { createdAt: true },
  });
  const times = rows.map((r) => r.createdAt.getTime()).sort((a, b) => a - b);
  for (let i = tries - 1; i < times.length; i++) {
    const last = times[i];
    if (last > now.getTime() - windowMs && last - times[i - (tries - 1)] <= windowMs) return true;
  }
  return false;
}

/** A read-only look at the pause (no lock): for display and tests. Sign-in itself uses reserveSignInAttempt. */
export async function signInPaused(emailKey: string, now: Date = new Date()): Promise<boolean> {
  return pausedIn(prisma, key(emailKey), now);
}

export type SignInReservation = { paused: true } | { paused: false; attemptId: string };

/**
 * Fix round 1 (I-1): the check and the record under one per-email lock, so a burst of parallel attempts can't all
 * pass the check before any failure lands. Inside a transaction holding `pg_advisory_xact_lock` for this email: if
 * the email is paused, refuse; otherwise insert this attempt now, counted as a failure until it proves otherwise.
 * The lock ends with the transaction, before the caller's bcrypt compare, so no pooled connection waits on bcrypt.
 * Afterwards the caller keeps the row (a wrong password, a turned-off account), releases it (the right password
 * for a waiting or declined account: not a failure) or clears the email (a successful sign-in).
 */
export async function reserveSignInAttempt(emailKey: string): Promise<SignInReservation> {
  return reserveIn(key(emailKey), SIGN_IN_LIMIT);
}

/**
 * Fix round 1 (M5): the same locked check-and-record for one account's current-password tries in Account settings.
 * The caller keeps the row for a wrong current password, releases it for a right one, and clears the bucket after a
 * successful change.
 */
export async function reserveCurrentPasswordAttempt(userId: string): Promise<SignInReservation> {
  return reserveIn(currentPasswordKey(userId), CURRENT_PASSWORD_LIMIT);
}

export async function clearCurrentPasswordFailures(userId: string): Promise<void> {
  await prisma.signInAttempt.deleteMany({ where: { emailKey: currentPasswordKey(userId) } });
}

async function reserveIn(k: string, limit: Limit): Promise<SignInReservation> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LOCK_NAMESPACE}::int4, hashtext(${k}::text))`;
    const now = new Date();
    if (await pausedIn(tx, k, now, limit)) return { paused: true } as const;
    const row = await tx.signInAttempt.create({ data: { emailKey: k, createdAt: now }, select: { id: true } });
    return { paused: false, attemptId: row.id } as const;
    // Prisma's 2 s default maxWait includes opening a connection, which a cold start can exceed (measured ~2.1 s on
    // the laptop): a sign-in must not fail for that. The work inside is two short queries.
  }, { maxWait: 10_000, timeout: 10_000 });
}

/** Takes back a reserved attempt that turned out not to be a failure. */
export async function releaseSignInAttempt(attemptId: string): Promise<void> {
  await prisma.signInAttempt.deleteMany({ where: { id: attemptId } });
}

/** One failed attempt, stamped with the app's clock (the same clock the pause reads). Not locked: sign-in reserves. */
export async function recordSignInFailure(emailKey: string): Promise<void> {
  await prisma.signInAttempt.create({ data: { emailKey: key(emailKey), createdAt: new Date() } });
}

export async function clearSignInFailures(emailKey: string): Promise<void> {
  await prisma.signInAttempt.deleteMany({ where: { emailKey: key(emailKey) } });
}
