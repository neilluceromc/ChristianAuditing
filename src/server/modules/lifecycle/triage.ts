import type { AssetStatus, Prisma } from "@prisma/client";
import type { z } from "zod";
import { prisma } from "@/server/db/client";
import type { SessionUser } from "@/server/auth/guards";
import { writeAudit } from "@/server/audit";
import { isDeadlock } from "@/server/prisma-errors";
import { openApprovalForAsset } from "@/server/modules/approvals/create";
import { conflict, forbidden, ok, validationError, type ActionResult } from "@/server/action-result";
import type { AuditDiff } from "@/lib/audit-diff";
import { isDirectLifecycle } from "@/lib/asset-class";
import { TRIAGE_LABEL, triageNeedsReason, type triageInputSchema } from "@/lib/lifecycle";
import {
  TRIAGE_ALREADY_UNDONE, TRIAGE_CHANGED_SINCE, TRIAGE_UNDONE, TRIAGE_UNDO_FINAL, TRIAGE_UNDO_NOT_YOURS,
  blocksTriageUndo, isUndoableTriage, notesBefore, triageOutcomeOf, triageRestore, triageVersion, undoWindowOpen, undoneTarget,
  type TriageRestore,
} from "@/lib/triage-undo";
import { assetSelect, loadDirect, recordDirect } from "./direct";

/*
 * Worklist split view (H4) Task 2: one triage decision and its undo, each in its own transaction. NOT "use server":
 * these take a user, so they must never be callable from the browser. The server actions (actions.ts) do the auth,
 * the rate check and the revalidation, and the bulk actions run these once per item.
 */

export type TriageInput = z.infer<typeof triageInputSchema>;
export type TriageDone = { tag: string; status: string; model: string; auditId: string };
export type TriageUndone = { id: string; tag: string; model: string; status: string };

/** One item's outcome in a bulk call: decided (with its audit id), or why not. */
export type BulkResult = { done: string[]; failed: Array<{ id: string; reason: string }>; auditIds: string[] };

/**
 * Thrown inside a `$transaction` callback to force a rollback of every write
 * made so far in that transaction. Prisma's interactive transactions only
 * roll back on a thrown exception — a plain `return` from the callback
 * commits whatever writes already happened. Caught just outside the
 * `$transaction` call and converted back into a `conflict()` result.
 */
class DirectRefusal extends Error {}

/**
 * Phase 40 (spec §8): a missing decision, or Dispose/Donate without a reason, was refused by the schema already.
 * Worklist H4: every asset write here stamps `updatedAt` with this decision's `now`, and the audit entry records it
 * as `version`, so an undo can tell the asset is exactly as the decision left it.
 */
export async function triageCore(user: SessionUser, d: TriageInput, now: Date = new Date()): Promise<ActionResult<TriageDone>> {
  let out: TriageDone | null = null;
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
        data: { returnedAt: null, updatedAt: now },
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
        // the asset's updatedAt this decision leaves (history.ts META_KEYS: never a row of its own)
        version: { from: null, to: now },
      };
      let auditId: string;
      if (d.outcome === asset.status) {
        // Keep as spare: only the flag moves (claimed above). No approval row — nothing about the
        // asset's lifecycle changed, so there is no decision to record as one.
        if (notes !== undefined) await tx.asset.update({ where: { id: asset.id }, data: { notes, updatedAt: now } });
        auditId = await writeAudit(tx, {
          actorId: user.id, actorLabel: user.name, entityType: "asset", entityId: asset.id,
          action: "lifecycle.triage", diff: { ...triageDiff, returnedAt: { from: asset.returnedAt, to: null } },
        });
      } else {
        const r = await recordDirect(tx, {
          actor: user, asset, now, type: "lifecycle_change_status", action: "lifecycle.triage",
          change: { kind: "change-status", status: d.outcome },
          payload: { from: { status: asset.status }, to: { status: d.outcome }, reason: d.note || "triage" },
          extraDiff: triageDiff,
          extraUpdates: { updatedAt: now, ...(notes !== undefined ? { notes } : {}) },
        });
        // the claim is already written: throw, so the rollback undoes it (a plain return would commit it)
        if (!r.ok) throw new DirectRefusal(r.error);
        auditId = r.auditId;
      }
      out = { tag: asset.tag, status: d.outcome, model: asset.model, auditId };
      return null;
    });
  } catch (err) {
    if (err instanceof DirectRefusal) return conflict(err.message);
    throw err;
  }
  if (failure) return failure;
  return ok(out!);
}

