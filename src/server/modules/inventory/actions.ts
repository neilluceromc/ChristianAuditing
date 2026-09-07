"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { actionRole } from "@/server/auth/guards";
import { checkRate } from "@/server/rate-limit";
import { writeAudit } from "@/server/audit";
import { emitWebhook } from "@/server/webhooks/emit";
import { createApproval, newSlaAt, OPEN_APPROVAL_STATES, openApprovalForAsset } from "@/server/modules/approvals/create";
import {
  conflict, forbidden, ok, rateLimited, validationError, zodFieldErrors, type ActionResult,
} from "@/server/action-result";
import {
  ASSET_STATUSES, BULK_MAX, buildAssetWhere, INVENTORY_LIST_CONFIG, parsePurchaseYear,
} from "@/lib/inventory-list";
import {
  CLASS_LABEL, CLASS_PHRASE, canEditAsset, canManageClass, canRegisterClass, isAwaitingItCheck, isDirectLifecycle, isStatusOf, parseCls,
} from "@/lib/asset-class";
import { parseListState, type ListState } from "@/lib/url-state";
import { repairStageIds } from "@/server/modules/inventory/queries";
import { creationPlan, CREATABLE_STATUSES } from "@/lib/asset-rules";
import { statusFamily } from "@/lib/status";
import { assetDiff } from "@/lib/asset-diff";
import { TAG_SHAPE } from "@/lib/tag-key";
import { commitLifecycle, prepareLifecycle, type LifecycleAsset } from "@/server/modules/lifecycle/apply";

/** Phase 15: IT's lifecycle changes apply directly (Change status, Assign, Return) — the request path is closed to it. */
const DIRECT_REFUSAL = "IT changes apply directly — use Change status, Assign or Return.";

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
 * never a direct write (spec: approvals gate lifecycle). Skipped and counted:
 * assets already in the target status, assets with an open approval, and
 * closed-family stock (DONATED/BUYOUT/DISPOSE — reviving off-the-books assets
 * is a deliberate single-record action, never a bulk one).
 */
