"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma, type AssetStatus, type Role } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { actionUser } from "@/server/auth/guards";
import { checkRate } from "@/server/rate-limit";
import { writeAudit } from "@/server/audit";
import { emitWebhook } from "@/server/webhooks/emit";
import { OPEN_APPROVAL_STATES, createApproval, openApprovalForAsset } from "@/server/modules/approvals/create";
import { repairStageIds } from "@/server/modules/inventory/queries";
import {
  conflict, forbidden, ok, rateLimited, validationError, zodFieldErrors, type ActionResult,
} from "@/server/action-result";
import type { AuditDiff } from "@/lib/audit-diff";
import { parseListState, type ListState } from "@/lib/url-state";
import { ASSET_STATUSES, BULK_MAX, INVENTORY_LIST_CONFIG, buildAssetWhere, parsePurchaseYear } from "@/lib/inventory-list";
import { statusFamily } from "@/lib/status";
import {
  ASSIGN_TARGETS, CLASS_PHRASE, DEFAULT_ASSIGN_STATUS, isAssignable, isDirectLifecycle, isStatusOf, parseCls,
} from "@/lib/asset-class";
import {
  RETURN_OUTCOMES, RETURN_OUTCOME_STATUS, TRIAGE_LABEL, TRIAGE_OUTCOMES, reasonRequiredFor, replacePlan,
} from "@/lib/lifecycle";
import { commitLifecycle, prepareLifecycle, type LifecycleAsset, type LifecycleChange } from "./apply";

type Tx = Prisma.TransactionClient;
type Actor = { id: string; name: string };

/**
 * Thrown inside a `$transaction` callback to force a rollback of every write
 * made so far in that transaction. Prisma's interactive transactions only
 * roll back on a thrown exception — a plain `return` from the callback
 * commits whatever writes already happened. Caught just outside the
 * `$transaction` call and converted back into a `conflict()` result.
 */
class DirectRefusal extends Error {}

const assetSelect = {
  id: true, tag: true, cls: true, status: true, assigneeId: true, defectiveSince: true, returnedAt: true, model: true,
} as const;

/** Load + the three refusals every direct action shares: exists, direct for this role, no open approval. */
async function loadDirect(tx: Tx, actor: { role: Role }, assetId: string) {
  const asset = await tx.asset.findUnique({ where: { id: assetId }, select: assetSelect });
  if (!asset) return { failure: conflict("That asset no longer exists.") } as const;
  if (!isDirectLifecycle(actor.role, asset.cls)) return { failure: forbidden() } as const;
  const open = await openApprovalForAsset(tx, asset.id);
  if (open) return { failure: conflict(`${asset.tag} is held by ${open.refNo} — resolve it in Approvals first.`) } as const;
  return { asset } as const;
}

/**
 * Spec §2.3: one direct change = the asset write + an EXECUTED approval row (the
 * record of the decision) + the asset audit entry + the same webhook the worker
 * emits. All in the caller's transaction.
 */
async function recordDirect(tx: Tx, input: {
  actor: Actor; asset: LifecycleAsset; change: LifecycleChange;
  type: "lifecycle_assign" | "lifecycle_return" | "lifecycle_change_status";
  payload: Prisma.InputJsonObject; employeeId?: string; action: string; extraDiff?: AuditDiff; now: Date;
}): Promise<{ ok: true; diff: AuditDiff } | { ok: false; error: string }> {
  const prepared = await prepareLifecycle(tx, input.asset, input.change, input.now);
  if (!prepared.ok) return prepared;
  await commitLifecycle(tx, input.asset.id, prepared.prepared, input.now);
  const approval = await createApproval(tx, {
    type: input.type, payload: input.payload, requestedById: input.actor.id,
    assetId: input.asset.id, employeeId: input.employeeId,
    executed: { by: input.actor.id, at: input.now },
  });
  const diff: AuditDiff = { ...prepared.prepared.diff, ...(input.extraDiff ?? {}) };
  await writeAudit(tx, {
    actorId: input.actor.id, actorLabel: input.actor.name,
    entityType: "asset", entityId: input.asset.id, action: input.action, diff,
  });
  await emitWebhook(tx, "approval.executed", {
    approvalId: approval.id, refNo: approval.refNo, type: approval.type, assetId: input.asset.id, assetTag: input.asset.tag,
  });
  return { ok: true, diff };
}

