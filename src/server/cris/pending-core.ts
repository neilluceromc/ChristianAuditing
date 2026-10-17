import { Prisma, type ApprovalType, type AssetStatus } from "@prisma/client";
import { prisma } from "@/server/db/client";
import type { SessionUser } from "@/server/auth/guards";
import { writeAudit } from "@/server/audit";
import { emitWebhook } from "@/server/webhooks/emit";
import { createApproval } from "@/server/modules/approvals/create";
import { conflict, forbidden, ok, validationError, zodFieldErrors, type ActionResult } from "@/server/action-result";
import {
  assignCore, assignSchema, loadDirect, replaceCore, replaceSchema, type AssignInput, type LifecycleOpts, type ReplaceInput,
} from "@/server/modules/lifecycle/direct";
import { prepareLifecycle } from "@/server/modules/lifecycle/apply";
import type { AuditDiff } from "@/lib/audit-diff";
import {
  CRIS_RETURN_OUTCOMES, cardFromSnapshot, type ConfirmCard, type CrisReturnOutcome, type CrisViewMessage, type ResultCard,
} from "@/lib/cris-cards";
import {
  CRIS_ALREADY_DONE, CRIS_CHANGED_SINCE, CRIS_EXPIRED, PENDING_TTL_MS, parseResultRef, undoEligible, undoUntil,
  type AssetBefore, type ResultRef,
} from "@/lib/cris-undo";
import { readAsset, readPerson, sparesCard } from "./cards";
import { appendCrisMessage, viewMessages } from "./messages";

/*
 * Spec §6.1, §6.2, §6.4: pending actions, Confirm and Undo. NOT "use server" — everything here takes a user (and
 * createPending a transaction) the caller has already authenticated; the public actions are in ./pending.ts.
 */

type Tx = Prisma.TransactionClient;
export type PendingKind = "assign" | "replace";
type Parsed = { kind: "assign"; d: AssignInput } | { kind: "replace"; d: ReplaceInput };

/**
 * What Cris may assign with: the spare, the person and a reason — the fields the Confirm card shows. `status` and
 * `loanDueAt` are refused (strict), so a Cris assign is always the class's default status; loans stay a screen job
 * in v1 and nothing the card leaves out can reach the record.
 */
const crisAssignSchema = assignSchema.pick({ assetId: true, employeeId: true, reason: true }).strict();

/**
 * The stored or proposed input, re-validated with the lifecycle action's own schema (the cores do not re-check
 * their input). A replace may only propose Defective, Back for triage or Missing — Buyout stays a manual decision.
 */
function parseInput(kind: string, input: unknown): { ok: true; p: Parsed } | { ok: false; failure: ActionResult<never> } {
  if (kind === "assign") {
    const r = crisAssignSchema.safeParse(input);
    return r.success ? { ok: true, p: { kind, d: r.data } } : { ok: false, failure: validationError(zodFieldErrors(r.error)) };
  }
  if (kind === "replace") {
    const r = replaceSchema.safeParse(input);
    if (!r.success) return { ok: false, failure: validationError(zodFieldErrors(r.error)) };
    if (!(CRIS_RETURN_OUTCOMES as readonly string[]).includes(r.data.outcome)) {
      return { ok: false, failure: validationError({ outcome: "Cris records Defective, Back for triage or Missing — record a buyout from the profile." }) };
    }
    return { ok: true, p: { kind, d: r.data } };
  }
  return { ok: false, failure: validationError({ kind: "Cris can assign or replace only." }) };
}

/** The spare the person gets, and (a replace) the item they give back. */
function assetsOf(p: Parsed): { gets: string; returns: string | null } {
  return p.kind === "assign" ? { gets: p.d.assetId, returns: null } : { gets: p.d.newAssetId, returns: p.d.oldAssetId };
}

type CoreOut = { kind: "assign"; tag: string } | { kind: "replace"; oldTag: string; newTag: string };

