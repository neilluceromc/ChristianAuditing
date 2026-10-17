"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma, type Role } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { actionUser } from "@/server/auth/guards";
import { checkRate } from "@/server/rate-limit";
import { writeAudit } from "@/server/audit";
import { OPEN_APPROVAL_STATES, openApprovalForAsset } from "@/server/modules/approvals/create";
import { repairStageIds } from "@/server/modules/inventory/queries";
import {
  conflict, forbidden, ok, rateLimited, validationError, zodFieldErrors, type ActionResult,
} from "@/server/action-result";
import { cleanReason, reasonOptional } from "@/lib/reason";
import type { AuditDiff } from "@/lib/audit-diff";
import { parseListState, type ListState } from "@/lib/url-state";
import { ASSET_STATUSES, BULK_MAX, INVENTORY_LIST_CONFIG, buildAssetWhere, parsePurchaseYear } from "@/lib/inventory-list";
import { statusFamily } from "@/lib/status";
import {
  ASSIGN_TARGETS, CLASS_PHRASE, DEFAULT_ASSIGN_STATUS, defaultClassFor, isAssignable, isDirectLifecycle, isStatusOf, parseCls, statusLabel,
} from "@/lib/asset-class";
import {
  RETURN_OUTCOMES, RETURN_OUTCOME_STATUS, TRIAGE_LABEL, loanDueFor, reasonRequiredFor, triageInputSchema, triageNeedsReason,
} from "@/lib/lifecycle";
import {
  assetSelect, assignCore, assignSchema, dateStr, loadDirect, recordDirect, replaceCore, replaceSchema,
} from "./direct";
import { revalidateAsset } from "./revalidate";
import { rememberPicks } from "@/server/recent-picks";

/**
 * Thrown inside a `$transaction` callback to force a rollback of every write
 * made so far in that transaction. Prisma's interactive transactions only
 * roll back on a thrown exception — a plain `return` from the callback
 * commits whatever writes already happened. Caught just outside the
 * `$transaction` call and converted back into a `conflict()` result.
 */
class DirectRefusal extends Error {}

const reasonOpt = reasonOptional();

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
// Phase 41: the decision and the write are assignCore (direct.ts), shared with Cris's confirm.
export async function assignAsset(input: unknown): Promise<ActionResult<{ tag: string; employeeName: string }>> {
  const user = await actionUser();
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = assignSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const d = parsed.data;
  const result = await prisma.$transaction((tx) => assignCore(tx, user, d));
  if (!result.ok) return result;
  revalidateAsset(d.assetId, [d.employeeId]);
  await rememberPicks(user.id, { employee: d.employeeId });
  return result;
}

// ── setLoanDue ──────────────────────────────────────────────────────────────
const loanDueSchema = z.object({ assetId: z.string().min(1), loanDueAt: dateStr });

