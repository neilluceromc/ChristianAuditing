"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db/client";
import { actionRole } from "@/server/auth/guards";
import { checkRate } from "@/server/rate-limit";
import { forbidden, ok, rateLimited, validationError, zodFieldErrors, type ActionResult } from "@/server/action-result";
import { MANAGEABLE_CLASSES } from "@/lib/asset-class";

const schema = z.object({ assetIds: z.array(z.string().min(1)).min(1).max(200) });

/**
 * Phase 34 (spec §5): a print convenience, not a custody change — no audit row. Idempotent:
 * only rows still waiting are stamped, so a reprint never moves labelPrintedAt (Review Focus 5).
 */
export async function markLabelsPrinted(input: unknown): Promise<ActionResult<{ marked: number }>> {
  const user = await actionRole("admin", "it_staff", "purchasing_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = schema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const { count } = await prisma.asset.updateMany({
    where: { id: { in: parsed.data.assetIds }, cls: { in: [...MANAGEABLE_CLASSES[user.role]] }, labelPrintedAt: null },
    data: { labelPrintedAt: new Date() },
  });
  revalidatePath("/inventory/labels");
  return ok({ marked: count });
}
