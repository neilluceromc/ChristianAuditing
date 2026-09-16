"use server";

import { prisma } from "@/server/db/client";
import { actionUser } from "@/server/auth/guards";
import { checkRate } from "@/server/rate-limit";
import { writeAudit } from "@/server/audit";
import { canManageStock } from "@/lib/stock-access";
import {
  adjustSchema, issueSchema, receiptSchema, setLotCostSchema, todayStr, writeOffSchema,
} from "@/lib/stock-schema";
import { canIssue, signedQuantity } from "@/lib/stock-movement-rules";
import { unitsLabel } from "@/lib/stock-balance";
import { localDateISO } from "@/lib/format";
import {
  conflict, forbidden, ok, rateLimited, validationError, zodFieldErrors, type ActionResult,
} from "@/server/action-result";
import { ActionFailure, openLots, recordInflowLot, recordOutflow } from "./ledger";
import { revalidateStockReads } from "./revalidate";

function revalidateItem(itemId: string) {
  // Phase 22 (spec §7): the list, the item, the audit and the three reports —
  // one shared list so no writer can forget a page (final review).
  revalidateStockReads(itemId);
}

/** Spec §5.4/R3: names the lot in an audit diff — its reference when it has one, else its lot date. */
function lotLabel(lot: { reference: string | null; lotDate: Date }): string {
  return lot.reference || localDateISO(lot.lotDate);
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
        expiresAt: d.expiresAt ? new Date(`${d.expiresAt}T00:00:00Z`) : null,
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
      const { cost } = await recordOutflow(tx, {
        item, kind: "ISSUE", quantity: d.quantity, policy: "skip", today: localDateISO(new Date()),
        fields: { departmentId: dept.id, employeeId, reason: d.reason || null, actorId: user.id },
      });
      await writeAudit(tx, {
        actorId: user.id, actorLabel: user.name, entityType: "stock-item", entityId: item.id, action: "stock.issued",
        diff: {
          quantity: { from: balance, to: balance - d.quantity },
          department: { from: null, to: dept.name },
          cost: { from: null, to: cost },
        },
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
 * carry rows nobody can ever undo). Spec §5.2: a positive result becomes an
 * uncosted ADJUSTMENT lot (`recordInflowLot`); a negative one draws down the
 * item's lots expired-first (`recordOutflow`, policy `"first"`) — wrapped in
 * `try/catch` because that helper can now throw `ActionFailure` on a
 * shortfall, even though the invariant Σ remaining = balance means a
 * well-formed adjustment should never actually hit it.
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
    where: { id: d.itemId }, select: { id: true, code: true, unit: true, archivedAt: true },
  });
  if (!item) return conflict("That item no longer exists.");
  if (item.archivedAt) return conflict(`${item.code} is archived — restore it first.`);

  try {
    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "StockItem" WHERE "id" = ${item.id} FOR UPDATE`;
      const sum = await tx.stockMovement.aggregate({ where: { itemId: item.id }, _sum: { quantity: true } });
      const balance = sum._sum.quantity ?? 0;
      const q = d.mode === "delta" ? d.quantity : d.quantity - balance;
      if (q === 0) return { balance };
      if (q > 0) {
        await recordInflowLot(tx, {
          item, origin: "ADJUSTMENT", quantity: q, unitCost: null,
          fields: { reason: d.reason, actorId: user.id },
        });
      } else {
        await recordOutflow(tx, {
          item, kind: "ADJUSTMENT", quantity: -q, policy: "first", today: localDateISO(new Date()),
          fields: { reason: d.reason, actorId: user.id },
        });
      }
      await writeAudit(tx, {
        actorId: user.id, actorLabel: user.name, entityType: "stock-item", entityId: item.id, action: "stock.adjusted",
        diff: { balance: { from: balance, to: balance + q }, reason: { from: null, to: d.reason } },
      });
      return { balance: balance + q };
    });
    revalidateItem(item.id);
    return ok(result);
  } catch (e) {
    if (e instanceof ActionFailure) return e.result;
    throw e;
  }
}

/**
 * Spec §5.2 (new). `quantity` defaults to the lot's own remaining, resolved
 * here under the item lock (the schema never sees a lot, so it cannot
 * default this itself) — a request for MORE than that resolves to a
 * shortfall `recordOutflow` itself refuses with `Only N left on this lot`.
 * The one case `recordOutflow`'s own guard cannot cover is the RESOLVED
 * default being zero (a closed lot with nothing left): `allocate()` treats
 * `quantity <= 0` as a programming error and throws a raw `Error`, not an
 * `ActionFailure`, so that case is refused here before ever calling it.
 */
export async function writeOffLot(input: unknown): Promise<ActionResult<{ balance: number }>> {
  const user = await actionUser();
  if (!user || !canManageStock(user.role)) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = writeOffSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const d = parsed.data;

  const lot = await prisma.stockLot.findUnique({
    where: { id: d.lotId },
    select: {
      id: true, reference: true, lotDate: true,
      item: { select: { id: true, code: true, unit: true, archivedAt: true } },
    },
  });
  if (!lot) return conflict("That lot no longer exists.");
  if (lot.item.archivedAt) return conflict(`${lot.item.code} is archived — restore it first.`);

  try {
    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "StockItem" WHERE "id" = ${lot.item.id} FOR UPDATE`;
      const lots = await openLots(tx, lot.item.id);
      const remaining = lots.find((l) => l.id === lot.id)?.remaining ?? 0;
      const quantity = d.quantity ?? remaining;
      if (quantity <= 0) throw new ActionFailure(conflict("Only 0 left on this lot"));

      await recordOutflow(tx, {
        item: lot.item, kind: "ADJUSTMENT", quantity, policy: "first",
        today: localDateISO(new Date()), onlyLotId: lot.id,
        fields: { reason: d.reason, actorId: user.id },
      });

      const sum = await tx.stockMovement.aggregate({ where: { itemId: lot.item.id }, _sum: { quantity: true } });
      await writeAudit(tx, {
        actorId: user.id, actorLabel: user.name, entityType: "stock-item", entityId: lot.item.id, action: "stock.written-off",
        diff: {
          lot: { from: null, to: lotLabel(lot) },
          quantity: { from: null, to: unitsLabel(quantity, lot.item.unit) },
          reason: { from: null, to: d.reason },
        },
      });
      return { balance: sum._sum.quantity ?? 0 };
    });
    revalidateItem(lot.item.id);
    return ok(result);
  } catch (e) {
    if (e instanceof ActionFailure) return e.result;
    throw e;
  }
}