async function runCore(tx: Tx, user: SessionUser, p: Parsed, opts: LifecycleOpts): Promise<ActionResult<CoreOut>> {
  if (p.kind === "assign") {
    const r = await assignCore(tx, user, p.d, opts);
    return r.ok ? ok({ kind: "assign", tag: r.data.tag }) : r;
  }
  const r = await replaceCore(tx, user, p.d, opts);
  return r.ok ? ok({ kind: "replace", oldTag: r.data.oldTag, newTag: r.data.newTag }) : r;
}

/** A refusal thrown inside a transaction so it rolls back every write so far (a plain return would commit them). */
class Refusal extends Error {
  constructor(readonly result: ActionResult<never>) { super(result.ok ? "refused" : result.message); }
}
/** The lifecycle core refused at Confirm: rolled back like Refusal, then posted in the box with the spares left. */
class CoreRefusal extends Refusal {}

const refuse = (message: string): CrisOutcome<never> => ({ result: conflict(message), affected: null });

// ── createPending ───────────────────────────────────────────────────────────

/**
 * Spec §6.1: a propose tool's proposal, validated as a dry run of the real action (every read and guard, no
 * write), then stored as a pending action for 10 minutes. The Confirm card is built from DB reads by id —
 * never from the model's words. `scanned` is whether the person scanned the spare's label.
 */
export async function createPending(
  tx: Tx, user: SessionUser, conversationId: string, kind: PendingKind, input: unknown, meta: { scanned?: boolean } = {},
): Promise<ActionResult<{ card: ConfirmCard }>> {
  const parsed = parseInput(kind, input);
  if (!parsed.ok) return parsed.failure;
  const p = parsed.p;
  const dry = await runCore(tx, user, p, { dryRun: true });
  if (!dry.ok) return dry;

  const ids = assetsOf(p);
  const person = await readPerson(tx, p.d.employeeId);
  const gets = await readAsset(tx, ids.gets);
  const back = ids.returns ? await readAsset(tx, ids.returns) : null;
  if (!person || !gets || (ids.returns && !back)) return conflict("That asset no longer exists.");

  const row = await tx.crisPendingAction.create({
    data: {
      userId: user.id, conversationId, kind: p.kind, input: p.d as Prisma.InputJsonObject, card: {},
      expiresAt: new Date(Date.now() + PENDING_TTL_MS),
    },
    select: { id: true },
  });
  // The card shows exactly what Confirm records: an assign's reason when one was given (otherwise the record's
  // generic "assigned"), and for the item taken back the given reason or replaceCore's "replaced by {tag}".
  const card = cardFromSnapshot({
    pendingId: row.id, kind: p.kind, person, gets, scanned: meta.scanned === true,
    ...(p.kind === "assign" && p.d.reason ? { reason: p.d.reason } : {}),
    ...(p.kind === "replace" && back
      ? { returns: { id: back.id, tag: back.tag, outcome: p.d.outcome as CrisReturnOutcome, reason: p.d.reason || `replaced by ${gets.tag}` } }
      : {}),
  });
  await tx.crisPendingAction.update({ where: { id: row.id }, data: { card } });
  return ok({ card });
}

// ── Confirm ─────────────────────────────────────────────────────────────────

export type CrisActionData = { messages: CrisViewMessage[]; refused?: true };
/** What a committed change made stale: the public action revalidates these after commit. */
export type Affected = { assetIds: string[]; employeeId: string };
export type CrisOutcome<T = CrisActionData> = { result: ActionResult<T>; affected: Affected | null };

const BEFORE_SELECT = { status: true, assigneeId: true, loanDueAt: true, returnedAt: true, defectiveSince: true, repairEndedAt: true } as const;
const isoOrNull = (d: Date | null) => d?.toISOString() ?? null;

async function beforeOf(tx: Tx, assetId: string): Promise<AssetBefore | null> {
  const a = await tx.asset.findUnique({ where: { id: assetId }, select: BEFORE_SELECT });
  if (!a) return null;
  return {
    status: a.status, assigneeId: a.assigneeId, loanDueAt: isoOrNull(a.loanDueAt), returnedAt: isoOrNull(a.returnedAt),
    defectiveSince: isoOrNull(a.defectiveSince), repairEndedAt: isoOrNull(a.repairEndedAt),
  };
}