function revalidateAsset(assetId: string, employeeIds: Array<string | null | undefined>) {
  revalidatePath(`/inventory/${assetId}`);
  revalidatePath("/inventory");
  revalidatePath("/");
  for (const e of employeeIds) if (e) revalidatePath(`/employees/${e}`);
}

const reasonOpt = z.string().trim().max(500).optional();

// ── changeStatus ────────────────────────────────────────────────────────────
const changeStatusSchema = z.object({ assetId: z.string().min(1), to: z.enum(ASSET_STATUSES), reason: reasonOpt });

export async function changeStatus(input: unknown): Promise<ActionResult<{ tag: string; status: string }>> {
  const user = await actionUser();
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = changeStatusSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const d = parsed.data;
  const now = new Date();
  let out: { tag: string; status: string } | null = null;
  const failure = await prisma.$transaction(async (tx) => {
    const loaded = await loadDirect(tx, user, d.assetId);
    if ("failure" in loaded) return loaded.failure;
    const { asset } = loaded;
    if (!isStatusOf(asset.cls, d.to)) return validationError({ to: `${d.to} is not ${CLASS_PHRASE[asset.cls]} status.` });
    if (asset.status === d.to) return conflict(`Already ${d.to}.`);
    const r = await recordDirect(tx, {
      actor: user, asset, now, type: "lifecycle_change_status", action: "lifecycle.change-status",
      change: { kind: "change-status", status: d.to },
      payload: { from: { status: asset.status }, to: { status: d.to }, reason: d.reason ?? "" },
    });
    if (!r.ok) return conflict(r.error);
    out = { tag: asset.tag, status: d.to };
    return null;
  });
  if (failure) return failure;
  revalidateAsset(d.assetId, []);
  return ok(out!);
}

// ── assignAsset ─────────────────────────────────────────────────────────────
const assignSchema = z.object({
  assetId: z.string().min(1), employeeId: z.string().min(1),
  status: z.enum(ASSET_STATUSES).optional(), reason: reasonOpt,
});

export async function assignAsset(input: unknown): Promise<ActionResult<{ tag: string; employeeName: string }>> {
  const user = await actionUser();
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = assignSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const d = parsed.data;
  const now = new Date();
  let out: { tag: string; employeeName: string } | null = null;
  const failure = await prisma.$transaction(async (tx) => {
    const loaded = await loadDirect(tx, user, d.assetId);
    if ("failure" in loaded) return loaded.failure;
    const { asset } = loaded;
    const status: AssetStatus = d.status ?? DEFAULT_ASSIGN_STATUS[asset.cls];
    if (!(ASSIGN_TARGETS[asset.cls] as readonly string[]).includes(status)) {
      return validationError({ status: `${status} is not an assign target for ${CLASS_PHRASE[asset.cls]} asset.` });
    }
    const employee = await tx.employee.findUnique({ where: { id: d.employeeId }, select: { name: true } });
    if (!employee) return validationError({ employeeId: "Unknown employee" });
    const r = await recordDirect(tx, {
      actor: user, asset, now, type: "lifecycle_assign", action: "lifecycle.assign", employeeId: d.employeeId,
      change: { kind: "assign", employeeId: d.employeeId, status },
      payload: { to: { assigneeId: d.employeeId, status }, reason: d.reason || "assigned" },
    });
    if (!r.ok) return conflict(r.error);
    out = { tag: asset.tag, employeeName: employee.name };
    return null;
  });
  if (failure) return failure;
  revalidateAsset(d.assetId, [d.employeeId]);
  return ok(out!);
}

// ── returnAsset ─────────────────────────────────────────────────────────────
const returnSchema = z.object({ assetId: z.string().min(1), outcome: z.enum(RETURN_OUTCOMES), reason: reasonOpt });