export async function bulkRequestStatusChange(
  input: unknown,
): Promise<ActionResult<{ created: number; skipped: number }>> {
  const user = await actionRole("admin", "it_staff", "purchasing_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = bulkSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const { ids, filters, to, reason } = parsed.data;

  let where: Prisma.AssetWhereInput;
  if (ids?.length) {
    where = { id: { in: ids } };
  } else {
    const filterParams = new URLSearchParams(filters);
    const state: ListState = parseListState(filterParams, INVENTORY_LIST_CONFIG);
    // purchaseYear rides outside the config's facets (it's a nav-destination
    // value, not a multi-select — see parsePurchaseYear), so it has to be
    // read off the same serialized filters string separately, same as the
    // stage cut just below has to be resolved separately from the state.
    const purchaseYear = parsePurchaseYear(filterParams.get("purchaseYear"));
    // `stage` is a derived facet — buildAssetWhere only narrows to the repair
    // CANDIDATE set in SQL (beyond-repair compares repairQuote against cost,
    // which no Prisma filter can express). Acting on that candidate set
    // directly would mean the drawer's "all N matching" acts on more rows
    // than the screen shows. Resolve to the exact cut ids first.
    const cls = parseCls(filterParams.get("cls")) ?? "IT";
    const cutIds = await repairStageIds(state, purchaseYear, cls);
    where = cutIds !== null ? { id: { in: cutIds } } : buildAssetWhere(state, purchaseYear, cls);
  }

  let created = 0;
  let skipped = 0;
  try {
    const failure = await prisma.$transaction(async (tx) => {
      // Reads happen INSIDE the transaction (statuses move between a pre-fetch
      // and the writes), and writes are BATCHED — 4×N sequential round trips at
      // the 200-asset cap would blow Prisma's 5s interactive-transaction budget.
      const assets = await tx.asset.findMany({
        where,
        take: BULK_MAX + 1,
        select: { id: true, status: true, cls: true },
      });
      if (assets.length === 0) return conflict("Nothing matched the selection.");
      if (assets.length > BULK_MAX) {
        return conflict(`That selection exceeds the ${BULK_MAX}-asset bulk cap — narrow the filter and repeat.`);
      }

      // No status is valid for both a laptop and a desk, so a mixed selection
      // has no legal target. The list is class-scoped, so this is unreachable
      // from the UI — it guards a hand-built request.
      const classes = new Set(assets.map((a) => a.cls));
      if (classes.size > 1) return conflict("Select assets of one class — IT and Purchasing assets cannot share a status change.");
      const cls = assets[0].cls;
      if (!canManageClass(user.role, cls)) return forbidden();
      if (isDirectLifecycle(user.role, cls)) return conflict(DIRECT_REFUSAL);
      if (!isStatusOf(cls, to)) return validationError({ to: `${to} is not ${CLASS_PHRASE[cls]} status.` });

      const open = await tx.approval.findMany({
        where: { assetId: { in: assets.map((a) => a.id) }, state: { in: [...OPEN_APPROVAL_STATES] } },
        select: { assetId: true },
      });
      const blocked = new Set(open.map((o) => o.assetId));

      const targets = assets.filter(
        (a) => a.status !== to && !blocked.has(a.id) && statusFamily(a.status) !== "closed",
      );
      skipped = assets.length - targets.length;
      if (targets.length === 0) return null;

      const seq = await tx.$queryRaw<Array<{ nextval: bigint }>>`
        SELECT nextval('approval_ref_seq') FROM generate_series(1, ${targets.length}::int)`;
      const slaAt = newSlaAt();

      await tx.approval.createMany({
        data: targets.map((asset, i) => ({
          refNo: `APR-${seq[i].nextval}`,
          type: "lifecycle_change_status" as const,
          payload: { from: { status: asset.status }, to: { status: to }, reason },
          requestedById: user.id,
          assetId: asset.id,
          slaAt,
        })),
      });
      await tx.auditEntry.createMany({
        data: targets.map((asset, i) => ({
          actorId: user.id,
          actorLabel: user.name,
          entityType: "asset",
          entityId: asset.id,
          action: "approval.requested",
          diff: { approval: { from: null, to: `APR-${seq[i].nextval}` } },
        })),
      });
      created = targets.length;
      return null;
    });
    if (failure) return failure;
  } catch (err) {
    // The partial unique index (one OPEN approval per asset) turns a
    // concurrent-request race into a constraint violation.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return conflict("Someone else just requested a change on one of these assets — refresh and retry.");
    }
    throw err;
  }

  revalidatePath("/inventory");
  return ok({ created, skipped });
}

const dateStr = z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use the date picker")]);

const createSchema = z.object({
  tag: z.string().trim().toUpperCase().regex(TAG_SHAPE, "Format: BR-XX-0000"),
  model: z.string().trim().min(2, "Name the model").max(120),
  serial: z.string().trim().max(120).optional(),
  categoryId: z.string().min(1, "Pick a category"),
  typeId: z.string().optional(),
  purchasedAt: dateStr.optional(),
  cost: z.union([z.literal(""), z.coerce.number().nonnegative().max(10_000_000).multipleOf(0.01, "Whole centavos only")]).optional(),
  warrantyUntil: dateStr.optional(),
  notes: z.string().trim().max(2000).optional(),
  requestedStatus: z.enum(CREATABLE_STATUSES),
  assigneeId: z.string().optional(),
  assignReason: z.string().trim().max(500).optional(),
});

/**
 * P2002 meta.target is either a column array (["serial"]) or an index-name
 * string ("Asset_serial_key") depending on constraint kind — .includes()
 * happens to match correctly under BOTH shapes; keep it that way.
 */
