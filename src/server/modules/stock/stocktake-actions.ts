"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { actionUser } from "@/server/auth/guards";
import { checkRate } from "@/server/rate-limit";
import { writeAudit } from "@/server/audit";
import { canManageStock } from "@/lib/stock-access";
import { countSchema, stocktakeOpenSchema } from "@/lib/stock-schema";
import { planStocktakePost } from "@/lib/stocktake";
import {
  conflict, forbidden, ok, rateLimited, validationError, zodFieldErrors, type ActionResult,
} from "@/server/action-result";

const idSchema = z.object({ id: z.string().min(1) });

/**
 * R2, same local class as `item-actions.ts`'s `createStockItem`: a refusal
 * discovered inside `$transaction` must THROW so Prisma rolls back whatever
 * the callback already wrote (the per-line ADJUSTMENT creates + audits in
 * `postStocktake`), not `return` — a plain `return` from an interactive
 * transaction's callback commits everything written so far.
 */
class ActionFailure extends Error {
  constructor(public readonly result: ActionResult<never>) {
    super(result.ok ? undefined : result.message);
  }
}

function revalidateStocktake(id?: string) {
  revalidatePath("/stock/stocktakes");
  if (id) revalidatePath(`/stock/stocktakes/${id}`);
  revalidatePath("/audit");
}

/**
 * Spec §5.3/§8: opening "all" is blocked by ANY open stocktake; opening a
 * category is blocked by an open "all" or an open same category. Both
 * reduce to the same query — `categoryId: null` OR the scope — because when
 * the new scope IS "all" every open stocktake already matches `categoryId:
 * null OR categoryId: scope` is skipped entirely (no OR needed: anything
 * open blocks it).
 *
 * I-2: no unique index can express "one open stocktake per scope, where an
 * open 'all' also blocks every category" — READ COMMITTED lets two
 * concurrent opens both see no blocker and both insert. The check below
 * (pre-transaction) is only a fast path that can still race; the one inside
 * the transaction is the real gate, serialised by a transaction-scoped
 * Postgres advisory lock (`pg_advisory_xact_lock`, released automatically at
 * commit/rollback, run with `$executeRaw` since it returns `void` and
 * `$queryRaw` cannot deserialize that) taken before it re-runs the identical
 * query under `tx`.
 */
export async function openStocktake(input: unknown): Promise<ActionResult<{ id: string; refNo: string }>> {
  const user = await actionUser();
  if (!user || !canManageStock(user.role)) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = stocktakeOpenSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const d = parsed.data;
  const scope = d.categoryId === "all" ? null : d.categoryId;

  let categoryName = "All categories";
  if (scope) {
    const cat = await prisma.stockCategory.findUnique({ where: { id: scope }, select: { name: true } });
    if (!cat) return validationError({ categoryId: "Unknown category" });
    categoryName = cat.name;
  }

  const blocking = await prisma.stocktake.findFirst({
    where: { state: "OPEN", ...(scope ? { OR: [{ categoryId: null }, { categoryId: scope }] } : {}) },
    include: { category: { select: { name: true } } },
    orderBy: { openedAt: "asc" },
  });
  if (blocking) {
    return conflict(`${blocking.refNo} is still open for ${blocking.category?.name ?? "all categories"} — post or cancel it first`);
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // `$queryRaw` cannot deserialize `pg_advisory_xact_lock`'s `void`
      // result (Prisma has no column type for it) — `$executeRaw` runs the
      // same statement without trying to read a row back.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('stocktake-open'))`;
      const blockingInTx = await tx.stocktake.findFirst({
        where: { state: "OPEN", ...(scope ? { OR: [{ categoryId: null }, { categoryId: scope }] } : {}) },
        include: { category: { select: { name: true } } },
        orderBy: { openedAt: "asc" },
      });
      if (blockingInTx) {
        throw new ActionFailure(conflict(`${blockingInTx.refNo} is still open for ${blockingInTx.category?.name ?? "all categories"} — post or cancel it first`));
      }
      const [{ nextval }] = await tx.$queryRaw<[{ nextval: bigint }]>`SELECT nextval('stocktake_ref_seq')`;
      const refNo = `ST-${String(nextval).padStart(4, "0")}`;
      const items = await tx.stockItem.findMany({
        where: { archivedAt: null, ...(scope ? { categoryId: scope } : {}) },
        select: { id: true },
      });
      const ids = items.map((i) => i.id);
      const sums = ids.length
        ? await tx.stockMovement.groupBy({ by: ["itemId"], where: { itemId: { in: ids } }, _sum: { quantity: true } })
        : [];
      const balanceById = new Map(sums.map((s) => [s.itemId, s._sum.quantity ?? 0]));
      const st = await tx.stocktake.create({ data: { refNo, categoryId: scope, openedById: user.id, note: d.note || null } });
      if (ids.length) {
        await tx.stocktakeLine.createMany({
          data: ids.map((id) => ({ stocktakeId: st.id, itemId: id, bookQty: balanceById.get(id) ?? 0 })),
        });
      }
      await writeAudit(tx, {
        actorId: user.id, actorLabel: user.name, entityType: "stocktake", entityId: st.id, action: "stocktake.opened",
        diff: { scope: { from: null, to: categoryName }, lines: { from: null, to: ids.length } },
      });
      return { id: st.id, refNo };
    });
    revalidateStocktake(result.id);
    return ok(result);
  } catch (e) {
    if (e instanceof ActionFailure) return e.result;
    throw e;
  }
}

