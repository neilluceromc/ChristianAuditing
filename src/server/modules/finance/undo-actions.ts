"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { actionRole } from "@/server/auth/guards";
import { checkRate } from "@/server/rate-limit";
import { writeAudit } from "@/server/audit";
import { conflict, forbidden, ok, rateLimited, validationError, zodFieldErrors, type ActionResult } from "@/server/action-result";
import type { AuditDiff } from "@/lib/audit-diff";
import { cleanReason } from "@/lib/reason";
import { fieldLabels } from "@/lib/registration";
import {
  approveRestore, REOPEN_REASON_MAX, REOPEN_REASON_MESSAGE, REOPEN_REASON_MIN, sendBackRestore, settingsRestore, undoCheck,
  UNDO_KINDS, UNDONE_ACTION, type UndoKind,
} from "@/lib/finance-undo";

/*
 * Finance follow-up (spec §3): Undo for Finance's review actions, and the admin's Reopen review. Every rule runs here,
 * inside the transaction, from a fresh read of the asset and its audit trail (`undoCheck`); the asset page's banner
 * and the toast's timer are only hints. Audit stays append-only: an undo is a new entry, the original is untouched.
 */

const undoSchema = z.object({ assetId: z.string().min(1), kind: z.enum(UNDO_KINDS as [UndoKind, ...UndoKind[]]) });

const reopenSchema = z.object({
  assetId: z.string().min(1),
  reason: z.string().overwrite(cleanReason).min(REOPEN_REASON_MIN, REOPEN_REASON_MESSAGE).max(REOPEN_REASON_MAX, REOPEN_REASON_MESSAGE),
});

/** Enough of the asset's recent audit trail to find its latest finance change. */
const RECENT_ENTRIES = 50;

const ASSET_SELECT = {
  id: true, tag: true, cost: true, purchaseRecordId: true,
  financeConfirmedAt: true, financeConfirmedById: true, financeNotCapitalised: true,
  financeReturnedAt: true, financeReturnedById: true, financeReturnFields: true, financeResubmitNote: true,
  depreciationLifeMonths: true, depreciationSalvage: true, depreciationNote: true,
} as const;

const RACE = (tag: string) => `${tag} was changed by someone else just now. Reload and try again.`;

function revalidateAsset(id: string, settings = false) {
  revalidatePath(`/inventory/${id}`);
  revalidatePath("/inventory");
  revalidatePath("/finance/assets");
  revalidatePath(`/finance/assets/${id}`);
  if (settings) revalidatePath("/finance/depreciation");
}

/**
 * Undo the person's own approve, approve as not capitalised, send back or depreciation settings change: within 15
 * minutes, and only while it is still the latest finance change on the asset. Puts back exactly what the action
 * changed, from the original entry's diff, then writes the undone entry.
 */
