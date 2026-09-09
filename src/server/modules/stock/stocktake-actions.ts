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

  const result = await prisma.$transaction(async (tx) => {
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
}

/** Spec §5.3: OPEN only; re-counting a line is allowed; no audit per line (the post records the outcome). */
export async function countStocktakeLine(input: unknown): Promise<ActionResult<null>> {
  const user = await actionUser();
  if (!user || !canManageStock(user.role)) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = countSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const d = parsed.data;

  const line = await prisma.stocktakeLine.findUnique({
    where: { id: d.lineId }, select: { id: true, stocktakeId: true, stocktake: { select: { state: true } } },
  });
  if (!line) return conflict("That line no longer exists.");
  if (line.stocktake.state !== "OPEN") return conflict("This stocktake is no longer open.");

  await prisma.stocktakeLine.update({
    where: { id: d.lineId }, data: { countedQty: d.countedQty, countedAt: new Date(), countedById: user.id },
  });
  revalidatePath(`/stock/stocktakes/${line.stocktakeId}`);
  return ok(null);
}

/**
 * The "failure" variable pattern (R2), same as movement-actions.ts: the
 * updateMany's zero-count race (someone else posted it meanwhile) is
 * returned from inside the transaction and handed back after it resolves.
 */
export async function postStocktake(input: unknown): Promise<ActionResult<{ adjusted: number; skipped: number }>> {
  const user = await actionUser();
  if (!user || !canManageStock(user.role)) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const { id } = parsed.data;

  const st = await prisma.stocktake.findUnique({
    where: { id },
    select: { id: true, refNo: true, state: true, lines: { select: { id: true, itemId: true, bookQty: true, countedQty: true } } },
  });
  if (!st) return conflict("That stocktake no longer exists.");
  if (st.state !== "OPEN") return conflict("This stocktake is no longer open.");

  let counts: { adjusted: number; skipped: number } | null = null;
  const failure = await prisma.$transaction(async (tx) => {
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
    if (updated.count === 0) return conflict("This stocktake was already posted");

    await writeAudit(tx, {
      actorId: user.id, actorLabel: user.name, entityType: "stocktake", entityId: st.id, action: "stocktake.posted",
      diff: { adjusted: { from: null, to: plan.adjustments.length }, skipped: { from: null, to: plan.skipped.length } },
    });
    counts = { adjusted: plan.adjustments.length, skipped: plan.skipped.length };
    return null;
  });
  if (failure) return failure;
  revalidateStocktake(id);
  revalidatePath("/stock");
  return ok(counts!);
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