/** `SELECT … FOR UPDATE` on the asset's row, held until the transaction ends (the Finance undo's lock). */
async function lockAsset(tx: Prisma.TransactionClient, id: string): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "Asset" WHERE "id" = ${id} FOR UPDATE`;
}

const sameValue = (a: unknown, b: unknown) =>
  a instanceof Date || b instanceof Date ? (a as Date | null)?.valueOf() === (b as Date | null)?.valueOf() : a === b;

/**
 * Undo the person's own Keep as spare or Send to repair: within 15 minutes, and only while the asset is exactly as
 * the decision left it — its updatedAt still the decision's `version`, no later change recorded on it (a hold, an
 * assignment; a note or attachment doesn't count), no open request on it. Puts back each field the decision changed
 * from its audit entry's diff, then writes `lifecycle.triage.undone` naming that entry. Append-only: the decision's
 * entry and a repair's EXECUTED approval stay as they are.
 */
export async function undoTriageCore(user: SessionUser, auditId: string, now: Date = new Date()): Promise<ActionResult<TriageUndone>> {
  const original = await prisma.auditEntry.findUnique({
    where: { id: auditId },
    select: { id: true, actorId: true, entityType: true, entityId: true, action: true, diff: true, createdAt: true },
  });
  if (!original || original.entityType !== "asset" || original.action !== "lifecycle.triage") {
    return validationError({ auditId: "Unknown decision" });
  }
  if (original.actorId !== user.id || !undoWindowOpen(original.createdAt, now)) return conflict(TRIAGE_UNDO_NOT_YOURS);
  const outcome = triageOutcomeOf(original.diff);
  if (!outcome || !isUndoableTriage(outcome)) return conflict(TRIAGE_UNDO_FINAL);
  const version = triageVersion(original.diff);
  const changed = conflict(TRIAGE_CHANGED_SINCE);

  try {
    return await prisma.$transaction(async (tx): Promise<ActionResult<TriageUndone>> => {
      // Lock the row first: any other write to this asset waits behind the undo, so what is checked below stays true.
      await lockAsset(tx, original.entityId);
      const later = await tx.auditEntry.findMany({
        where: { entityType: "asset", entityId: original.entityId, createdAt: { gte: original.createdAt }, id: { not: original.id } },
        select: { action: true, diff: true },
      });
      if (later.some((e) => e.action === TRIAGE_UNDONE && undoneTarget(e.diff) === original.id)) return conflict(TRIAGE_ALREADY_UNDONE);
      const asset = await tx.asset.findUnique({
        where: { id: original.entityId }, select: { ...assetSelect, notes: true, updatedAt: true },
      });
      if (!asset) return changed;
      if (!isDirectLifecycle(user.role, asset.cls)) return forbidden();
      if (!version || asset.updatedAt.getTime() !== version.getTime()) return changed;
      if (later.some((e) => blocksTriageUndo(e.action))) return changed;
      if (await openApprovalForAsset(tx, asset.id)) return changed;

      const restore: TriageRestore = triageRestore(original.diff);
      const diff: AuditDiff = { triage: { from: TRIAGE_LABEL[outcome], to: null } };
      for (const key of Object.keys(restore) as Array<keyof TriageRestore>) {
        if (!sameValue(asset[key], restore[key])) diff[key] = { from: asset[key], to: restore[key] };
      }
      const noteChange = (original.diff as Record<string, { to?: unknown } | undefined> | null)?.note;
      const note = typeof noteChange?.to === "string" ? noteChange.to : null;
      const notes = note ? notesBefore(asset.notes, note) : undefined;
      if (note && notes !== undefined) diff.note = { from: note, to: null };
      diff.undoes = { from: null, to: original.id };

      const { status, ...dates } = restore;
      const hit = await tx.asset.updateMany({
        where: { id: asset.id, updatedAt: asset.updatedAt },
        data: {
          ...dates,
          ...(status ? { status: status as AssetStatus } : {}),
          ...(notes !== undefined ? { notes } : {}),
          updatedAt: now,
        },
      });
      if (hit.count === 0) return changed;
      await writeAudit(tx, {
        actorId: user.id, actorLabel: user.name, entityType: "asset", entityId: asset.id,
        action: "lifecycle.triage.undone", diff, source: "web",
      });
      return ok({ id: asset.id, tag: asset.tag, model: asset.model, status: status ?? asset.status });
    });
  } catch (err) {
    // the row lock met another change head-on: rolled back whole, nothing written
    if (isDeadlock(err)) return changed;
    throw err;
  }
}

/**
 * Worklist H4 bulk: one call per item, each in its own transaction (`run` opens it), so one refusal never touches
 * another item and nothing is left half-written. A deadlock fails that item alone; any other error is thrown.
 */
export async function eachAlone<T>(
  ids: readonly string[], run: (id: string) => Promise<ActionResult<T>>,
): Promise<{ done: string[]; failed: Array<{ id: string; reason: string }>; results: T[] }> {
  const done: string[] = [];
  const failed: Array<{ id: string; reason: string }> = [];
  const results: T[] = [];
  for (const id of [...new Set(ids)]) {
    let r: ActionResult<T>;
    try {
      r = await run(id);
    } catch (err) {
      if (!isDeadlock(err)) throw err;
      r = conflict(TRIAGE_CHANGED_SINCE);
    }
    if (r.ok) { done.push(id); results.push(r.data); } else failed.push({ id, reason: r.message });
  }
  return { done, failed, results };
}
