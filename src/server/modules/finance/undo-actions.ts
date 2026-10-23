"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { actionRole } from "@/server/auth/guards";
import { checkRate } from "@/server/rate-limit";
import { writeAudit } from "@/server/audit";
import { conflict, forbidden, ok, rateLimited, validationError, zodFieldErrors, type ActionResult } from "@/server/action-result";
import type { AuditDiff } from "@/lib/audit-diff";
import { cleanReason } from "@/lib/reason";
import {
  groupUndoCheck, REOPEN_REASON_MAX, REOPEN_REASON_MESSAGE, REOPEN_REASON_MIN, settingsRestore, undoCheck,
  UNDO_KINDS, UNDONE_ACTION, type UndoKind,
} from "@/lib/finance-undo";
import { lockPo } from "@/server/modules/purchases/po-lock";
import { undoOne, type ReturnTeam } from "./review-writes";
import { GROUP_ASSET_SELECT, lockGroupAssets, revalidateGroup, StaleGroupError } from "./group-shared";
import { correctionTeams, FINANCE_WORDS, notifyAssetsByTeam } from "./review-notify";

/*
 * Finance follow-up (spec §3): Undo for Finance's review actions, and the admin's Reopen review. Every rule runs here,
 * inside the transaction, from a fresh read of the asset and its audit trail (`undoCheck`); the asset page's banner
 * and the toast's timer are only hints. Audit stays append-only: an undo is a new entry, the original is untouched.
 *
 * 2026-10-23: the team that heard about the original hears about its undo, in the same transaction — a send-back
 * taken back tells the team it went to ("{tag}: Finance took back the send-back"); an approval of a corrected asset
 * undone or reopened tells the team that corrected it ("{tag}: Finance reopened its review"), after the "accepted" it
 * had. A notification is never deleted: the earlier one stays, and this one follows it.
 */

/** The team an asset was sent back to (one from before teams were recorded went to its class's team). */
const sentBackTeam = (a: { cls: string; financeReturnedTo: string | null }): ReturnTeam =>
  a.financeReturnedTo === "IT" || a.financeReturnedTo === "PURCHASING" ? a.financeReturnedTo : a.cls === "IT" ? "IT" : "PURCHASING";

const undoSchema = z.object({ assetId: z.string().min(1), kind: z.enum(UNDO_KINDS as [UndoKind, ...UndoKind[]]) });

const reopenSchema = z.object({
  assetId: z.string().min(1),
  reason: z.string().overwrite(cleanReason).min(REOPEN_REASON_MIN, REOPEN_REASON_MESSAGE).max(REOPEN_REASON_MAX, REOPEN_REASON_MESSAGE),
});

/** Enough of the asset's recent audit trail to find its latest finance change. */
const RECENT_ENTRIES = 50;

const ASSET_SELECT = {
  id: true, tag: true, cls: true, cost: true, purchaseRecordId: true,
  financeConfirmedAt: true, financeConfirmedById: true, financeNotCapitalised: true,
  financeReturnedAt: true, financeReturnedById: true, financeReturnedTo: true, financeReturnFields: true, financeResubmitNote: true,
  depreciationLifeMonths: true, depreciationSalvage: true, depreciationNote: true,
} as const;

const RACE = (tag: string) => `${tag} was changed by someone else just now. Reload and try again.`;

