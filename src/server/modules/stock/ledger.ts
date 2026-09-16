/**
 * Phase 22 Task 4 (spec §5.2, plan P-1/P-2). A plain TypeScript module —
 * deliberately NOT `"use server"` — because `recordOutflow`/`recordInflowLot`
 * are shared between `movement-actions.ts` and `stocktake-actions.ts`, and a
 * `"use server"` module may only export async functions; a plain export
 * (like the `ActionFailure` class below) is not allowed there. Both action
 * modules import this file instead of each declaring their own copy.
 *
 * Every function here runs INSIDE the caller's transaction, after the caller
 * has already taken the item's `FOR UPDATE` row lock (P-2) — nothing here
 * takes a lock of its own.
 */
import type { Prisma } from "@prisma/client";
import { allocate, type ExpiredPolicy, type LotState } from "@/lib/stock-allocation";
import { unitsLabel } from "@/lib/stock-balance";
import { signedQuantity } from "@/lib/stock-movement-rules";
import { conflict, type ActionResult } from "@/server/action-result";

type Tx = Prisma.TransactionClient;

/**
 * R2/I-1 (unified — see `movement-actions.ts`/`stocktake-actions.ts`, which
 * used to each declare their own copy of this class): a refusal discovered
 * inside `$transaction` must THROW so Prisma rolls back whatever the
 * callback already wrote, never `return` — a plain `return` from an
 * interactive transaction's callback COMMITS. `recordOutflow` itself throws
 * this on a shortfall, so it has to be the SAME class every caller's
 * `catch (e) { e instanceof ActionFailure }` checks against — declaring it
 * locally in each `"use server"` module would make that check always fail
 * for a refusal thrown from here.
 */
export class ActionFailure extends Error {
  constructor(public readonly result: ActionResult<never>) {
    super(result.ok ? undefined : result.message);
  }
}

/**
 * Spec §5.1/P-2: an item's open lots (`remaining > 0`), built from one
 * `findMany` of the item's lots joined to their allocations. Callers run
 * this inside the transaction that already holds the item's `FOR UPDATE`
 * lock, so the read is consistent with whatever this same transaction is
 * about to write.
 */
export async function openLots(tx: Tx, itemId: string): Promise<LotState[]> {
  const lots = await tx.stockLot.findMany({
    where: { itemId },
    select: {
      id: true,
      lotDate: true,
      expiresAt: true,
      unitCost: true,
      quantity: true,
      allocations: { select: { quantity: true } },
    },
  });
  return lots
    .map((lot) => ({
      id: lot.id,
      lotDate: lot.lotDate,
      expiresAt: lot.expiresAt,
      unitCost: lot.unitCost === null ? null : Number(lot.unitCost),
      remaining: lot.quantity - lot.allocations.reduce((sum, a) => sum + a.quantity, 0),
    }))
    .filter((lot) => lot.remaining > 0);
}

/**
 * `unitsLabel(12, "sachet")` → "12 sachets". Spec §7's expired-shortfall copy
 * ("Only 12 unexpired sachets of PN-0001 …") wants "unexpired" spliced in
 * between the number and the (already pluralised) unit word — inserting
 * right after the label's first space does that regardless of which of
 * `unitsLabel`'s pluralisation branches fired.
 */
function unexpiredLabel(qty: number, unit: string): string {
  const label = unitsLabel(qty, unit);
  const spaceIdx = label.indexOf(" ");
  return spaceIdx === -1 ? label : `${label.slice(0, spaceIdx)} unexpired${label.slice(spaceIdx)}`;
}

export interface OutflowFields {
  departmentId?: string;
  employeeId?: string | null;
  reason?: string | null;
  stocktakeId?: string;
  occurredAt?: Date;
  actorId: string;
}

