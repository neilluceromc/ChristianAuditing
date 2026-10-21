import type { NoteKind, PurchaseOrderState } from "@prisma/client";

/**
 * The bounce-back is the design problem (README 1j). Everything the banner and
 * the stepper need is DERIVED from the append-only thread — there is no
 * "bounced" column to drift out of sync with the notes.
 */
export interface ThreadNote {
  id: string;
  kind: NoteKind;
  text: string;
  author: string;
  at: Date;
}

export const NOTE_CHIP: Record<NoteKind, string> = {
  COMMENT: "COMMENT",
  SUBMIT: "SUBMITTED",
  IT_REVIEW: "IT REVIEW",
  IT_REJECT: "SENT BACK",
  REQUEST_INFO: "SENT BACK",
  CANCEL: "CANCELLED",
  COMPLETE: "COMPLETED",
  RECEIVE: "RECEIVED",
  // Migration 38: the purchase-order thread. The kinds above stay so history still renders.
  PO_SAVED: "SAVED",
  PO_SENT_BACK: "SENT BACK",
  PO_RESUBMITTED: "RESUBMITTED",
  PO_FIXED: "FIXED",
  PO_REGISTERED: "REGISTERED",
  PO_LINE_CLOSED: "CLOSED SHORT",
  PO_CANCELLED: "CANCELLED",
};

export interface BounceBack {
  by: string;
  at: Date;
  reason: string;
  /** who sent it back — legacy: Finance asked for more info (now WITH_IT), IT rejected (now SENT_BACK) */
  from: "finance" | "it";
  /** the honest transition line: nothing was cleared */
  transition: string;
}

/** Notes arrive oldest-first; COMMENT never changes state, so it never ends a bounce. */
function lastFlowNote(notes: ThreadNote[]): ThreadNote | null {
  for (let i = notes.length - 1; i >= 0; i--) {
    if (notes[i].kind !== "COMMENT") return notes[i];
  }
  return null;
}

/**
 * Migration 38 mapped the old states (SUBMITTED → WITH_IT, DRAFT → SENT_BACK), so a legacy bounce still reads
 * off the same notes. The purchase-order send-back (PO_SENT_BACK) is Task 4's to render.
 */
export function bounceBack(state: PurchaseOrderState, notes: ThreadNote[]): BounceBack | null {
  const last = lastFlowNote(notes);
  if (!last) return null;
  if (state === "WITH_IT" && last.kind === "REQUEST_INFO") {
    return {
      by: last.author, at: last.at, reason: last.text, from: "finance",
      transition: "Back with IT · nothing was cleared",
    };
  }
  if (state === "SENT_BACK" && last.kind === "IT_REJECT") {
    return {
      by: last.author, at: last.at, reason: last.text, from: "it",
      transition: "Sent back to Purchasing · nothing was cleared",
    };
  }
  return null;
}

/** "Jump to unit 04" when the reason names one, the units section otherwise. */
export function unitAnchor(reason: string): { anchor: string; label: string } {
  const m = /unit\s*0*(\d+)/i.exec(reason);
  if (!m) return { anchor: "#units", label: "Jump to units" };
  return { anchor: `#unit-${m[1]}`, label: `Jump to unit ${m[1].padStart(2, "0")}` };
}

/** Every arrival with IT under the old flow: one per submit, one per finance bounce-back. */
export function submittedVisits(notes: ThreadNote[]): number {
  return notes.filter((n) => n.kind === "SUBMIT" || n.kind === "REQUEST_INFO").length;
}

export type StopStatus = "done" | "current" | "upcoming";

export interface StepperStop {
  state: PurchaseOrderState;
  label: string;
  status: StopStatus;
  note?: string;
}

export interface Stepper {
  stops: StepperStop[];
  /** renders the dashed amber/red "← sent back" connector */
  sentBack: "finance" | "it" | null;
  cancelled: boolean;
}

const STOPS: Array<{ state: PurchaseOrderState; label: string }> = [
  { state: "SENT_BACK", label: "With Purchasing" },
  { state: "WITH_IT", label: "With IT" },
  { state: "READY", label: "Ready to register" },
];

const ORDINAL_SUFFIXES = ["th", "st", "nd", "rd"] as const;

function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  const rem10 = n % 10;
  const suffix = rem10 >= 0 && rem10 <= 3 ? ORDINAL_SUFFIXES[rem10] : "th";
  return `${n}${suffix}`;
}

/** How far a cancelled order actually got, read off the thread (old and new note kinds alike). */
function reachedIndex(notes: ThreadNote[]): number {
  let reached = 0;
  for (const n of notes) {
    if ((n.kind === "SUBMIT" || n.kind === "IT_REVIEW" || n.kind === "PO_SAVED" || n.kind === "PO_RESUBMITTED") && reached < 1) reached = 1;
    if (n.kind === "COMPLETE") reached = 2;
  }
  return reached;
}

export function stepperModel(state: PurchaseOrderState, notes: ThreadNote[]): Stepper {
  const bounce = bounceBack(state, notes);
  const cancelled = state === "CANCELLED";
  const currentIndex = cancelled ? -1 : STOPS.findIndex((s) => s.state === state);
  const frozenAt = cancelled ? reachedIndex(notes) : -1;
  const visits = submittedVisits(notes);

  const stops = STOPS.map((stop, i): StepperStop => {
    if (cancelled) return { ...stop, status: i <= frozenAt ? "done" : "upcoming" };
    if (i < currentIndex) return { ...stop, status: "done" };
    if (i > currentIndex) return { ...stop, status: "upcoming" };
    const repeat = stop.state === "WITH_IT" && visits > 1 ? ` · ${ordinal(visits)} time` : "";
    return { ...stop, status: "current", note: `NOW${repeat}` };
  });

  return { stops, sentBack: bounce?.from ?? null, cancelled };
}

/** Phase 39 (spec §3): the request page shows this many of the newest messages; the rest open in a side panel. */
export const THREAD_PREVIEW = 5;
/** …and the panel shows this many at a time, oldest first. */
export const THREAD_PAGE = 30;

/** The panel's count line: "{n} messages · oldest first · showing {k}", or "{m} of {n} messages match" while filtering. */
export function threadCountLine({
  total, matching, shown, filtering,
}: { total: number; matching: number; shown: number; filtering: boolean }): string {
  const noun = total === 1 ? "message" : "messages";
  return filtering ? `${matching} of ${total} ${noun} match` : `${total} ${noun} · oldest first · showing ${shown}`;
}
