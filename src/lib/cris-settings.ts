import { z } from "zod";

/** Spec §8: Haiku is the default; admins may pick Sonnet or Opus in Settings › Cris. */
export const CRIS_MODELS = ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5"] as const;
export type CrisModelId = (typeof CRIS_MODELS)[number];

/** Spec §9, "Cris for everyone": the admin switch, questions per person per day, the AI model. */
export type CrisSettings = { on: boolean; dailyLimit: number; model: CrisModelId };

export const CRIS_DEFAULTS: CrisSettings = { on: true, dailyLimit: 100, model: "claude-haiku-5-5" };

export const CRIS_DAILY_MIN = 1;
export const CRIS_DAILY_MAX = 1000;

/** The admin's save. Strict where the reader is forgiving: a bad value is refused, not clamped. */
export const crisSettingsSchema = z.object({
  on: z.boolean(),
  dailyLimit: z.number().int().min(CRIS_DAILY_MIN).max(CRIS_DAILY_MAX),
  model: z.enum(CRIS_MODELS),
});

function isModel(v: unknown): v is CrisModelId {
  return typeof v === "string" && (CRIS_MODELS as readonly string[]).includes(v);
}

/**
 * The stored settings, read defensively: each field that is missing or malformed falls back to its
 * default on its own, so one bad field never resets the others. `dailyLimit` is rounded and clamped
 * to 1–1000. Input is `{on, dailyLimit, model}` — the server reader assembles it from the `cris`
 * FeatureFlag row (`enabled` → `on`, `value` → the rest).
 */
export function parseCrisSettings(json: unknown): CrisSettings {
  const o = json && typeof json === "object" && !Array.isArray(json) ? (json as Record<string, unknown>) : {};
  const limit = typeof o.dailyLimit === "number" && Number.isFinite(o.dailyLimit)
    ? Math.min(CRIS_DAILY_MAX, Math.max(CRIS_DAILY_MIN, Math.round(o.dailyLimit)))
    : CRIS_DEFAULTS.dailyLimit;
  return {
    on: typeof o.on === "boolean" ? o.on : CRIS_DEFAULTS.on,
    dailyLimit: limit,
    model: isModel(o.model) ? o.model : CRIS_DEFAULTS.model,
  };
}

/**
 * Spec §9: stored as the one `FeatureFlag` row `cris` — `enabled` is the switch, `value` holds
 * `{dailyLimit, model}`. Deliberately NOT in `FLAG_SPECS` (src/lib/admin-flags.ts), whose generic
 * code reads a flag's value as the signup domain; only Settings › Cris reads and writes this row.
 */
export const CRIS_FLAG_KEY = "cris";
export const CRIS_FLAG_DESCRIPTION =
  "Cris, the in-app IT assistant: the switch, questions per person per day, and the AI model. Edited in Settings › Cris.";

export function crisSettingsFromFlag(row: { enabled: boolean; value: unknown }): CrisSettings {
  const value = row.value && typeof row.value === "object" && !Array.isArray(row.value) ? row.value : {};
  return parseCrisSettings({ ...value, on: row.enabled });
}

export function crisFlagValue(s: CrisSettings): { dailyLimit: number; model: CrisModelId } {
  return { dailyLimit: s.dailyLimit, model: s.model };
}

export type CrisAvailability ={ on: boolean; reason?: "off" | "no-key" };

/**
 * Plan, "Who and when": Cris is off when the admin switch is off (checked first), or when no
 * `ANTHROPIC_API_KEY` is set — except that `CRIS_MODEL=fake` stands in for the key outside
 * production (spec §8: the fake model is refused when NODE_ENV=production).
 */
export function crisAvailabilityFrom(
  settings: Pick<CrisSettings, "on">,
  env: Partial<Record<"ANTHROPIC_API_KEY" | "CRIS_MODEL" | "NODE_ENV", string | undefined>>,
): CrisAvailability {
  if (!settings.on) return { on: false, reason: "off" };
  const fake = env.CRIS_MODEL === "fake" && env.NODE_ENV !== "production";
  if (!env.ANTHROPIC_API_KEY && !fake) return { on: false, reason: "no-key" };
  return { on: true };
}