export async function returnAsset(input: unknown): Promise<ActionResult<{ tag: string; status: string }>> {
  const user = await actionUser();
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = returnSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const d = parsed.data;
  if (reasonRequiredFor(d.outcome) && (d.reason ?? "").length < 3) {
    return validationError({ reason: "Missing needs a reason (at least 3 characters) — it opens an investigation." });
  }
  const now = new Date();
  let out: { tag: string; status: string } | null = null;
  const holderId: { v: string | null } = { v: null };
  const failure = await prisma.$transaction(async (tx) => {
    const loaded = await loadDirect(tx, user, d.assetId);
    if ("failure" in loaded) return loaded.failure;
    const { asset } = loaded;
    if (!asset.assigneeId) return conflict(`${asset.tag} is not held by anyone.`);
    holderId.v = asset.assigneeId;
    const status = RETURN_OUTCOME_STATUS[d.outcome];
    const r = await recordDirect(tx, {
      actor: user, asset, now, type: "lifecycle_return", action: "lifecycle.return", employeeId: asset.assigneeId,
      change: { kind: "return", status },
      payload: { from: { assigneeId: asset.assigneeId }, to: { assigneeId: null, status }, reason: d.reason ?? "" },
    });
    if (!r.ok) return conflict(r.error);
    out = { tag: asset.tag, status };
    return null;
  });
  if (failure) return failure;
  revalidateAsset(d.assetId, [holderId.v]);
  return ok(out!);
}

// ── replaceAsset ────────────────────────────────────────────────────────────
const replaceSchema = z.object({
  employeeId: z.string().min(1), oldAssetId: z.string().min(1), newAssetId: z.string().min(1),
  outcome: z.enum(RETURN_OUTCOMES), reason: reasonOpt,
});

export async function replaceAsset(input: unknown): Promise<ActionResult<{ oldTag: string; newTag: string }>> {
  const user = await actionUser();
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = replaceSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const d = parsed.data;
  if (d.oldAssetId === d.newAssetId) return validationError({ newAssetId: "Pick a different device." });
  if (reasonRequiredFor(d.outcome) && (d.reason ?? "").length < 3) {
    return validationError({ reason: "Missing needs a reason (at least 3 characters) — it opens an investigation." });
  }
  const now = new Date();
  let out: { oldTag: string; newTag: string } | null = null;
  let failure: ActionResult<never> | null | undefined;
  try {
    failure = await prisma.$transaction(async (tx) => {
      const oldL = await loadDirect(tx, user, d.oldAssetId);
      if ("failure" in oldL) return oldL.failure;
      const newL = await loadDirect(tx, user, d.newAssetId);
      if ("failure" in newL) return newL.failure;
      const oldAsset = oldL.asset, newAsset = newL.asset;
      if (oldAsset.assigneeId !== d.employeeId) return conflict(`${oldAsset.tag} isn't held by this person.`);
      if (oldAsset.cls !== newAsset.cls) return conflict("Replace within one class only.");
      if (!isAssignable(newAsset)) {
        return conflict(newAsset.returnedAt
          ? `${newAsset.tag} is back but not yet triaged — triage it first.`
          : `${newAsset.tag} is ${newAsset.status}, not a spare.`);
      }
      let plan: ReturnType<typeof replacePlan>;
      try { plan = replacePlan({ status: oldAsset.status }, d.outcome); }
      catch { return conflict(`${oldAsset.tag} is ${oldAsset.status} — nothing to replace.`); }

      // From here on, the old asset's return may already have written to the
      // database (asset row, approval, audit, webhook). If the new asset's
      // assign then refuses, a plain `return` would let that first write
      // commit while telling the caller the whole operation failed. Throw
      // instead, so Prisma rolls back both legs together.
      const ret = await recordDirect(tx, {
        actor: user, asset: oldAsset, now, type: "lifecycle_return", action: "lifecycle.replace", employeeId: d.employeeId,
        change: { kind: "return", status: plan.oldStatus },
        payload: { from: { assigneeId: d.employeeId }, to: { assigneeId: null, status: plan.oldStatus }, reason: d.reason || `replaced by ${newAsset.tag}` },
        extraDiff: { replacedBy: { from: null, to: newAsset.tag } },
      });
      if (!ret.ok) throw new DirectRefusal(ret.error);
      const asg = await recordDirect(tx, {
        actor: user, asset: newAsset, now, type: "lifecycle_assign", action: "lifecycle.replace", employeeId: d.employeeId,
        change: { kind: "assign", employeeId: d.employeeId, status: plan.newStatus },
        payload: { to: { assigneeId: d.employeeId, status: plan.newStatus }, reason: `replaces ${oldAsset.tag}` },
        extraDiff: { replaces: { from: null, to: oldAsset.tag } },
      });
      if (!asg.ok) throw new DirectRefusal(asg.error);
      out = { oldTag: oldAsset.tag, newTag: newAsset.tag };
      return null;
    });
  } catch (err) {
    if (err instanceof DirectRefusal) return conflict(err.message);
    throw err;
  }
  if (failure) return failure;
  revalidateAsset(d.oldAssetId, [d.employeeId]);
  revalidatePath(`/inventory/${d.newAssetId}`);
  return ok(out!);
}

