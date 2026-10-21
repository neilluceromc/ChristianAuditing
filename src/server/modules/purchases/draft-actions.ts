"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma, type AssetClass, type PurchaseOrderState } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { actionRole } from "@/server/auth/guards";
import { checkRate } from "@/server/rate-limit";
import { writeAudit } from "@/server/audit";
import { diffOf } from "@/lib/audit-diff";
import { PO_WRITE_ROLES, poRefNo, stateAfterSave } from "@/lib/po-flow";
import { GROUP_ARCHIVED } from "@/lib/groups";
import {
  conflict, forbidden, ok, rateLimited, validationError, zodFieldErrors, type ActionResult,
} from "@/server/action-result";

/**
 * Prices are Decimal(12,2) in Postgres: .multipleOf(0.01) is what stops a
 * third decimal being accepted here and silently rounded by the database, so
 * the audit trail can never record a number Postgres never stored.
 */
const unitSchema = z.object({
  id: z.string().min(1).optional(), // present = an existing row
  description: z.string().trim().min(2, "Say what this is").max(200),
  specs: z.string().trim().max(500).default(""),
  /** Migration 38: the line's category decides its class (IT or not). Optional until Task 3's PO form. */
  categoryId: z.string().min(1).optional(),
  qty: z.number().int().min(1, "At least one").max(999),
  unitPrice: z
    .number()
    .min(0)
    .max(99_999_999.99)
    .multipleOf(0.01, "Prices go to centavos — two decimal places at most")
    .nullable(),
});

const draftSchema = z.object({
  id: z.string().min(1).optional(),
  departmentId: z.string().min(1, "Pick the requesting department"),
  units: z.array(unitSchema).min(1, "A request needs at least one unit").max(50),
});

/**
 * Same contract as actions.ts: a transaction that can't get a connection in
 * time (P2028) is contention, not a crash, so it becomes a typed conflict the
 * autosave UI can show. Everything else rethrows.
 */
async function asActionResult<T>(run: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2028") {
      return conflict("The database is busy right now — nothing was written. Your input is still here; try again.");
    }
    throw err;
  }
}

/** States the edit page may still save (Task 3 replaces this with poMoneyStage). */
const EDITABLE: readonly PurchaseOrderState[] = ["SENT_BACK", "WITH_IT"];

/**
 * Each line's class from its chosen category; a line with no category is a legacy line (null), which
 * stateAfterSave sends to IT. An unknown category id is a validation error, not a silent null.
 */
async function lineClasses(
  units: Array<{ categoryId?: string }>,
): Promise<{ ok: true; cls: Array<AssetClass | null> } | { ok: false }> {
  const ids = [...new Set(units.map((u) => u.categoryId).filter((x): x is string => !!x))];
  const cats = ids.length
    ? await prisma.assetCategory.findMany({ where: { id: { in: ids } }, select: { id: true, cls: true } })
    : [];
  if (cats.length !== ids.length) return { ok: false };
  const byId = new Map(cats.map((c) => [c.id, c.cls]));
  return { ok: true, cls: units.map((u) => (u.categoryId ? byId.get(u.categoryId) ?? null : null)) };
}

export interface DraftSaved {
  id: string;
  refNo: string;
  savedAt: string;
}

const summarize = (units: Array<{ qty: number; unitPrice: number | null }>) => ({
  units: units.length,
  total: units.reduce((sum, u) => sum + u.qty * (u.unitPrice ?? 0), 0),
});

/**
 * The row is created by the first autosave, not by opening the form —
 * abandoning /purchases/new leaves no junk PO behind. refNo continues the
 * seeded PO-#### range via purchase_request_ref_seq (poRefNo), and the state is
 * stateAfterSave over the lines' classes (migration 38; Task 3 replaces this action).
 */
export async function createDraft(input: unknown): Promise<ActionResult<DraftSaved>> {
  return asActionResult(() => createDraftImpl(input));
}

async function createDraftImpl(input: unknown): Promise<ActionResult<DraftSaved>> {
  const parsed = draftSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const { units, departmentId } = parsed.data;

  const user = await actionRole(...PO_WRITE_ROLES);
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);

  const dept = await prisma.department.findUnique({ where: { id: departmentId }, select: { id: true, name: true, archivedAt: true } });
  if (!dept) return validationError({ departmentId: "Unknown department" });
  // Phase 37 (spec §2.1): a new request never names an archived department or client.
  if (dept.archivedAt) return validationError({ departmentId: GROUP_ARCHIVED });
  const classes = await lineClasses(units);
  if (!classes.ok) return validationError({ units: "Unknown category" });
  const state = stateAfterSave(classes.cls.map((cls) => ({ cls })));

  const created = await prisma.$transaction(async (tx) => {
    const [{ nextval }] = await tx.$queryRaw<[{ nextval: bigint }]>`SELECT nextval('purchase_request_ref_seq')`;
    const request = await tx.purchaseOrder.create({
      data: {
        refNo: poRefNo(Number(nextval)),
        state,
        requestedById: user.id,
        departmentId: dept.id,
        lines: {
          create: units.map((u) => ({
            description: u.description,
            specs: u.specs || null,
            categoryId: u.categoryId ?? null,
            qty: u.qty,
            unitPrice: u.unitPrice,
          })),
        },
      },
      select: { id: true, refNo: true },
    });
    await writeAudit(tx, {
      actorId: user.id,
      actorLabel: user.name,
      entityType: "purchase-order",
      entityId: request.id,
      action: "create",
      diff: {
        state: { from: null, to: state },
        department: { from: null, to: dept.name },
        ...diffOf({}, summarize(units)),
      },
    });
    return request;
  });

  revalidatePath("/purchases");
  revalidatePath("/purchases/activity");
  revalidatePath("/audit"); // the create writes an AuditEntry too
  return ok({ id: created.id, refNo: created.refNo, savedAt: new Date().toISOString() });
}