function uniqueTarget(err: unknown): string[] {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002"
    ? ((err.meta?.target as string[] | undefined) ?? [])
    : [];
}

const toDate = (s: string | undefined) => (s ? new Date(`${s}T00:00:00Z`) : null);
const toCost = (c: number | "" | undefined) => (c === "" || c === undefined ? null : c);

export async function createAsset(input: unknown): Promise<ActionResult<{ id: string }>> {
  const user = await actionRole("admin", "it_staff", "purchasing_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const d = parsed.data;

  const category = await prisma.assetCategory.findUnique({ where: { id: d.categoryId }, select: { name: true, cls: true } });
  if (!category) return validationError({ categoryId: "Unknown category" });
  // Spec §4: Purchasing registers both classes, IT its own. Registering is not
  // managing — an IT asset Purchasing registers is IT's from this moment.
  if (!canRegisterClass(user.role, category.cls)) {
    return validationError({
      categoryId: `${category.name} is ${CLASS_PHRASE[category.cls]} category — your department does not create ${CLASS_LABEL[category.cls]} assets.`,
    });
  }
  // Spec §4 stamping: born checked when the registrant manages the class.
  const selfChecked = category.cls === "IT" && canManageClass(user.role, "IT");
  const plan = creationPlan(d.requestedStatus, d.assigneeId || null, category.cls);
  if (!plan.ok) {
    return plan.error === "assignee_required"
      ? validationError({ assigneeId: "Pick who this deploys to" })
      : validationError({ requestedStatus: `${d.requestedStatus} is not an initial state for ${CLASS_PHRASE[category.cls]} asset.` });
  }

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
          status: plan.status,
          cls: category.cls,
          purchasedAt: toDate(d.purchasedAt),
          cost: toCost(d.cost),
          warrantyUntil: toDate(d.warrantyUntil),
          notes: d.notes || null,
          itVerifiedAt: selfChecked ? new Date() : null,
          itVerifiedById: selfChecked ? user.id : null,
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
          status: { from: null, to: plan.status },
        },
      });
      if (plan.approval) {
        // Phase 15 (spec §2.1): IT registering its own deploy applies directly —
        // asset write + EXECUTED approval row + audit + webhook, same as every
        // other direct lifecycle change — instead of waiting in the queue.
        if (isDirectLifecycle(user.role, category.cls)) {
          const asset: LifecycleAsset = created;
          const prepared = await prepareLifecycle(tx, asset, {
            kind: "assign", employeeId: plan.approval.assigneeId, status: plan.approval.toStatus,
          });
          if (!prepared.ok) throw new Error(prepared.error);
          await commitLifecycle(tx, created.id, prepared.prepared);
          const approval = await createApproval(tx, {
            type: "lifecycle_assign",
            payload: {
              to: { assigneeId: plan.approval.assigneeId, status: plan.approval.toStatus },
              reason: d.assignReason || "assigned at registration",
            },
            requestedById: user.id,
            assetId: created.id,
            employeeId: plan.approval.assigneeId,
            executed: { by: user.id, at: new Date() },
          });
          await writeAudit(tx, {
            actorId: user.id,
            actorLabel: user.name,
            entityType: "asset",
            entityId: created.id,
            action: "lifecycle.assign",
            diff: prepared.prepared.diff,
          });
          await emitWebhook(tx, "approval.executed", {
            approvalId: approval.id, refNo: approval.refNo, type: approval.type, assetId: created.id, assetTag: created.tag,
          });
        } else {
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
      }
      return created;
    });
    revalidatePath("/inventory");
    return ok({ id: asset.id });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003") {
      return conflict("A referenced record vanished mid-request — refresh and retry.");
    }
    const target = uniqueTarget(err);
    if (target.includes("tag")) return validationError({ tag: "That tag is already registered" });
    if (target.includes("serial")) return validationError({ serial: "That serial is already registered" });
    // The direct path's prepareLifecycle guard throws a plain Error inside the
    // transaction (e.g. the assignee went inactive mid-request) — surface it
    // as the conflict it is rather than an unhandled 500.
    if (err instanceof Error) return conflict(err.message);
    throw err;
  }
}

