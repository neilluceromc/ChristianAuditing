import type { ActionErrorKind } from "@/server/action-result";
import type { CrisCard, CrisViewMessage, SpareRef } from "./cris-cards";
import type { CrisMood, MoodState } from "./cris-mood";
import { CRIS_SAME_MOMENT } from "./cris-undo";
import { fmtDayMonth } from "./format";

/*
 * The chat box's pure rules (spec §4): what is live, what is waited for, how a scan is read, and the cards' and the
 * opening state's words. The widget (src/components/cris) only wires these to the screen.
 */

/** The reply types out about this many characters a tick (the Talking mood). */
export const TYPE_STEP = 3;
export const TYPE_TICK_MS = 18;

export function nextTyped(shown: number, full: number): number {
  return Math.min(full, shown + TYPE_STEP);
}

type Outcome = MoodState["outcome"];

/** A refused action as a mood outcome: forbidden is Sad; a conflict, a rate limit or a bad input is Frustrated. */
export function outcomeOfFailure(kind: ActionErrorKind): Exclude<Outcome, null> {
  return kind === "forbidden" ? "refused" : "error";
}

/** crisSend's mood as an outcome that stays after the reply has typed out. */
export function outcomeOfMood(mood: CrisMood): Outcome {
  if (mood === "sad") return "empty";
  if (mood === "cross") return "error";
  return null;
}

/** Messages the server never stored (the limit, a failure, a refusal) carry ids starting `transient-`. */
export function isSaved(id: string): boolean {
  return !id.startsWith("transient-");
}

/** "Earlier messages" loads the page before this one. */
export function oldestSavedId(messages: CrisViewMessage[]): string | null {
  return messages.find((m) => isSaved(m.id))?.id ?? null;
}

/** Only the newest message's cards take a pick, a scan or a Confirm; older ones are a record. */
function newestSaved(messages: CrisViewMessage[]): CrisViewMessage | null {
  for (let i = messages.length - 1; i >= 0; i--) if (isSaved(messages[i].id)) return messages[i];
  return null;
}

/**
 * The newest SAVED message. Unsaved ones (the echo of a send that failed, a refusal said only in the box) never end
 * a card: the server still holds it open, and the person must be able to press Confirm or pick again.
 */
export function liveMessageId(messages: CrisViewMessage[]): string | null {
  return newestSaved(messages)?.id ?? null;
}

function liveCards(messages: CrisViewMessage[]): CrisCard[] {
  const last = newestSaved(messages);
  return last && last.role === "cris" ? last.cards : [];
}

/** Cris is waiting for a pick, a scan or a Confirm (the Looking mood). */
export function waitingIn(messages: CrisViewMessage[], confirmed: ReadonlySet<string>): boolean {
  return liveCards(messages).some(
    (c) => c.type === "which" || c.type === "spares" || (c.type === "confirm" && !confirmed.has(c.pendingId)),
  );
}

/** A scanned tag that is one of the spares on the open pick list: that spare's id (a scanned pick); else null (typed text). */
export function scannedSpare(tag: string, messages: CrisViewMessage[]): string | null {
  const wanted = tag.trim().toUpperCase();
  if (!wanted) return null;
  for (const card of liveCards(messages)) {
    if (card.type !== "spares") continue;
    const hit = card.options.find((o) => o.tag.toUpperCase() === wanted);
    if (hit) return hit.assetId;
  }
  return null;
}

const monthYear = new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric", timeZone: "Asia/Manila" });

/** A spare's second line on the pick list: "Standard · warranty to Feb 2029 · back 12 Oct". */
export function spareMeta(s: SpareRef): string {
  return [
    s.typeName,
    s.warrantyEnd ? `warranty to ${monthYear.format(new Date(s.warrantyEnd))}` : "no warranty date",
    s.backOn ? `back ${fmtDayMonth(s.backOn)}` : null,
  ].filter(Boolean).join(" · ");
}

