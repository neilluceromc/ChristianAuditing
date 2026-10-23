/*
 * Test double (not a test file, never imported by app code): the SignInAttempt table in memory, filtered the way
 * Postgres would for sign-in-limit.ts's queries, plus an interactive `$transaction` whose
 * `$queryRaw` "SELECT pg_try_advisory_xact_lock(ns, hashtext(key))" behaves as Postgres's does: it takes the key's
 * lock until the transaction ends and answers true, or answers false at once when another transaction holds it
 * (final review M-3: never waits). Every query yields to the event loop's microtasks first, so concurrent callers
 * interleave exactly where an unlocked check-then-insert would race.
 */

export type AttemptRow = { id: string; emailKey: string; createdAt: Date };

export const attempts = {
  rows: [] as AttemptRow[],
  seq: 0,
  /** The lock keys taken, in the order the locks were granted. */
  locked: [] as string[],
  /** The lock keys asked for while another transaction held them (answered false). */
  busy: [] as string[],
};

export function resetAttempts(): void {
  attempts.rows = [];
  attempts.seq = 0;
  attempts.locked = [];
  attempts.busy = [];
  held.clear();
}

/** Lets other pending promise chains run, without timers (works under vi.useFakeTimers). */
async function yieldTurn(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

type Where = { id?: string; emailKey?: string; createdAt?: { gt?: Date; lt?: Date } };

function matches(r: AttemptRow, where: Where): boolean {
  if (where.id !== undefined && r.id !== where.id) return false;
  if (where.emailKey !== undefined && r.emailKey !== where.emailKey) return false;
  if (where.createdAt?.gt && !(r.createdAt > where.createdAt.gt)) return false;
  if (where.createdAt?.lt && !(r.createdAt < where.createdAt.lt)) return false;
  return true;
}

export const signInAttemptTable = {
  async create({ data }: { data: { emailKey: string; createdAt?: Date } }) {
    await yieldTurn();
    const row = { id: `a${++attempts.seq}`, emailKey: data.emailKey, createdAt: data.createdAt ?? new Date() };
    attempts.rows.push(row);
    return { ...row };
  },
  async findMany({ where, orderBy, take }: { where: Where; orderBy?: { createdAt: "asc" | "desc" }; take?: number }) {
    await yieldTurn();
    const found = attempts.rows.filter((r) => matches(r, where)).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    if (orderBy?.createdAt === "desc") found.reverse();
    return (take ? found.slice(0, take) : found).map((r) => ({ id: r.id, createdAt: r.createdAt }));
  },
  async deleteMany({ where }: { where: Where }) {
    await yieldTurn();
    const before = attempts.rows.length;
    attempts.rows = attempts.rows.filter((r) => !matches(r, where));
    return { count: before - attempts.rows.length };
  },
};

/** Keys whose advisory lock some open transaction holds. */
const held = new Set<string>();

/** Tests only: holds a key's lock as another transaction would; call the result to release it. */
export function holdLock(key: string): () => void {
  held.add(key);
  return () => held.delete(key);
}

/**
 * An interactive-transaction double. The array form (`$transaction([p1, p2])`) just awaits the promises, as other
 * callers in the same module (signOutAction) use it.
 */
export async function fakeTransaction(arg: unknown): Promise<unknown> {
  if (Array.isArray(arg)) return Promise.all(arg);
  const mine: string[] = [];
  const tx = {
    signInAttempt: signInAttemptTable,
    // pg_try_advisory_xact_lock: decided at the call, never queued behind the holder.
    async $queryRaw(_sql: TemplateStringsArray, ...values: unknown[]) {
      const key = String(values[values.length - 1]);
      if (held.has(key)) {
        attempts.busy.push(key);
        await yieldTurn();
        return [{ locked: false }];
      }
      held.add(key);
      mine.push(key);
      attempts.locked.push(key);
      await yieldTurn();
      return [{ locked: true }];
    },
  };
  try {
    return await (arg as (t: typeof tx) => Promise<unknown>)(tx);
  } finally {
    for (const key of mine) held.delete(key);
  }
}
