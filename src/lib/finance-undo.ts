import { historyKind, historyVerb, isFinanceRelevant } from "./finance-history";

/*
 * Finance follow-up (spec §3): Undo for Finance's review actions, and the admin's Reopen review.
 *
 * Who and when: only the person who did the action, only within 15 minutes by the server's clock, and only while the
 * action is still the latest finance change on the asset (IT has not resubmitted it, no cost, review or settings
 * change since). Pure, so the asset page's banner and the server action read the same rules; the server re-runs it
 * inside its transaction, and the client's countdown is only a hint.
 *
 * What an undo restores comes from the original audit entry's diff (the writers record the earlier values), never
 * from a guess: an approval's not-capitalised flag and IT's reply, a settings change's earlier override.
 */

export type UndoKind = "approve" | "send-back" | "settings";
export const UNDO_KINDS: readonly UndoKind[] = ["approve", "send-back", "settings"];

export const UNDO_WINDOW_MS = 15 * 60 * 1000;

/** The audit actions an undo can take back, and which kind each is. */
export const UNDOABLE_ACTIONS: Readonly<Record<string, UndoKind>> = {
  "finance.confirm": "approve",
  "finance.return": "send-back",
  "depreciation.override": "settings",
  "depreciation.override.cleared": "settings",
};

/** The audit action each undo writes. */
export const UNDONE_ACTION: Readonly<Record<UndoKind, string>> = {
  approve: "finance.confirm.undone",
  "send-back": "asset.return.undone",
  settings: "depreciation.override.undone",
};

/** The words after "Undid": "Undid the approval of BR-LT-0201". */
export const UNDO_WHAT: Readonly<Record<UndoKind, string>> = {
  approve: "the approval",
  "send-back": "the send-back",
  settings: "the depreciation settings change",
};

/** Admin reopen: the reason's length. */
export const REOPEN_REASON_MIN = 5;
export const REOPEN_REASON_MAX = 300;
export const REOPEN_REASON_MESSAGE = `Give a reason of ${REOPEN_REASON_MIN} to ${REOPEN_REASON_MAX} characters`;

/** The asset's review columns the rules check. */
export interface UndoAsset {
  financeConfirmedAt: Date | null;
  financeReturnedAt: Date | null;
}

/** One audit entry on the asset (or its purchase record); a Financial history AuditRow fits. */
export interface UndoEntry {
  id: string;
  actorId: string | null;
  actorLabel: string;
  entityType: string;
  action: string;
  diff: unknown;
  createdAt: Date;
}

export interface UndoState {
  kind: UndoKind;
  /** When the action was done (its audit entry). */
  at: Date;
  /** Whole minutes left, rounded up: 1 in the last minute, never 0. */
  minutesLeft: number;
  /** The banner's words: "You approved this at 10:42". */
  label: string;
  /** The audit entry being undone. */
  entryId: string;
}

export type UndoCheck = { ok: true; state: UndoState; entry: UndoEntry } | { ok: false; reason: string };

const HHMM = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Asia/Manila" });
/** Manila "10:42". */
export const manilaTime = (d: Date) => HHMM.format(d);

type Change = { from?: unknown; to?: unknown };
type Diff = Record<string, Change | null | undefined>;
const asDiff = (diff: unknown): Diff | null => (diff !== null && typeof diff === "object" && !Array.isArray(diff) ? (diff as Diff) : null);
const has = (c: Change | null | undefined, side: "from" | "to"): c is Change => c !== null && typeof c === "object" && side in c;

const NEVER_BLOCK = ["document.", "attachment.", "note.", "asset-note."];

/**
 * A finance change on the asset: anything the Financial history shows as an approval, review, cost or settings change
 * on the asset or its purchase record. Notes, documents and the category's policy do not count: they change nothing
 * an undo puts back.
 */
export function blocksUndo(e: Pick<UndoEntry, "entityType" | "action" | "diff">): boolean {
  if (e.entityType !== "asset" && e.entityType !== "purchase-record") return false;
  // By prefix first: the history files every purchase-record entry under Cost, a document or note on it included.
  if (NEVER_BLOCK.some((p) => e.action.startsWith(p))) return false;
  if (!isFinanceRelevant(e)) return false;
  const kind = historyKind(e.entityType, e.action);
  return kind !== "docs" && kind !== "notes";
}

/** The latest finance change, by time (ties: the later id), whatever order the entries come in. */
export function latestFinanceChange<E extends UndoEntry>(entries: readonly E[]): E | null {
  let latest: E | null = null;
  for (const e of entries) {
    if (!blocksUndo(e)) continue;
    if (!latest || e.createdAt.getTime() > latest.createdAt.getTime()
      || (e.createdAt.getTime() === latest.createdAt.getTime() && e.id > latest.id)) latest = e;
  }
  return latest;
}