// ── triageAsset ─────────────────────────────────────────────────────────────
const triageSchema = z.object({ assetId: z.string().min(1), outcome: z.enum(TRIAGE_OUTCOMES), note: z.string().trim().max(500).optional() });

export async function triageAsset(input: unknown): Promise<ActionResult<{ tag: string; status: string }>> {
  const user = await actionUser();
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = triageSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const d = parsed.data;
  const now = new Date();
  let out: { tag: string; status: string } | null = null;
  const failure = await prisma.$transaction(async (tx) => {
    const loaded = await loadDirect(tx, user, d.assetId);
    if ("failure" in loaded) return loaded.failure;
    const { asset } = loaded;
    if (asset.returnedAt === null) return conflict(`${asset.tag} is not waiting for triage.`);
    const full = await tx.asset.findUniqueOrThrow({ where: { id: asset.id }, select: { notes: true } });
    const notes = d.note ? (full.notes ? `${full.notes}\n${d.note}` : d.note) : undefined;
    const triageDiff: AuditDiff = { triage: { from: null, to: TRIAGE_LABEL[d.outcome] } };
    if (d.outcome === asset.status) {
      // Keep as spare: only the flag moves. No approval row — nothing about the
      // asset's lifecycle changed, so there is no decision to record as one.
      await tx.asset.update({ where: { id: asset.id }, data: { returnedAt: null, ...(notes !== undefined ? { notes } : {}) } });
      await writeAudit(tx, {
        actorId: user.id, actorLabel: user.name, entityType: "asset", entityId: asset.id,
        action: "lifecycle.triage", diff: { ...triageDiff, returnedAt: { from: asset.returnedAt, to: null } },
      });
    } else {
      const r = await recordDirect(tx, {
        actor: user, asset, now, type: "lifecycle_change_status", action: "lifecycle.triage",
        change: { kind: "change-status", status: d.outcome },
        payload: { from: { status: asset.status }, to: { status: d.outcome }, reason: d.note ?? "triage" },
        extraDiff: triageDiff,
      });
      if (!r.ok) return conflict(r.error);
      if (notes !== undefined) await tx.asset.update({ where: { id: asset.id }, data: { notes } });
    }
    out = { tag: asset.tag, status: d.outcome };
    return null;
  });
  if (failure) return failure;
  revalidateAsset(d.assetId, []);
  return ok(out!);
}

// ── bulkChangeStatus ────────────────────────────────────────────────────────
const bulkSchema = z
  .object({
    ids: z.array(z.string().min(1)).max(500).optional(),
    filters: z.string().max(2000).optional(),
    to: z.enum(ASSET_STATUSES),
    reason: reasonOpt,
  })
  .refine((v) => (v.ids?.length ?? 0) > 0 || v.filters !== undefined, { message: "Nothing is selected", path: ["ids"] });