const updateSchema = z.object({
  id: z.string().min(1),
  model: z.string().trim().min(2, "Name the model").max(120),
  serial: z.string().trim().max(120).optional(),
  categoryId: z.string().min(1, "Pick a category"),
  typeId: z.string().optional(),
  purchasedAt: dateStr.optional(),
  cost: z.union([z.literal(""), z.coerce.number().nonnegative().max(10_000_000).multipleOf(0.01, "Whole centavos only")]).optional(),
  warrantyUntil: dateStr.optional(),
  notes: z.string().trim().max(2000).optional(),
  vendorId: z.string().optional(),
  rmaRef: z.string().trim().max(60).optional(),
  repairQuote: z.union([z.literal(""), z.coerce.number().nonnegative().max(10_000_000).multipleOf(0.01, "Whole centavos only")]).optional(),
});

/**
 * Direct-write surface: identity/procurement/repair fields ONLY (scope
 * decision #3). tag is immutable; status/assignee move via approvals.
 */
export async function updateAsset(input: unknown): Promise<ActionResult<{ id: string }>> {
  const user = await actionRole("admin", "it_staff", "purchasing_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const d = parsed.data;

  const asset = await prisma.asset.findUnique({ where: { id: d.id } });
  if (!asset) return conflict("That asset no longer exists.");
  if (!canEditAsset(user.role, asset)) return forbidden();
  if (d.categoryId !== asset.categoryId) {
    // Same class only. A category change across classes would flip the
    // asset's class and invalidate its status; the trigger would refuse it,
    // but the person deserves the reason, not a database error.
    const target = await prisma.assetCategory.findUnique({ where: { id: d.categoryId }, select: { name: true, cls: true } });
    if (!target) return validationError({ categoryId: "Unknown category" });
    if (target.cls !== asset.cls) {
      return validationError({ categoryId: `${target.name} is ${CLASS_PHRASE[target.cls]} category; this is ${CLASS_PHRASE[asset.cls]} asset.` });
    }
  }
  if (d.typeId) {
    const type = await prisma.assetType.findUnique({ where: { id: d.typeId } });
    if (!type || type.categoryId !== d.categoryId) {
      return validationError({ typeId: "That type doesn't belong to the chosen category" });
    }
  }
  if (d.vendorId && !(await prisma.vendor.findUnique({ where: { id: d.vendorId } }))) {
    return validationError({ vendorId: "Unknown vendor" });
  }

  const data = {
    model: d.model,
    serial: d.serial || null,
    categoryId: d.categoryId,
    typeId: d.typeId || null,
    purchasedAt: toDate(d.purchasedAt),
    cost: toCost(d.cost),
    warrantyUntil: toDate(d.warrantyUntil),
    notes: d.notes || null,
    vendorId: d.vendorId || null,
    rmaRef: d.rmaRef || null,
    repairQuote: toCost(d.repairQuote),
  };
  // The form round-trips dates at DAY precision while seed/legacy rows carry
  // time-of-day. Compare at day precision — otherwise every first edit of an
  // old row writes phantom purchasedAt/warrantyUntil audit entries — and
  // write ONLY the changed fields, so untouched columns keep their stored
  // timestamps instead of being silently truncated to midnight. Shared with
  // `applyAssetImport` via `assetDiff` (`src/lib/asset-diff.ts`, C-1, Task 10
  // round two) so the two paths cannot drift apart the way they already had.
  const { diff, changed } = assetDiff(asset as unknown as Record<string, unknown>, data);
  if (Object.keys(diff).length === 0) return ok({ id: asset.id }); // no audit noise for no-ops

  try {
    await prisma.$transaction(async (tx) => {
      await tx.asset.update({ where: { id: asset.id }, data: changed });
      await writeAudit(tx, {
        actorId: user.id, actorLabel: user.name,
        entityType: "asset", entityId: asset.id,
        action: "update", diff,
      });
    });
  } catch (err) {
    if (uniqueTarget(err).includes("serial")) return validationError({ serial: "That serial is already registered" });
    throw err;
  }
  revalidatePath(`/inventory/${asset.id}`);
  revalidatePath("/inventory");
  return ok({ id: asset.id });
}

const statusChangeSchema = z.object({
  assetId: z.string().min(1),
  to: z.enum(ASSET_STATUSES),
  reason: z.string().trim().min(3, "Give a reason (at least 3 characters)").max(500),
});

/** Lifecycle change = approval, never a direct write. */
export async function requestStatusChange(input: unknown): Promise<ActionResult<{ refNo: string }>> {
  const user = await actionRole("admin", "it_staff", "purchasing_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = statusChangeSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const d = parsed.data;

  let refNo = "";
  try {
    const result = await prisma.$transaction(async (tx) => {
      const asset = await tx.asset.findUnique({ where: { id: d.assetId } });
      if (!asset) return conflict("That asset no longer exists.");
      if (!canManageClass(user.role, asset.cls)) return forbidden();
      if (isDirectLifecycle(user.role, asset.cls)) return conflict(DIRECT_REFUSAL);
      if (!isStatusOf(asset.cls, d.to)) {
        return validationError({ to: `${d.to} is not ${CLASS_PHRASE[asset.cls]} status.` });
      }
      if (asset.status === d.to) return conflict(`Already ${d.to}.`);
      if (await openApprovalForAsset(tx, asset.id)) {
        return conflict("This asset already has an open request — resolve it first.");
      }
      const approval = await createApproval(tx, {
        type: "lifecycle_change_status",
        payload: { from: { status: asset.status }, to: { status: d.to }, reason: d.reason },
        requestedById: user.id,
        assetId: asset.id,
      });
      await writeAudit(tx, {
        actorId: user.id, actorLabel: user.name,
        entityType: "asset", entityId: asset.id,
        action: "approval.requested",
        diff: { approval: { from: null, to: approval.refNo } },
      });
      refNo = approval.refNo;
      return null;
    });
    if (result) return result;
  } catch (err) {
    // The partial unique index (one OPEN approval per asset) turns a
    // concurrent-request race into a constraint violation.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return conflict("Someone else just requested a change on this asset — refresh and retry.");
    }
    throw err;
  }
  revalidatePath(`/inventory/${d.assetId}`);
  return ok({ refNo });
}

const confirmSchema = z.object({ id: z.string().min(1) });

/**
 * Finance confirms that a registered asset's details are correct. Separate
 * from the approval queue on purpose (C-5): every ApprovalType is a lifecycle
 * change to an asset that already exists, whereas this is data verification —
 * a different question with a different audience.
 *
 * Idempotent by refusal rather than by silence: confirming twice is a
 * conflict, so a double-submit cannot quietly overwrite who confirmed it and
 * when.
 */
export async function confirmAssetDetails(input: unknown): Promise<ActionResult<{ tag: string }>> {
  const user = await actionRole("admin", "finance_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);

  const parsed = confirmSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));

  let out: { tag: string } | null = null;
  let failure: ActionResult<{ tag: string }> | null = null;

  await prisma.$transaction(async (tx) => {
    const asset = await tx.asset.findUnique({
      where: { id: parsed.data.id },
      select: { id: true, tag: true, financeConfirmedAt: true, cls: true, itVerifiedAt: true },
    });
    if (!asset) {
      failure = validationError({ id: "Unknown asset" });
      return;
    }
    if (asset.financeConfirmedAt) {
      failure = conflict(`${asset.tag} was already confirmed.`);
      return;
    }
    if (isAwaitingItCheck(asset)) {
      failure = conflict(`${asset.tag} is waiting for IT's check — Finance confirms after IT.`);
      return;
    }
    // State-guarded write: the null check is IN the where clause, so two
    // simultaneous confirmations cannot both succeed.
    const hit = await tx.asset.updateMany({
      where: { id: asset.id, financeConfirmedAt: null },
      data: {
        financeConfirmedAt: new Date(),
        financeConfirmedById: user.id,
        // Clearing the return here is what makes "confirmed AND returned"
        // unreachable, so the pill's three states stay mutually exclusive.
        financeReturnedAt: null,
        financeReturnedById: null,
        financeReturnReason: null,
      },
    });
    if (hit.count === 0) {
      failure = conflict(`${asset.tag} was confirmed by someone else just now.`);
      return;
    }
    await writeAudit(tx, {
      actorId: user.id,
      actorLabel: user.name,
      entityType: "asset",
      entityId: asset.id,
      action: "finance.confirm",
      diff: { financeConfirmed: { from: null, to: user.name } },
    });
    out = { tag: asset.tag };
  });

  if (failure) return failure;
  revalidatePath(`/inventory/${parsed.data.id}`);
  revalidatePath("/inventory");
  return ok(out!);
}

