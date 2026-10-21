import type { Prisma } from "@prisma/client";

/**
 * `SELECT … FOR UPDATE` on a purchase order's row (the table keeps its old name), held until the transaction ends.
 * Every action that reads a PO's registered or approved counts takes it first — save, send back, fix, close short,
 * cancel (po-actions.ts) and register (po-register.ts) — so they serialise on the one row: a registration landing at
 * the same moment as a cancel or a close-short waits, then re-reads. Kept out of the "use server" modules, which may
 * export only async server actions.
 */
export async function lockPo(tx: Prisma.TransactionClient, id: string): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "PurchaseRequest" WHERE "id" = ${id} FOR UPDATE`;
}