/** What the person's equipment policy says is missing. */
export function gapLine(gaps: string[]): string | null {
  if (gaps.length === 0) return null;
  if (gaps.length === 1) return `Their policy also expects a ${gaps[0]} — none yet.`;
  return `Their policy also expects: ${gaps.join(", ")} — none yet.`;
}

export const firstWord = (name: string): string => name.trim().split(/\s+/)[0] ?? "";

/** The first name of whoever a result card's change was for, read from the Confirm card it answers. */
export function personFirstFor(pendingId: string, messages: CrisViewMessage[]): string | null {
  for (const m of messages) {
    for (const c of m.cards) if (c.type === "confirm" && c.pendingId === pendingId) return firstWord(c.person.name);
  }
  return null;
}

/**
 * Whether a Confirm or Undo answer ends that button: done, or refused for good (already done, expired, changed
 * since, Cris off). A clash with another change at the same moment wrote nothing, so the button stays to press again.
 */
export function pressSettled(res: { ok: true } | { ok: false; kind: ActionErrorKind; message: string } | null): boolean {
  if (!res) return false;
  if (res.ok) return true;
  return res.kind === "conflict" && res.message !== CRIS_SAME_MOMENT;
}

export function undoSecondsLeft(undoUntil: string, now: number): number {
  return Math.max(0, Math.ceil((Date.parse(undoUntil) - now) / 1000));
}

// ── the opening state ───────────────────────────────────────────────────────

/** The profile or record the person is on, as read by `crisPageContext` with their own visibility. */
export type CrisPageContext = { kind: "person"; id: string; name: string } | { kind: "asset"; id: string; tag: string };

/** A quick start either sends its text, or (when Cris needs more, such as why) starts it in the message box. */
export type QuickStart = { label: string; text: string; send: boolean };

/** The greeting's second line (spec §4), and the preview's (added 2026-10-18). */
export function greetingLine(preview: boolean): string {
  return preview
    ? "I'm still in development — for now I can only chat. Soon I'll look things up and make changes for you."
    : "I can look things up and make changes. Every change waits for your Confirm.";
}

/** The context chip's words: "You're on **Ana Reyes**'s profile". */
export function contextLine(ctx: CrisPageContext | null): { before: string; name: string; after: string } | null {
  if (!ctx) return null;
  return ctx.kind === "person"
    ? { before: "You're on ", name: ctx.name, after: "'s profile" }
    : { before: "You're on ", name: ctx.tag, after: "'s record" };
}

const GENERAL: QuickStart[] = [
  { label: "Spares in stock", text: "Spares in stock", send: true },
  { label: "Who has a tag?", text: "Who has ", send: false },
  { label: "Check someone's items", text: "Check the items of ", send: false },
];

/** Preview mode (no key, added 2026-10-18): Cris can only chat, so the box offers two chat starters and nothing else. */
const PREVIEW_STARTS: QuickStart[] = [
  { label: "Say hello", text: "Hello!", send: true },
  { label: "What will you do?", text: "What will you do?", send: true },
];

/**
 * Spec §4: on a profile or a record the first quick starts name that person or asset; elsewhere they are general.
 * In preview, only the two chat starters.
 */
export function quickStarts(ctx: CrisPageContext | null, preview = false): QuickStart[] {
  if (preview) return PREVIEW_STARTS;
  if (!ctx) return GENERAL;
  if (ctx.kind === "person") {
    const first = firstWord(ctx.name);
    return [
      { label: `Check ${first}'s items`, text: `Check ${ctx.name}'s items`, send: true },
      { label: `Replace ${first}'s laptop`, text: `Replace ${ctx.name}'s laptop, `, send: false },
      { label: `Assign a laptop to ${first}`, text: `Assign a laptop to ${ctx.name}`, send: true },
    ];
  }
  return [{ label: `Who has ${ctx.tag}?`, text: `Who has ${ctx.tag}?`, send: true }, GENERAL[0]];
}
