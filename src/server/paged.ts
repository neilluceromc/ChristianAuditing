import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { pageOf, type Page } from "@/lib/paging";

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
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}
