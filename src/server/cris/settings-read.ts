import type { FeatureFlag } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { isUniqueViolation } from "@/server/prisma-errors";
import {
  CRIS_DEFAULTS, CRIS_FLAG_DESCRIPTION, CRIS_FLAG_KEY, crisAvailabilityFrom, crisFlagValue, crisSettingsFromFlag,
  type CrisAvailability, type CrisSettings,
} from "@/lib/cris-settings";
import { CRIS_PREFS_KEY, parseCrisPrefs, type CrisPrefs } from "@/lib/cris-prefs";

/**
 * The readers beside the actions in ./settings.ts, deliberately NOT in that "use server" module:
 * every export of a "use server" file is a public endpoint, and `crisPrefsFor(userId)` would then
 * hand any signed-in caller anyone's prefs. Same split as loadout-view.ts / preferences.ts.
 */

/**
 * The `cris` flag row, created with the defaults the first time anything asks for it. Read-first:
 * the layout calls crisAvailability() on every page, so the common path is one SELECT, never a write.
 */
export async function ensureCrisFlag(): Promise<FeatureFlag> {
  const existing = await prisma.featureFlag.findUnique({ where: { key: CRIS_FLAG_KEY } });
  if (existing) return existing;
  try {
    return await prisma.featureFlag.create({
      data: {
        key: CRIS_FLAG_KEY,
        enabled: CRIS_DEFAULTS.on,
        description: CRIS_FLAG_DESCRIPTION,
        value: crisFlagValue(CRIS_DEFAULTS),
      },
    });
  } catch (err) {
    // Two first-ever reads racing: the loser's insert hits the unique key; the winner's row is the answer.
    if (!isUniqueViolation(err)) throw err;
    return prisma.featureFlag.findUniqueOrThrow({ where: { key: CRIS_FLAG_KEY } });
  }
}

/** Spec §9, "Cris for everyone": the switch, questions per person per day, the model. */
export async function crisSettings(): Promise<CrisSettings> {
  return crisSettingsFromFlag(await ensureCrisFlag());
}

/** Spec §9, "Your Cris": this person's colour, motion, show, place and hint — defaults until saved. */
export async function crisPrefsFor(userId: string): Promise<CrisPrefs> {
  const row = await prisma.userPreference.findUnique({
    where: { userId_key: { userId, key: CRIS_PREFS_KEY } }, select: { value: true },
  });
  return parseCrisPrefs(row?.value);
}

/** Off with reason "off" when the admin switch is off (checked first), "no-key" when no AI key is set. */
export async function crisAvailability(): Promise<CrisAvailability> {
  return crisAvailabilityFrom(await crisSettings(), process.env);
}