/**
 * Replaces the line set of an editable order (SENT_BACK or WITH_IT, nothing registered from it): rows dropped in
 * the editor are deleted, known ids updated, new ones created — one transaction, batched rather than one round
 * trip per row (Prisma's interactive-transaction budget is 5s). Editing requires ownership (or admin). The state
 * is left alone (Task 3's savePurchaseOrder owns resubmits). Audits only when something actually changed.
 */
export async function saveDraft(input: unknown): Promise<ActionResult<DraftSaved>> {
  return asActionResult(() => saveDraftImpl(input));
}

async function saveDraftImpl(input: unknown): Promise<ActionResult<DraftSaved>> {
  const parsed = draftSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const { id, units, departmentId } = parsed.data;
  if (!id) return validationError({ _form: "Missing draft id." });

  const user = await actionRole(...PO_WRITE_ROLES);
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);

  const dept = await prisma.department.findUnique({ where: { id: departmentId }, select: { id: true, name: true, archivedAt: true } });
  if (!dept) return validationError({ departmentId: "Unknown department" });
  // Phase 37 (spec §2.1): an edit keeps the draft's current value even when it is archived, and
  // refuses any other archived one.
  if (dept.archivedAt) {
    const current = await prisma.purchaseOrder.findUnique({ where: { id }, select: { departmentId: true } });
    if (current?.departmentId !== dept.id) return validationError({ departmentId: GROUP_ARCHIVED });
  }

  const classes = await lineClasses(units);
  if (!classes.ok) return validationError({ units: "Unknown category" });

  let saved: DraftSaved | null = null;
  const failure = await prisma.$transaction(async (tx) => {
    const req = await tx.purchaseOrder.findUnique({
      where: { id },
      select: {
        id: true, refNo: true, state: true, requestedById: true, departmentId: true,
        department: { select: { name: true } },
        lines: { select: { id: true, qty: true, unitPrice: true } },
        _count: { select: { assets: true } },
      },
    });
    if (!req) return conflict("That purchase order no longer exists.");
    if (!EDITABLE.includes(req.state)) {
      return conflict(`${req.refNo} can't be edited here — it is ${req.state}.`);
    }
    if (req._count.assets > 0) {
      return conflict(`${req.refNo} has assets registered from it — its lines can't be edited here.`);
    }
    if (req.requestedById !== user.id && user.role !== "admin") return forbidden();

    const known = new Set(req.lines.map((u) => u.id));
    const keep = new Set(units.map((u) => u.id).filter((x): x is string => !!x));
    // an id the caller invented (or one belonging to another request) must not
    // become a row under this draft
    if ([...keep].some((unitId) => !known.has(unitId))) {
      return conflict("This draft changed elsewhere — refresh and retry.");
    }
    const drop = req.lines.filter((u) => !keep.has(u.id)).map((u) => u.id);

    if (drop.length) await tx.purchaseOrderLine.deleteMany({ where: { id: { in: drop }, orderId: id } });
    for (const u of units.filter((x) => x.id)) {
      await tx.purchaseOrderLine.update({
        where: { id: u.id },
        data: {
          description: u.description, specs: u.specs || null, qty: u.qty, unitPrice: u.unitPrice,
          ...(u.categoryId ? { categoryId: u.categoryId } : {}),
        },
      });
    }
    const fresh = units.filter((u) => !u.id);
    if (fresh.length) {
      await tx.purchaseOrderLine.createMany({
        data: fresh.map((u) => ({
          orderId: id,
          description: u.description,
          specs: u.specs || null,
          categoryId: u.categoryId ?? null,
          qty: u.qty,
          unitPrice: u.unitPrice,
        })),
      });
    }

    const now = new Date();
    const departmentChanged = req.departmentId !== dept.id;
    await tx.purchaseOrder.updateMany({
      where: { id, state: req.state },
      data: { updatedAt: now, ...(departmentChanged ? { departmentId: dept.id } : {}) },
    });

    const before = summarize(
      req.lines.map((u) => ({ qty: u.qty, unitPrice: u.unitPrice === null ? null : Number(u.unitPrice) })),
    );
    const diff = diffOf(before, summarize(units));
    if (departmentChanged) diff.department = { from: req.department?.name ?? null, to: dept.name };
    // autosave fires per edit; an unchanged save must not spam the audit log
    if (Object.keys(diff).length > 0 || drop.length > 0 || fresh.length > 0) {
      await writeAudit(tx, {
        actorId: user.id, actorLabel: user.name, entityType: "purchase-order",
        entityId: id, action: "update", diff,
      });
    }
    saved = { id, refNo: req.refNo, savedAt: now.toISOString() };
    return null;
  });

  if (failure) return failure;
  revalidatePath("/purchases");
  revalidatePath(`/purchases/${id}`);
  revalidatePath(`/purchases/${id}/edit`);
  return ok(saved!);
}
