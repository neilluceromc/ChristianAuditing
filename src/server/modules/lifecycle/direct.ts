import { z } from "zod";
import type { AssetStatus, Prisma, Role } from "@prisma/client";
import type { SessionUser } from "@/server/auth/guards";
import { writeAudit } from "@/server/audit";
import { emitWebhook } from "@/server/webhooks/emit";
import { createApproval, openApprovalForAsset } from "@/server/modules/approvals/create";
import { conflict, forbidden, ok, validationError, type ActionResult } from "@/server/action-result";
import { cleanReason, reasonOptional } from "@/lib/reason";
import type { AuditDiff } from "@/lib/audit-diff";
import { ASSET_STATUSES } from "@/lib/inventory-list";
import {
  ASSIGN_TARGETS, CLASS_PHRASE, DEFAULT_ASSIGN_STATUS, isAssignable, isDirectLifecycle, statusLabel,
} from "@/lib/asset-class";
import { RETURN_OUTCOMES, humanizeGuard, loanDueFor, reasonRequiredFor, replacePlan } from "@/lib/lifecycle";
import { commitLifecycle, prepareLifecycle, type LifecycleAsset, type LifecycleChange, type Prepared } from "./apply";

/*
 * Phase 41 (spec §6.1–6.3): the direct lifecycle path's shared pieces, apart from the
 * "use server" file so nothing here is callable from the browser. Every export of
 * actions.ts is a server action a client can invoke with any arguments; the cores
 * below take a transaction and a user, so they must never be one. They do no auth,
 * no rate check and no revalidation: the server actions (and Cris's confirm) do.
 */

export type Tx = Prisma.TransactionClient;
type Actor = { id: string; name: string };

export const assetSelect = {
  id: true, tag: true, cls: true, status: true, assigneeId: true, defectiveSince: true, repairEndedAt: true, returnedAt: true, loanDueAt: true, model: true,
} as const;

/** Load + the three refusals every direct action shares: exists, direct for this role, no open approval. */
export async function loadDirect(tx: Tx, actor: { role: Role }, assetId: string) {
  const asset = await tx.asset.findUnique({ where: { id: assetId }, select: assetSelect });
  if (!asset) return { failure: conflict("That asset no longer exists.") } as const;
  if (!isDirectLifecycle(actor.role, asset.cls)) return { failure: forbidden() } as const;
  const open = await openApprovalForAsset(tx, asset.id);
  if (open) return { failure: conflict(`${asset.tag} is held by ${open.refNo} — resolve it in Approvals first.`) } as const;
  return { asset } as const;
}

/** One direct change, described: what recordDirect checks and then writes. */
export interface DirectRecord {
  actor: Actor; asset: LifecycleAsset; change: LifecycleChange;
  type: "lifecycle_assign" | "lifecycle_return" | "lifecycle_change_status";
  payload: Prisma.InputJsonObject; employeeId?: string; action: string; extraDiff?: AuditDiff; now: Date;
}

/** The guards half of recordDirect: reads only, writes nothing. */
async function prepareDirect(tx: Tx, rec: DirectRecord): Promise<{ ok: true; prepared: Prepared } | { ok: false; error: string }> {
  const prepared = await prepareLifecycle(tx, rec.asset, rec.change, rec.now);
  // The direct dialogs are IT talking to IT, not the worker's retry UI — strip
  // the worker's framing so the same guard reads as a plain sentence here
  // (final review, plan D-8; the worker's own workerError stays verbatim).
  if (!prepared.ok) return { ok: false, error: humanizeGuard(prepared.error) };
  return prepared;
}

/** The writes half of recordDirect: nothing here refuses. */
async function commitDirect(tx: Tx, rec: DirectRecord, prepared: Prepared): Promise<AuditDiff> {
  await commitLifecycle(tx, rec.asset.id, prepared, rec.now);
  const approval = await createApproval(tx, {
    type: rec.type, payload: rec.payload, requestedById: rec.actor.id,
    assetId: rec.asset.id, employeeId: rec.employeeId,
    executed: { by: rec.actor.id, at: rec.now },
  });
  const diff: AuditDiff = { ...prepared.diff, ...(rec.extraDiff ?? {}) };
  await writeAudit(tx, {
    actorId: rec.actor.id, actorLabel: rec.actor.name,
    entityType: "asset", entityId: rec.asset.id, action: rec.action, diff,
  });
  await emitWebhook(tx, "approval.executed", {
    approvalId: approval.id, refNo: approval.refNo, type: approval.type, assetId: rec.asset.id, assetTag: rec.asset.tag,
  });
  return diff;
}

