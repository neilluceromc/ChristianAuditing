"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { actionUser } from "@/server/auth/guards";
import { checkRate } from "@/server/rate-limit";
import { DISMISS_PREF_KEY, todayStamp, withDismissal, withoutDismissal, type DismissPref } from "@/lib/home";
import {
  forbidden, ok, rateLimited, validationError, zodFieldErrors, type ActionResult,
} from "@/server/action-result";

const schema = z.object({ key: z.string().min(3).max(120) });

/**
 * Hiding a worklist row is a per-user, per-day preference — not an audited
 * domain event. It writes no AuditEntry deliberately: nothing about the record
 * changed, only what this person wants to look at for the rest of today.
 */
export async function dismissShiftRow(input: unknown): Promise<ActionResult<null>> {
  const user = await actionUser();
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = schema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  await writeDismissal(user.id, (value) => withDismissal(value, todayStamp(), parsed.data.key));
  return ok(null);
}

/** Undo for Hide until tomorrow (spec §5.2) — the same per-user, per-day preference, one key removed. */
export async function undismissShiftRow(input: unknown): Promise<ActionResult<null>> {
  const user = await actionUser();
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = schema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  await writeDismissal(user.id, (value) => withoutDismissal(value, todayStamp(), parsed.data.key));
  return ok(null);
}

async function writeDismissal(userId: string, next: (value: unknown) => DismissPref) {
  const existing = await prisma.userPreference.findUnique({
    where: { userId_key: { userId, key: DISMISS_PREF_KEY } },
    select: { value: true },
  });
  // DismissPref has no index signature, so it isn't structurally an
  // InputJsonObject even though every field is JSON-safe (string + string[]).
  // The `value` column is Json, so the bridge is a plain, honest double cast.
  const value = next(existing?.value) as unknown as Prisma.InputJsonObject;
  await prisma.userPreference.upsert({
    where: { userId_key: { userId, key: DISMISS_PREF_KEY } },
    create: { userId, key: DISMISS_PREF_KEY, value },
    update: { value },
  });
  revalidatePath("/");
  revalidatePath("/inventory/work");
}
