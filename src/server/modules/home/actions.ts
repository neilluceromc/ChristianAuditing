"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { actionUser } from "@/server/auth/guards";
import { checkRate } from "@/server/rate-limit";
import { DISMISS_PREF_KEY, todayStamp, withDismissal } from "@/lib/home";
import {
  forbidden, ok, rateLimited, validationError, zodFieldErrors, type ActionResult,
} from "@/server/action-result";

const schema = z.object({ key: z.string().min(3).max(120) });

/**
 * Clearing a shift row is a per-user, per-day preference — not an audited
 * domain event. It writes no AuditEntry deliberately: nothing about the record
 * changed, only what this person wants to look at for the rest of today.
 */
export async function dismissShiftRow(input: unknown): Promise<ActionResult<null>> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));

  const user = await actionUser();
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);

  const existing = await prisma.userPreference.findUnique({
    where: { userId_key: { userId: user.id, key: DISMISS_PREF_KEY } },
    select: { value: true },
  });
  // DismissPref has no index signature, so it isn't structurally an
  // InputJsonObject even though every field is JSON-safe (string + string[]).
  // The `value` column is Json, so the bridge is a plain, honest double cast.
  const next = withDismissal(existing?.value, todayStamp(), parsed.data.key) as unknown as Prisma.InputJsonObject;

  await prisma.userPreference.upsert({
    where: { userId_key: { userId: user.id, key: DISMISS_PREF_KEY } },
    create: { userId: user.id, key: DISMISS_PREF_KEY, value: next },
    update: { value: next },
  });

  revalidatePath("/");
  return ok(null);
}