/**
 * Spec §2.3: one direct change = the asset write + an EXECUTED approval row (the
 * record of the decision) + the asset audit entry + the same webhook the worker
 * emits. All in the caller's transaction.
 */
export async function recordDirect(tx: Tx, rec: DirectRecord): Promise<{ ok: true; diff: AuditDiff } | { ok: false; error: string }> {
  const p = await prepareDirect(tx, rec);
  if (!p.ok) return p;
  return { ok: true, diff: await commitDirect(tx, rec, p.prepared) };
}

// ── the cores (Phase 41, spec §6) ───────────────────────────────────────────

/**
 * `via: "Cris"` adds `via: { from: null, to: "Cris" }` to every audit entry the core writes — set only by
 * server code (Cris's confirm), never from client input. `dryRun: true` runs every read and guard and
 * returns the would-be result or the same refusal, writing nothing.
 */
export type LifecycleOpts = { via?: "Cris"; dryRun?: boolean };

const viaDiff = (opts: LifecycleOpts): AuditDiff => (opts.via === "Cris" ? { via: { from: null, to: "Cris" } } : {});

/** A guarded, prepared change waiting to be written: the plan step's output, the apply step's input. */
type Step = { rec: DirectRecord; prepared: Prepared };
type Plan<T> = { failure: ActionResult<never> } | { steps: Step[]; out: T };

/**
 * Every guard runs in the plan step, before anything is written, so a refusal leaves the caller's
 * transaction untouched and a dry run sees exactly the refusals a real run would.
 */
async function runPlan<T>(tx: Tx, plan: Plan<T>, opts: LifecycleOpts): Promise<ActionResult<T>> {
  if ("failure" in plan) return plan.failure;
  if (!opts.dryRun) for (const step of plan.steps) await commitDirect(tx, step.rec, step.prepared);
  return ok(plan.out);
}

const reasonOpt = reasonOptional();
export const dateStr = z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use the date picker")]);

// ── assign ──────────────────────────────────────────────────────────────────
export const assignSchema = z.object({
  assetId: z.string().min(1), employeeId: z.string().min(1),
  status: z.enum(ASSET_STATUSES).optional(), loanDueAt: dateStr.optional(), reason: reasonOpt,
});
export type AssignInput = z.infer<typeof assignSchema>;

async function planAssign(tx: Tx, user: SessionUser, d: AssignInput, opts: LifecycleOpts, now: Date): Promise<Plan<{ tag: string; employeeName: string }>> {
  const loaded = await loadDirect(tx, user, d.assetId);
  if (loaded.failure) return { failure: loaded.failure };
  const { asset } = loaded;
  const status: AssetStatus = d.status ?? DEFAULT_ASSIGN_STATUS[asset.cls];
  if (!(ASSIGN_TARGETS[asset.cls] as readonly string[]).includes(status)) {
    return { failure: validationError({ status: `${statusLabel(status)} is not an assign target for ${CLASS_PHRASE[asset.cls]} asset.` }) };
  }
  const employee = await tx.employee.findUnique({ where: { id: d.employeeId }, select: { name: true } });
  if (!employee) return { failure: validationError({ employeeId: "Unknown employee" }) };
  const due = loanDueFor(status, d.loanDueAt, now);
  if (!due.ok) return { failure: validationError({ loanDueAt: due.error }) };
  const rec: DirectRecord = {
    actor: user, asset, now, type: "lifecycle_assign", action: "lifecycle.assign", employeeId: d.employeeId,
    change: { kind: "assign", employeeId: d.employeeId, status, loanDueAt: due.value },
    payload: {
      to: { assigneeId: d.employeeId, status, ...(due.value ? { loanDueAt: due.value.toISOString() } : {}) },
      reason: d.reason || "assigned",
    },
    extraDiff: viaDiff(opts),
  };
  const p = await prepareDirect(tx, rec);
  if (!p.ok) return { failure: conflict(p.error) };
  return { steps: [{ rec, prepared: p.prepared }], out: { tag: asset.tag, employeeName: employee.name } };
}

