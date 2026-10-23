"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma, type AssetClass, type Role } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { typeRequired } from "@/server/modules/inventory/register-queries";
import { TYPE_REQUIRED } from "@/lib/register-type";
import { actionRole } from "@/server/auth/guards";
import { isUniqueViolation, uniqueTarget } from "@/server/prisma-errors";
import { checkRate } from "@/server/rate-limit";
import { writeAudit } from "@/server/audit";
import { notify } from "@/server/notifications/notify";
import { canRegisterLine } from "@/lib/po-flow";
import { emitWebhook } from "@/server/webhooks/emit";
import { createApproval, newSlaAt, OPEN_APPROVAL_STATES, openApprovalForAsset } from "@/server/modules/approvals/create";
import {
  conflict, forbidden, ok, rateLimited, validationError, zodFieldErrors, type ActionResult,
} from "@/server/action-result";
import {
  ASSET_STATUSES, BULK_MAX, buildAssetWhere, identifierWhere, INVENTORY_LIST_CONFIG, parsePurchaseYear,
} from "@/lib/inventory-list";
import {
  ASSET_CLASSES, CLASS_LABEL, CLASS_PHRASE, canEditAsset, canSeeClass, canManageClass, canRegisterClass, defaultClassFor, isAwaitingItCheck, isDirectLifecycle, isStatusOf, parseCls,
  statusLabel,
} from "@/lib/asset-class";
import { reasonOptional, reasonRequired } from "@/lib/reason";
import { parseListState, type ListState } from "@/lib/url-state";
import { repairStageIds } from "@/server/modules/inventory/queries";
import { creationPlan, CREATABLE_STATUSES } from "@/lib/asset-rules";
import { statusFamily } from "@/lib/status";
import { assetDiff } from "@/lib/asset-diff";
import { TAG_RULE, TAG_SHAPE, tagKey } from "@/lib/tag-key";
import { humanizeGuard, loanDueFor } from "@/lib/lifecycle";
import { commitLifecycle, prepareLifecycle, type LifecycleAsset } from "@/server/modules/lifecycle/apply";
import { rememberPicks } from "@/server/recent-picks";
import { nextToReview } from "@/server/modules/finance/queries";
import { toReviewCount } from "@/server/modules/finance/review-queue";
import { serialRequired } from "@/lib/serial-rules";
import { WARRANTY_COVERED_BY } from "@/lib/purchase-summary";
import { approveSchema, resubmitSchema, returnSchema } from "@/lib/registration-input";
import { fieldLabels, shouldReopen } from "@/lib/registration";
import {
  assetMoneyStage, canEditField, DEVICE_FIELDS, MONEY_FIELDS, reasonError, returnTeamFor, teamOfRole, type IntakeField,
} from "@/lib/intake-rules";
import {
  approveOne, approveRefusal, returnOne, returnRefusal, TEAM_NAME, type ReturnContext,
} from "@/server/modules/finance/review-writes";
import { lockPo } from "@/server/modules/purchases/po-lock";
import { emitIfPoFullyApproved } from "@/server/modules/purchases/po-complete";
import { correctionTeams, FINANCE_WORDS, notifyAssetsByTeam } from "@/server/modules/finance/review-notify";

/** Phase 15: IT's lifecycle changes apply directly (Change status, Assign, Return) — the request path is closed to it. */
const DIRECT_REFUSAL = "IT changes apply directly — use Change status, Assign or Return.";

/**
 * Thrown inside createAsset's `$transaction` callback to force a rollback of
 * the asset just created when the direct-registration branch's lifecycle
 * guard refuses. Narrower than `Error`: the catch below must only turn THIS
 * into a user-facing conflict() — every other Error (a Prisma driver fault,
 * an unrelated bug) has to keep falling through to `throw err` instead of
 * being repainted as a banner (final review, plan D-8).
 */
class DirectRefusal extends Error {}
class StaleAssetError extends Error {}

const bulkSchema = z
  .object({
    ids: z.array(z.string().min(1)).max(500).optional(),
    /** serialized list query (e.g. "status=SPARE&q=dell") when acting on all matching */
    filters: z.string().max(2000).optional(),
    to: z.enum(ASSET_STATUSES),
    reason: reasonRequired(),
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
    const cls = parseCls(filterParams.get("cls")) ?? defaultClassFor(user.role);
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
    if (isUniqueViolation(err)) {
      return conflict("Someone else just requested a change on one of these assets — refresh and retry.");
    }
    throw err;
  }

  revalidatePath("/inventory");
  return ok({ created, skipped });
}

const dateStr = z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use the date picker")]);

