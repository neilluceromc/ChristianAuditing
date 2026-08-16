"use server";

import { z } from "zod";
import { prisma } from "./db/client";
import { actionUser } from "./auth/guards";
import { checkRate } from "./rate-limit";
import {
  forbidden, ok, rateLimited, validationError, zodFieldErrors, type ActionResult,
} from "./action-result";
import { COLUMN_PREF_KEYS } from "@/lib/column-prefs";

const schema = z.object({
  key: z.literal("columns:inventory"), // extend to a union as more tables gain choosers
  visible: z.array(z.string()).max(20),
});

/**
 * Preference writes skip the audit trail (user preference, not domain data —
 * recorded scope decision #9) but still count against the mutation budget.
 * Any authenticated role may save its own columns — viewer included.
 */
export async function saveColumns(input: unknown): Promise<ActionResult<null>> {
  const user = await actionUser();
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = schema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));

  const allowed = COLUMN_PREF_KEYS[parsed.data.key] as readonly string[];
  const visible = parsed.data.visible.filter((c) => allowed.includes(c));

  await prisma.userPreference.upsert({
    where: { userId_key: { userId: user.id, key: parsed.data.key } },
    update: { value: visible },
    create: { userId: user.id, key: parsed.data.key, value: visible },
  });
  return ok(null);
}
