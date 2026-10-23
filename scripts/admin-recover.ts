/**
 * Users & access (spec §4.4, Recovery; owner 2026-10-24): the permanent admin's way back in when they forget their
 * password. Nobody can reset that account from Users & access (it is locked against every admin action), so the
 * owner runs, with DATABASE_URL in the environment:
 *
 *   npm run admin:recover -- --email <the permanent admin's email>
 *
 * It sets a new temporary password (printed once, here only), makes the next sign-in choose a new one, signs every
 * session out (sessionVersion + 1), clears the sign-in pause and the Account settings count, and writes the audit
 * entry `password.reset` with source "cli". It works on the permanent admin's account and no other. DATABASE_URL is
 * read from the environment and never printed, not even inside an error.
 *
 * Relative imports only, like prisma/seed.ts: this runs under tsx outside Next.
 */
import bcrypt from "bcryptjs";
import { PrismaClient, type Prisma } from "@prisma/client";
import { generateTempPassword } from "../src/server/auth/temp-password";
import { normalizeEmail } from "../src/lib/auth-shared";
import { writeAudit } from "../src/server/audit";

/** The one thing the command needs from Prisma: an interactive transaction. */
export type RecoverDb = { $transaction: <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) => Promise<T> };

export type RecoverResult = { ok: true; tempPassword: string; name: string } | { ok: false; message: string };

const NOT_PERMANENT = "That email isn't the permanent admin's. This command only recovers the permanent admin's account.";
const USAGE = "Usage: npm run admin:recover -- --email <the permanent admin's email>";

/** The Account settings wrong-password bucket (sign-in-limit.ts's currentPasswordKey; upper-case on purpose). */
const currentPasswordKey = (userId: string) => `CURRENT:${userId}`;

/** The core, without printing: sets the temporary password on the permanent admin's account, in one transaction. */
export async function recoverPermanentAdmin(db: RecoverDb, rawEmail: string): Promise<RecoverResult> {
  const email = normalizeEmail(rawEmail);
  if (!email) return { ok: false, message: USAGE };
  const tempPassword = generateTempPassword();
  const passwordHash = await bcrypt.hash(tempPassword, 10);
  const now = new Date();

  return db.$transaction(async (tx): Promise<RecoverResult> => {
    const user = await tx.user.findUnique({
      where: { email },
      select: { id: true, name: true, isPermanentAdmin: true, mustChangePassword: true, passwordChangedAt: true },
    });
    if (!user?.isPermanentAdmin) return { ok: false, message: NOT_PERMANENT };
    const written = await tx.user.updateMany({
      where: { id: user.id, isPermanentAdmin: true },
      data: { passwordHash, mustChangePassword: true, passwordChangedAt: now, sessionVersion: { increment: 1 } },
    });
    if (written.count === 0) return { ok: false, message: NOT_PERMANENT };
    // Spec §4.6: a reset clears the sign-in pause for the email, and the account's Account settings count.
    await tx.signInAttempt.deleteMany({ where: { emailKey: { in: [email, currentPasswordKey(user.id)] } } });
    await writeAudit(tx, {
      actorId: null,
      actorLabel: "Recovery command",
      entityType: "user",
      entityId: user.id,
      action: "password.reset",
      source: "cli",
      // Never the password, its hash or the temporary password.
      diff: {
        passwordChangedAt: { from: user.passwordChangedAt?.toISOString() ?? null, to: now.toISOString() },
        ...(user.mustChangePassword ? {} : { mustChangePassword: { from: false, to: true } }),
      },
    });
    return { ok: true, tempPassword, name: user.name };
  });
}

/** `--email <address>` or `--email=<address>`; null when missing. */
function emailArg(argv: string[]): string | null {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--email=")) return arg.slice("--email=".length) || null;
    if (arg === "--email") return argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : null;
  }
  return null;
}

/** Every secret the environment holds, removed from a message before it is printed. */
function scrub(message: string, env: Record<string, string | undefined>): string {
  let out = message;
  for (const key of ["DATABASE_URL", "DIRECT_URL"]) {
    const value = env[key];
    if (value) out = out.split(value).join(`[${key}]`);
  }
  // Any other connection string (a pooler URL, say) loses its credentials.
  return out.replace(/(postgres(?:ql)?:\/\/)[^@\s/]+@/gi, "$1[credentials]@");
}

export interface RecoverIo {
  db: () => RecoverDb;
  out: (line: string) => void;
  err: (line: string) => void;
}

/** The command: arguments and environment in, an exit code out. The database is opened only once both are good. */
export async function runRecover(argv: string[], env: Record<string, string | undefined>, io: RecoverIo): Promise<number> {
  const email = emailArg(argv);
  if (!email) {
    io.err(USAGE);
    return 1;
  }
  if (!env.DATABASE_URL) {
    io.err("DATABASE_URL is not set. Set it in the environment for the database to recover, then run this again.");
    return 1;
  }
  try {
    const result = await recoverPermanentAdmin(io.db(), email);
    if (!result.ok) {
      io.err(result.message);
      return 1;
    }
    io.out(`Temporary password for ${result.name} (${normalizeEmail(email)}): ${result.tempPassword}`);
    io.out("It is shown only this once. They choose their own password at their next sign-in; every session is signed out.");
    return 0;
  } catch (e) {
    io.err(`Recovery failed; nothing was changed. ${scrub(e instanceof Error ? e.message : String(e), env)}`);
    return 1;
  }
}

// Run only as the command (`tsx scripts/admin-recover.ts`), never when a test imports this file.
if (/admin-recover\.ts$/.test((process.argv[1] ?? "").replace(/\\/g, "/"))) {
  let client: PrismaClient | null = null;
  runRecover(process.argv.slice(2), process.env, {
    db: () => (client = new PrismaClient()) as unknown as RecoverDb,
    out: (line) => console.log(line),
    err: (line) => console.error(line),
  })
    .then((code) => { process.exitCode = code; })
    .finally(() => client?.$disconnect().catch(() => {}));
}
