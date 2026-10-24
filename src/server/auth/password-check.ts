import bcrypt from "bcryptjs";

// A valid cost-10 bcrypt hash of a throwaway string; compared against when no
// user row exists so a check always spends the same time (anti-enumeration).
const DUMMY_HASH = "$2b$10$l89N0WvFRRNscT9OSQHFYOavkWnuDSQo.q6hXve35x64eOdY.U6my";

/**
 * One bcrypt compare, against the account's hash or the dummy one when there is no account or no password (an
 * SSO-only row), so the timing never says whether the account exists. True only for a real hash that matches.
 */
export async function passwordMatches(password: string, passwordHash: string | null | undefined): Promise<boolean> {
  const ok = await bcrypt.compare(password, passwordHash ?? DUMMY_HASH);
  return ok && !!passwordHash;
}