/** Spec §4.2: a due date is metadata, like notes — audited, no approval row. */
export async function setLoanDue(input: unknown): Promise<ActionResult<{ tag: string; loanDueAt: string }>> {
  const user = await actionUser();
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = loanDueSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const d = parsed.data;
  const now = new Date();
  const due = loanDueFor("TEMPORARY", d.loanDueAt, now);
  if (!due.ok) return validationError({ loanDueAt: due.error });
  let out: { tag: string; loanDueAt: string } | null = null;
  const failure = await prisma.$transaction(async (tx) => {
    const asset = await tx.asset.findUnique({ where: { id: d.assetId }, select: assetSelect });
    if (!asset) return conflict("That asset no longer exists.");
    if (!isDirectLifecycle(user.role, asset.cls)) return forbidden();
    if (asset.status !== "TEMPORARY") return conflict(`${asset.tag} is not on loan — it reads ${statusLabel(asset.status)}.`);
    await tx.asset.update({ where: { id: asset.id }, data: { loanDueAt: due.value } });
    await writeAudit(tx, {
      actorId: user.id, actorLabel: user.name, entityType: "asset", entityId: asset.id,
      action: "loan.due-changed", diff: { loanDueAt: { from: asset.loanDueAt, to: due.value } },
    });
    out = { tag: asset.tag, loanDueAt: d.loanDueAt };
    return null;
  });
  if (failure) return failure;
  revalidateAsset(d.assetId, []);
  revalidatePath("/inventory/work");
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
  if (reasonRequiredFor(d.outcome) && cleanReason(d.reason).length < 3) {
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
// Phase 41: the decision and both writes are replaceCore (direct.ts), shared with Cris's confirm. It guards
// both legs before writing either, so a refusal returns with nothing written — no rollback throw needed.
export async function replaceAsset(input: unknown): Promise<ActionResult<{ oldTag: string; newTag: string }>> {
  const user = await actionUser();
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = replaceSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const d = parsed.data;
  const result = await prisma.$transaction((tx) => replaceCore(tx, user, d));
  if (!result.ok) return result;
  revalidateAsset(d.oldAssetId, [d.employeeId]);
  revalidatePath(`/inventory/${d.newAssetId}`);
  await rememberPicks(user.id, { employee: d.employeeId });
  return result;
}

// ── triageAsset ─────────────────────────────────────────────────────────────
// Phase 40 (spec §8): the schema lives in lib/lifecycle (triageInputSchema) so its reason rule is unit-tested;
// a missing decision, or Dispose/Donate without a reason of at least 2 characters, is refused before any write.

export async function triageAsset(input: unknown): Promise<ActionResult<{ tag: string; status: string }>> {
  const user = await actionUser();
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = triageInputSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const d = parsed.data;
  const now = new Date();
  let out: { tag: string; status: string } | null = null;
  let failure: ActionResult<never> | null | undefined;
  try {
    failure = await prisma.$transaction(async (tx) => {
      const loaded = await loadDirect(tx, user, d.assetId);
      if ("failure" in loaded) return loaded.failure;
      const { asset } = loaded;
      const notWaiting = conflict(`${asset.tag} is not waiting for triage.`);
      if (asset.returnedAt === null) return notWaiting;
      // Claim first, state-guarded, before anything is recorded: of two concurrent triages of the same
      // device, the second blocks on the row lock, then finds nothing still waiting and is refused.
      // `asset` keeps the pre-claim snapshot, so prepareLifecycle still diffs returnedAt → null.
      const claim = await tx.asset.updateMany({
        where: { id: asset.id, status: asset.status, returnedAt: { not: null } },
        data: { returnedAt: null },
      });
      if (claim.count === 0) return notWaiting;
      const full = await tx.asset.findUniqueOrThrow({ where: { id: asset.id }, select: { notes: true } });
      const notes = d.note ? (full.notes ? `${full.notes}\n${d.note}` : d.note) : undefined;
      // The asset has no disposal-reason column. For Dispose/Donate the text is the decision's reason
      // (`reason`, the key other reasoned actions use); for Keep/Repair it is an optional `note`. Either way
      // it also rides the EXECUTED approval's payload and the asset's notes, as the note always did.
      const textKey = triageNeedsReason(d.outcome) ? "reason" : "note";
      const triageDiff: AuditDiff = {
        triage: { from: null, to: TRIAGE_LABEL[d.outcome] },
        ...(d.note ? { [textKey]: { from: null, to: d.note } } : {}),
      };
      if (d.outcome === asset.status) {
        // Keep as spare: only the flag moves (claimed above). No approval row — nothing about the
        // asset's lifecycle changed, so there is no decision to record as one.
        if (notes !== undefined) await tx.asset.update({ where: { id: asset.id }, data: { notes } });
        await writeAudit(tx, {
          actorId: user.id, actorLabel: user.name, entityType: "asset", entityId: asset.id,
          action: "lifecycle.triage", diff: { ...triageDiff, returnedAt: { from: asset.returnedAt, to: null } },
        });
      } else {
        const r = await recordDirect(tx, {
          actor: user, asset, now, type: "lifecycle_change_status", action: "lifecycle.triage",
          change: { kind: "change-status", status: d.outcome },
          payload: { from: { status: asset.status }, to: { status: d.outcome }, reason: d.note || "triage" },
          extraDiff: triageDiff,
        });
        // the claim is already written: throw, so the rollback undoes it (a plain return would commit it)
        if (!r.ok) throw new DirectRefusal(r.error);
        if (notes !== undefined) await tx.asset.update({ where: { id: asset.id }, data: { notes } });
      }
      out = { tag: asset.tag, status: d.outcome };
      return null;
    });
  } catch (err) {
    if (err instanceof DirectRefusal) return conflict(err.message);
    throw err;
  }
  if (failure) return failure;
  revalidateAsset(d.assetId, []);
  return ok(out!);
}

/**
 * The `where` clause every bulk action resolves the same way: an explicit id
 * list, or the current list filters re-parsed server-side (repair-stage aware,
 * same as the list page itself). Shared by `bulkChangeStatus` and `bulkAssign`
 * so the two never drift.
 */
async function resolveBulkWhere(ids: string[] | undefined, filters: string | undefined, role: Role): Promise<Prisma.AssetWhereInput> {
  if (ids?.length) return { id: { in: ids } };
  const fp = new URLSearchParams(filters);
  const state: ListState = parseListState(fp, INVENTORY_LIST_CONFIG);
  const purchaseYear = parsePurchaseYear(fp.get("purchaseYear"));
  // Phase 30 (plan P-7): no `cls=` means the viewer's own default class — the list the drawer sits on.
  const cls = parseCls(fp.get("cls")) ?? defaultClassFor(role);
  const cutIds = await repairStageIds(state, purchaseYear, cls);
  return cutIds !== null ? { id: { in: cutIds } } : buildAssetWhere(state, purchaseYear, cls);
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

/**
 * Phase 20 (spec §6.1, gap 1): the skipped list now NAMES each tag and why,
 * the same shape `bulkAssign` already returns — before this it was a bare
 * count, and an operator staring at "3 skipped" had to go find which three
 * and guess. The one-class refusal (mixed IT/Purchasing in one selection)
 * stays a hard, whole-selection conflict, unchanged: the list-scoped `cls`
 * filter `resolveBulkWhere` applies means a mixed selection can only reach
 * here via a hand-built `ids` list, and there is still no legal target
 * status for a mixed batch to skip its way around — so it refuses before any
 * per-asset reason is even collected.
 */
export async function bulkChangeStatus(input: unknown): Promise<ActionResult<{ changed: number; skipped: Array<{ tag: string; reason: string }> }>> {
  const user = await actionUser();
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = bulkSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const { ids, filters, to, reason } = parsed.data;

  const where = await resolveBulkWhere(ids, filters, user.role);

  const now = new Date();
  let changed = 0;
  const skipped: Array<{ tag: string; reason: string }> = [];
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
    const targets: typeof assets = [];
    for (const asset of assets) {
      if (asset.status === to) { skipped.push({ tag: asset.tag, reason: `already ${statusLabel(to)}` }); continue; }
      if (blocked.has(asset.id)) { skipped.push({ tag: asset.tag, reason: "held by an open request" }); continue; }
      if (statusFamily(asset.status) === "closed") {
        skipped.push({ tag: asset.tag, reason: `closed status ${statusLabel(asset.status)} — cannot change` });
        continue;
      }
      targets.push(asset);
    }
    for (const asset of targets) {
      const r = await recordDirect(tx, {
        actor: user, asset, now, type: "lifecycle_change_status", action: "lifecycle.change-status",
        change: { kind: "change-status", status: to },
        payload: { from: { status: asset.status }, to: { status: to }, reason: reason ?? "" },
      });
      if (!r.ok) { skipped.push({ tag: asset.tag, reason: r.error }); continue; } // a held asset refused by the holder guard is skipped, not fatal
      changed += 1;
    }
    return null;
  }, {
    // ~8 statements per asset (recordDirect: prepareLifecycle reads + the asset
    // update, approval, audit and webhook writes) × BULK_MAX (200) assets can
    // clear Prisma's 5s interactive-transaction default well before the loop
    // finishes; maxWait only bounds how long this waits to acquire a slot.
    timeout: 60_000, maxWait: 10_000,
  });
  if (failure) return failure;
  revalidatePath("/inventory");
  revalidatePath("/");
  return ok({ changed, skipped });
}

// ── bulkAssign ──────────────────────────────────────────────────────────────
const bulkAssignSchema = z
  .object({
    ids: z.array(z.string().min(1)).max(500).optional(),
    filters: z.string().max(2000).optional(),
    employeeId: z.string().min(1, "Pick a person"),
    status: z.enum(["DEPLOYED", "TEMPORARY"]),
    loanDueAt: dateStr.optional(),
    reason: reasonOpt,
  })
  .refine((v) => (v.ids?.length ?? 0) > 0 || v.filters !== undefined, { message: "Nothing is selected", path: ["ids"] });

/** Spec §5: several spares to one person, one transaction, the same record per asset a single assign writes. */
export async function bulkAssign(input: unknown): Promise<ActionResult<{ assigned: number; skipped: Array<{ tag: string; reason: string }> }>> {
  const user = await actionUser();
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = bulkAssignSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const d = parsed.data;
  const now = new Date();
  const due = loanDueFor(d.status, d.loanDueAt, now);
  if (!due.ok) return validationError({ loanDueAt: due.error });

  const where = await resolveBulkWhere(d.ids, d.filters, user.role);

  let assigned = 0;
  const skipped: Array<{ tag: string; reason: string }> = [];
  const failure = await prisma.$transaction(async (tx) => {
    const employee = await tx.employee.findUnique({ where: { id: d.employeeId }, select: { name: true, employment: true } });
    if (!employee) return validationError({ employeeId: "Unknown employee" });
    if (employee.employment !== "ACTIVE") return conflict(`${employee.name} is ${employee.employment.toLowerCase()} — assignments are frozen.`);
    const assets = await tx.asset.findMany({ where, take: BULK_MAX + 1, orderBy: [{ tag: "asc" }, { id: "asc" }], select: assetSelect });
    if (assets.length === 0) return conflict("Nothing matched the selection.");
    if (assets.length > BULK_MAX) return conflict(`That selection exceeds the ${BULK_MAX}-asset bulk cap — narrow the filter and repeat.`);
    const classes = new Set(assets.map((a) => a.cls));
    if (classes.size > 1) return conflict("Select assets of one class — IT and Purchasing assets cannot share an assignment.");
    const cls = assets[0].cls;
    if (!isDirectLifecycle(user.role, cls)) return forbidden();
    if (!(ASSIGN_TARGETS[cls] as readonly string[]).includes(d.status)) {
      return validationError({ status: `${statusLabel(d.status)} is not an assign target for ${CLASS_PHRASE[cls]} asset.` });
    }
    for (const asset of assets) {
      const open = await openApprovalForAsset(tx, asset.id);
      if (open) { skipped.push({ tag: asset.tag, reason: `held by ${open.refNo}` }); continue; }
      const r = await recordDirect(tx, {
        actor: user, asset, now, type: "lifecycle_assign", action: "lifecycle.assign", employeeId: d.employeeId,
        change: { kind: "assign", employeeId: d.employeeId, status: d.status, loanDueAt: due.value },
        payload: { to: { assigneeId: d.employeeId, status: d.status, ...(due.value ? { loanDueAt: due.value.toISOString() } : {}) }, reason: d.reason || "bulk assigned" },
      });
      if (!r.ok) { skipped.push({ tag: asset.tag, reason: r.error }); continue; }
      assigned += 1;
    }
    return null;
  }, { timeout: 60_000, maxWait: 10_000 });
  if (failure) return failure;
  revalidatePath("/inventory");
  revalidatePath(`/employees/${d.employeeId}`);
  revalidatePath("/");
  await rememberPicks(user.id, { employee: d.employeeId });
  return ok({ assigned, skipped });
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
        change: { kind: "assign", employeeId, status: DEFAULT_ASSIGN_STATUS[hold.asset.cls], loanDueAt: null },
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
