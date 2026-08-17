"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { actionRole } from "@/server/auth/guards";
import { checkRate } from "@/server/rate-limit";
import { writeAudit } from "@/server/audit";
import { diffOf } from "@/lib/audit-diff";
import { DRAFT_ROLES } from "@/lib/purchase-flow";
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
  units: z.array(unitSchema).min(1, "A request needs at least one unit").max(50),
});

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
 * The DRAFT row is created by the first autosave, not by opening the form —
 * abandoning /purchases/new leaves no junk PR behind. refNo continues the
 * seeded PR-#### range via purchase_request_ref_seq (the seed leaves it at 201).
 */
export async function createDraft(input: unknown): Promise<ActionResult<DraftSaved>> {
  const parsed = draftSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const { units } = parsed.data;

  const user = await actionRole(...DRAFT_ROLES);
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);

  const created = await prisma.$transaction(async (tx) => {
    const [{ nextval }] = await tx.$queryRaw<[{ nextval: bigint }]>`SELECT nextval('purchase_request_ref_seq')`;
    const request = await tx.purchaseRequest.create({
      data: {
        refNo: `PR-${String(nextval).padStart(4, "0")}`,
        state: "DRAFT",
        requestedById: user.id,
        units: {
          create: units.map((u) => ({
            description: u.description,
            specs: u.specs || null,
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
      entityType: "purchase-request",
      entityId: request.id,
      action: "create",
      diff: { state: { from: null, to: "DRAFT" }, ...diffOf({}, summarize(units)) },
    });
    return request;
  });

  revalidatePath("/purchases");
  revalidatePath("/purchases/activity");
  return ok({ id: created.id, refNo: created.refNo, savedAt: new Date().toISOString() });
}

/**
 * Replaces the unit set of a DRAFT: rows dropped in the editor are deleted,
 * known ids updated, new ones created — one transaction, batched rather than
 * one round trip per row (Prisma's interactive-transaction budget is 5s).
 * Editing requires ownership (or admin): a draft is not yet a shared document.
 * Audits only when something actually changed (scope decision #5).
 */
export async function saveDraft(input: unknown): Promise<ActionResult<DraftSaved>> {
  const parsed = draftSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const { id, units } = parsed.data;
  if (!id) return validationError({ _form: "Missing draft id." });

  const user = await actionRole(...DRAFT_ROLES);
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);

  let saved: DraftSaved | null = null;
  const failure = await prisma.$transaction(async (tx) => {
    const req = await tx.purchaseRequest.findUnique({
      where: { id },
      select: {
        id: true, refNo: true, state: true, requestedById: true,
        units: { select: { id: true, qty: true, unitPrice: true } },
      },
    });
    if (!req) return conflict("That request no longer exists.");
    if (req.state !== "DRAFT") {
      return conflict(`Only a draft can be edited — this one is ${req.state}.`);
    }
    if (req.requestedById !== user.id && user.role !== "admin") return forbidden();

    const known = new Set(req.units.map((u) => u.id));
    const keep = new Set(units.map((u) => u.id).filter((x): x is string => !!x));
    // an id the caller invented (or one belonging to another request) must not
    // become a row under this draft
    if ([...keep].some((unitId) => !known.has(unitId))) {
      return conflict("This draft changed elsewhere — refresh and retry.");
    }
    const drop = req.units.filter((u) => !keep.has(u.id)).map((u) => u.id);

    if (drop.length) await tx.purchaseUnit.deleteMany({ where: { id: { in: drop }, requestId: id } });
    for (const u of units.filter((x) => x.id)) {
      await tx.purchaseUnit.update({
        where: { id: u.id },
        data: { description: u.description, specs: u.specs || null, qty: u.qty, unitPrice: u.unitPrice },
      });
    }
    const fresh = units.filter((u) => !u.id);
    if (fresh.length) {
      await tx.purchaseUnit.createMany({
        data: fresh.map((u) => ({
          requestId: id,
          description: u.description,
          specs: u.specs || null,
          qty: u.qty,
          unitPrice: u.unitPrice,
        })),
      });
    }

    const now = new Date();
    await tx.purchaseRequest.updateMany({ where: { id, state: "DRAFT" }, data: { updatedAt: now } });

    const before = summarize(
      req.units.map((u) => ({ qty: u.qty, unitPrice: u.unitPrice === null ? null : Number(u.unitPrice) })),
    );
    const diff = diffOf(before, summarize(units));
    // autosave fires per edit; an unchanged save must not spam the audit log
    if (Object.keys(diff).length > 0 || drop.length > 0 || fresh.length > 0) {
      await writeAudit(tx, {
        actorId: user.id, actorLabel: user.name, entityType: "purchase-request",
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