/** assignAsset's whole decision and write, in the caller's transaction. No auth, rate check or revalidation. */
export async function assignCore(
  tx: Tx, user: SessionUser, input: AssignInput, opts: LifecycleOpts = {},
): Promise<ActionResult<{ tag: string; employeeName: string }>> {
  return runPlan(tx, await planAssign(tx, user, input, opts, new Date()), opts);
}

// ── replace ─────────────────────────────────────────────────────────────────
export const replaceSchema = z.object({
  employeeId: z.string().min(1), oldAssetId: z.string().min(1), newAssetId: z.string().min(1),
  outcome: z.enum(RETURN_OUTCOMES), reason: reasonOpt,
});
export type ReplaceInput = z.infer<typeof replaceSchema>;

async function planReplace(tx: Tx, user: SessionUser, d: ReplaceInput, opts: LifecycleOpts, now: Date): Promise<Plan<{ oldTag: string; newTag: string }>> {
  if (d.oldAssetId === d.newAssetId) return { failure: validationError({ newAssetId: "Pick a different device." }) };
  if (reasonRequiredFor(d.outcome) && cleanReason(d.reason).length < 3) {
    return { failure: validationError({ reason: "Missing needs a reason (at least 3 characters) — it opens an investigation." }) };
  }
  const oldL = await loadDirect(tx, user, d.oldAssetId);
  if (oldL.failure) return { failure: oldL.failure };
  const newL = await loadDirect(tx, user, d.newAssetId);
  if (newL.failure) return { failure: newL.failure };
  const oldAsset = oldL.asset, newAsset = newL.asset;
  if (oldAsset.assigneeId !== d.employeeId) return { failure: conflict(`${oldAsset.tag} isn't held by this person.`) };
  if (oldAsset.cls !== newAsset.cls) return { failure: conflict("Replace within one class only.") };
  if (!isAssignable(newAsset)) {
    return {
      failure: conflict(newAsset.returnedAt
        ? `${newAsset.tag} is back but not yet triaged — triage it first.`
        : `${newAsset.tag} is ${statusLabel(newAsset.status)}, not a spare.`),
    };
  }
  let plan: ReturnType<typeof replacePlan>;
  try { plan = replacePlan({ status: oldAsset.status }, d.outcome); }
  catch { return { failure: conflict(`${oldAsset.tag} is ${statusLabel(oldAsset.status)} — nothing to replace.`) }; }

  const via = viaDiff(opts);
  const ret: DirectRecord = {
    actor: user, asset: oldAsset, now, type: "lifecycle_return", action: "lifecycle.replace", employeeId: d.employeeId,
    change: { kind: "return", status: plan.oldStatus },
    payload: { from: { assigneeId: d.employeeId }, to: { assigneeId: null, status: plan.oldStatus }, reason: d.reason || `replaced by ${newAsset.tag}` },
    extraDiff: { replacedBy: { from: null, to: newAsset.tag }, ...via },
  };
  const asg: DirectRecord = {
    actor: user, asset: newAsset, now, type: "lifecycle_assign", action: "lifecycle.replace", employeeId: d.employeeId,
    change: { kind: "assign", employeeId: d.employeeId, status: plan.newStatus, loanDueAt: null },
    payload: { to: { assigneeId: d.employeeId, status: plan.newStatus }, reason: `replaces ${oldAsset.tag}` },
    extraDiff: { replaces: { from: null, to: oldAsset.tag }, ...via },
  };
  // Both legs are guarded before either is written. The new asset's guards read only the person, the new
  // asset's own snapshot and its holds — nothing the old asset's return writes — so checking them first
  // refuses exactly what the old return-then-assign order refused, and a refusal never needs a rollback.
  const retP = await prepareDirect(tx, ret);
  if (!retP.ok) return { failure: conflict(retP.error) };
  const asgP = await prepareDirect(tx, asg);
  if (!asgP.ok) return { failure: conflict(asgP.error) };
  return {
    steps: [{ rec: ret, prepared: retP.prepared }, { rec: asg, prepared: asgP.prepared }],
    out: { oldTag: oldAsset.tag, newTag: newAsset.tag },
  };
}

/** replaceAsset's whole decision and both writes, in the caller's transaction. No auth, rate check or revalidation. */
export async function replaceCore(
  tx: Tx, user: SessionUser, input: ReplaceInput, opts: LifecycleOpts = {},
): Promise<ActionResult<{ oldTag: string; newTag: string }>> {
  return runPlan(tx, await planReplace(tx, user, input, opts, new Date()), opts);
}
