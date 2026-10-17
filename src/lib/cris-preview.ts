/*
 * Preview mode (added 2026-10-18, owner's request): with no AI key on the server, Cris still shows up and chats, but
 * only with these placeholder lines — no AI calls, no cost, no lookups and no changes. When a key is added, Cris
 * switches to the real model by itself (crisModeFrom in ./cris-settings.ts). Pure; the adapter is
 * src/server/cris/preview.ts.
 */

/** The owner's placeholder lines, one per reply, in turn. */
export const PREVIEW_LINES = [
  "Hello! I'm Cris — I'm still in development. Soon I'll check items, assign and replace laptops for you.",
  "Hi there! I'm still learning the ropes. For now, the screens do everything I'll soon help with.",
  "Thanks for saying hi! I'm still in development, so I can't look anything up yet.",
  "I'm Cris, your IT inventory assistant — still in training. Check back soon!",
  "Good to meet you! I'm a preview for now: I can chat, but I can't see or change any records yet.",
] as const;

/** The answer when the person asks what Cris does. */
export const PREVIEW_ABOUT =
  "Soon I'll check someone's items, assign and replace laptops, find who has a tag, and list spares in stock — every change waiting for your Confirm. For now I'm a preview, so I can only chat.";

/** Whole words only: "what", "do", "help", or "can you" ("helpful", "whatever" and "can't" don't count). */
const ASKS = /\b(?:what|do|help|can\s+you)\b/i;

export function asksWhatCrisDoes(text: string): boolean {
  return ASKS.test(text);
}

/**
 * The preview reply to `text`: the about line when the person asks what Cris does, otherwise the line at `pick`
 * (wrapping round; a negative, fractional or non-finite index still lands on a line).
 */
export function previewReply(text: string, pick: number): string {
  if (asksWhatCrisDoes(text)) return PREVIEW_ABOUT;
  const n = PREVIEW_LINES.length;
  const i = Number.isFinite(pick) ? Math.floor(pick) : 0;
  return PREVIEW_LINES[((i % n) + n) % n];
}
