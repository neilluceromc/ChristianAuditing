import type { NoteKind, PurchaseOrderState } from "@prisma/client";
import type { Team } from "./intake-rules";

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
export type StopKey = "saved" | "with-it" | "registered" | "approved";

export interface StepperStop {
  key: StopKey;
  label: string;
  status: StopStatus;
  note?: string;
}

export interface Stepper {
  stops: StepperStop[];
  /** who sent it back, for the dashed "← sent back" connector: the PO's own send-back, or a legacy bounce off the thread */
  sentBack: "finance" | "it" | null;
  /** the connector (between stop i and i + 1) the return is drawn on; -1 for none */
  returnAt: number;
  cancelled: boolean;
}

/** What the stepper needs beyond the state and the thread: the lines' classes, how far registering got, who sent it back. */
export interface StepperContext {
  /** "With IT" is a stop only when some line is IT gear (or a legacy line, whose class IT still has to see). */
  hasItLines: boolean;
  /** poProgress(lines, approvedAll): null until something is registered. */
  progress: "Partly registered" | "Registered" | "Approved" | null;
  /** The open send-back's team (po.sentBackBy); null for a legacy draft that was never sent. */
  sentBackBy: Team | null;
}

const ORDINAL_SUFFIXES = ["th", "st", "nd", "rd"] as const;

function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  const rem10 = n % 10;
  const suffix = rem10 >= 0 && rem10 <= 3 ? ORDINAL_SUFFIXES[rem10] : "th";
  return `${n}${suffix}`;
}

/** Did a cancelled order get as far as IT? Read off the thread (old and new note kinds alike). */
function reachedIt(notes: ThreadNote[]): boolean {
  return notes.some((n) =>
    n.kind === "SUBMIT" || n.kind === "IT_REVIEW" || n.kind === "COMPLETE" || n.kind === "PO_SAVED" || n.kind === "PO_RESUBMITTED");
}

/**
 * PO saved → With IT (only when it has IT lines) → Registered → Approved, driven by the state and poProgress — so
 * With IT is never "done" on an order nobody has registered from yet, and a non-IT order has no With IT stop.
 * Sent back: PO saved is the current stop (it is with Purchasing again) and the return is drawn after it; stops
 * that registering already reached stay done. A cancelled order freezes at how far it got.
 */
export function stepperModel(state: PurchaseOrderState, notes: ThreadNote[], ctx: StepperContext): Stepper {
  const bounce = bounceBack(state, notes);
  const cancelled = state === "CANCELLED";
  const sentBackState = state === "SENT_BACK";
  const progress = ctx.progress;
  const registeredDone = progress === "Registered" || progress === "Approved";
  const visits = submittedVisits(notes);

  const stops: StepperStop[] = [{ key: "saved", label: "PO saved", status: "done" }];
  if (ctx.hasItLines) stops.push({ key: "with-it", label: "With IT", status: "upcoming" });
  stops.push({ key: "registered", label: "Registered", status: "upcoming" });
  stops.push({ key: "approved", label: "Approved", status: "upcoming" });
  const at = (key: StopKey) => stops.find((s) => s.key === key);
  const set = (key: StopKey, status: StopStatus, note?: string) => {
    const s = at(key);
    if (s) { s.status = status; if (note) s.note = note; }
  };

  if (cancelled) {
    if (reachedIt(notes)) set("with-it", "done");
  } else if (sentBackState) {
    set("saved", "current", "SENT BACK");
    if (progress !== null) set("with-it", "done");
    if (registeredDone) set("registered", "done");
    if (progress === "Approved") set("approved", "done");
  } else {
    if (state === "WITH_IT" && progress === null) {
      const repeat = visits > 1 ? ` · ${ordinal(visits)} time` : "";
      set("with-it", "current", `NOW${repeat}`);
    } else {
      set("with-it", "done");
    }
    if (progress === null) {
      if (state !== "WITH_IT") set("registered", "current", "NOW");
    } else if (progress === "Partly registered") {
      set("registered", "current", "PARTLY");
    } else {
      set("registered", "done");
      if (progress === "Approved") set("approved", "done");
      else set("approved", "current", "WITH FINANCE");
    }
  }

  const sentBack: Stepper["sentBack"] =
    sentBackState && ctx.sentBackBy ? (ctx.sentBackBy === "IT" ? "it" : "finance") : bounce?.from ?? null;
  // A PO send-back and a legacy IT rejection return to PO saved (connector 0); a legacy Finance bounce left it WITH_IT
  // (the connector after With IT).
  const returnAt = sentBack === null ? -1 : sentBackState ? 0 : Math.max(0, stops.findIndex((s) => s.key === "with-it"));

  return { stops, sentBack, returnAt, cancelled };
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
