/*
 * Test double (not a test file, never imported by app code): the SignInAttempt table in memory, filtered the way
 * Postgres would for sign-in-limit.ts's queries, plus an interactive `$transaction` whose
 * `$executeRaw` "SELECT pg_advisory_xact_lock(ns, hashtext(key))" really serialises callers per key until the
 * transaction ends. Every query yields to the event loop's microtasks first, so concurrent callers interleave exactly
 * where an unlocked check-then-insert would race.
 */

export type AttemptRow = { id: string; emailKey: string; createdAt: Date };

export const attempts = {
  rows: [] as AttemptRow[],
  seq: 0,
  /** The lock keys taken, in the order the locks were granted. */
  locked: [] as string[],
};

export function resetAttempts(): void {
  attempts.rows = [];
  attempts.seq = 0;
  attempts.locked = [];
  locks.clear();
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

const locks = new Map<string, Promise<void>>();

/**
 * An interactive-transaction double. The array form (`$transaction([p1, p2])`) just awaits the promises, as other
 * callers in the same module (signOutAction) use it.
 */
export async function fakeTransaction(arg: unknown): Promise<unknown> {
  if (Array.isArray(arg)) return Promise.all(arg);
  const releases: Array<() => void> = [];
  const tx = {
    signInAttempt: signInAttemptTable,
    async $executeRaw(_sql: TemplateStringsArray, ...values: unknown[]) {
      const key = String(values[values.length - 1]);
      const previous = locks.get(key) ?? Promise.resolve();
      let release!: () => void;
      const mine = new Promise<void>((resolve) => (release = resolve));
      locks.set(key, previous.then(() => mine));
      releases.push(release);
      await previous;
      attempts.locked.push(key);
      return 1;
    },
  };
  try {
    return await (arg as (t: typeof tx) => Promise<unknown>)(tx);
  } finally {
    for (const release of releases) release();
  }
}
