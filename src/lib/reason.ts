import { z } from "zod";

/**
 * A paste can smuggle zero-width and other format characters (`\p{Cf}`, e.g.
 * U+200B ZERO WIDTH SPACE, U+2060 WORD JOINER) or control characters
 * (`\p{Cc}`) past a naive `.trim()` — a reason made only of these reads as
 * non-empty to `.trim().length`. Every reason field runs its input through
 * this before the length check, so an invisible-only reason is refused like
 * an empty one.
 */
export function cleanReason(raw: string | null | undefined): string {
  return (raw ?? "").replace(/[\p{Cf}\p{Cc}]/gu, "").trim();
}

export const REASON_MAX = 500;
export const REASON_MESSAGE = "Give a reason (at least 3 characters)";

/**
 * A required reason field: cleaned via `cleanReason`, then length-checked —
 * min/max/message all overridable so each call site keeps its own numbers.
 * zod 4's `.overwrite()` runs the cleanup as a check in place (P-4), so the
 * schema stays a `ZodString` and callers' own `.optional()`/`.default()`
 * chains still type-check the way they did before this helper existed.
 */
export function reasonRequired(opts?: { min?: number; max?: number; message?: string }): z.ZodString {
  const { min = 3, max = REASON_MAX, message = REASON_MESSAGE } = opts ?? {};
  return z.string().overwrite(cleanReason).min(min, message).max(max);
}

/** An optional reason field: cleaned via `cleanReason`, may end up `""`. */
export function reasonOptional(opts?: { max?: number }): z.ZodOptional<z.ZodString> {
  const { max = REASON_MAX } = opts ?? {};
  return z.string().overwrite(cleanReason).max(max).optional();
}
