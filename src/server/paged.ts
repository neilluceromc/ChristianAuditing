import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { pageOf, type Page } from "@/lib/paging";

/** How long a paged read may wait for a pooled connection before failing (a burst queues, it does not 500). */
export const PAGED_MAX_WAIT_MS = 10_000;
/** How long the whole count → page window may take (a slow list on a cold database stays slow, it does not fail). */
export const PAGED_TIMEOUT_MS = 20_000;

/**
 * One list's count and its page, read inside ONE `RepeatableRead` interactive
 * transaction (spec §5). Under PostgreSQL both statements share one snapshot,
 * so the total, the page clamp (`pageOf`) and the rows always agree — a write
 * that lands between the count and the `findMany` can no longer shift the
 * page out from under a request the way two separate queries could.
 *
 * `client` defaults to the shared `prisma` singleton; the unit test injects a
 * fake whose `$transaction(fn, opts)` calls `fn(fakeTx)` directly and records
 * `opts` (P-3) — no real database, no Prisma mocking library.
 */
export async function pagedSnapshot<T>(
  size: number,
  requested: number,
  count: (tx: Prisma.TransactionClient) => Promise<number>,
  rows: (tx: Prisma.TransactionClient, pg: Page) => Promise<T[]>,
  client: PrismaClient = prisma,
): Promise<{ rows: T[] } & Page> {
  return client.$transaction(
    async (tx) => {
      const total = await count(tx);
      const pg = pageOf(total, requested, size);
      const pageRows = await rows(tx, pg);
      return { rows: pageRows, ...pg };
    },
    // Explicit budgets, not Prisma's 2 s / 5 s defaults: eighteen lists now
    // pin one pooled connection for the whole count → page window, so a
    // burst should queue rather than throw P2024, and a slow list on a cold
    // database should stay slow rather than fail (final review, Phase 21).
    {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      maxWait: PAGED_MAX_WAIT_MS,
      timeout: PAGED_TIMEOUT_MS,
    },
  );
}