/**
 * The audit entry this Confirm just wrote on each asset: the newest Cris-made `action` entry by this person on it.
 * The core's asset write holds the row lock until commit, so no other lifecycle entry on it can land in between.
 */
async function ownAuditIds(tx: Tx, user: SessionUser, assetIds: string[], action: string): Promise<string[]> {
  const ids: string[] = [];
  for (const entityId of assetIds) {
    const e = await tx.auditEntry.findFirst({
      where: { entityType: "asset", entityId, actorId: user.id, action, diff: { path: ["via", "to"], equals: "Cris" } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true },
    });
    if (e) ids.push(e.id);
  }
  return ids;
}

const OUTCOME_PHRASE: Record<CrisReturnOutcome, string> = {
  TRIAGE: "is back for triage", DEFECTIVE: "is marked Defective", MISSING: "is marked Missing",
};

async function conversationExists(tx: Tx, id: string): Promise<boolean> {
  return (await tx.crisConversation.count({ where: { id } })) > 0;
}

/**
 * Spec §6.2. Owner → not used → not expired, then one transaction: the state-guarded claim (of two presses,
 * the second finds `usedAt` set and is refused — Review Focus #2), the real action with `via: "Cris"`, and the
 * result card. A refusal from the action rolls the claim back and is posted in the action's own words, with the
 * spares still pickable when it is about the picked spare (Review Focus #3).
 */
export async function confirmPending(user: SessionUser, pendingId: string, now: Date = new Date()): Promise<CrisOutcome> {
  const pending = await prisma.crisPendingAction.findUnique({ where: { id: pendingId } });
  if (!pending || pending.userId !== user.id) return { result: forbidden(), affected: null };
  if (pending.usedAt) return refuse(CRIS_ALREADY_DONE);
  if (pending.expiresAt.getTime() <= now.getTime()) return refuse(CRIS_EXPIRED);
  const parsed = parseInput(pending.kind, pending.input);
  if (!parsed.ok) return { result: parsed.failure, affected: null };
  const p = parsed.p;
  const ids = assetsOf(p);
  const employeeId = p.d.employeeId;
  const assetIds = ids.returns ? [ids.gets, ids.returns] : [ids.gets];

  try {
    const messages = await prisma.$transaction(async (tx) => {
      const claim = await tx.crisPendingAction.updateMany({ where: { id: pending.id, usedAt: null }, data: { usedAt: now } });
      if (claim.count === 0) throw new Refusal(conflict(CRIS_ALREADY_DONE));

      const getsBefore = await beforeOf(tx, ids.gets);
      const returnsBefore = ids.returns ? await beforeOf(tx, ids.returns) : null;
      const hold = await tx.reservation.findFirst({ where: { assetId: ids.gets, employeeId, state: "ACTIVE" }, select: { id: true } });

      const r = await runCore(tx, user, p, { via: "Cris" });
      // the claim is already written: throw, so the rollback undoes it
      if (!r.ok) throw new CoreRefusal(r);
      if (!getsBefore || (ids.returns && !returnsBefore)) throw new Refusal(conflict("That asset no longer exists."));

      const after = await tx.asset.findMany({ where: { id: { in: assetIds } }, select: { id: true, status: true } });
      const afterStatus = (id: string) => after.find((a) => a.id === id)?.status ?? "";
      const fulfilled = hold ? await tx.reservation.findUnique({ where: { id: hold.id }, select: { state: true } }) : null;
      const ref: ResultRef = {
        employeeId,
        auditIds: await ownAuditIds(tx, user, assetIds, p.kind === "assign" ? "lifecycle.assign" : "lifecycle.replace"),
        holdId: hold && fulfilled?.state === "FULFILLED" ? hold.id : null,
        assets: [
          { id: ids.gets, role: "gets", afterStatus: afterStatus(ids.gets), before: getsBefore },
          ...(ids.returns && returnsBefore
            ? [{ id: ids.returns, role: "returns" as const, afterStatus: afterStatus(ids.returns), before: returnsBefore }]
            : []),
        ],
      };
      await tx.crisPendingAction.update({ where: { id: pending.id }, data: { resultRef: JSON.stringify(ref) } });

      const person = await readPerson(tx, employeeId);
      const name = person?.name ?? "The person";
      const card: ResultCard = r.data.kind === "assign"
        ? { type: "result", pendingId: pending.id, employeeId, head: "Assigned.", text: `${r.data.tag} is with ${name} now.`, undoUntil: undoUntil(now).toISOString() }
        : {
            type: "result", pendingId: pending.id, employeeId, head: "Replaced.",
            text: `${name} has ${r.data.newTag} now; ${r.data.oldTag} ${OUTCOME_PHRASE[(p.d as ReplaceInput).outcome as CrisReturnOutcome]}.`,
            undoUntil: undoUntil(now).toISOString(),
          };
      if (!(await conversationExists(tx, pending.conversationId))) return [];
      return viewMessages([await appendCrisMessage(tx, pending.conversationId, "cris", { text: null, cards: [card] })]);
    });
    return { result: ok({ messages }), affected: { assetIds, employeeId } };
  } catch (err) {
    if (err instanceof CoreRefusal) return { result: await postRefusal(pending.conversationId, employeeId, ids.gets, err.result), affected: null };
    if (err instanceof Refusal) return { result: err.result, affected: null };
    throw err;
  }
}

