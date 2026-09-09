"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db/client";
import { actionUser } from "@/server/auth/guards";
import { checkRate } from "@/server/rate-limit";
import { writeAudit } from "@/server/audit";
import { canManageStock } from "@/lib/stock-access";
import { adjustSchema, issueSchema, receiptSchema, todayStr } from "@/lib/stock-schema";
import { canIssue, signedQuantity } from "@/lib/stock-movement-rules";
import { unitsLabel } from "@/lib/stock-balance";
import {
  conflict, forbidden, ok, rateLimited, validationError, zodFieldErrors, type ActionResult,
} from "@/server/action-result";

function revalidateItem(itemId: string) {
  revalidatePath("/stock");
  revalidatePath(`/stock/items/${itemId}`);
  revalidatePath("/audit");
}

/**
 * R2/I-1, the same local class `item-actions.ts` and `stocktake-actions.ts`
 * each declare: a refusal discovered inside `$transaction` must THROW so
 * Prisma rolls back whatever the callback already wrote, never `return` — a
 * plain `return` from an interactive transaction's callback COMMITS. Nothing
 * is written above `issueStock`'s three in-transaction refusals today, but
 * the pattern is declared here (not just followed ad hoc) so the next writer
 * who adds a write above one of them inherits the rollback for free instead
 * of having to notice the hazard themselves.
 */
class ActionFailure extends Error {
  constructor(public readonly result: ActionResult<never>) {
    super(result.ok ? undefined : result.message);
  }
}

/**
 * Spec §5.3. Item existence/archived and the packs×packSize cross-check are
 * refused BEFORE the transaction (nothing to roll back yet); the lot and
 * movement are written together so a receipt is never half-recorded.
 */
export async function receiveStock(input: unknown): Promise<ActionResult<{ movementId: string; balance: number }>> {
  const user = await actionUser();
  if (!user || !canManageStock(user.role)) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = receiptSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const d = parsed.data;

  const item = await prisma.stockItem.findUnique({
    where: { id: d.itemId }, select: { id: true, code: true, unit: true, packSize: true, archivedAt: true },
  });
  if (!item) return conflict("That item no longer exists.");
  if (item.archivedAt) return conflict(`${item.code} is archived — restore it first.`);
  if (d.packs != null && item.packSize && d.packs * item.packSize !== d.quantity) {
    return validationError({ quantity: `${d.packs} packs × ${item.packSize} is ${d.packs * item.packSize}, not ${d.quantity}` });
  }
  if (d.supplierId) {
    const v = await prisma.vendor.findUnique({ where: { id: d.supplierId }, select: { archivedAt: true } });
    if (!v || v.archivedAt) return conflict("That supplier is archived — restore it first.");
  }
  const occurredAt = new Date(`${d.occurredAt || todayStr()}T00:00:00Z`);

  const result = await prisma.$transaction(async (tx) => {
    const lot = await tx.stockLot.create({
      data: {
        itemId: item.id, supplierId: d.supplierId || null,
        lotDate: new Date(`${d.lotDate || d.occurredAt || todayStr()}T00:00:00Z`),
        unitCost: d.unitCost ?? null, quantity: d.quantity, reference: d.reference || null, receivedById: user.id,
      },
    });
    const mv = await tx.stockMovement.create({
      data: { itemId: item.id, kind: "RECEIPT", quantity: signedQuantity("RECEIPT", d.quantity), lotId: lot.id, actorId: user.id, occurredAt },
    });
    const sum = await tx.stockMovement.aggregate({ where: { itemId: item.id }, _sum: { quantity: true } });
    await writeAudit(tx, {
      actorId: user.id, actorLabel: user.name, entityType: "stock-item", entityId: item.id, action: "stock.received",
      diff: { quantity: { from: null, to: d.quantity }, lot: { from: null, to: d.reference || d.lotDate || "lot" } },
    });
    return { movementId: mv.id, balance: sum._sum.quantity ?? 0 };
  });
  revalidateItem(item.id);
  return ok(result);
}

