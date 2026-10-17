"use server";

import { z } from "zod";
import { actionRole } from "@/server/auth/guards";
import { checkRate } from "@/server/rate-limit";
import { forbidden, rateLimited, validationError, zodFieldErrors, type ActionResult } from "@/server/action-result";
import { revalidateAsset } from "@/server/modules/lifecycle/revalidate";
import { confirmPending, undoPending, type Affected, type CrisActionData } from "./pending-core";

/*
 * Spec §6.2 and §6.4: the box's Confirm and Undo buttons. They send only the pending action's id; everything else
 * is read back from the stored action. `createPending` is deliberately not here (./pending-core.ts): it takes a
 * user and a transaction, and every export of this file is callable from the browser.
 */

const pendingSchema = z.object({ pendingId: z.string().min(1) });

/** The pages the manual actions refresh: each asset, the inventory list, home and the person's profile. */
function revalidateAffected(a: Affected): void {
  for (const id of a.assetIds) revalidateAsset(id, [a.employeeId]);
}

/**
 * Runs the stored change for real, as the person, `via: "Cris"`. Refusals: not theirs → forbidden; used →
 * "That's already done."; expired → "That expired — ask me again."; the action's own refusal comes back as
 * Cris's message with the spares still pickable (`refused: true`, for the Frustrated mood).
 */
export async function crisConfirm(input: { pendingId: string }): Promise<ActionResult<CrisActionData>> {
  const user = await actionRole("admin", "it_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = pendingSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const { result, affected } = await confirmPending(user, parsed.data.pendingId);
  if (affected) revalidateAffected(affected);
  return result;
}

/**
 * Reverses a confirmed change within 60 s, while nothing else has touched its assets; otherwise "Something changed
 * since — reverse it from the record instead."
 */
export async function crisUndo(input: { pendingId: string }): Promise<ActionResult<CrisActionData>> {
  const user = await actionRole("admin", "it_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = pendingSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const { result, affected } = await undoPending(user, parsed.data.pendingId);
  if (affected) revalidateAffected(affected);
  return result;
}