/** The action's own words: a validation refusal's first field message, otherwise its message. */
function refusalText(r: ActionResult<never>): string {
  if (r.ok) return "";
  const first = r.fieldErrors ? Object.values(r.fieldErrors)[0] : undefined;
  return first ?? r.message;
}

/**
 * Whether a refusal is about the picked spare, so another spare is the next step: it names the spare's tag
 * ("… is reserved for …", "… is Deployed, not a spare.", "… is held by APR-…") or it is a field error on the spare
 * ("Pick a different device."). A refusal about the person (leaving, unknown), the item taken back, or the
 * change itself names neither, and another spare would only meet it again.
 */
function aboutSpare(r: ActionResult<never>, spareTag: string | null): boolean {
  if (r.ok) return false;
  if (r.fieldErrors && ("assetId" in r.fieldErrors || "newAssetId" in r.fieldErrors)) return true;
  return spareTag !== null && refusalText(r).includes(spareTag);
}

/**
 * After a refused Confirm (rolled back): Cris posts the action's own message and — when the refusal is about the
 * picked spare and any are left — the pickable spares for the same person, the picked spare's type first.
 * A forbidden refusal is returned as is.
 */
async function postRefusal(conversationId: string, employeeId: string, getsId: string, core: ActionResult<never>): Promise<ActionResult<CrisActionData>> {
  if (core.ok || core.kind === "forbidden") return core;
  return prisma.$transaction(async (tx) => {
    if (!(await conversationExists(tx, conversationId))) return core;
    const picked = await tx.asset.findUnique({ where: { id: getsId }, select: { tag: true, typeId: true } });
    const spares = aboutSpare(core, picked?.tag ?? null)
      ? await sparesCard(tx, employeeId, { typeId: picked?.typeId ?? null })
      : null;
    const row = await appendCrisMessage(tx, conversationId, "cris", { text: refusalText(core), cards: spares?.options.length ? [spares] : [] });
    return ok({ messages: viewMessages([row]), refused: true as const });
  });
}

// ── Undo ────────────────────────────────────────────────────────────────────

const UNDONE = "Undone";
/** Every undo entry: the reason "Undone", made through Cris (spec §6.4). */
const UNDO_DIFF: AuditDiff = { reason: { from: null, to: UNDONE }, via: { from: null, to: "Cris" } };
const changed = () => new Refusal(conflict(CRIS_CHANGED_SINCE));