/**
 * Spec §5.2: the one place every outflow — an ISSUE, a negative ADJUSTMENT
 * (manual or a stocktake's), or a write-off's single-lot ADJUSTMENT — is
 * written. Reads the item's open lots (restricted to one lot when
 * `onlyLotId` is given, the write-off case), runs the pure `allocate` rule,
 * and on a shortfall throws `ActionFailure(conflict(...))` with spec §7's
 * exact copy: `Only N left on this lot` for a write-off; otherwise `Only
 * {available} unexpired {unit} of {code} — write off the expired lot first`
 * when some of the shortfall is locked in expired lots, else D1's own
 * `Only N {unit} left of {code} — issue at most that many`. `quantity` is
 * always the positive magnitude to remove; the movement is written with the
 * negative signed quantity regardless of `kind` — an ADJUSTMENT reaching
 * this helper is, by construction, always a decrease.
 */
export async function recordOutflow(
  tx: Tx,
  args: {
    item: { id: string; code: string; unit: string };
    kind: "ISSUE" | "ADJUSTMENT";
    quantity: number;
    policy: ExpiredPolicy;
    today: string;
    onlyLotId?: string;
    fields: OutflowFields;
  },
): Promise<{ movementId: string; cost: number | null; uncostedUnits: number }> {
  const { item, kind, quantity, policy, today, onlyLotId, fields } = args;
  let lots = await openLots(tx, item.id);
  if (onlyLotId) lots = lots.filter((lot) => lot.id === onlyLotId);

  const result = allocate(lots, quantity, today, policy);
  if (!result.ok) {
    const available = quantity - result.short;
    const message = onlyLotId
      ? `Only ${available} left on this lot`
      : result.expiredRemaining > 0
        ? `Only ${unexpiredLabel(available, item.unit)} of ${item.code} — write off the expired lot first`
        : `Only ${unitsLabel(available, item.unit)} left of ${item.code} — issue at most that many`;
    throw new ActionFailure(conflict(message));
  }

  const occurredAt = fields.occurredAt ?? new Date();
  const mv = await tx.stockMovement.create({
    data: {
      itemId: item.id,
      kind,
      quantity: -Math.abs(quantity),
      departmentId: fields.departmentId ?? null,
      employeeId: fields.employeeId ?? null,
      reason: fields.reason ?? null,
      stocktakeId: fields.stocktakeId ?? null,
      actorId: fields.actorId,
      occurredAt,
    },
  });
  if (result.allocations.length) {
    await tx.stockAllocation.createMany({
      data: result.allocations.map((a) => ({ movementId: mv.id, lotId: a.lotId, quantity: a.quantity })),
    });
  }
  return { movementId: mv.id, cost: result.cost, uncostedUnits: result.uncostedUnits };
}

export interface InflowFields {
  reason?: string | null;
  stocktakeId?: string;
  occurredAt?: Date;
  actorId: string;
}

/**
 * Spec §5.2/decision 3: the one place every non-receipt inflow — opening
 * stock and a positive ADJUSTMENT (manual or a stocktake's) — becomes both a
 * movement and the (by default uncosted) lot backing it. `receiveStock`
 * keeps writing its own costed, supplier-attributable lot directly; it does
 * not call this helper.
 */
export async function recordInflowLot(
  tx: Tx,
  args: {
    item: { id: string };
    origin: "OPENING" | "ADJUSTMENT";
    quantity: number;
    unitCost: number | null;
    fields: InflowFields;
  },
): Promise<{ movementId: string; lotId: string }> {
  const { item, origin, quantity, unitCost, fields } = args;
  const occurredAt = fields.occurredAt ?? new Date();
  const lot = await tx.stockLot.create({
    data: {
      itemId: item.id,
      origin,
      lotDate: occurredAt,
      unitCost,
      quantity,
      receivedById: fields.actorId,
    },
  });
  const mv = await tx.stockMovement.create({
    data: {
      itemId: item.id,
      kind: origin,
      quantity: signedQuantity(origin, quantity),
      lotId: lot.id,
      reason: fields.reason ?? null,
      stocktakeId: fields.stocktakeId ?? null,
      actorId: fields.actorId,
      occurredAt,
    },
  });
  return { movementId: mv.id, lotId: lot.id };
}