const createSchema = z.object({
  tag: z.string().trim().toUpperCase().regex(TAG_SHAPE, TAG_RULE),
  model: z.string().trim().min(2, "Name the model").max(120),
  serial: z.string().trim().max(120).optional(),
  categoryId: z.string().min(1, "Pick a category"),
  typeId: z.string().optional(),
  purchasedAt: dateStr.optional(),
  cost: z.union([z.literal(""), z.coerce.number().nonnegative().max(9_999_999_999.99).multipleOf(0.01, "Whole centavos only")]).optional(),
  warrantyUntil: dateStr.optional(),
  notes: z.string().trim().max(2000).optional(),
  vendorId: z.string().optional(),
  brand: z.string().trim().max(60).optional(),
  invoiceRef: z.string().trim().max(60).optional(),
  // Phase 34 (spec §7.1, §8): the official receipt, who honours the warranty and how to reach them,
  // and the purchase's fees (delivery, setup) — fees live on the PurchaseRecord, never on the asset.
  receiptRef: z.string().trim().max(60).optional(),
  warrantyCoveredBy: z.union([z.literal(""), z.enum(WARRANTY_COVERED_BY)]).optional(),
  warrantyContact: z.string().trim().max(160).optional(),
  fees: z.union([z.literal(""), z.coerce.number().nonnegative().max(9_999_999_999.99).multipleOf(0.01, "Whole centavos only")]).optional(),
  requestedStatus: z.enum(CREATABLE_STATUSES),
  assigneeId: z.string().optional(),
  // Phase 21 (spec §6): cleaned like every other reason — a zero-width string
  // must fall through to the "assigned at registration" default below.
  assignReason: reasonOptional(),
  // Phase 30 (spec §5.3, plan P-13): Register at quantity 1 submits here — a loan's due date rides along, so
  // no loan is created without a due date. No purchase order (spec §4 way 3): a PO's units register from the PO.
  loanDueAt: dateStr.optional(),
});

const toDate = (s: string | undefined) => (s ? new Date(`${s}T00:00:00Z`) : null);
const toCost = (c: number | "" | undefined) => (c === "" || c === undefined ? null : c);

/**
 * Register at quantity 1 (spec §4 way 3): IT registers IT gear directly, an admin anything; Purchasing registers only
 * from a purchase order (po-register.ts). The one asset is its own registration group, and Finance's bell rings once.
 */