/** Spec §4.3/§5.2 (new). `unitCost` is settable exactly once — the conditional `updateMany` is the guard against a race with a second `setLotCost` call, not just the pre-check above it. */
export async function setLotCost(input: unknown): Promise<ActionResult<null>> {
  const user = await actionUser();
  if (!user || !canManageStock(user.role)) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = setLotCostSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const d = parsed.data;

  const lot = await prisma.stockLot.findUnique({
    where: { id: d.lotId },
    select: {
      id: true, unitCost: true, reference: true, lotDate: true,
      item: { select: { id: true, code: true, archivedAt: true } },
    },
  });
  if (!lot) return conflict("That lot no longer exists.");
  if (lot.item.archivedAt) return conflict(`${lot.item.code} is archived — restore it first.`);
  if (lot.unitCost !== null) return conflict("This lot already has a cost");

  try {
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "StockItem" WHERE "id" = ${lot.item.id} FOR UPDATE`;
      const written = await tx.stockLot.updateMany({
        where: { id: lot.id, unitCost: null }, data: { unitCost: d.unitCost },
      });
      if (written.count === 0) throw new ActionFailure(conflict("This lot already has a cost"));
      await writeAudit(tx, {
        actorId: user.id, actorLabel: user.name, entityType: "stock-item", entityId: lot.item.id, action: "stock.lot-cost-set",
        diff: { lot: { from: null, to: lotLabel(lot) }, unitCost: { from: null, to: d.unitCost } },
      });
    });
  } catch (e) {
    if (e instanceof ActionFailure) return e.result;
    throw e;
  }
  revalidateItem(lot.item.id);
  return ok(null);
}