/** `SELECT … FOR UPDATE` on the asset's row, held until the transaction ends (no row: nothing locked, the read refuses). */
async function lockAsset(tx: Prisma.TransactionClient, id: string): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "Asset" WHERE "id" = ${id} FOR UPDATE`;
}

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
    // Lock the row first: any other write to this asset waits behind the undo, so what undoCheck reads stays true.
    await lockAsset(tx, assetId);
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

    if (kind !== "settings") {
      // Approve or send back: the shared per-asset undo (review-writes.ts), state-guarded like the action itself — the
      // one read above, by this person, is the one being undone. The group undo runs the same write per asset.
      const fixedBy = kind === "approve" ? (await correctionTeams(tx, [asset])).get(asset.id) : undefined;
      if (!(await undoOne(tx, asset, kind, original.diff, user))) {
        failure = conflict(RACE(asset.tag));
        return;
      }
      const team = kind === "send-back" ? sentBackTeam(asset) : fixedBy;
      if (team) {
        await notifyAssetsByTeam(
          tx, [{ team, id: asset.id, tag: asset.tag }],
          kind === "send-back" ? FINANCE_WORDS.tookBack : FINANCE_WORDS.reopened, user,
          { group: { entityType: "asset", entityId: asset.id } },
        );
      }
      out = { tag: asset.tag, id: asset.id };
      return;
    }
    const back = settingsRestore(original.diff)!; // undoCheck refused an entry without its earlier values
    if (back.lifeMonths !== null && (asset.cost === null || back.salvage! >= Number(asset.cost))) {
      failure = conflict(`Can't undo: the earlier salvage no longer fits ${asset.tag}'s cost.`);
      return;
    }
    const hit = await tx.asset.updateMany({
      where: {
        id: asset.id, depreciationLifeMonths: asset.depreciationLifeMonths, depreciationSalvage: asset.depreciationSalvage,
        depreciationNote: asset.depreciationNote,
      },
      data: { depreciationLifeMonths: back.lifeMonths, depreciationSalvage: back.salvage, depreciationNote: back.note },
    });
    const salvageNow = asset.depreciationSalvage === null ? null : Number(asset.depreciationSalvage);
    const diff: AuditDiff = {
      lifeMonths: { from: asset.depreciationLifeMonths, to: back.lifeMonths },
      salvage: { from: salvageNow, to: back.salvage },
      depreciationNote: { from: asset.depreciationNote, to: back.note },
    };
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
    await lockAsset(tx, assetId);
    const asset = await tx.asset.findUnique({
      where: { id: assetId },
      select: { id: true, tag: true, cls: true, financeConfirmedAt: true, financeNotCapitalised: true },
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
    // A corrected asset's review reopened: the team that corrected it heard "accepted"; now it hears this, and why.
    const fixedBy = (await correctionTeams(tx, [asset])).get(asset.id);
    if (fixedBy) {
      await notifyAssetsByTeam(
        tx, [{ team: fixedBy, id: asset.id, tag: asset.tag }], FINANCE_WORDS.reopened, user,
        { body: reason, group: { entityType: "asset", entityId: asset.id } },
      );
    }
    out = { tag: asset.tag, id: asset.id };
  });

  if (failure) return failure;
  revalidateAsset(assetId);
  return ok(out!);
}

// ---- a whole group (Task 6, spec §5) -------------------------------------------------------------------------------

const groupSchema = z.object({ recordId: z.string().min(1) });
const reopenGroupSchema = z.object({
  recordId: z.string().min(1),
  reason: z.string().overwrite(cleanReason).min(REOPEN_REASON_MIN, REOPEN_REASON_MESSAGE).max(REOPEN_REASON_MAX, REOPEN_REASON_MESSAGE),
});

/** Enough of a group's audit trail to find the person's latest group action and each asset's latest finance change. */
const GROUP_ENTRIES = 500;

/** The registration, and — a PO group — its PO row locked first, then the group's asset rows (the approve's order). */
async function lockGroup(tx: Prisma.TransactionClient, recordId: string) {
  const record = await tx.purchaseRecord.findUnique({ where: { id: recordId }, select: { id: true, purchaseOrderId: true } });
  if (!record) return null;
  let refNo: string | null = null;
  if (record.purchaseOrderId) {
    await lockPo(tx, record.purchaseOrderId);
    refNo = (await tx.purchaseOrder.findUnique({ where: { id: record.purchaseOrderId }, select: { refNo: true } }))?.refNo ?? null;
  }
  await lockGroupAssets(tx, recordId);
  const assets = await tx.asset.findMany({ where: { purchaseRecordId: recordId }, select: GROUP_ASSET_SELECT });
  return { poId: record.purchaseOrderId, refNo, assets };
}

/**
 * Undo the person's own latest Approve all on a group — its approvals and its hold-backs — as one action (spec §5): within
 * 15 minutes, and only while each asset's entry from it is still that asset's latest finance change (`groupUndoCheck`
 * runs `undoCheck` per asset). The first asset that fails refuses the whole undo, with its reason; nothing is written.
 * Each asset gets its own undone entry. A PO that the action completed keeps its `completedAt`: its webhooks have gone,
 * and approving again must not send them twice.
 */
export async function undoGroupAction(input: unknown): Promise<ActionResult<{ undone: number; refNo: string | null }>> {
  const user = await actionRole("admin", "finance_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = groupSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const { recordId } = parsed.data;

  type Out = { undone: number; refNo: string | null };
  let out: Out | null = null;
  let failure: ActionResult<Out> | null = null;
  let poId: string | null = null;
  let ids: string[] = [];

  try {
    await prisma.$transaction(async (tx) => {
      const group = await lockGroup(tx, recordId);
      if (!group) { failure = validationError({ recordId: "Unknown registration" }); return; }
      poId = group.poId;
      const entries = await tx.auditEntry.findMany({
        where: {
          OR: [
            { entityType: "asset", entityId: { in: group.assets.map((a) => a.id) } },
            { entityType: "purchase-record", entityId: recordId },
          ],
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: GROUP_ENTRIES,
        select: { id: true, actorId: true, actorLabel: true, entityType: true, entityId: true, action: true, diff: true, createdAt: true },
      });
      const check = groupUndoCheck(recordId, group.assets, entries, user.id, new Date());
      if (!check.ok) { failure = conflict(check.reason); return; }

      const meta = { group: { from: null, to: recordId } };
      const undone = check.items.map((item) => ({ item, asset: group.assets.find((a) => a.id === item.assetId)! }));
      const fixedBy = await correctionTeams(tx, undone.filter((u) => u.item.kind === "approve").map((u) => u.asset));
      for (const { item, asset } of undone) {
        if (item.kind === "settings") throw new StaleGroupError(asset.tag); // a group action never changes settings
        if (!(await undoOne(tx, asset, item.kind, item.entry.diff, user, meta))) throw new StaleGroupError(asset.tag);
      }
      // Every undo landed: the teams that heard of the hold-backs and the accepted corrections hear they were taken back.
      const about = { group: { entityType: "purchase-record", entityId: recordId } };
      await notifyAssetsByTeam(
        tx,
        undone.filter((u) => u.item.kind === "send-back").map((u) => ({ team: sentBackTeam(u.asset), id: u.asset.id, tag: u.asset.tag })),
        FINANCE_WORDS.tookBack, user, about,
      );
      await notifyAssetsByTeam(
        tx,
        undone.filter((u) => fixedBy.has(u.asset.id)).map((u) => ({ team: fixedBy.get(u.asset.id)!, id: u.asset.id, tag: u.asset.tag })),
        FINANCE_WORDS.reopened, user, about,
      );
      ids = check.items.map((i) => i.assetId);
      out = { undone: check.items.length, refNo: group.refNo };
    });
  } catch (err) {
    if (err instanceof StaleGroupError) return conflict(RACE(err.tag));
    throw err;
  }

  if (failure) return failure;
  revalidateGroup(recordId, ids, poId);
  revalidatePath("/inventory");
  return ok(out!);
}

/**
 * An admin reopens every approved asset of a group at once (spec §5, "also available for a whole group"), with a
 * reason, at any time: each goes back to To review with its own `finance.confirm.reopened` entry, as the per-asset
 * Reopen review writes.
 */
export async function reopenGroup(input: unknown): Promise<ActionResult<{ reopened: number; refNo: string | null }>> {
  const user = await actionRole("admin");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = reopenGroupSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const { recordId, reason } = parsed.data;

  type Out = { reopened: number; refNo: string | null };
  let out: Out | null = null;
  let failure: ActionResult<Out> | null = null;
  let poId: string | null = null;
  let ids: string[] = [];

  try {
    await prisma.$transaction(async (tx) => {
      const group = await lockGroup(tx, recordId);
      if (!group) { failure = validationError({ recordId: "Unknown registration" }); return; }
      poId = group.poId;
      const approved = group.assets.filter((a) => a.financeConfirmedAt !== null);
      if (approved.length === 0) { failure = conflict("Nothing in this group is approved, so there is no review to reopen."); return; }
      for (const a of approved) {
        const hit = await tx.asset.updateMany({
          where: { id: a.id, financeConfirmedAt: { not: null } },
          data: { financeConfirmedAt: null, financeConfirmedById: null, financeNotCapitalised: false },
        });
        if (hit.count === 0) throw new StaleGroupError(a.tag);
        await writeAudit(tx, {
          actorId: user.id, actorLabel: user.name, entityType: "asset", entityId: a.id,
          action: "finance.confirm.reopened",
          diff: {
            review: { from: "Approved", to: "To review" },
            ...(a.financeNotCapitalised ? { notCapitalised: { from: true, to: false } } : {}),
            group: { from: null, to: recordId },
          },
          reason, source: "web",
        });
      }
      // The corrected ones: their teams heard "accepted", so they hear this, with the reason.
      const fixedBy = await correctionTeams(tx, approved);
      await notifyAssetsByTeam(
        tx,
        approved.filter((a) => fixedBy.has(a.id)).map((a) => ({ team: fixedBy.get(a.id)!, id: a.id, tag: a.tag })),
        FINANCE_WORDS.reopened, user, { body: reason, group: { entityType: "purchase-record", entityId: recordId } },
      );
      ids = approved.map((a) => a.id);
      out = { reopened: approved.length, refNo: group.refNo };
    });
  } catch (err) {
    if (err instanceof StaleGroupError) return conflict(RACE(err.tag));
    throw err;
  }

  if (failure) return failure;
  revalidateGroup(recordId, ids, poId);
  revalidatePath("/inventory");
  return ok(out!);
}
