import { z } from "zod";

/** Spec §9, "Your Cris": stored per person in `UserPreference` under this key. */
export const CRIS_PREFS_KEY = "cris:prefs";

export const CRIS_COLORS = ["gold", "sky", "silver", "auto"] as const;
export const CRIS_MOTIONS = ["lively", "calm", "still"] as const;
export const CRIS_SIDES = ["left", "right"] as const;

export const CRIS_BOTTOM_MIN = 16;
export const CRIS_BOTTOM_MAX = 2000;

export type CrisPrefs = {
  color: (typeof CRIS_COLORS)[number];
  motion: (typeof CRIS_MOTIONS)[number];
  show: boolean;
  side: (typeof CRIS_SIDES)[number];
  /** px from the viewport's bottom edge, where the mascot was last dropped */
  bottom: number;
  /** the first-run hint has been seen and dismissed */
  seenHint: boolean;
  /** tucked away: a slim tab on the screen's edge instead of the mascot (spec §4, added 2026-10-18) */
  tucked: boolean;
};

/** New people start on Match theme, Lively, shown in the bottom-right corner (20 px up since 2026-10-18), not tucked. */
export const CRIS_PREF_DEFAULTS: CrisPrefs = {
  color: "auto", motion: "lively", show: true, side: "right", bottom: 20, seenHint: false, tucked: false,
};

/** The default height before 2026-10-18; parseCrisPrefs reads a stored one as the new default. */
const CRIS_OLD_DEFAULT_BOTTOM = 72;

export const crisPrefsSchema = z.object({
  color: z.enum(CRIS_COLORS),
  motion: z.enum(CRIS_MOTIONS),
  show: z.boolean(),
  side: z.enum(CRIS_SIDES),
  bottom: z.number().int().min(CRIS_BOTTOM_MIN).max(CRIS_BOTTOM_MAX),
  seenHint: z.boolean(),
  tucked: z.boolean(),
});

/** The stored value, read defensively: each bad or missing field falls back to its default on its own. */
export function parseCrisPrefs(json: unknown): CrisPrefs {
  const o = json && typeof json === "object" && !Array.isArray(json) ? (json as Record<string, unknown>) : {};
  const out: CrisPrefs = { ...CRIS_PREF_DEFAULTS };
  for (const key of Object.keys(crisPrefsSchema.shape) as (keyof CrisPrefs)[]) {
    const field = crisPrefsSchema.shape[key].safeParse(o[key]);
    if (field.success) (out as Record<keyof CrisPrefs, unknown>)[key] = field.data;
  }
  // The corner moved from 72 px up to 20 px on 2026-10-18; a stored 72 is the old default, so it becomes the new one.
  if (out.bottom === CRIS_OLD_DEFAULT_BOTTOM) out.bottom = CRIS_PREF_DEFAULTS.bottom;
  return out;
}
