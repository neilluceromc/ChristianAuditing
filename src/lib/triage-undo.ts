import { TRIAGE_LABEL, TRIAGE_OUTCOMES, type TriageOutcome } from "./lifecycle";

/*
 * Worklist split view (H4) Task 2: Undo for a triage decision, the Worklist's bulk decisions, and "Cleared today".
 *
 * Who and when: only the person who decided, only within 15 minutes by the server's clock, and only while the asset
 * is exactly as the decision left it. "Keep as spare" and "Send to repair" can be undone; Dispose and Donate cannot
 * (their reason and Confirm step is the guard). What an undo puts back comes from the decision's own audit entry: its
 * diff records each field's earlier value, and `version` the asset's updatedAt the decision left.
 */

export const TRIAGE_UNDO_WINDOW_MS = 15 * 60_000;

/** One bulk call decides at most this many items. */
export const TRIAGE_BULK_MAX = 100;

/** The decisions a bulk call can make and an undo can take back. */
export const UNDOABLE_TRIAGE = ["SPARE", "DEFECTIVE"] as const satisfies readonly TriageOutcome[];
export type UndoableTriage = (typeof UNDOABLE_TRIAGE)[number];

/** The audit action a triage's undo writes. */
export const TRIAGE_UNDONE = "lifecycle.triage.undone";

/** The refusals, verbatim (plan Global Constraints for the first two). */
export const TRIAGE_CHANGED_SINCE = "Changed by someone else since — open the record";
export const TRIAGE_UNDO_NOT_YOURS = "Undo is only for your own decision within 15 minutes";
export const TRIAGE_UNDO_FINAL = "Dispose and Donate can't be undone — open the record";
export const TRIAGE_ALREADY_UNDONE = "That decision is already undone";
/** A bulk item that failed for a reason other than a refusal (a timeout, a dropped connection): nothing of it was written. */
export const BULK_ITEM_FAILED = "Couldn't save — try again";

/** "8 done, 1 couldn't (changed by someone else)". */
export function bulkReport(done: number, failed: number): string {
  return `${done} done, ${failed} couldn't (changed by someone else)`;
}

type Change = { from?: unknown; to?: unknown };
const change = (diff: unknown, key: string): Change | null => {
  if (diff === null || typeof diff !== "object" || Array.isArray(diff)) return null;
  const c = (diff as Record<string, unknown>)[key];
  return c !== null && typeof c === "object" ? (c as Change) : null;
};

const asDate = (v: unknown): Date | null => {
  if (v instanceof Date) return v;
  if (typeof v !== "string") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** The decision a triage entry recorded, from its words ("Keep as spare" → SPARE). */
export function triageOutcomeOf(diff: unknown): TriageOutcome | null {
  const to = change(diff, "triage")?.to;
  return TRIAGE_OUTCOMES.find((o) => TRIAGE_LABEL[o] === to) ?? null;
}

export function isUndoableTriage(outcome: TriageOutcome): outcome is UndoableTriage {
  return (UNDOABLE_TRIAGE as readonly string[]).includes(outcome);
}

/** The asset's updatedAt the decision left (every triage write stamps it); null on an entry written before Undo. */
export function triageVersion(diff: unknown): Date | null {
  return asDate(change(diff, "version")?.to);
}

/** The asset fields a triage decision can change (triageAsset → prepareLifecycle), and an undo puts back. */
const DATE_FIELDS = ["returnedAt", "defectiveSince", "repairEndedAt", "loanDueAt"] as const;

export interface TriageRestore {
  status?: string;
  returnedAt?: Date | null;
  defectiveSince?: Date | null;
  repairEndedAt?: Date | null;
  loanDueAt?: Date | null;
}

/** Each field the decision changed, at its value before: the diff's `from`. Fields the diff lacks were not changed. */
export function triageRestore(diff: unknown): TriageRestore {
  const out: TriageRestore = {};
  const status = change(diff, "status");
  if (status && typeof status.from === "string") out.status = status.from;
  for (const key of DATE_FIELDS) {
    const c = change(diff, key);
    if (c && "from" in c) out[key] = asDate(c.from);
  }
  return out;
}

/**
 * The asset's notes before the decision appended its note (`notes + "\n" + note`, or the note alone). undefined
 * when the notes don't end with it — then they are left as they are.
 */
export function notesBefore(current: string | null, note: string): string | null | undefined {
  if (current === null) return undefined;
  if (current === note) return null;
  return current.endsWith(`\n${note}`) ? current.slice(0, -(note.length + 1)) : undefined;
}

/** Within 15 minutes of the decision, by the server's clock. */
export function undoWindowOpen(decidedAt: Date, now: Date): boolean {
  const age = now.getTime() - decidedAt.getTime();
  return age >= 0 && age <= TRIAGE_UNDO_WINDOW_MS;
}

/** Entries that change nothing an undo puts back: notes, attachments, documents, a secret read. */
const NEVER_BLOCK = ["note.", "attachment.", "document.", "comment", "SECRET_READ"];

/** A later entry on the asset that means it has changed since the decision. */
export function blocksTriageUndo(action: string): boolean {
  return !NEVER_BLOCK.some((p) => action.startsWith(p));
}

/** The decision an undone entry undid: its audit id. */
export function undoneTarget(diff: unknown): string | null {
  const to = change(diff, "undoes")?.to;
  return typeof to === "string" ? to : null;
}

/** The worklist decisions "Cleared today" counts: a triage, an IT check, a loan's due date. */
export const CLEARED_ACTIONS = ["lifecycle.triage", "it.verify", "loan.due-changed"] as const;

/** Today's decisions by one person, less those undone (an undo names the decision it undid). */
export function clearedCount(entries: ReadonlyArray<{ id: string; action: string; diff: unknown }>): number {
  const undone = new Set(entries.filter((e) => e.action === TRIAGE_UNDONE).map((e) => undoneTarget(e.diff)));
  return entries.filter((e) => (CLEARED_ACTIONS as readonly string[]).includes(e.action) && !undone.has(e.id)).length;
}