export async function undoFinanceAction(input: unknown): Promise<ActionResult<{ tag: string; id: string }>> {
  const user = await actionRole("admin", "finance_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = undoSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const { assetId, kind } = parsed.data;

  let out: { tag: string; id: string } | null = null;
  let failure: ActionResult<{ tag: string; id: string }> | null = null;

  await prisma.$transaction(async (tx) => {
    const asset = await tx.asset.findUnique({ where: { id: assetId }, select: ASSET_SELECT });
    if (!asset) {
      failure = validationError({ assetId: "Unknown asset" });
      return;
    }
    const entries = await tx.auditEntry.findMany({
      where: {
        OR: [
          { entityType: "asset", entityId: asset.id },
          ...(asset.purchaseRecordId ? [{ entityType: "purchase-record", entityId: asset.purchaseRecordId }] : []),
        ],
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: RECENT_ENTRIES,
      select: { id: true, actorId: true, actorLabel: true, entityType: true, entityId: true, action: true, diff: true, createdAt: true },
    });
    const check = undoCheck(asset, entries, user.id, new Date(), kind);
    if (!check.ok) {
      failure = conflict(check.reason);
      return;
    }
    const original = check.entry;

    let diff: AuditDiff;
    let hit: { count: number };
    if (kind === "approve") {
      const back = approveRestore(original.diff);
      // State-guarded like the approval itself: the approval read above, by this person, is the one being undone.
      hit = await tx.asset.updateMany({
        where: { id: asset.id, financeConfirmedAt: asset.financeConfirmedAt, financeConfirmedById: user.id, financeReturnedAt: null },
        data: {
          financeConfirmedAt: null, financeConfirmedById: null,
          financeNotCapitalised: back.notCapitalised, financeResubmitNote: back.resubmitNote,
        },
      });
      diff = {
        financeConfirmed: { from: user.name, to: null },
        review: { from: "Approved", to: "To review" },
        ...(asset.financeNotCapitalised !== back.notCapitalised
          ? { notCapitalised: { from: asset.financeNotCapitalised, to: back.notCapitalised } } : {}),
      };
    } else if (kind === "send-back") {
      const back = sendBackRestore(original.diff);
      hit = await tx.asset.updateMany({
        where: { id: asset.id, financeConfirmedAt: null, financeReturnedAt: asset.financeReturnedAt, financeReturnedById: user.id },
        data: {
          financeReturnedAt: null, financeReturnedById: null, financeReturnReason: null, financeReturnFields: [],
          financeResubmitNote: back.resubmitNote,
        },
      });
      diff = {
        review: { from: "Sent back", to: "To review" },
        flagged: { from: fieldLabels(asset.financeReturnFields), to: null },
      };
    } else {
      const back = settingsRestore(original.diff)!; // undoCheck refused an entry without its earlier values
      if (back.lifeMonths !== null && (asset.cost === null || back.salvage! >= Number(asset.cost))) {
        failure = conflict(`Can't undo: the earlier salvage no longer fits ${asset.tag}'s cost.`);
        return;
      }
      hit = await tx.asset.updateMany({
        where: {
          id: asset.id, depreciationLifeMonths: asset.depreciationLifeMonths, depreciationSalvage: asset.depreciationSalvage,
          depreciationNote: asset.depreciationNote,
        },
        data: { depreciationLifeMonths: back.lifeMonths, depreciationSalvage: back.salvage, depreciationNote: back.note },
      });
      const salvageNow = asset.depreciationSalvage === null ? null : Number(asset.depreciationSalvage);
      diff = {
        lifeMonths: { from: asset.depreciationLifeMonths, to: back.lifeMonths },
        salvage: { from: salvageNow, to: back.salvage },
        depreciationNote: { from: asset.depreciationNote, to: back.note },
      };
    }
    if (hit.count === 0) {
      failure = conflict(RACE(asset.tag));
      return;
    }
    await writeAudit(tx, {
      actorId: user.id, actorLabel: user.name, entityType: "asset", entityId: asset.id,
      action: UNDONE_ACTION[kind], diff, source: "web",
    });
    out = { tag: asset.tag, id: asset.id };
  });

  if (failure) return failure;
  revalidateAsset(assetId, kind === "settings");
  return ok(out!);
}

/**
 * An admin reopens an approved review at any time, with a reason: the approval is cleared and the asset goes back
 * to To review. Not an undo, so not time-limited and not tied to who approved it.
 */
export async function reopenFinanceReview(input: unknown): Promise<ActionResult<{ tag: string; id: string }>> {
  const user = await actionRole("admin");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = reopenSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const { assetId, reason } = parsed.data;

  let out: { tag: string; id: string } | null = null;
  let failure: ActionResult<{ tag: string; id: string }> | null = null;

  await prisma.$transaction(async (tx) => {
    const asset = await tx.asset.findUnique({
      where: { id: assetId },
      select: { id: true, tag: true, financeConfirmedAt: true, financeNotCapitalised: true },
    });
    if (!asset) {
      failure = validationError({ assetId: "Unknown asset" });
      return;
    }
    if (!asset.financeConfirmedAt) {
      failure = conflict(`${asset.tag} isn't approved, so there is no review to reopen.`);
      return;
    }
    const hit = await tx.asset.updateMany({
      where: { id: asset.id, financeConfirmedAt: { not: null } },
      data: { financeConfirmedAt: null, financeConfirmedById: null, financeNotCapitalised: false },
    });
    if (hit.count === 0) {
      failure = conflict(RACE(asset.tag));
      return;
    }
    await writeAudit(tx, {
      actorId: user.id, actorLabel: user.name, entityType: "asset", entityId: asset.id,
      action: "finance.confirm.reopened",
      diff: {
        review: { from: "Approved", to: "To review" },
        ...(asset.financeNotCapitalised ? { notCapitalised: { from: true, to: false } } : {}),
      },
      reason, source: "web",
    });
    out = { tag: asset.tag, id: asset.id };
  });

  if (failure) return failure;
  revalidateAsset(assetId);
  return ok(out!);
}
