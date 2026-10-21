import type { Role } from "@prisma/client";
import type { ActionResult } from "@/server/action-result";
import { depreciate, monthLabel, type MonthIndex, type Policy } from "./depreciation";
import { fmtMoneyExact } from "./format";
import { cleanReason } from "./reason";
import {
  REOPEN_REASON_MAX, REOPEN_REASON_MESSAGE, REOPEN_REASON_MIN, UNDO_WHAT, UNDO_WINDOW_MS, undoState, type UndoAsset, type UndoEntry, type UndoKind,
} from "./finance-undo";

/*
 * Finance follow-up, Task 3 (spec §4): what Finance sees after each review action. Pure, so the copy, the buttons and
 * what Undo does are tested without a DOM; the review box, the send-back dialog and the settings dialog only wire
 * these to the toast, the router and the server actions.
 *
 * Undo works after the page has moved on (approving goes to the next asset): every button carries the asset's id, and
 * the toast lives in the provider, not on the page that raised it.
 */

/** One toast button: the shape of the toast's ToastAction. */
export interface ToastButton {
  label: string;
  onAction: () => void;
}

/** A toast's message, its detail line(s) and its buttons (at most two). */
export interface ToastSpec {
  message: string;
  detail?: string;
  actions?: ToastButton[];
}

/** What an Undo button undoes. */
export interface UndoTarget {
  assetId: string;
  tag: string;
  kind: UndoKind;
}

/** What the buttons do: Undo (runFinanceUndo, wired to the server action) and Open <tag>. */
export interface ReviewToastDeps {
  undo: (target: UndoTarget) => void;
  open: (assetId: string) => void;
}

export const financeAssetHref = (id: string) => `/finance/assets/${id}`;

/** "Oct 2026". */
const shortMonth = (m: MonthIndex) => {
  const [name, year] = monthLabel(m).split(" ");
  return `${name.slice(0, 3)} ${year}`;
};

/**
 * Approve's first detail line: "Depreciation starts Oct 2026 · ₱2,131.11 a month", for the policy the approval will
 * use and its start month (the purchase month, `depStartMonth` with the approval as now). The figure and the rules are
 * the engine's (`depreciate`, read in the start month), never re-derived here. Null with no cost: approving it as not
 * capitalised.
 */
export function approveDetail(a: { costC: number | null; policy: Policy | null; startMonth: MonthIndex; category: string }): string | null {
  if (a.costC === null) return null;
  const r = depreciate(a.costC, a.startMonth, a.policy, a.startMonth);
  if (r.state === "no-policy") return `No depreciation policy for ${a.category} yet`;
  if (r.state === "bad-salvage" || r.monthly === null) return "Salvage is not below cost, so it does not depreciate";
  return `Depreciation starts ${shortMonth(a.startMonth)} · ${fmtMoneyExact(r.monthly / 100)} a month`;
}

const undoButton = (target: UndoTarget, deps: ReviewToastDeps): ToastButton => ({ label: "Undo", onAction: () => deps.undo(target) });

/**
 * Approve or approve as not capitalised. When it moved the page to the next asset, the toast names it and how many are
 * left, and offers "Open <tag>" to go back; with none left it says so (the page stays).
 */
export function approveToast(
  r: {
    assetId: string; tag: string; notCapitalised: boolean; detail: string | null;
    next: { id: string; tag: string } | null; remaining: number;
  },
  deps: ReviewToastDeps,
): ToastSpec {
  const queue = r.next ? `Next: ${r.next.tag} · ${Math.max(r.remaining, 1)} left to review` : "Nothing left to review";
  const actions = [undoButton({ assetId: r.assetId, tag: r.tag, kind: "approve" }, deps)];
  if (r.next) actions.push({ label: `Open ${r.tag}`, onAction: () => deps.open(r.assetId) });
  return {
    message: r.notCapitalised ? `Approved ${r.tag} as not capitalised` : `Approved ${r.tag}`,
    detail: r.detail ? `${r.detail}\n${queue}` : queue,
    actions,
  };
}

/** Send back: "Sent BR-LT-0201 back to IT", with what was flagged (or the note when nothing was ticked). */
export function sendBackToast(
  r: { assetId: string; tag: string; deptLabel: string; flagged: string[]; note: string },
  deps: ReviewToastDeps,
): ToastSpec {
  const note = r.note.trim();
  const detail = r.flagged.length ? `Flagged: ${r.flagged.join(", ")}` : note ? `Note: “${note}”` : undefined;
  return {
    message: `Sent ${r.tag} back to ${r.deptLabel}`,
    ...(detail ? { detail } : {}),
    actions: [undoButton({ assetId: r.assetId, tag: r.tag, kind: "send-back" }, deps)],
  };
}