/**
 * Spec §5.3: OPEN only; re-counting a line is allowed; no audit per line (the
 * post records the outcome). I-3: a count and a post can race on the same
 * stocktake, so the OPEN check is re-run under a lock on the STOCKTAKE row
 * (not just a pre-transaction read) — `postStocktake` takes the identical
 * lock first, so whichever of the two gets there first serialises the other
 * behind it, and a count that arrives during a post window either lands
 * before the post reads its lines or fails this re-checked OPEN gate.
 */
export async function countStocktakeLine(input: unknown): Promise<ActionResult<null>> {
  const user = await actionUser();
  if (!user || !canManageStock(user.role)) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = countSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const d = parsed.data;

  const line = await prisma.stocktakeLine.findUnique({
    where: { id: d.lineId }, select: { id: true, stocktakeId: true },
  });
  if (!line) return conflict("That line no longer exists.");

  try {
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Stocktake" WHERE "id" = ${line.stocktakeId} FOR UPDATE`;
      const st = await tx.stocktake.findUnique({ where: { id: line.stocktakeId }, select: { state: true } });
      if (!st || st.state !== "OPEN") throw new ActionFailure(conflict("This stocktake is no longer open."));
      await tx.stocktakeLine.update({
        where: { id: d.lineId }, data: { countedQty: d.countedQty, countedAt: new Date(), countedById: user.id },
      });
    });
  } catch (e) {
    if (e instanceof ActionFailure) return e.result;
    throw e;
  }
  revalidatePath(`/stock/stocktakes/${line.stocktakeId}`);
  return ok(null);
}

/**
 * R2, the same `ActionFailure` pattern as `item-actions.ts`'s
 * `createStockItem`: every refusal discovered inside the transaction THROWS
 * — a plain `return` from an interactive transaction's callback would commit
 * whatever the callback already wrote instead of rolling it back.
 *
 * I-3: the stocktake row is locked FIRST (`FOR UPDATE`), and the state AND
 * lines (counted quantities) are re-read INSIDE the transaction under that
 * lock — never the pre-transaction snapshot `countStocktakeLine` could have
 * mutated in the meantime. Only once that re-read confirms OPEN does the
 * item-row lock (`Prisma.join`) and the rest of the post proceed, so a count
 * that lands while a post is already running either commits before this
 * lock is taken (and is reflected in the re-read) or blocks until the post's
 * transaction finishes and then fails `countStocktakeLine`'s own re-checked
 * OPEN gate — never both applying against different snapshots of the line.
 */
