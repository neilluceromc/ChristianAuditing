import type { AssetClass, Prisma, Role, Team } from "@prisma/client";
import { writeAudit } from "@/server/audit";
import type { AuditDiff } from "@/lib/audit-diff";
import { isAwaitingItCheck } from "@/lib/asset-class";
import { isMoneyKey, returnTeamFor } from "@/lib/intake-rules";
import { fieldLabels, REGISTRATION_FIELDS, type RegFieldKey } from "@/lib/registration";
import { approveRestore, sendBackRestore, UNDONE_ACTION, type UndoKind } from "@/lib/finance-undo";

/*
 * Task 6 (spec §5): Finance's per-asset review writes — approve, send back, and the undo of either — shared by the
 * single-asset actions (inventory/actions.ts, undo-actions.ts) and the group ones (group-actions.ts). Every write is
 * state-guarded and returns whether it landed; the caller decides what a miss means (a conflict, or a rollback).
 * A plain module, not "use server": these take a transaction client, which must never be a network-reachable action.
 */

export type Actor = { id: string; name: string };
export type ReturnTeam = "IT" | "PURCHASING";
export const TEAM_NAME: Record<Team, string> = { IT: "IT", PURCHASING: "Purchasing", FINANCE: "Finance" };

// ---- approve -------------------------------------------------------------------------------------------------------

export interface ApproveFacts {
  id: string;
  tag: string;
  cls: AssetClass;
  itVerifiedAt: Date | null;
  cost: unknown;
  financeConfirmedAt: Date | null;
  financeReturnedAt: Date | null;
  financeReturnedTo?: Team | null;
  financeNotCapitalised: boolean;
  financeResubmitNote: string | null;
}

const classTeam = (cls: AssetClass): ReturnTeam => (cls === "IT" ? "IT" : "PURCHASING");

/** Why Finance can't approve this asset now (as capitalised, or as not capitalised), or null. */
export function approveRefusal(a: ApproveFacts, notCapitalised: boolean): string | null {
  if (a.financeConfirmedAt) return `${a.tag} was already confirmed.`;
  if (isAwaitingItCheck(a)) return `${a.tag} is waiting for IT's check — Finance confirms after IT.`;
  if (a.financeReturnedAt) {
    const team = TEAM_NAME[a.financeReturnedTo ?? classTeam(a.cls)];
    return `${a.tag} is waiting for ${team} to correct it — Finance reviews it when it comes back.`;
  }
  if (notCapitalised && a.cost !== null) return `${a.tag} has a cost, so it is approved as capitalised — use Approve.`;
  if (!notCapitalised && a.cost === null) return `${a.tag} has no cost. Send it back for the cost, or approve it as not capitalised.`;
  return null;
}

/**
 * Approve one asset: the state-guarded write (still unapproved, not returned, the cost as the flag expects) and its
 * `finance.confirm` entry, whose diff records what an undo puts back. `meta` rides in the diff (the group action's
 * `group` and `batch`). False when the guard missed: nothing was written.
 */
export async function approveOne(
  tx: Prisma.TransactionClient,
  asset: ApproveFacts,
  user: Actor,
  notCapitalised: boolean,
  meta: AuditDiff = {},
): Promise<boolean> {
  const hit = await tx.asset.updateMany({
    where: { id: asset.id, financeConfirmedAt: null, financeReturnedAt: null, cost: notCapitalised ? null : { not: null } },
    data: {
      financeConfirmedAt: new Date(),
      financeConfirmedById: user.id,
      financeNotCapitalised: notCapitalised,
      financeReturnFields: [],
      financeResubmitNote: null,
      // Clearing the return here is what makes "confirmed AND returned" unreachable, so the pill's three states stay
      // mutually exclusive.
      financeReturnedAt: null,
      financeReturnedById: null,
      financeReturnReason: null,
      financeReturnedTo: null,
    },
  });
  if (hit.count === 0) return false;
  await writeAudit(tx, {
    actorId: user.id, actorLabel: user.name, entityType: "asset", entityId: asset.id, action: "finance.confirm",
    // The earlier values an undo puts back (finance-undo.ts): the not-capitalised flag before and after when either
    // side is true (no key means false both sides, so a plain approval shows no "No → No" chip), and IT's reply the
    // approval cleared.
    diff: {
      financeConfirmed: { from: null, to: user.name },
      ...(notCapitalised || asset.financeNotCapitalised ? { notCapitalised: { from: asset.financeNotCapitalised, to: notCapitalised } } : {}),
      ...(asset.financeResubmitNote ? { resubmitNote: { from: asset.financeResubmitNote, to: null } } : {}),
      ...meta,
    },
    source: "web",
  });
  return true;
}

// ---- send back -----------------------------------------------------------------------------------------------------

/** Who registered the asset's batch and the PO it came from: what decides which team a field goes back to. */
export interface ReturnContext {
  cls: AssetClass;
  refNo: string | null;
  registeredByRole: Role | null;
}

const label = (key: string) => REGISTRATION_FIELDS.find((f) => f.key === key)?.label ?? key;

