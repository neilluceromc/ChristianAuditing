"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { actionRole } from "@/server/auth/guards";
import { checkRate } from "@/server/rate-limit";
import { writeAudit } from "@/server/audit";
import { createApproval, openApprovalForAsset } from "@/server/modules/approvals/create";
import {
  conflict, forbidden, ok, rateLimited, validationError, zodFieldErrors, type ActionResult,
} from "@/server/action-result";
import { ASSET_STATUSES, buildAssetWhere, INVENTORY_LIST_CONFIG } from "@/lib/inventory-list";
import { parseListState } from "@/lib/url-state";
import { creationPlan, CREATABLE_STATUSES } from "@/lib/asset-rules";

const BULK_MAX = 200;

const bulkSchema = z
  .object({
    ids: z.array(z.string().min(1)).max(500).optional(),
    /** serialized list query (e.g. "status=SPARE&q=dell") when acting on all matching */
    filters: z.string().max(2000).optional(),
    to: z.enum(ASSET_STATUSES),
    reason: z.string().trim().min(3, "Give a reason (at least 3 characters)").max(500),
  })
  .refine((v) => (v.ids?.length ?? 0) > 0 || v.filters !== undefined, {
    message: "Nothing is selected",
    path: ["ids"],
  });

/**
 * Bulk lifecycle change = one lifecycle.change-status approval PER asset —
 * never a direct write (spec: approvals gate lifecycle). Assets already in
 * the target status or with an open approval are skipped and counted.
 */
export async function bulkRequestStatusChange(
  input: unknown,
): Promise<ActionResult<{ created: number; skipped: number }>> {
  const user = await actionRole("admin", "it_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = bulkSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const { ids, filters, to, reason } = parsed.data;

  const where = ids?.length
    ? { id: { in: ids } }
    : buildAssetWhere(parseListState(new URLSearchParams(filters), INVENTORY_LIST_CONFIG));

  const assets = await prisma.asset.findMany({
    where,
    take: BULK_MAX + 1,
    select: { id: true, status: true },
  });
  if (assets.length === 0) return conflict("Nothing matched the selection.");
  if (assets.length > BULK_MAX) {
    return conflict(`That selection exceeds the ${BULK_MAX}-asset bulk cap — narrow the filter and repeat.`);
  }

  let created = 0;
  let skipped = 0;
  await prisma.$transaction(async (tx) => {
    for (const asset of assets) {
      if (asset.status === to || (await openApprovalForAsset(tx, asset.id))) {
        skipped += 1;
        continue;
      }
      const approval = await createApproval(tx, {
        type: "lifecycle_change_status",
        payload: { from: { status: asset.status }, to: { status: to }, reason },
        requestedById: user.id,
        assetId: asset.id,
      });
      await writeAudit(tx, {
        actorId: user.id,
        actorLabel: user.name,
        entityType: "asset",
        entityId: asset.id,
        action: "approval.requested",
        diff: { approval: { from: null, to: approval.refNo } },
      });
      created += 1;
    }
  });

  revalidatePath("/inventory");
  return ok({ created, skipped });
}

const dateStr = z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use the date picker")]);

const createSchema = z.object({
  tag: z.string().trim().toUpperCase().regex(/^BR-[A-Z]{2}-\d{4}$/, "Format: BR-XX-0000"),
  model: z.string().trim().min(2, "Name the model").max(120),
  serial: z.string().trim().max(120).optional(),
  categoryId: z.string().min(1, "Pick a category"),
  typeId: z.string().optional(),
  purchasedAt: dateStr.optional(),
  cost: z.union([z.literal(""), z.coerce.number().nonnegative().max(10_000_000)]).optional(),
  warrantyUntil: dateStr.optional(),
  notes: z.string().trim().max(2000).optional(),
  requestedStatus: z.enum(CREATABLE_STATUSES),
  assigneeId: z.string().optional(),
  assignReason: z.string().trim().max(500).optional(),
});

function uniqueTarget(err: unknown): string[] {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002"
    ? ((err.meta?.target as string[] | undefined) ?? [])
    : [];
}

const toDate = (s: string | undefined) => (s ? new Date(`${s}T00:00:00Z`) : null);
const toCost = (c: number | "" | undefined) => (c === "" || c === undefined ? null : c);

export async function createAsset(input: unknown): Promise<ActionResult<{ id: string }>> {
  const user = await actionRole("admin", "it_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const d = parsed.data;

  const plan = creationPlan(d.requestedStatus, d.assigneeId || null);
  if (!plan.ok) return validationError({ assigneeId: "Pick who this deploys to" });

  if (d.typeId) {
    const type = await prisma.assetType.findUnique({ where: { id: d.typeId } });
    if (!type || type.categoryId !== d.categoryId) {
      return validationError({ typeId: "That type doesn't belong to the chosen category" });
    }
  }
  if (plan.approval) {
    const employee = await prisma.employee.findUnique({ where: { id: plan.approval.assigneeId } });
    if (!employee) return validationError({ assigneeId: "Unknown employee" });
    if (employee.employment !== "ACTIVE") {
      return conflict(`${employee.name} is ${employee.employment.toLowerCase()} — assignments are frozen.`);
    }
  }

  try {
    const asset = await prisma.$transaction(async (tx) => {
      const created = await tx.asset.create({
        data: {
          tag: d.tag,
          model: d.model,
          serial: d.serial || null,
          categoryId: d.categoryId,
          typeId: d.typeId || null,
          status: "SPARE",
          purchasedAt: toDate(d.purchasedAt),
          cost: toCost(d.cost),
          warrantyUntil: toDate(d.warrantyUntil),
          notes: d.notes || null,
        },
      });
      await writeAudit(tx, {
        actorId: user.id,
        actorLabel: user.name,
        entityType: "asset",
        entityId: created.id,
        action: "create",
        diff: {
          tag: { from: null, to: created.tag },
          model: { from: null, to: created.model },
          status: { from: null, to: "SPARE" },
        },
      });
      if (plan.approval) {
        const approval = await createApproval(tx, {
          type: "lifecycle_assign",
          payload: {
            to: { assigneeId: plan.approval.assigneeId, status: plan.approval.toStatus },
            reason: d.assignReason || "assigned at registration",
          },
          requestedById: user.id,
          assetId: created.id,
          employeeId: plan.approval.assigneeId,
        });
        await writeAudit(tx, {
          actorId: user.id,
          actorLabel: user.name,
          entityType: "asset",
          entityId: created.id,
          action: "approval.requested",
          diff: { approval: { from: null, to: approval.refNo } },
        });
      }
      return created;
    });
    revalidatePath("/inventory");
    return ok({ id: asset.id });
  } catch (err) {
    const target = uniqueTarget(err);
    if (target.includes("tag")) return validationError({ tag: "That tag is already registered" });
    if (target.includes("serial")) return validationError({ serial: "That serial is already registered" });
    throw err;
  }
}