/**
 * R2/I-1: the same `ActionFailure` pattern as `item-actions.ts`'s
 * `createStockItem` and `stocktake-actions.ts`'s `postStocktake` — every
 * in-transaction refusal here (over-issue, unknown department, unknown
 * employee) THROWS `ActionFailure`, caught by the `try/catch` below and
 * turned back into the module's `ActionResult`. A `return` from inside an
 * interactive transaction's callback COMMITS rather than rolling back, so it
 * is never used for a refusal found after the item row lock is taken.
 */
export async function issueStock(input: unknown): Promise<ActionResult<{ balance: number }>> {
  const user = await actionUser();
  if (!user || !canManageStock(user.role)) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = issueSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const d = parsed.data;

  const item = await prisma.stockItem.findUnique({
    where: { id: d.itemId }, select: { id: true, code: true, unit: true, archivedAt: true },
  });
  if (!item) return conflict("That item no longer exists.");
  if (item.archivedAt) return conflict(`${item.code} is archived — restore it first.`);

  try {
    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "StockItem" WHERE "id" = ${item.id} FOR UPDATE`;
      const sum = await tx.stockMovement.aggregate({ where: { itemId: item.id }, _sum: { quantity: true } });
      const balance = sum._sum.quantity ?? 0;
      const check = canIssue(balance, d.quantity);
      if (!check.ok) {
        throw new ActionFailure(conflict(`Only ${unitsLabel(check.left, item.unit)} left of ${item.code} — issue at most that many`));
      }
      const dept = await tx.department.findUnique({ where: { id: d.departmentId }, select: { id: true, name: true } });
      if (!dept) throw new ActionFailure(validationError({ departmentId: "Unknown department" }));
      let employeeId: string | null = null;
      if (d.employeeId) {
        const employee = await tx.employee.findUnique({ where: { id: d.employeeId }, select: { id: true } });
        if (!employee) throw new ActionFailure(validationError({ employeeId: "Unknown employee" }));
        employeeId = employee.id;
      }
      await tx.stockMovement.create({
        data: {
          itemId: item.id, kind: "ISSUE", quantity: signedQuantity("ISSUE", d.quantity), departmentId: dept.id,
          employeeId: employeeId || null, reason: d.reason || null, actorId: user.id,
        },
      });
      await writeAudit(tx, {
        actorId: user.id, actorLabel: user.name, entityType: "stock-item", entityId: item.id, action: "stock.issued",
        diff: { quantity: { from: balance, to: balance - d.quantity }, department: { from: null, to: dept.name } },
      });
      return { balance: balance - d.quantity };
    });
    revalidateItem(item.id);
    return ok(result);
  } catch (e) {
    if (e instanceof ActionFailure) return e.result;
    throw e;
  }
}

/**
 * `delta` writes the signed change as-is; `set` computes `target - balance`
 * under the same row lock. A zero result changes nothing, so it succeeds
 * without writing a no-op movement (the append-only ledger would otherwise
 * carry rows nobody can ever undo).
 */
export async function adjustStock(input: unknown): Promise<ActionResult<{ balance: number }>> {
  const user = await actionUser();
  if (!user || !canManageStock(user.role)) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = adjustSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const d = parsed.data;

  const item = await prisma.stockItem.findUnique({
    where: { id: d.itemId }, select: { id: true, code: true, archivedAt: true },
  });
  if (!item) return conflict("That item no longer exists.");
  if (item.archivedAt) return conflict(`${item.code} is archived — restore it first.`);

  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "StockItem" WHERE "id" = ${item.id} FOR UPDATE`;
    const sum = await tx.stockMovement.aggregate({ where: { itemId: item.id }, _sum: { quantity: true } });
    const balance = sum._sum.quantity ?? 0;
    const q = d.mode === "delta" ? d.quantity : d.quantity - balance;
    if (q === 0) return { balance };
    await tx.stockMovement.create({
      data: { itemId: item.id, kind: "ADJUSTMENT", quantity: q, reason: d.reason, actorId: user.id },
    });
    await writeAudit(tx, {
      actorId: user.id, actorLabel: user.name, entityType: "stock-item", entityId: item.id, action: "stock.adjusted",
      diff: { balance: { from: balance, to: balance + q }, reason: { from: null, to: d.reason } },
    });
    return { balance: balance + q };
  });
  revalidateItem(item.id);
  return ok(result);
}