/** Depreciation settings saved ("48 months, ₱0.00 salvage") or cleared (back to the category policy). */
export function settingsToast(
  r: { assetId: string; tag: string; saved: { lifeMonths: number; salvagePesos: number } | null },
  deps: ReviewToastDeps,
): ToastSpec {
  const actions = [undoButton({ assetId: r.assetId, tag: r.tag, kind: "settings" }, deps)];
  if (!r.saved) return { message: `Cleared ${r.tag}'s depreciation settings`, detail: "Back to the category policy", actions };
  return {
    message: `Saved ${r.tag}'s depreciation settings`,
    detail: `${r.saved.lifeMonths} months, ${fmtMoneyExact(r.saved.salvagePesos)} salvage`,
    actions,
  };
}

/** "Undid the approval of BR-LT-0201". */
export const undoneMessage = (kind: UndoKind, tag: string) => `Undid ${UNDO_WHAT[kind]} of ${tag}`;

/**
 * Pressing Undo (in the toast or the banner): the server re-checks everything. Done: a toast and back to the asset.
 * Refused: an error toast with the server's reason, which stays until dismissed.
 */
export async function runFinanceUndo(
  target: UndoTarget,
  deps: {
    call: (input: { assetId: string; kind: UndoKind }) => Promise<ActionResult<{ tag: string; id: string }>>;
    toast: (message: string, tone: "settled" | "fault") => void;
    go: (href: string) => void;
  },
): Promise<boolean> {
  let res: ActionResult<{ tag: string; id: string }>;
  try {
    res = await deps.call({ assetId: target.assetId, kind: target.kind });
  } catch {
    deps.toast(`Couldn't undo: the server didn't answer. Check ${target.tag} and try again.`, "fault");
    return false;
  }
  if (res.ok) {
    deps.toast(undoneMessage(target.kind, res.data.tag), "settled");
    deps.go(financeAssetHref(res.data.id));
    return true;
  }
  if (res.kind === "rate_limited") deps.toast(`Too many changes just now. Try Undo again in ${res.retryAfterSec ?? 60} s.`, "fault");
  else if (res.kind === "validation") deps.toast(Object.values(res.fieldErrors ?? {})[0] ?? res.message, "fault");
  else deps.toast(res.message, "fault");
  return false;
}

/** The asset page's Undo banner, computed on the server: null unless this person can undo now. */
export interface UndoBannerState {
  kind: UndoKind;
  /** "You approved this at 10:42". */
  label: string;
  minutesLeft: number;
  /** When the 15 minutes end (ms since epoch, the server's clock). */
  endsAt: number;
  /** Milliseconds left when the page was read: the client's countdown runs from it on its own clock. */
  msLeft: number;
}

export function undoBanner(asset: UndoAsset, entries: readonly UndoEntry[], userId: string, now: Date): UndoBannerState | null {
  const s = undoState(asset, entries, userId, now); // `undoCheck`'s state when it allows the undo, else null
  if (!s) return null;
  const endsAt = s.at.getTime() + UNDO_WINDOW_MS;
  return { kind: s.kind, label: s.label, minutesLeft: s.minutesLeft, endsAt, msLeft: endsAt - now.getTime() };
}

/** The banner's countdown on the client: whole minutes rounded up, 0 once the window has ended. */
export function minutesLeftAt(endsAt: number, now: number): number {
  return Math.max(0, Math.ceil((endsAt - now) / 60_000));
}

/** How often the banner re-reads the minutes left. */
export const UNDO_TICK_MS = 30_000;

/**
 * The banner's countdown on this device's clock: the minutes are re-read every 30 s, and a timer at the deadline ends
 * it exactly then (spec §4: it disappears when the window ends), not up to 30 s later. Returns the cleanup.
 */
export function startUndoCountdown(deadline: number, set: (minutesLeft: number) => void, tickMs = UNDO_TICK_MS): () => void {
  const tick = setInterval(() => set(minutesLeftAt(deadline, Date.now())), tickMs);
  const end = setTimeout(() => {
    clearInterval(tick);
    set(0);
  }, Math.max(0, deadline - Date.now()));
  return () => {
    clearInterval(tick);
    clearTimeout(end);
  };
}

/** Reopen review: admins only, on an approved asset. */
export function canReopenReview(role: Role, approvedAt: Date | null): boolean {
  return role === "admin" && approvedAt !== null;
}

/** The reopen reason's client check (the server re-checks): 5 to 300 characters once cleaned. */
export function reopenReasonError(reason: string): string | null {
  const n = cleanReason(reason).length;
  return n < REOPEN_REASON_MIN || n > REOPEN_REASON_MAX ? REOPEN_REASON_MESSAGE : null;
}