/** Approve: the not-capitalised flag before the approval (no key: false before and after) and IT's reply it cleared. */
export function approveRestore(diff: unknown): { notCapitalised: boolean; resubmitNote: string | null } {
  const d = asDiff(diff);
  const nc = d?.notCapitalised;
  const note = d?.resubmitNote;
  return {
    notCapitalised: has(nc, "from") ? nc.from === true : false,
    resubmitNote: has(note, "from") && typeof note.from === "string" ? note.from : null,
  };
}

/** Send back: IT's reply the send-back cleared. */
export function sendBackRestore(diff: unknown): { resubmitNote: string | null } {
  const note = asDiff(diff)?.resubmitNote;
  return { resubmitNote: has(note, "from") && typeof note.from === "string" ? note.from : null };
}

/** A send-back written over an earlier one (`financeReturn.from` is set): undoing it cannot bring the earlier one back. */
function replacedEarlier(diff: unknown): boolean {
  const ret = asDiff(diff)?.financeReturn;
  return has(ret, "from") && ret.from !== null && ret.from !== undefined;
}

/**
 * Task 6: an asset returned as part of a PO send-back (`po` in its diff names the PO). It goes back to Finance when
 * Purchasing corrects and saves the PO, so the one asset's return can't be undone on its own.
 */
function poSendBack(diff: unknown): string | null {
  const po = asDiff(diff)?.po;
  return has(po, "to") && typeof po.to === "string" ? po.to : null;
}

/*
 * Task 6 (spec §5): a group action — Approve all with its hold-backs — writes one entry per asset, each carrying the
 * registration (`group`) and the action's own id (`batch`) in its diff, so the whole action can be found and undone as
 * one. These keys, and a PO send-back's `po`, say which action an entry belongs to, not what changed: the history
 * tables leave them out (history.ts META_KEYS, finance-history.ts HIDDEN_FIELDS).
 */
const metaTo = (diff: unknown, key: string): string | null => {
  const c = asDiff(diff)?.[key];
  return has(c, "to") && typeof c.to === "string" ? c.to : null;
};

export interface GroupUndoAsset extends UndoAsset {
  id: string;
  tag: string;
}

export interface GroupUndoItem {
  assetId: string;
  tag: string;
  kind: UndoKind;
  /** The asset's entry from the group action. */
  entry: UndoEntry;
}

export type GroupUndoCheck =
  | { ok: true; batch: string; at: Date; minutesLeft: number; items: GroupUndoItem[] }
  | { ok: false; reason: string };

/**
 * Whether `userId` can undo their latest group action on registration `recordId` now: all of it or none (spec §5,
 * "one action"). Each asset of the action must pass `undoCheck` — same person, within 15 minutes, still its latest
 * finance change — and the first that doesn't refuses the whole undo with its reason. `entries` holds the assets' own
 * entries (entityType "asset", `entityId` the asset) and the registration's ("purchase-record").
 */
export function groupUndoCheck(
  recordId: string,
  assets: readonly GroupUndoAsset[],
  entries: ReadonlyArray<UndoEntry & { entityId: string }>,
  userId: string,
  now: Date,
): GroupUndoCheck {
  const mine = entries.filter((e) =>
    e.entityType === "asset" && e.actorId === userId && UNDOABLE_ACTIONS[e.action] !== undefined
    && metaTo(e.diff, "group") === recordId && metaTo(e.diff, "batch") !== null);
  let latest: (typeof mine)[number] | null = null;
  for (const e of mine) {
    if (!latest || e.createdAt.getTime() > latest.createdAt.getTime()
      || (e.createdAt.getTime() === latest.createdAt.getTime() && e.id > latest.id)) latest = e;
  }
  if (!latest) return { ok: false, reason: "Can't undo: there is no recent group action of yours to undo." };
  const batch = metaTo(latest.diff, "batch")!;
  const record = entries.filter((e) => e.entityType === "purchase-record" && e.entityId === recordId);

  const items: GroupUndoItem[] = [];
  for (const e of mine.filter((x) => metaTo(x.diff, "batch") === batch)) {
    const a = assets.find((x) => x.id === e.entityId);
    if (!a) return { ok: false, reason: "Can't undo: an asset from it has left this registration." };
    const own = entries.filter((x) => x.entityType === "asset" && x.entityId === a.id);
    const check = undoCheck(a, [...own, ...record], userId, now);
    const why = (r: string) => ({ ok: false as const, reason: `Can't undo: ${a.tag} — ${r.replace(/^Can't undo: /, "")}` });
    if (!check.ok) return why(check.reason);
    if (check.entry.id !== e.id) return why("its review has changed since.");
    items.push({ assetId: a.id, tag: a.tag, kind: check.state.kind, entry: e });
  }
  const left = latest.createdAt.getTime() + UNDO_WINDOW_MS - now.getTime();
  return {
    ok: true, batch, at: latest.createdAt, items,
    minutesLeft: Math.max(1, Math.min(UNDO_WINDOW_MS / 60_000, Math.ceil(left / 60_000))),
  };
}

