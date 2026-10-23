import { prisma } from "../db/client";
import { normalizeEmail } from "@/lib/auth-shared";

/**
 * Users & access (spec §4.6, Review Focus #5): three failed sign-ins for one email within 15 minutes pause that email
 * for 15 minutes from the third. Counted per lower-cased email whether or not an account exists, so the pause never
 * reveals which emails have accounts. A successful sign-in or an admin reset clears the count; the worker prunes
 * rows older than a day.
 */
export const SIGN_IN_LIMIT = { tries: 3, windowMs: 15 * 60_000 };

const key = (emailKey: string) => normalizeEmail(emailKey).slice(0, 320);

/**
 * True while some three failures fall within 15 minutes of each other and the latest of them is under 15 minutes
 * old. While paused no failure is recorded (the password isn't checked), so the pause ends 15 minutes after the
 * third failure, not later.
 */
export async function signInPaused(emailKey: string, now: Date = new Date()): Promise<boolean> {
  const { tries, windowMs } = SIGN_IN_LIMIT;
  // A pausing run ends inside the last window and starts at most a window before that: two windows back is enough.
  const rows = await prisma.signInAttempt.findMany({
    where: { emailKey: key(emailKey), createdAt: { gt: new Date(now.getTime() - 2 * windowMs) } },
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

/** One failed attempt, stamped with the app's clock (the same clock signInPaused reads). */
export async function recordSignInFailure(emailKey: string): Promise<void> {
  await prisma.signInAttempt.create({ data: { emailKey: key(emailKey), createdAt: new Date() } });
}

export async function clearSignInFailures(emailKey: string): Promise<void> {
  await prisma.signInAttempt.deleteMany({ where: { emailKey: key(emailKey) } });
}
