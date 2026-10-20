import { cache } from "react";
import type { FeatureFlag } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { isUniqueViolation } from "@/server/prisma-errors";
import {
  CRIS_DEFAULTS, CRIS_FLAG_DESCRIPTION, CRIS_FLAG_KEY, crisAvailabilityFrom, crisFlagValue, crisSettingsFromFlag,
  type CrisAvailability, type CrisSettings,
} from "@/lib/cris-settings";
import { CRIS_PREFS_KEY, parseCrisPrefs, type CrisPrefs } from "@/lib/cris-prefs";
import { monthStartManila } from "@/lib/cris-limits";
import { usageCostUsd } from "@/lib/cris-cost";

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

/**
 * Phase 43: the flag row once per request. The (app) layout reads it for admin and IT through crisAvailability() and
 * again through crisWidgetStart(), and Settings › Cris a third time; React `cache()` makes those one SELECT. It is
 * request-scoped (a fresh store per server render; outside one it does not memoise), so a switch flipped between
 * requests is always seen. ensureCrisFlag stays uncached: saveCrisSettings' read-before-write must hit the database.
 */
const crisFlagThisRequest = cache(ensureCrisFlag);

/** Spec §9, "Cris for everyone": the switch, questions per person per day, the model. */
export async function crisSettings(): Promise<CrisSettings> {
  return crisSettingsFromFlag(await crisFlagThisRequest());
}

/** Spec §9, "Your Cris": this person's colour, motion, show, place and hint — defaults until saved. */
export async function crisPrefsFor(userId: string): Promise<CrisPrefs> {
  const row = await prisma.userPreference.findUnique({
    where: { userId_key: { userId, key: CRIS_PREFS_KEY } }, select: { value: true },
  });
  return parseCrisPrefs(row?.value);
}

/**
 * Spec §9, "This month: {n} questions, about {$ cost}" — totals only, across everyone, since the Manila month
 * began (spec §7: admins see totals, never chats). Chats cleared at sign-out (Phase 47) still count: their messages
 * are kept, and nothing here filters on `clearedAt`. Questions are user messages; the cost prices each reply's
 * stored tokens at the model that served it. Two aggregate queries, so the page never grows with the data.
 * Admin-only: the caller (Settings › Cris) shows it only to admins.
 */
export async function crisMonthUsage(now: Date = new Date()): Promise<{ questions: number; costUsd: number }> {
  const since = monthStartManila(now);
  const [questions, byModel] = await Promise.all([
    prisma.crisMessage.count({ where: { role: "user", createdAt: { gte: since } } }),
    prisma.crisMessage.groupBy({
      by: ["model"],
      where: { createdAt: { gte: since }, model: { not: null } },
      _sum: { inputTokens: true, outputTokens: true },
    }),
  ]);
  return {
    questions,
    costUsd: usageCostUsd(byModel.map((g) => ({ model: g.model, inputTokens: g._sum.inputTokens, outputTokens: g._sum.outputTokens }))),
  };
}

/** Off (reason "off") only when the admin switch is off; on with `preview` when no AI key is set (crisModeFrom). */
export async function crisAvailability(): Promise<CrisAvailability> {
  return crisAvailabilityFrom(await crisSettings(), process.env);
}
