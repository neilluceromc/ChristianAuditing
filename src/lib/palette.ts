import type { Prisma } from "@prisma/client";

/**
 * Phase 40 (spec §4): the command palette's pure rules — what an asset search
 * matches, the exact tag first, the hint copy, the stale-response sequence and
 * the in-memory rate window. The server (src/server/palette.ts) and the UI
 * (command-palette.tsx) only wire these up.
 */

/** Rows per group. */
export const PALETTE_LIMIT = 5;

/**
 * The exact-tag asset first, then the rest in their own order without it,
 * capped at `limit`. The exact row comes from its own lookup, so it leads even
 * when the bounded contains query never reached it.
 */
export function exactTagFirst<T extends { id: string }>(exact: T | null, rows: T[], limit = PALETTE_LIMIT): T[] {
  if (!exact) return rows.slice(0, limit);
  return [exact, ...rows.filter((r) => r.id !== exact.id)].slice(0, limit);
}

/** Assets match tag, model, serial and holder name (spec §4). Visibility is ANDed on by the caller. */
export function assetSearchWhere(q: string): Prisma.AssetWhereInput {
  return {
    OR: [
      { tag: { contains: q, mode: "insensitive" } },
      { model: { contains: q, mode: "insensitive" } },
      { serial: { contains: q, mode: "insensitive" } },
      { assignee: { is: { name: { contains: q, mode: "insensitive" } } } },
    ],
  };
}

export const serialHint = (serial: string) => `serial ${serial}`;
export const holderHint = (name: string) => `held by ${name}`;
export const holdsHint = (tag: string) => `holds ${tag}`;

/**
 * Why an asset matched, when the row does not already show it: the serial, or
 * else the holder. A tag or model match needs no hint — both are on the row.
 */
export function assetHint(
  a: { tag: string; model: string; serial: string | null; holderName: string | null },
  query: string,
): string | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  if (a.tag.toLowerCase().includes(q) || a.model.toLowerCase().includes(q)) return null;
  if (a.serial && a.serial.toLowerCase().includes(q)) return serialHint(a.serial);
  if (a.holderName && a.holderName.toLowerCase().includes(q)) return holderHint(a.holderName);
  return null;
}

/**
 * Review focus #4: each keystroke takes a ticket; a response is shown only if
 * its ticket is still the latest. Taking a ticket without searching (clearing
 * the query, closing the palette) retires every request still in flight.
 */
export function createSequence(): { next(): number; isCurrent(ticket: number): boolean } {
  let latest = 0;
  return {
    next: () => ++latest,
    isCurrent: (ticket) => ticket === latest,
  };
}

// In-memory sliding window: 30 searches / 10 s per user. A DB RateEvent per
// keystroke would be write amplification on a read path; process-local is
// fine on a single-machine deploy.
export const SEARCH_WINDOW_MS = 10_000;
export const SEARCH_MAX_IN_WINDOW = 30;

export type SearchRateDecision =
  | { allowed: true; recent: number[] }
  | { allowed: false; recent: number[]; retryAfterSec: number };

/**
 * `recent` = this user's search times (ms), oldest first. Returns the window
 * to keep: with `now` added when allowed, unchanged (only pruned) when not, so
 * refused searches never extend the block.
 */
export function searchRateDecision(recent: number[], now: number): SearchRateDecision {
  const live = recent.filter((t) => now - t < SEARCH_WINDOW_MS);
  if (live.length >= SEARCH_MAX_IN_WINDOW) {
    const freesAt = live[live.length - SEARCH_MAX_IN_WINDOW] + SEARCH_WINDOW_MS;
    return { allowed: false, recent: live, retryAfterSec: Math.max(1, Math.ceil((freesAt - now) / 1000)) };
  }
  return { allowed: true, recent: [...live, now] };
}

/** Spec §4, verbatim. Shown instead of "No matches.". */
export function rateLimitMessage(seconds: number): string {
  return `Too many searches just now — try again in ${seconds} s.`;
}