/** One compensating change's record, as the direct path writes one: an EXECUTED approval, the audit entry, the webhook. */
async function recordUndo(
  tx: Tx, user: SessionUser, asset: { id: string; tag: string }, now: Date,
  r: { type: ApprovalType; action: string; employeeId: string; payload: Prisma.InputJsonObject; diff: AuditDiff },
): Promise<void> {
  const approval = await createApproval(tx, {
    type: r.type, payload: r.payload, requestedById: user.id, assetId: asset.id, employeeId: r.employeeId,
    executed: { by: user.id, at: now },
  });
  await writeAudit(tx, {
    actorId: user.id, actorLabel: user.name, entityType: "asset", entityId: asset.id, action: r.action,
    diff: { ...r.diff, ...UNDO_DIFF },
  });
  await emitWebhook(tx, "approval.executed", {
    approvalId: approval.id, refNo: approval.refNo, type: approval.type, assetId: asset.id, assetTag: asset.tag,
  });
}

/** The asset the Confirm worked on, refused unless it still reads exactly what the Confirm left. */
async function loadForUndo(tx: Tx, user: SessionUser, assetId: string) {
  const loaded = await loadDirect(tx, user, assetId);
  if (loaded.failure) throw loaded.failure.ok === false && loaded.failure.kind === "forbidden" ? new Refusal(loaded.failure) : changed();
  return loaded.asset;
}

/**
 * The spare the person got goes back to its status before (Spare), through the lifecycle guards — and straight
 * onto the shelf, not into triage: it never left IT's hands (spec §6.4). The write is prepareLifecycle's planned
 * update, state-guarded on what the Confirm left (commitLifecycle's only other step, settling a hold, never
 * applies to a return). Audited `lifecycle.return`.
 */
async function putBack(tx: Tx, user: SessionUser, entry: ResultRef["assets"][number], employeeId: string, now: Date): Promise<string> {
  const a = await loadForUndo(tx, user, entry.id);
  if (a.assigneeId !== employeeId || a.status !== entry.afterStatus) throw changed();
  const status = entry.before.status as AssetStatus;
  const p = await prepareLifecycle(tx, a, { kind: "return", status }, now);
  if (!p.ok) throw changed();
  const { updates, diff } = p.prepared;
  if (a.returnedAt === null) { delete updates.returnedAt; delete diff.returnedAt; }
  else { updates.returnedAt = null; diff.returnedAt = { from: a.returnedAt, to: null }; }
  const scalar: Prisma.AssetUpdateInput = { ...updates };
  delete scalar.assignee; // { disconnect: true } — written as assigneeId: null below
  const written = await tx.asset.updateMany({
    where: { id: a.id, assigneeId: employeeId, status: a.status },
    data: { ...(scalar as Prisma.AssetUncheckedUpdateManyInput), assigneeId: null },
  });
  if (written.count === 0) throw changed();
  await recordUndo(tx, user, a, now, {
    type: "lifecycle_return", action: "lifecycle.return", employeeId, diff,
    payload: { from: { assigneeId: employeeId }, to: { assigneeId: null, status }, reason: UNDONE },
  });
  return a.tag;
}

const toDate = (s: string | null) => (s ? new Date(s) : null);

/**
 * The item a replace took back goes back to the person with everything it had before (status, loan date, repair
 * clock). The lifecycle guards refuse assigning a Defective or Missing item, so this is a small direct update,
 * state-guarded on what the Confirm left. Audited `lifecycle.assign`.
 */
