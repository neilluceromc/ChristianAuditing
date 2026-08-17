import type { NoteKind, PurchaseRequestState } from "@prisma/client";

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
};

export interface BounceBack {
  by: string;
  at: Date;
  reason: string;
  /** who sent it back — finance bounced IT_REVIEWED, IT rejected SUBMITTED */
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

export function bounceBack(state: PurchaseRequestState, notes: ThreadNote[]): BounceBack | null {
  const last = lastFlowNote(notes);
  if (!last) return null;
  if (state === "SUBMITTED" && last.kind === "REQUEST_INFO") {
    return {
      by: last.author, at: last.at, reason: last.text, from: "finance",
      transition: "IT_REVIEWED → SUBMITTED · nothing was cleared",
    };
  }
  if (state === "DRAFT" && last.kind === "IT_REJECT") {
    return {
      by: last.author, at: last.at, reason: last.text, from: "it",
      transition: "SUBMITTED → DRAFT · nothing was cleared",
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

/** Every arrival at SUBMITTED: one per submit, one per finance bounce-back. */
export function submittedVisits(notes: ThreadNote[]): number {
  return notes.filter((n) => n.kind === "SUBMIT" || n.kind === "REQUEST_INFO").length;
}

export type StopStatus = "done" | "current" | "upcoming";

export interface StepperStop {
  state: PurchaseRequestState;
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

const STOPS: Array<{ state: PurchaseRequestState; label: string }> = [
  { state: "DRAFT", label: "Draft" },
  { state: "SUBMITTED", label: "Submitted" },
  { state: "IT_REVIEWED", label: "IT reviewed" },
  { state: "COMPLETED", label: "Completed" },
];

const ORDINAL_SUFFIXES = ["th", "st", "nd", "rd"] as const;

function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  const rem10 = n % 10;
  const suffix = rem10 >= 0 && rem10 <= 3 ? ORDINAL_SUFFIXES[rem10] : "th";
  return `${n}${suffix}`;
}

/** How far a cancelled request actually got, read off the thread. */
function reachedIndex(notes: ThreadNote[]): number {
  let reached = 0;
  for (const n of notes) {
    if (n.kind === "SUBMIT" && reached < 1) reached = 1;
    if (n.kind === "IT_REVIEW" && reached < 2) reached = 2;
    if (n.kind === "COMPLETE") reached = 3;
  }
  return reached;
}

export function stepperModel(state: PurchaseRequestState, notes: ThreadNote[]): Stepper {
  const bounce = bounceBack(state, notes);
  const cancelled = state === "CANCELLED";
  const currentIndex = cancelled ? -1 : STOPS.findIndex((s) => s.state === state);
  const frozenAt = cancelled ? reachedIndex(notes) : -1;
  const visits = submittedVisits(notes);

  const stops = STOPS.map((stop, i): StepperStop => {
    if (cancelled) return { ...stop, status: i <= frozenAt ? "done" : "upcoming" };
    if (i < currentIndex) return { ...stop, status: "done" };
    if (i > currentIndex) return { ...stop, status: "upcoming" };
    const repeat = stop.state === "SUBMITTED" && visits > 1 ? ` · ${ordinal(visits)} time` : "";
    return { ...stop, status: "current", note: `NOW${repeat}` };
  });

  return { stops, sentBack: bounce?.from ?? null, cancelled };
}
