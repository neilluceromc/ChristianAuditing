// Cris's looks and moods (spec §5). Pure, so the widget and the settings preview share it.
import type { CrisPrefs } from "./cris-prefs";

export type CrisMood = "idle" | "think" | "search" | "talk" | "look" | "sad" | "cross";
/** The colour preference: a colour, or "auto" to match the theme. */
export type CrisColorPref = CrisPrefs["color"];
/** A drawn colour: the preference with "auto" resolved. */
export type CrisColor = Exclude<CrisColorPref, "auto">;
/** Lively plays every mood, Calm only the slow float, Still nothing. */
export type CrisMotion = CrisPrefs["motion"];

/** Match theme is Sky blue in light mode and Silver in dark. */
export function resolveColor(pref: CrisColorPref, theme: "light" | "dark"): CrisColor {
  if (pref === "auto") return theme === "dark" ? "silver" : "sky";
  return pref;
}

export type MoodState = {
  open: boolean;
  busy: "model" | "tools" | null;
  typing: boolean;
  waiting: boolean;
  outcome: "refused" | "empty" | "undone" | "error" | null;
  unread: number;
};

/**
 * The mood for the widget's state. Closed: idle, or talking while a reply waits unread.
 * Open: a turn in flight (thinking, searching, typing out) beats the last outcome;
 * then frustrated on an error, sad on nothing found / refused / Undo, looking while a
 * pick, scan or Confirm is awaited, and idle when Ready.
 *
 * How callers map results onto `outcome`:
 * - a conflict (someone got there first) and a rate limit are passed as `"error"`;
 * - a request refused as forbidden is passed as `"refused"`;
 * - nothing found is `"empty"`, and after Undo it is `"undone"`.
 * The caller clears `outcome` (back to null) when the next turn starts.
 */
export function moodFor(s: MoodState): CrisMood {
  if (!s.open) return s.unread > 0 ? "talk" : "idle";
  if (s.busy === "tools") return "search";
  if (s.busy === "model") return "think";
  if (s.typing) return "talk";
  if (s.outcome === "error") return "cross";
  if (s.outcome) return "sad";
  if (s.waiting) return "look";
  return "idle";
}