const returnSchema = z.object({
  id: z.string().min(1),
  reason: z.string().trim().min(5, "Say what is wrong — at least 5 characters.").max(500),
});

/**
 * Finance sends a registration back to IT with a reason. The counterpart to
 * confirmAssetDetails, and deliberately NOT a gate (C-7): the asset stays
 * live and usable throughout — what changes is that IT can see what to fix.
 *
 * A SECOND return is allowed and overwrites the current reason: Finance
 * re-checking after IT's fix and finding it still wrong is a real sequence.
 * Only the current reason lives in the column; every one survives in the
 * audit trail.
 */
export async function returnAssetToIt(input: unknown): Promise<ActionResult<{ tag: string }>> {
  const user = await actionRole("admin", "finance_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);

  const parsed = returnSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const { id, reason } = parsed.data;

  let out: { tag: string } | null = null;
  let failure: ActionResult<{ tag: string }> | null = null;

  await prisma.$transaction(async (tx) => {
    const asset = await tx.asset.findUnique({
      where: { id },
      select: { id: true, tag: true, financeConfirmedAt: true, cls: true, itVerifiedAt: true },
    });
    if (!asset) {
      failure = validationError({ id: "Unknown asset" });
      return;
    }
    if (asset.financeConfirmedAt) {
      failure = conflict(`${asset.tag} is already confirmed and cannot be sent back.`);
      return;
    }
    if (isAwaitingItCheck(asset)) {
      failure = conflict(`${asset.tag} is waiting for IT's check — Finance reviews after IT.`);
      return;
    }
    // State-guarded, the same shape as confirmAssetDetails: the confirmed-is-
    // null check lives IN the where clause, so a confirmation landing between
    // the read above and this write wins rather than being silently undone.
    const hit = await tx.asset.updateMany({
      where: { id: asset.id, financeConfirmedAt: null },
      data: {
        financeReturnedAt: new Date(),
        financeReturnedById: user.id,
        financeReturnReason: reason,
      },
    });
    if (hit.count === 0) {
      failure = conflict(`${asset.tag} was confirmed by someone else just now.`);
      return;
    }
    await writeAudit(tx, {
      actorId: user.id,
      actorLabel: user.name,
      entityType: "asset",
      entityId: asset.id,
      action: "finance.return",
      // The reason goes in the diff, and that is what makes the audit trail
      // the history: the column holds only the CURRENT reason.
      diff: { financeReturn: { from: null, to: reason } },
    });
    out = { tag: asset.tag };
  });

  if (failure) return failure;
  revalidatePath(`/inventory/${id}`);
  revalidatePath("/inventory");
  return ok(out!);
}

const resubmitSchema = z.object({ id: z.string().min(1) });

/**
 * The registering department says "fixed, look again", clearing the return
 * so the record reads AWAITING FINANCE once more.
 *
 * Explicit rather than clearing on any edit to the asset: a staffer
 * correcting an unrelated field must not silently claim the reported problem
 * is resolved.
 */
export async function resubmitAssetToFinance(input: unknown): Promise<ActionResult<{ tag: string }>> {
  const user = await actionRole("admin", "it_staff", "purchasing_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);

  const parsed = resubmitSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const { id } = parsed.data;

  let out: { tag: string } | null = null;
  let failure: ActionResult<{ tag: string }> | null = null;

  await prisma.$transaction(async (tx) => {
    const asset = await tx.asset.findUnique({
      where: { id },
      select: { id: true, tag: true, cls: true, financeReturnedAt: true },
    });
    if (!asset) {
      failure = validationError({ id: "Unknown asset" });
      return;
    }
    // Resubmit is the department's own action, like register: the class that
    // may send an asset back to Finance is the class that may send it again.
    if (!canManageClass(user.role, asset.cls)) {
      failure = forbidden();
      return;
    }
    if (!asset.financeReturnedAt) {
      failure = conflict(`${asset.tag} was not sent back, so there is nothing to resubmit.`);
      return;
    }
    const hit = await tx.asset.updateMany({
      where: { id: asset.id, financeReturnedAt: { not: null } },
      data: { financeReturnedAt: null, financeReturnedById: null, financeReturnReason: null },
    });
    if (hit.count === 0) {
      failure = conflict(`${asset.tag} was resubmitted by someone else just now.`);
      return;
    }
    await writeAudit(tx, {
      actorId: user.id,
      actorLabel: user.name,
      entityType: "asset",
      entityId: asset.id,
      action: "finance.resubmit",
      diff: { financeReturn: { from: "returned", to: null } },
    });
    out = { tag: asset.tag };
  });

  if (failure) return failure;
  revalidatePath(`/inventory/${id}`);
  revalidatePath("/inventory");
  return ok(out!);
}

const verifySchema = z.object({ id: z.string().min(1) });

/**
 * Phase 14 (spec §5.2): IT marks a Purchasing-registered IT asset checked.
 * Finance's register and confirm wait for this. Same shape as confirmAssetDetails:
 * refuse-not-silence, null check IN the where.
 */
export async function verifyAssetDetails(input: unknown): Promise<ActionResult<{ tag: string }>> {
  const user = await actionRole("admin", "it_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = verifySchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));

  const asset = await prisma.asset.findUnique({
    where: { id: parsed.data.id },
    select: { id: true, tag: true, cls: true, itVerifiedAt: true },
  });
  if (!asset) return conflict("That asset no longer exists.");
  if (asset.cls !== "IT") return conflict(`${asset.tag} is ${CLASS_PHRASE[asset.cls]} asset — Purchasing assets are not IT-checked.`);
  if (asset.itVerifiedAt) return conflict(`${asset.tag} was already checked.`);

  const hit = await prisma.$transaction(async (tx) => {
    const r = await tx.asset.updateMany({
      where: { id: asset.id, itVerifiedAt: null },
      data: { itVerifiedAt: new Date(), itVerifiedById: user.id },
    });
    if (r.count === 0) return false;
    await writeAudit(tx, {
      actorId: user.id, actorLabel: user.name,
      entityType: "asset", entityId: asset.id,
      action: "it.verify",
      diff: { itVerified: { from: null, to: user.name } },
    });
    return true;
  });
  if (!hit) return conflict(`${asset.tag} was checked by someone else just now.`);
  revalidatePath(`/inventory/${asset.id}`);
  revalidatePath("/inventory");
  revalidatePath("/finance/assets");
  return ok({ tag: asset.tag });
}