/**
 * Why these fields can't go back to `team`, as `{ field: message }`, or null. Each field must be `team`'s to fix
 * (`returnTeamFor`); "Other" goes wherever Finance picks. A money field on an asset from a PO is the PO's: Finance sends
 * the PO back instead (sendBackPurchaseOrder), so every asset from it stays on one SI number.
 */
export function returnRefusal(fields: readonly RegFieldKey[], team: ReturnTeam, ctx: ReturnContext): Record<string, string> | null {
  const hasPo = ctx.refNo !== null;
  for (const f of fields) {
    if (f === "other") continue;
    if (hasPo && isMoneyKey(f)) return { fields: `Send ${ctx.refNo} back instead` };
  }
  for (const f of fields) {
    if (f === "other") continue;
    const to = returnTeamFor(f, ctx.cls, { hasPo, registeredByRole: ctx.registeredByRole });
    if (to !== team) return { team: `${label(f)} goes back to ${TEAM_NAME[to]}` };
  }
  return null;
}

/** The team a field goes back to by default, for the hold-back picker (Other: the class's team). */
export function defaultReturnTeam(fields: readonly RegFieldKey[], ctx: ReturnContext): ReturnTeam {
  const f = fields.find((x) => x !== "other");
  return f ? returnTeamFor(f, ctx.cls, { hasPo: ctx.refNo !== null, registeredByRole: ctx.registeredByRole }) : classTeam(ctx.cls);
}

export interface ReturnFacts {
  id: string;
  tag: string;
  financeReturnedAt: Date | null;
  financeResubmitNote: string | null;
}

/**
 * Send one unapproved asset back to `team` with the ticked fields and the note, and write its `finance.return` entry:
 * the checklist (as labels), the note and the team, plus what an undo needs (`from`: whether it replaced an earlier
 * send-back; `resubmitNote`: the reply it cleared). `meta` rides in the diff (a group's `group` and `batch`, a PO
 * send-back's `po`). False when the asset was approved in between: nothing was written.
 */
export async function returnOne(
  tx: Prisma.TransactionClient,
  asset: ReturnFacts,
  user: Actor,
  r: { team: ReturnTeam; fields: readonly string[]; note: string | null; labels?: string[] },
  meta: AuditDiff = {},
): Promise<boolean> {
  const hit = await tx.asset.updateMany({
    where: { id: asset.id, financeConfirmedAt: null },
    data: {
      financeReturnedAt: new Date(),
      financeReturnedById: user.id,
      financeReturnedTo: r.team,
      financeReturnReason: r.note,
      financeReturnFields: [...r.fields],
      financeResubmitNote: null,
    },
  });
  if (hit.count === 0) return false;
  await writeAudit(tx, {
    actorId: user.id, actorLabel: user.name, entityType: "asset", entityId: asset.id, action: "finance.return",
    diff: {
      financeReturn: {
        from: asset.financeReturnedAt ? "returned" : null,
        to: { fields: r.labels ?? fieldLabels(r.fields), note: r.note, team: r.team },
      },
      ...(asset.financeResubmitNote ? { resubmitNote: { from: asset.financeResubmitNote, to: null } } : {}),
      ...meta,
    },
    reason: r.note, source: "web",
  });
  return true;
}

// ---- undo ----------------------------------------------------------------------------------------------------------

export interface UndoFacts {
  id: string;
  tag: string;
  financeConfirmedAt: Date | null;
  financeNotCapitalised: boolean;
  financeReturnedAt: Date | null;
  financeReturnFields: string[];
}

/**
 * Undo one approval or send-back by `user` (undoCheck already allowed it): put back what the original entry's diff
 * recorded, state-guarded on the values just read, and write the undone entry. False when the guard missed.
 */
export async function undoOne(
  tx: Prisma.TransactionClient,
  asset: UndoFacts,
  kind: Exclude<UndoKind, "settings">,
  originalDiff: unknown,
  user: Actor,
  meta: AuditDiff = {},
): Promise<boolean> {
  let diff: AuditDiff;
  let hit: { count: number };
  if (kind === "approve") {
    const back = approveRestore(originalDiff);
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
  } else {
    const back = sendBackRestore(originalDiff);
    hit = await tx.asset.updateMany({
      where: { id: asset.id, financeConfirmedAt: null, financeReturnedAt: asset.financeReturnedAt, financeReturnedById: user.id },
      data: {
        financeReturnedAt: null, financeReturnedById: null, financeReturnedTo: null, financeReturnReason: null,
        financeReturnFields: [], financeResubmitNote: back.resubmitNote,
      },
    });
    diff = {
      review: { from: "Sent back", to: "To review" },
      flagged: { from: fieldLabels(asset.financeReturnFields), to: null },
    };
  }
  if (hit.count === 0) return false;
  await writeAudit(tx, {
    actorId: user.id, actorLabel: user.name, entityType: "asset", entityId: asset.id,
    action: UNDONE_ACTION[kind], diff: { ...diff, ...meta }, source: "web",
  });
  return true;
}