/**
 * Settings: the override before the change, or all null (the category policy) when there was none. Null when the
 * entry did not record the earlier values (a removal saved before this follow-up).
 */
export function settingsRestore(diff: unknown): { lifeMonths: number | null; salvage: number | null; note: string | null } | null {
  const d = asDiff(diff);
  const life = d?.lifeMonths;
  if (!has(life, "from")) return null;
  if (life.from === null || life.from === undefined) return { lifeMonths: null, salvage: null, note: null };
  if (typeof life.from !== "number") return null;
  const s = d?.salvage;
  const salvage = has(s, "from") && s.from !== null && s.from !== "" && !Number.isNaN(Number(s.from)) ? Number(s.from) : null;
  if (salvage === null) return null;
  const n = d?.note;
  return { lifeMonths: life.from, salvage, note: has(n, "from") && typeof n.from === "string" ? n.from : null };
}

function stateMatches(kind: UndoKind, a: UndoAsset): boolean {
  if (kind === "approve") return a.financeConfirmedAt !== null;
  if (kind === "send-back") return a.financeConfirmedAt === null && a.financeReturnedAt !== null;
  return true;
}

function bannerLabel(kind: UndoKind, e: UndoEntry): string {
  const at = manilaTime(e.createdAt);
  if (kind === "approve") {
    return asDiff(e.diff)?.notCapitalised?.to === true ? `You approved this as not capitalised at ${at}` : `You approved this at ${at}`;
  }
  if (kind === "send-back") return `You sent this back at ${at}`;
  return `You changed the depreciation settings at ${at}`;
}

const no = (why: string): UndoCheck => ({ ok: false, reason: `Can't undo: ${why}.` });

/**
 * Whether `userId` can undo the asset's latest review action now, with the reason when not. `kind`, when given, must
 * be the latest action's kind (the server passes the one the button named).
 */
export function undoCheck(asset: UndoAsset, entries: readonly UndoEntry[], userId: string, now: Date, kind?: UndoKind): UndoCheck {
  const latest = latestFinanceChange(entries);
  if (!latest) return no("there is no recent review action to undo");
  const k = UNDOABLE_ACTIONS[latest.action];
  if (!k || (kind && k !== kind)) {
    const who = latest.actorId === userId ? "you" : latest.actorId === null ? "the system" : latest.actorLabel;
    return no(`${who} ${historyVerb(latest)} at ${manilaTime(latest.createdAt)}`);
  }
  if (latest.actorId !== userId) return no(`only ${latest.actorLabel} can undo this`);
  const ends = latest.createdAt.getTime() + UNDO_WINDOW_MS;
  const left = ends - now.getTime();
  if (left <= 0) return no(`the 15 minutes to undo it ended at ${manilaTime(new Date(ends))}`);
  if (!stateMatches(k, asset)) return no("the asset's review has changed since");
  if (k === "send-back" && replacedEarlier(latest.diff)) return no("this send-back replaced an earlier one");
  const po = k === "send-back" ? poSendBack(latest.diff) : null;
  if (po) return no(`it went back to Purchasing with ${po} — undo the send-back on ${po} instead`);
  if (k === "settings" && settingsRestore(latest.diff) === null) return no("the earlier depreciation settings weren't recorded");
  return {
    ok: true,
    entry: latest,
    state: {
      kind: k,
      at: latest.createdAt,
      minutesLeft: Math.max(1, Math.min(UNDO_WINDOW_MS / 60_000, Math.ceil(left / 60_000))),
      label: bannerLabel(k, latest),
      entryId: latest.id,
    },
  };
}

/** The asset page's banner: what `userId` can undo now, or null (`undoCheck` says why). */
export function undoState(asset: UndoAsset, entries: readonly UndoEntry[], userId: string, now: Date): UndoState | null {
  const r = undoCheck(asset, entries, userId, now);
  return r.ok ? r.state : null;
}

