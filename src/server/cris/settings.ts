"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db/client";
import { actionRole, actionUser } from "@/server/auth/guards";
import { checkRate } from "@/server/rate-limit";
import { writeAudit } from "@/server/audit";
import { asActionResult } from "@/server/prisma-errors";
import {
  conflict, forbidden, ok, rateLimited, validationError, zodFieldErrors, type ActionResult,
} from "@/server/action-result";
import { diffOf } from "@/lib/audit-diff";
import { CRIS_FLAG_KEY, crisFlagValue, crisSettingsFromFlag, crisSettingsSchema } from "@/lib/cris-settings";
import { CRIS_PREFS_KEY, crisPrefsSchema, parseCrisPrefs, type CrisPrefs } from "@/lib/cris-prefs";
import { ensureCrisFlag } from "./settings-read";

/**
 * Spec §9, "Cris for everyone" — admins only, audited as `cris-settings` on the `cris` FeatureFlag
 * row. The readers live in ./settings-read.ts (see the note there).
 */
export async function saveCrisSettings(input: unknown): Promise<ActionResult<{ changed: boolean }>> {
  const actor = await actionRole("admin");
  if (!actor) return forbidden();
  const rate = await checkRate(actor.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = crisSettingsSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const next = parsed.data;

  await ensureCrisFlag();
  const result = await asActionResult(
    async () =>
      prisma.$transaction(async (tx) => {
        // Every return below that isn't a success precedes the one write, so nothing commits half-done.
        const flag = await tx.featureFlag.findUnique({ where: { key: CRIS_FLAG_KEY } });
        if (!flag) return conflict("Cris's settings couldn't be found — refresh and try again.");
        const diff = diffOf(crisSettingsFromFlag(flag), next);
        if (Object.keys(diff).length === 0) return ok({ changed: false }); // no-op: don't pollute the trail

        // Guarded on updatedAt, as setFlagValue is: two admins saving from the same page must not both
        // write an audit row claiming the same `from`.
        const written = await tx.featureFlag.updateMany({
          where: { key: CRIS_FLAG_KEY, updatedAt: flag.updatedAt },
          data: { enabled: next.on, value: crisFlagValue(next) },
        });
        if (written.count === 0) return conflict("Someone else just changed Cris's settings — refresh.");

        await writeAudit(tx, {
          actorId: actor.id,
          actorLabel: actor.name,
          entityType: "feature-flag",
          entityId: flag.id,
          action: "cris-settings",
          diff,
        });
        return ok({ changed: true });
      }),
    { goneMessage: "Cris's settings couldn't be found — refresh and try again." },
  );
  if (!result.ok) return result;
  // The switch decides whether the mascot renders in the shared (app) layout, so every page.
  if (result.data.changed) revalidatePath("/", "layout");
  return result;
}

const prefsPatch = crisPrefsSchema.partial();

/**
 * Spec §9, "Your Cris": per person, under UserPreference `cris:prefs`. Takes any subset of the
 * fields (a drag saves only side and bottom; the hint saves only seenHint), merges it over what is
 * stored, and returns the full result. Not audited — a preference, the same as saveLoadoutView.
 */
export async function saveCrisPrefs(input: unknown): Promise<ActionResult<CrisPrefs>> {
  const user = await actionUser();
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = prefsPatch.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));

  const where = { userId_key: { userId: user.id, key: CRIS_PREFS_KEY } };
  const stored = await prisma.userPreference.findUnique({ where, select: { value: true } });
  // An explicit `undefined` from the client means "not sent", never "clear this field".
  const patch = Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined));
  const value: CrisPrefs = { ...parseCrisPrefs(stored?.value), ...patch };
  await prisma.userPreference.upsert({
    where,
    update: { value },
    create: { userId: user.id, key: CRIS_PREFS_KEY, value },
  });
  return ok(value);
}