export async function createAsset(input: unknown): Promise<ActionResult<{ id: string; purchaseRecordId: string }>> {
  const user = await actionRole("admin", "it_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const d = parsed.data;

  // Phase 30 (spec §5.4): every post-schema refusal in ONE pass — a refused submit shows every
  // error at once instead of one per round trip.
  const errors: Record<string, string> = {};
  const category = await prisma.assetCategory.findUnique({ where: { id: d.categoryId }, select: { name: true, cls: true } });
  if (!category) errors.categoryId = "Unknown category";
  // Spec §4 way 3: IT registers its own class directly (REGISTRABLE_CLASSES); Purchasing's items come in from a PO.
  else if (!canRegisterClass(user.role, category.cls)) {
    errors.categoryId = `${category.name} is ${CLASS_PHRASE[category.cls]} category — your department does not create ${CLASS_LABEL[category.cls]} assets.`;
  }
  // Phase 34 (spec §8): an IT unit is not registered without its serial; Purchasing stays optional.
  if (category && serialRequired(category.cls) && !(d.serial ?? "").trim()) {
    errors.serial = "Enter the serial number before you register.";
  }
  const plan = category ? creationPlan(d.requestedStatus, d.assigneeId || null, category.cls) : null;
  if (category && plan && !plan.ok) {
    if (plan.error === "assignee_required") errors.assigneeId = "Pick who this deploys to";
    else errors.requestedStatus = `${statusLabel(d.requestedStatus)} is not an initial state for ${CLASS_PHRASE[category.cls]} asset.`;
  }
  // A loan's due date rides only on the direct path; the approval path's payload carries none, so a
  // registrant who does not manage the class cannot register a loan (the form already hides it, R4).
  if (category && !errors.requestedStatus && d.requestedStatus === "TEMPORARY" && !isDirectLifecycle(user.role, category.cls)) {
    errors.requestedStatus = "A loan can only be registered by the team that manages this class.";
  }
  const loan = loanDueFor(d.requestedStatus, d.loanDueAt || undefined, new Date());
  if (!loan.ok) errors.loanDueAt = "Pick the date the loan ends";
  if (d.typeId) {
    const type = await prisma.assetType.findUnique({ where: { id: d.typeId } });
    if (!type || type.categoryId !== d.categoryId) errors.typeId = "That type doesn't belong to the chosen category";
  }
  // Spec §8, a category with types needs one picked (Phase 36).
  else if (category && (await typeRequired(d.categoryId, d.typeId))) errors.typeId = TYPE_REQUIRED;
  const tagTaken = await prisma.asset.findUnique({ where: { tag: d.tag }, select: { id: true } });
  if (tagTaken) errors.tag = `${d.tag} is already registered`;
  // Scoped to the class being registered into, like checkIdentifiers (identifierWhere): the message
  // names the record the serial is on, and a record of the OTHER class must not be named. A
  // cross-class collision still lands on the unique constraint below, as its neutral copy. Skipped
  // when the category itself is refused — a class the role cannot register into is never probed
  // (the same skip registerAssets makes).
  if (d.serial && category && canRegisterClass(user.role, category.cls)) {
    const serialTaken = await prisma.asset.findFirst({ where: { serial: d.serial, cls: category.cls }, select: { tag: true } });
    if (serialTaken) errors.serial = `Serial ${d.serial} is already on ${serialTaken.tag}`;
  }
  let employee: { name: string; employment: string } | null = null;
  if (plan?.ok && plan.approval) {
    employee = await prisma.employee.findUnique({ where: { id: plan.approval.assigneeId }, select: { name: true, employment: true } });
    if (!employee) errors.assigneeId = "Unknown employee";
  }
  if (Object.keys(errors).length || !category || !plan?.ok) return validationError(errors);
  if (employee && employee.employment !== "ACTIVE") {
    return conflict(`${employee.name} is ${employee.employment.toLowerCase()} — assignments are frozen.`);
  }
  // Spec §4 stamping: born checked when the registrant manages the class.
  const selfChecked = category.cls === "IT" && canManageClass(user.role, "IT");

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Phase 34 (P-1, spec §7.2): every Register submit is one PurchaseRecord — it is also the
      // registration batch the Labels queue groups by, so it exists even with no purchase field filled.
      const record = await tx.purchaseRecord.create({
        data: {
          cls: category.cls, vendorId: d.vendorId || null, purchasedAt: toDate(d.purchasedAt),
          invoiceRef: d.invoiceRef || null, receiptRef: d.receiptRef || null,
          unitCost: toCost(d.cost), fees: toCost(d.fees), quantity: 1, createdById: user.id,
        },
      });
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
          vendorId: d.vendorId || null,
          brand: d.brand || null,
          invoiceRef: d.invoiceRef || null,
          receiptRef: d.receiptRef || null,
          warrantyCoveredBy: d.warrantyCoveredBy || null,
          warrantyContact: d.warrantyContact || null,
          purchaseRecordId: record.id,
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
      await writeAudit(tx, {
        actorId: user.id,
        actorLabel: user.name,
        entityType: "purchase-record",
        entityId: record.id,
        action: "purchase.recorded",
        diff: {
          quantity: { from: null, to: 1 },
          total: { from: null, to: (Number(toCost(d.cost) ?? 0) + Number(toCost(d.fees) ?? 0)).toFixed(2) },
        },
      });
      // Spec §4 way 3: the registration reaches Finance as one group, and Finance's bell rings once.
      await notify(tx, {
        team: "FINANCE", kind: "TO_CHECK",
        title: `${created.tag} registered by ${user.role === "admin" ? "an admin" : "IT"}, ready to check`,
        href: `/finance/review/${record.id}`, actorId: user.id, actorRole: user.role,
        entityType: "purchase-record", entityId: record.id,
      });
      if (plan.approval) {
        // Phase 15 (spec §2.1): IT registering its own deploy applies directly —
        // asset write + EXECUTED approval row + audit + webhook, same as every
        // other direct lifecycle change — instead of waiting in the queue.
        if (isDirectLifecycle(user.role, category.cls)) {
          const asset: LifecycleAsset = created;
          const loanDueAt = loan.ok ? loan.value : null;
          const prepared = await prepareLifecycle(tx, asset, {
            kind: "assign", employeeId: plan.approval.assigneeId, status: plan.approval.toStatus, loanDueAt,
          });
          if (!prepared.ok) throw new DirectRefusal(humanizeGuard(prepared.error));
          await commitLifecycle(tx, created.id, prepared.prepared);
          const approval = await createApproval(tx, {
            type: "lifecycle_assign",
            payload: {
              // the same payload shape a direct Assign records (lifecycle/actions.ts assignAsset)
              to: {
                assigneeId: plan.approval.assigneeId, status: plan.approval.toStatus,
                ...(loanDueAt ? { loanDueAt: loanDueAt.toISOString() } : {}),
              },
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
      return { created, recordId: record.id };
    });
    revalidatePath("/inventory");
    await rememberPicks(user.id, { vendor: d.vendorId || null });
    return ok({ id: result.created.id, purchaseRecordId: result.recordId });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003") {
      return conflict("A referenced record vanished mid-request — refresh and retry.");
    }
    // The last line of defence — the pre-checks above name a collision the moment it is visible;
    // this catches the race, and a serial held by the other class (never named, see above).
    const target = uniqueTarget(err);
    if (target.includes("tag")) return validationError({ tag: `${d.tag} is already registered` });
    if (target.includes("serial")) return validationError({ serial: "That serial is already registered" });
    // The direct path's prepareLifecycle guard throws DirectRefusal inside the
    // transaction (e.g. the assignee went inactive mid-request) — surface it
    // as the conflict it is. Anything else (a driver fault, an unrelated bug)
    // is NOT ours to repaint as user copy — it falls through to `throw err`.
    if (err instanceof DirectRefusal) return conflict(err.message);
    throw err;
  }
}

/**
 * Every key is optional (Task 6): the Edit form sends them all, and a key left out is left alone — so Finance's money
 * fix sends only what it changes. `reason` is the 5–300 character reason a cross-team fix needs (canEditField).
 */
const updateSchema = z.object({
  id: z.string().min(1),
  model: z.string().trim().min(2, "Name the model").max(120).optional(),
  serial: z.string().trim().max(120).optional(),
  categoryId: z.string().min(1, "Pick a category").optional(),
  typeId: z.string().optional(),
  purchasedAt: dateStr.optional(),
  cost: z.union([z.literal(""), z.coerce.number().nonnegative().max(10_000_000).multipleOf(0.01, "Whole centavos only")]).optional(),
  warrantyUntil: dateStr.optional(),
  notes: z.string().trim().max(2000).optional(),
  vendorId: z.string().optional(),
  brand: z.string().trim().max(60).optional(),
  invoiceRef: z.string().trim().max(60).optional(),
  rmaRef: z.string().trim().max(60).optional(),
  repairQuote: z.union([z.literal(""), z.coerce.number().nonnegative().max(10_000_000).multipleOf(0.01, "Whole centavos only")]).optional(),
  // Phase 35 (plan P-7): the Phase 34 register fields, now editable so a Finance send-back can be fixed here (same limits as register).
  receiptRef: z.string().trim().max(60).optional(),
  warrantyCoveredBy: z.union([z.literal(""), z.enum(WARRANTY_COVERED_BY)]).optional(),
  warrantyContact: z.string().trim().max(160).optional(),
  reason: reasonOptional({ max: 300 }),
});

const INTAKE_FIELDS: readonly string[] = [...MONEY_FIELDS, ...DEVICE_FIELDS];
const MONEY: readonly string[] = MONEY_FIELDS;

/**
 * Direct-write surface: identity/procurement/repair fields ONLY (scope
 * decision #3). tag is immutable; status/assignee move via approvals.
 *
 * Task 6 (spec §2): each changed intake field must pass `canEditField` for the person, the asset's class and where its
 * money sits (`assetMoneyStage`), with a reason when any of them needs one (a cross-team fix). Finance edits money
 * only — it never touches IT's fields — and an asset from a PO has its money fixed on the PO, never here.
 */
export async function updateAsset(input: unknown): Promise<ActionResult<{ id: string }>> {
  const user = await actionRole("admin", "it_staff", "purchasing_staff", "finance_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const d = parsed.data;

  const asset = await prisma.asset.findUnique({ where: { id: d.id } });
  if (!asset) return conflict("That asset no longer exists.");
  const finance = user.role === "finance_staff";
  if (finance ? !canSeeClass(user.role, asset.cls) : !canEditAsset(user.role, asset)) return forbidden();
  const categoryId = d.categoryId ?? asset.categoryId;
  if (categoryId !== asset.categoryId) {
    // Same class only. A category change across classes would flip the
    // asset's class and invalidate its status; the trigger would refuse it,
    // but the person deserves the reason, not a database error.
    const target = await prisma.assetCategory.findUnique({ where: { id: categoryId }, select: { name: true, cls: true } });
    if (!target) return validationError({ categoryId: "Unknown category" });
    if (target.cls !== asset.cls) {
      return validationError({ categoryId: `${target.name} is ${CLASS_PHRASE[target.cls]} category; this is ${CLASS_PHRASE[asset.cls]} asset.` });
    }
  }
  if (d.typeId) {
    const type = await prisma.assetType.findUnique({ where: { id: d.typeId } });
    if (!type || type.categoryId !== categoryId) {
      return validationError({ typeId: "That type doesn't belong to the chosen category" });
    }
  }
  if (d.vendorId && !(await prisma.vendor.findUnique({ where: { id: d.vendorId } }))) {
    return validationError({ vendorId: "Unknown vendor" });
  }

  const given = <V,>(v: V | undefined, f: (x: V) => unknown) => (v === undefined ? undefined : f(v));
  const orNull = (v: string) => v || null;
  const all: Record<string, unknown> = {
    model: d.model,
    serial: given(d.serial, orNull),
    categoryId: d.categoryId,
    typeId: given(d.typeId, orNull),
    purchasedAt: given(d.purchasedAt, toDate),
    cost: given(d.cost, toCost),
    warrantyUntil: given(d.warrantyUntil, toDate),
    notes: given(d.notes, orNull),
    vendorId: given(d.vendorId, orNull),
    brand: given(d.brand, orNull),
    invoiceRef: given(d.invoiceRef, orNull),
    rmaRef: given(d.rmaRef, orNull),
    repairQuote: given(d.repairQuote, toCost),
    receiptRef: given(d.receiptRef, orNull),
    warrantyCoveredBy: given(d.warrantyCoveredBy, orNull),
    warrantyContact: given(d.warrantyContact, orNull),
  };
  // Only the keys sent: one left out keeps its stored value.
  const data = Object.fromEntries(Object.entries(all).filter(([, v]) => v !== undefined));
  // The form round-trips dates at DAY precision while seed/legacy rows carry
  // time-of-day. Compare at day precision — otherwise every first edit of an
  // old row writes phantom purchasedAt/warrantyUntil audit entries — and
  // write ONLY the changed fields, so untouched columns keep their stored
  // timestamps instead of being silently truncated to midnight. Shared with
  // `applyAssetImport` via `assetDiff` (`src/lib/asset-diff.ts`, C-1, Task 10
  // round two) so the two paths cannot drift apart the way they already had.
  const { diff, changed } = assetDiff(asset as unknown as Record<string, unknown>, data);
  // Phase 23: this return is also why a no-op save remembers no vendor pick —
  // the operator did choose one, but nothing changed, so no transaction ran and
  // `rememberPicks` below is never reached. Deliberate: Recent tracks picks that
  // produced a write, not every time a form was opened and closed.
  const keys = Object.keys(diff);
  if (keys.length === 0) return ok({ id: asset.id }); // no audit noise for no-ops

  // ---- who may change what (spec §2) ----
  if (finance && keys.some((k) => !MONEY.includes(k))) {
    // Finance never edits IT's (or Purchasing's device) fields: name the team to send it to when it's one of theirs.
    const device = keys.find((k) => INTAKE_FIELDS.includes(k) && !MONEY.includes(k));
    const verdict = device ? canEditField(user.role, device as IntakeField, asset.cls, "with-finance") : null;
    return conflict(verdict && !verdict.ok ? verdict.why : "Finance changes money details only — send the rest back.");
  }
  const moneyChanged = keys.filter((k) => MONEY.includes(k));
  if (asset.purchaseOrderId && moneyChanged.length > 0) {
    const po = await prisma.purchaseOrder.findUnique({ where: { id: asset.purchaseOrderId }, select: { refNo: true } });
    return conflict(`Fix it on ${po?.refNo ?? "its purchase order"}`);
  }
  const stage = assetMoneyStage(asset);
  let needsReason = false;
  for (const k of keys.filter((x) => INTAKE_FIELDS.includes(x))) {
    const verdict = canEditField(user.role, k as IntakeField, asset.cls, stage);
    if (!verdict.ok) return conflict(verdict.why);
    needsReason ||= verdict.reasonRequired;
  }
  const reason = d.reason ? d.reason : null;
  if (needsReason) {
    const err = reasonError(reason ?? undefined);
    if (err) return validationError({ reason: err });
  }
  // Spec §7: the team that registered the batch hears when another team changes its numbers (notify skips the
  // actor's own team, so a team fixing its own numbers rings nobody).
  const owner = moneyChanged.length > 0
    ? returnTeamFor(moneyChanged[0] as IntakeField, asset.cls, { hasPo: false, registeredByRole: await registeredBy(asset.purchaseRecordId) })
    : null;

  // Phase 35 (spec §3.6): a cost on an asset approved as NOT capitalised reopens Finance's review —
  // Finance never saw that cost, and depreciation must start from an approval of it.
  // Final review I-1: keyed on "approved, had no cost, now has one" (covers legacy approvals with no cost too).
  const newCost = "cost" in data ? data.cost : asset.cost;
  const reopen = "cost" in diff && shouldReopen(asset, newCost);

  try {
    await prisma.$transaction(async (tx) => {
      if (reopen) {
        // M-1: state-guarded — a concurrent approval/reopen changes the preconditions, so this is a conflict, not a CHECK 500.
        const done = await tx.asset.updateMany({
          where: { id: asset.id, financeConfirmedAt: { not: null }, cost: null },
          data: { ...changed, financeConfirmedAt: null, financeConfirmedById: null, financeNotCapitalised: false },
        });
        if (done.count === 0) throw new StaleAssetError();
      } else if ("cost" in diff && asset.cost === null && newCost !== null) {
        // Not approved when read; if Finance approves (even as not capitalised) before this lands, conflict.
        const done = await tx.asset.updateMany({ where: { id: asset.id, financeConfirmedAt: null }, data: changed });
        if (done.count === 0) throw new StaleAssetError();
      } else {
        await tx.asset.update({ where: { id: asset.id }, data: changed });
      }
      await writeAudit(tx, {
        actorId: user.id, actorLabel: user.name,
        entityType: "asset", entityId: asset.id,
        action: "update", diff, reason, source: "web",
      });
      if (reopen) {
        await writeAudit(tx, {
          actorId: user.id, actorLabel: user.name, entityType: "asset", entityId: asset.id,
          action: "finance.reopened", diff: { cost: diff.cost ?? { from: null, to: Number(newCost) } }, source: "web",
        });
      }
      if (owner) {
        const team = teamOfRole(user.role);
        await notify(tx, {
          team: owner, kind: "CHANGED",
          title: `${team ? TEAM_NAME[team] : "An admin"} changed ${asset.tag}'s ${fieldLabels(moneyChanged).join(", ")}`,
          body: reason, href: `/inventory/${asset.id}`, actorId: user.id, actorRole: user.role,
          entityType: "asset", entityId: asset.id,
        });
      }
    });
  } catch (err) {
    if (err instanceof StaleAssetError) return conflict("Finance just changed this asset's review. Reload and try again.");
    if (uniqueTarget(err).includes("serial")) return validationError({ serial: "That serial is already registered" });
    throw err;
  }
  revalidatePath(`/inventory/${asset.id}`);
  revalidatePath("/inventory");
  revalidatePath("/finance/assets");
  revalidatePath(`/finance/assets/${asset.id}`);
  if (asset.purchaseRecordId) revalidatePath(`/finance/review/${asset.purchaseRecordId}`);
  if (d.vendorId !== undefined) await rememberPicks(user.id, { vendor: d.vendorId || null });
  return ok({ id: asset.id });
}

/** The role of whoever registered the asset's batch (the PurchaseRecord's creator), or null. */
async function registeredBy(recordId: string | null): Promise<Role | null> {
  if (!recordId) return null;
  const record = await prisma.purchaseRecord.findUnique({ where: { id: recordId }, select: { createdById: true } });
  if (!record) return null;
  return (await prisma.user.findUnique({ where: { id: record.createdById }, select: { role: true } }))?.role ?? null;
}

const statusChangeSchema = z.object({
  assetId: z.string().min(1),
  to: z.enum(ASSET_STATUSES),
  reason: reasonRequired(),
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
    if (isUniqueViolation(err)) {
      return conflict("Someone else just requested a change on this asset — refresh and retry.");
    }
    throw err;
  }
  revalidatePath(`/inventory/${d.assetId}`);
  return ok({ refNo });
}

/**
 * Finance approves a registered asset — as capitalised (it has a cost), or as not capitalised
 * (Phase 35, spec §3.4: no cost, so it never depreciates). Separate
 * from the approval queue on purpose (C-5): every ApprovalType is a lifecycle
 * change to an asset that already exists, whereas this is data verification —
 * a different question with a different audience.
 *
 * Idempotent by refusal rather than by silence: confirming twice is a
 * conflict, so a double-submit cannot quietly overwrite who confirmed it and
 * when.
 *
 * Phase 30 (spec §4.6): the result names the next record waiting on Finance
 * (`nextToReview`, read after the commit) so the dialog can move straight on, and how many of the class are still
 * To review (`remaining`, finance follow-up spec §4) for the toast.
 */
export async function confirmAssetDetails(
  input: unknown,
): Promise<ActionResult<{ tag: string; next: { id: string; tag: string } | null; remaining: number }>> {
  const user = await actionRole("admin", "finance_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);

  const parsed = approveSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));

  let out: { id: string; tag: string; cls: AssetClass } | null = null;
  let failure: ActionResult<{ tag: string; next: { id: string; tag: string } | null; remaining: number }> | null = null;

  const select = {
    id: true, tag: true, financeConfirmedAt: true, cls: true, itVerifiedAt: true, cost: true, financeReturnedAt: true,
    financeReturnedTo: true, financeNotCapitalised: true, financeResubmitNote: true, purchaseOrderId: true,
  } as const;

  await prisma.$transaction(async (tx) => {
    let asset = await tx.asset.findUnique({ where: { id: parsed.data.id }, select });
    if (!asset) {
      failure = validationError({ id: "Unknown asset" });
      return;
    }
    // Task 6: an asset from a PO is approved under the PO row's lock (lockPo, as the group approval and a PO fix
    // take it), then re-read: a fix or send-back landing at the same moment waits, and this sees what it left.
    if (asset.purchaseOrderId) {
      await lockPo(tx, asset.purchaseOrderId);
      const po = await tx.purchaseOrder.findUnique({
        where: { id: asset.purchaseOrderId }, select: { refNo: true, state: true, invoiceRef: true },
      });
      if (po?.state === "SENT_BACK") {
        failure = conflict(`${po.refNo} is with Purchasing for corrections.`);
        return;
      }
      // Spec §3: an old request has no SI number; Finance approves nothing from it until it has one.
      if (po && !po.invoiceRef?.trim()) {
        failure = conflict("No SI number yet. Add it before approving.");
        return;
      }
      asset = await tx.asset.findUnique({ where: { id: parsed.data.id }, select });
      if (!asset) {
        failure = validationError({ id: "Unknown asset" });
        return;
      }
    }
    const notCap = parsed.data.notCapitalised === true;
    const refusal = approveRefusal(asset, notCap);
    if (refusal) {
      failure = conflict(refusal);
      return;
    }
    // 2026-10-23: whether it came back corrected (and by which team), read before the approval is written.
    const fixedBy = (await correctionTeams(tx, [asset])).get(asset.id);
    // State-guarded write: the null check is IN the where clause, so two simultaneous confirmations cannot both succeed.
    if (!(await approveOne(tx, asset, user, notCap))) {
      failure = conflict(`${asset.tag} was changed by someone else just now — reload and review it again.`);
      return;
    }
    // A corrected asset approved: the team that corrected it hears Finance accepted it (in the same transaction).
    if (fixedBy) {
      await notifyAssetsByTeam(
        tx, [{ team: fixedBy, id: asset.id, tag: asset.tag }], FINANCE_WORDS.accepted, user,
        { group: { entityType: "asset", entityId: asset.id } },
      );
    }
    // The last asset of a fully registered PO approved: the PO's approval webhooks (and Purchasing's bell), once.
    if (asset.purchaseOrderId) await emitIfPoFullyApproved(tx, asset.purchaseOrderId, user);
    out = { id: asset.id, tag: asset.tag, cls: asset.cls };
  });

  if (failure) return failure;
  const done = out!;
  revalidatePath(`/inventory/${parsed.data.id}`);
  revalidatePath("/inventory");
  revalidatePath("/finance/assets");
  revalidatePath(`/finance/assets/${parsed.data.id}`);
  // Finance follow-up (spec §4): and how many are left, for "Next: BR-LT-0204 · 3 left to review"
  const [next, remaining] = await Promise.all([nextToReview(done.id, done.cls), toReviewCount(done.cls)]);
  return ok({ tag: done.tag, next, remaining });
}

/**
 * Finance sends a registration back to IT or Purchasing with a checklist of what is wrong and an
 * optional note (Phase 35, spec §3.3). The counterpart to
 * confirmAssetDetails, and deliberately NOT a gate (C-7): the asset stays
 * live and usable throughout — what changes is that the team can see what to fix.
 *
 * Task 6 (spec §5): Finance picks the team (`team`), and the ticked fields must be that team's to fix
 * (`returnTeamFor`: the field's owner, or — money on an asset with no PO — the team that registered the batch); "Other"
 * goes wherever Finance picks. Money on an asset from a PO is refused: Finance sends the PO back instead, so its
 * assets keep one SI number. The team's bell rings once.
 *
 * A SECOND return is allowed and overwrites the current checklist and note: Finance
 * re-checking after the fix and finding it still wrong is a real sequence.
 * Only the current ones live in the columns; every one survives in the
 * audit trail.
 */
export async function returnAsset(input: unknown): Promise<ActionResult<{ tag: string }>> {
  const user = await actionRole("admin", "finance_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);

  const parsed = returnSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const { id, team, fields, note } = parsed.data;
  const cleanNote = note ? note : null;

  let out: { tag: string } | null = null;
  let failure: ActionResult<{ tag: string }> | null = null;

  await prisma.$transaction(async (tx) => {
    const asset = await tx.asset.findUnique({
      where: { id },
      select: {
        id: true, tag: true, financeConfirmedAt: true, cls: true, itVerifiedAt: true, financeReturnedAt: true, financeResubmitNote: true,
        purchaseOrderId: true, purchaseRecordId: true,
      },
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
    const ctx = await returnContext(tx, asset);
    const refused = returnRefusal(fields, team, ctx);
    if (refused) {
      failure = validationError(refused);
      return;
    }
    // State-guarded, the same shape as confirmAssetDetails: the confirmed-is-null check lives IN the where clause, so a
    // confirmation landing between the read above and this write wins rather than being silently undone.
    if (!(await returnOne(tx, asset, user, { team, fields, note: cleanNote }))) {
      failure = conflict(`${asset.tag} was confirmed by someone else just now.`);
      return;
    }
    await notify(tx, {
      team, kind: "SENT_BACK", title: `${asset.tag} sent back by Finance: ${fieldLabels(fields).join(", ")}`,
      body: cleanNote, href: `/inventory/${asset.id}`, actorId: user.id, actorRole: user.role,
      entityType: "asset", entityId: asset.id,
    });
    out = { tag: asset.tag };
  });

  if (failure) return failure;
  revalidatePath(`/inventory/${id}`);
  revalidatePath("/inventory");
  revalidatePath("/finance/assets");
  revalidatePath(`/finance/assets/${id}`);
  revalidatePath("/finance/review");
  return ok(out!);
}

/** What decides which team a field goes back to: the asset's class, its PO and who registered its batch. */
async function returnContext(
  tx: Prisma.TransactionClient,
  asset: { cls: AssetClass; purchaseOrderId: string | null; purchaseRecordId: string | null },
): Promise<ReturnContext> {
  const po = asset.purchaseOrderId
    ? await tx.purchaseOrder.findUnique({ where: { id: asset.purchaseOrderId }, select: { refNo: true } })
    : null;
  const record = asset.purchaseRecordId
    ? await tx.purchaseRecord.findUnique({ where: { id: asset.purchaseRecordId }, select: { createdById: true } })
    : null;
  const by = record ? await tx.user.findUnique({ where: { id: record.createdById }, select: { role: true } }) : null;
  return { cls: asset.cls, refNo: po?.refNo ?? null, registeredByRole: by?.role ?? null };
}

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
  const { id, reply } = parsed.data;

  let out: { tag: string } | null = null;
  let failure: ActionResult<{ tag: string }> | null = null;

  await prisma.$transaction(async (tx) => {
    const asset = await tx.asset.findUnique({
      where: { id },
      select: { id: true, tag: true, cls: true, financeReturnedAt: true, financeReturnedTo: true, purchaseOrderId: true, purchaseRecordId: true },
    });
    if (!asset) {
      failure = validationError({ id: "Unknown asset" });
      return;
    }
    // Task 6 (spec §5): only the team Finance sent it back to resubmits it (an admin is every team). A return from
    // before teams were recorded went to the class's team.
    const to = asset.financeReturnedTo ?? (asset.cls === "IT" ? "IT" : "PURCHASING");
    if (user.role !== "admin" && teamOfRole(user.role) !== to) {
      failure = forbidden();
      return;
    }
    if (!asset.financeReturnedAt) {
      failure = conflict(`${asset.tag} was not sent back, so there is nothing to resubmit.`);
      return;
    }
    // The PO's own send-back comes back with the PO: Purchasing corrects it and saves, which un-returns its assets.
    if (asset.purchaseOrderId && to === "PURCHASING") {
      const po = await tx.purchaseOrder.findUnique({ where: { id: asset.purchaseOrderId }, select: { refNo: true, state: true } });
      if (po?.state === "SENT_BACK") {
        failure = conflict(`Correct ${po.refNo} and save it — that sends ${asset.tag} back to Finance.`);
        return;
      }
    }
    const hit = await tx.asset.updateMany({
      where: { id: asset.id, financeReturnedAt: { not: null } },
      data: {
        financeReturnedAt: null, financeReturnedById: null, financeReturnReason: null, financeReturnedTo: null,
        financeReturnFields: [], financeResubmitNote: reply ? reply : null,
      },
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
      diff: { financeReturn: { from: "returned", to: null }, ...(reply ? { reply: { from: null, to: reply } } : {}) },
      source: "web",
    });
    // Spec §7: a correction is new to check for Finance — on the asset's group when it has one.
    await notify(tx, {
      team: "FINANCE", kind: "TO_CHECK", title: `${asset.tag} corrected by ${TEAM_NAME[to]}, to check again`, body: reply ? reply : null,
      href: asset.purchaseRecordId ? `/finance/review/${asset.purchaseRecordId}` : `/finance/assets/${asset.id}`,
      actorId: user.id, actorRole: user.role, entityType: "asset", entityId: asset.id,
    });
    out = { tag: asset.tag };
  });

  if (failure) return failure;
  revalidatePath(`/inventory/${id}`);
  revalidatePath("/inventory");
  revalidatePath("/finance/assets");
  revalidatePath(`/finance/assets/${id}`);
  revalidatePath("/finance/review");
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

const identifiersSchema = z.object({
  tags: z.array(z.string().trim().max(20)).max(200).optional(),
  serials: z.array(z.string().trim().max(120)).max(200).optional(),
  // Phase 20 (spec §6.2, plan P-4): now REQUIRED — the register and single
  // forms pass the class they are registering into, so a tag or serial
  // belonging to the OTHER class never leaks before submit. A genuine
  // cross-class collision still surfaces, but only at save time, as the
  // existing neutral P2002 conflict copy.
  cls: z.enum(ASSET_CLASSES),
});

/**
 * Spec §2.4/§6.2: which of these tags/serials already exist, scoped to ONE class. Phase 30 (spec §5.3):
 * each hit carries the record it lives on (its id, and a serial's tag) so the form can link to it —
 * still only identifiers, never anything else about the asset. Metered on the `check` kind: it fires
 * on every blur.
 */
export async function checkIdentifiers(
  input: unknown,
): Promise<ActionResult<{ tags: Array<{ tag: string; id: string }>; serials: Array<{ serial: string; id: string; tag: string }> }>> {
  const user = await actionRole("admin", "it_staff", "purchasing_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id, "check");
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = identifiersSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  // Each hit now names a record (its id, a serial's tag): a class the caller cannot register into — directly, or
  // from a purchase order (Purchasing's own items, po-register-form.tsx) — is refused outright, so a hand-crafted
  // call cannot read another class's tags or ids.
  if (!canRegisterClass(user.role, parsed.data.cls) && !canRegisterLine(user.role, parsed.data.cls, "READY").ok) return forbidden();
  const tags = [...new Set((parsed.data.tags ?? []).map(tagKey).filter(Boolean))];
  const serials = [...new Set((parsed.data.serials ?? []).filter(Boolean))];
  const where = identifierWhere(parsed.data.cls, tags, serials);
  const [byTag, bySerial] = await Promise.all([
    tags.length ? prisma.asset.findMany({ where: where.tags, select: { tag: true, id: true } }) : [],
    serials.length ? prisma.asset.findMany({ where: where.serials, select: { serial: true, id: true, tag: true } }) : [],
  ]);
  return ok({ tags: byTag, serials: bySerial.map((a) => ({ serial: a.serial as string, id: a.id, tag: a.tag })) });
}