export async function postStocktake(input: unknown): Promise<ActionResult<{ adjusted: number; skipped: number }>> {
  const user = await actionUser();
  if (!user || !canManageStock(user.role)) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const { id } = parsed.data;

  // Fast pre-transaction existence check only — state and lines are re-read
  // under the row lock below, so this never governs the actual refusal.
  const exists = await prisma.stocktake.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return conflict("That stocktake no longer exists.");

  try {
    const counts = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Stocktake" WHERE "id" = ${id} FOR UPDATE`;
      const st = await tx.stocktake.findUnique({
        where: { id },
        select: { id: true, refNo: true, state: true, lines: { select: { id: true, itemId: true, bookQty: true, countedQty: true } } },
      });
      if (!st) throw new ActionFailure(conflict("That stocktake no longer exists."));
      if (st.state !== "OPEN") throw new ActionFailure(conflict("This stocktake is no longer open."));

      const ids = st.lines.map((l) => l.itemId);
      if (ids.length) {
        await tx.$queryRaw`SELECT "id" FROM "StockItem" WHERE "id" IN (${Prisma.join(ids)}) FOR UPDATE`;
      }
      const sums = ids.length
        ? await tx.stockMovement.groupBy({ by: ["itemId"], where: { itemId: { in: ids } }, _sum: { quantity: true } })
        : [];
      const current = new Map(sums.map((s) => [s.itemId, s._sum.quantity ?? 0]));
      const plan = planStocktakePost(st.lines, current);

      for (const adj of plan.adjustments) {
        const before = current.get(adj.itemId) ?? 0;
        await tx.stockMovement.create({
          data: { itemId: adj.itemId, kind: "ADJUSTMENT", quantity: adj.quantity, reason: `Stocktake ${st.refNo}`, stocktakeId: st.id, actorId: user.id },
        });
        await writeAudit(tx, {
          actorId: user.id, actorLabel: user.name, entityType: "stock-item", entityId: adj.itemId, action: "stock.adjusted",
          diff: { balance: { from: before, to: before + adj.quantity }, reason: { from: null, to: `Stocktake ${st.refNo}` } },
        });
      }

      const updated = await tx.stocktake.updateMany({
        where: { id: st.id, state: "OPEN" }, data: { state: "POSTED", postedAt: new Date(), postedById: user.id },
      });
      if (updated.count === 0) throw new ActionFailure(conflict("This stocktake was already posted"));

      await writeAudit(tx, {
        actorId: user.id, actorLabel: user.name, entityType: "stocktake", entityId: st.id, action: "stocktake.posted",
        diff: { adjusted: { from: null, to: plan.adjustments.length }, skipped: { from: null, to: plan.skipped.length } },
      });
      return { adjusted: plan.adjustments.length, skipped: plan.skipped.length };
    });
    revalidateStocktake(id);
    revalidatePath("/stock");
    return ok(counts);
  } catch (e) {
    if (e instanceof ActionFailure) return e.result;
    throw e;
  }
}

export async function cancelStocktake(input: unknown): Promise<ActionResult<null>> {
  const user = await actionUser();
  if (!user || !canManageStock(user.role)) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const { id } = parsed.data;

  const st = await prisma.stocktake.findUnique({ where: { id }, select: { state: true } });
  if (!st) return conflict("That stocktake no longer exists.");
  if (st.state !== "OPEN") return conflict("This stocktake is no longer open.");

  await prisma.$transaction(async (tx) => {
    await tx.stocktake.update({ where: { id }, data: { state: "CANCELLED" } });
    await writeAudit(tx, {
      actorId: user.id, actorLabel: user.name, entityType: "stocktake", entityId: id, action: "stocktake.cancelled",
    });
  });
  revalidateStocktake(id);
  return ok(null);
}