async function giveBack(tx: Tx, user: SessionUser, entry: ResultRef["assets"][number], employeeId: string, now: Date): Promise<string> {
  const a = await loadForUndo(tx, user, entry.id);
  if (a.assigneeId !== null || a.status !== entry.afterStatus) throw changed();
  const employee = await tx.employee.findUnique({ where: { id: employeeId }, select: { employeeNo: true, employment: true } });
  if (!employee || employee.employment !== "ACTIVE") throw changed();
  const b = entry.before;
  const target = {
    status: b.status as AssetStatus, loanDueAt: toDate(b.loanDueAt), returnedAt: toDate(b.returnedAt),
    defectiveSince: toDate(b.defectiveSince), repairEndedAt: toDate(b.repairEndedAt),
  };
  const diff: AuditDiff = {};
  for (const key of Object.keys(target) as Array<keyof typeof target>) {
    const from = a[key], to = target[key];
    const same = from instanceof Date || to instanceof Date ? from?.valueOf() === to?.valueOf() : from === to;
    if (!same) diff[key] = { from, to };
  }
  diff.assignee = { from: null, to: employee.employeeNo };
  const written = await tx.asset.updateMany({
    where: { id: a.id, assigneeId: null, status: a.status },
    data: { ...target, assigneeId: employeeId },
  });
  if (written.count === 0) throw changed();
  await recordUndo(tx, user, a, now, {
    type: "lifecycle_assign", action: "lifecycle.assign", employeeId, diff,
    payload: { to: { assigneeId: employeeId, status: target.status }, reason: UNDONE },
  });
  return a.tag;
}

/**
 * Spec §6.4: one transaction — the state-guarded claim, the "touched since" check (any audit entry on either asset
 * since the Confirm other than the Confirm's own), then the compensating changes and Cris's line in the box.
 */
export async function undoPending(user: SessionUser, pendingId: string, now: Date = new Date()): Promise<CrisOutcome> {
  const pending = await prisma.crisPendingAction.findUnique({ where: { id: pendingId } });
  if (!pending || pending.userId !== user.id) return { result: forbidden(), affected: null };
  if (pending.undoneAt) return refuse(CRIS_ALREADY_DONE);
  const usedAt = pending.usedAt;
  const ref = parseResultRef(pending.resultRef);
  if (!usedAt || !ref || !undoEligible({ usedAt, undoneAt: null }, false, now)) return refuse(CRIS_CHANGED_SINCE);
  const assetIds = ref.assets.map((a) => a.id);

  try {
    const messages = await prisma.$transaction(async (tx) => {
      const claim = await tx.crisPendingAction.updateMany({
        where: { id: pending.id, usedAt, undoneAt: null }, data: { undoneAt: now },
      });
      if (claim.count === 0) throw new Refusal(conflict(CRIS_ALREADY_DONE));
      // Freeze both assets before the "touched since" check: a manual change now waits for this transaction,
      // so nothing can land between the check and the writes. One statement, in id order (no lock-order deadlock).
      await tx.$queryRaw`SELECT "id" FROM "Asset" WHERE "id" IN (${Prisma.join([...assetIds].sort())}) ORDER BY "id" FOR UPDATE`;
      const touched = await tx.auditEntry.count({
        where: { entityType: "asset", entityId: { in: assetIds }, createdAt: { gte: usedAt }, id: { notIn: ref.auditIds } },
      });
      if (!undoEligible({ usedAt, undoneAt: null }, touched > 0, now)) throw changed();

      const gets = ref.assets.find((a) => a.role === "gets")!;
      const returns = ref.assets.find((a) => a.role === "returns");
      const newTag = await putBack(tx, user, gets, ref.employeeId, now);
      const oldTag = returns ? await giveBack(tx, user, returns, ref.employeeId, now) : null;
      if (ref.holdId) {
        await tx.reservation.updateMany({ where: { id: ref.holdId, state: "FULFILLED" }, data: { state: "ACTIVE", resolvedAt: null } });
      }

      const person = await readPerson(tx, ref.employeeId);
      const text = oldTag
        ? `Undone — ${person?.name ?? "the person"} has ${oldTag} again, and ${newTag} is back in spares.`
        : `Undone — ${newTag} is back in spares.`;
      if (!(await conversationExists(tx, pending.conversationId))) return [];
      return viewMessages([await appendCrisMessage(tx, pending.conversationId, "cris", { text, cards: [] })]);
    });
    return { result: ok({ messages }), affected: { assetIds, employeeId: ref.employeeId } };
  } catch (err) {
    if (err instanceof Refusal) return { result: err.result, affected: null };
    throw err;
  }
}