export async function bulkChangeStatus(input: unknown): Promise<ActionResult<{ changed: number; skipped: number }>> {
  const user = await actionUser();
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = bulkSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const { ids, filters, to, reason } = parsed.data;

  let where: Prisma.AssetWhereInput;
  if (ids?.length) where = { id: { in: ids } };
  else {
    const fp = new URLSearchParams(filters);
    const state: ListState = parseListState(fp, INVENTORY_LIST_CONFIG);
    const purchaseYear = parsePurchaseYear(fp.get("purchaseYear"));
    const cls = parseCls(fp.get("cls")) ?? "IT";
    const cutIds = await repairStageIds(state, purchaseYear, cls);
    where = cutIds !== null ? { id: { in: cutIds } } : buildAssetWhere(state, purchaseYear, cls);
  }

  const now = new Date();
  let changed = 0, skipped = 0;
  const failure = await prisma.$transaction(async (tx) => {
    const assets = await tx.asset.findMany({ where, take: BULK_MAX + 1, select: assetSelect });
    if (assets.length === 0) return conflict("Nothing matched the selection.");
    if (assets.length > BULK_MAX) return conflict(`That selection exceeds the ${BULK_MAX}-asset bulk cap — narrow the filter and repeat.`);
    const classes = new Set(assets.map((a) => a.cls));
    if (classes.size > 1) return conflict("Select assets of one class — IT and Purchasing assets cannot share a status change.");
    const cls = assets[0].cls;
    if (!isDirectLifecycle(user.role, cls)) return forbidden();
    if (!isStatusOf(cls, to)) return validationError({ to: `${to} is not ${CLASS_PHRASE[cls]} status.` });
    const open = await tx.approval.findMany({
      where: { assetId: { in: assets.map((a) => a.id) }, state: { in: [...OPEN_APPROVAL_STATES] } },
      select: { assetId: true },
    });
    const blocked = new Set(open.map((o) => o.assetId));
    const targets = assets.filter((a) => a.status !== to && !blocked.has(a.id) && statusFamily(a.status) !== "closed");
    skipped = assets.length - targets.length;
    for (const asset of targets) {
      const r = await recordDirect(tx, {
        actor: user, asset, now, type: "lifecycle_change_status", action: "lifecycle.change-status",
        change: { kind: "change-status", status: to },
        payload: { from: { status: asset.status }, to: { status: to }, reason: reason ?? "" },
      });
      if (!r.ok) { skipped += 1; continue; } // a held asset refused by the holder guard is skipped, not fatal
      changed += 1;
    }
    return null;
  });
  if (failure) return failure;
  revalidatePath("/inventory");
  revalidatePath("/");
  return ok({ changed, skipped });
}

// ── assignReserved ──────────────────────────────────────────────────────────
const reservedSchema = z.object({ employeeId: z.string().min(1) });

export async function assignReserved(input: unknown): Promise<ActionResult<{ assigned: number }>> {
  const user = await actionUser();
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = reservedSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const { employeeId } = parsed.data;
  const now = new Date();
  let assigned = 0;
  const failure = await prisma.$transaction(async (tx) => {
    const employee = await tx.employee.findUnique({ where: { id: employeeId } });
    if (!employee) return conflict("That employee no longer exists.");
    if (employee.employment !== "ACTIVE") return conflict("Slots are frozen for a leaver.");
    const holds = await tx.reservation.findMany({ where: { employeeId, state: "ACTIVE" }, include: { asset: { select: assetSelect } } });
    for (const hold of holds) {
      if (!isDirectLifecycle(user.role, hold.asset.cls) || !isAssignable(hold.asset)) continue;
      if (await openApprovalForAsset(tx, hold.assetId)) continue;
      const r = await recordDirect(tx, {
        actor: user, asset: hold.asset, now, type: "lifecycle_assign", action: "lifecycle.assign", employeeId,
        change: { kind: "assign", employeeId, status: DEFAULT_ASSIGN_STATUS[hold.asset.cls] },
        payload: { to: { assigneeId: employeeId, status: DEFAULT_ASSIGN_STATUS[hold.asset.cls] }, reason: "reserved — day-one setup" },
      });
      if (r.ok) assigned += 1;
    }
    return null;
  });
  if (failure) return failure;
  if (assigned === 0) return conflict("No reserved spares were available to assign.");
  revalidatePath(`/employees/${employeeId}`);
  revalidatePath("/inventory");
  return ok({ assigned });
}