// ---- a PO's send-back (Task 6 fix round 1, spec §5: "the new send-backs", one action each) ---------------------------

/** PO entries that never block an undo: a comment or a document changes nothing the undo puts back. */
const PO_QUIET: readonly string[] = ["comment", "document.uploaded"];

export interface PoSendBackUndoItem {
  assetId: string;
  tag: string;
  /** The asset's finance.return entry from the send-back. */
  entry: UndoEntry;
}

export type PoSendBackUndoCheck =
  | {
    ok: true; entry: UndoEntry; previousState: string; items: PoSendBackUndoItem[];
    at: Date; minutesLeft: number; label: string;
  }
  | { ok: false; reason: string };

const latestOf = <E extends UndoEntry>(list: readonly E[]): E | null => {
  let latest: E | null = null;
  for (const e of list) {
    if (!latest || e.createdAt.getTime() > latest.createdAt.getTime()
      || (e.createdAt.getTime() === latest.createdAt.getTime() && e.id > latest.id)) latest = e;
  }
  return latest;
};

/**
 * Whether `userId` can undo the PO's send-back now (IT's or Finance's): the person who sent it, within 15 minutes, while
 * the PO is still sent back and nothing was done to it since (a comment or a document aside), and — Finance's — while
 * each asset it returned still has that return as its latest finance change. All or nothing: the first that fails
 * refuses the undo with its reason. What it restores: the PO's state before (`state.from` in the po.send-back diff)
 * and every asset the send-back returned (its finance.return entries carry the send-back's `batch`).
 *
 * `poEntries` are the PO's own entries (entityType "purchase-order"); `assetEntries` the entries of its assets.
 */
export function poSendBackUndoCheck(
  po: { refNo: string; state: string },
  poEntries: readonly UndoEntry[],
  assets: readonly GroupUndoAsset[],
  assetEntries: ReadonlyArray<UndoEntry & { entityId: string }>,
  userId: string,
  now: Date,
): PoSendBackUndoCheck {
  const refuse = (why: string) => ({ ok: false as const, reason: `Can't undo: ${why}.` });
  const sent = latestOf(poEntries.filter((e) => e.action === "po.send-back"));
  if (!sent) return refuse(`${po.refNo} has no send-back to undo`);
  if (po.state !== "SENT_BACK") return refuse(`${po.refNo} is no longer with Purchasing`);
  const since = latestOf(poEntries.filter((e) => !PO_QUIET.includes(e.action)));
  if (since && since.id !== sent.id) {
    const who = since.actorId === userId ? "you" : since.actorLabel;
    return refuse(`${who} changed ${po.refNo} since, at ${manilaTime(since.createdAt)}`);
  }
  if (sent.actorId !== userId) return refuse(`only ${sent.actorLabel} can undo this`);
  const ends = sent.createdAt.getTime() + UNDO_WINDOW_MS;
  const left = ends - now.getTime();
  if (left <= 0) return refuse(`the 15 minutes to undo it ended at ${manilaTime(new Date(ends))}`);
  const d = asDiff(sent.diff);
  const before = d?.state;
  if (!has(before, "from") || typeof before.from !== "string" || before.from === "SENT_BACK") {
    return refuse("the state before the send-back wasn't recorded");
  }
  const team = (() => {
    const to = d?.sentBack;
    return has(to, "to") && to.to && typeof to.to === "object" ? (to.to as { team?: unknown }).team : undefined;
  })();
  const batch = metaTo(sent.diff, "batch");
  if (team === "FINANCE" && batch === null) return refuse("this send-back is from before it could be undone");

  const items: PoSendBackUndoItem[] = [];
  for (const e of assetEntries) {
    if (e.entityType !== "asset" || e.action !== "finance.return" || batch === null || metaTo(e.diff, "batch") !== batch) continue;
    const a = assets.find((x) => x.id === e.entityId);
    if (!a) return refuse("an asset it returned is no longer on it");
    const own = assetEntries.filter((x) => x.entityType === "asset" && x.entityId === a.id);
    const latest = latestFinanceChange(own);
    if (latest?.id !== e.id || a.financeConfirmedAt !== null || a.financeReturnedAt === null) {
      return refuse(`${a.tag}'s review has changed since`);
    }
    items.push({ assetId: a.id, tag: a.tag, entry: e });
  }
  return {
    ok: true, entry: sent, previousState: before.from, items, at: sent.createdAt,
    minutesLeft: Math.max(1, Math.min(UNDO_WINDOW_MS / 60_000, Math.ceil(left / 60_000))),
    label: `You sent ${po.refNo} back to Purchasing at ${manilaTime(sent.createdAt)}`,
  };
}
