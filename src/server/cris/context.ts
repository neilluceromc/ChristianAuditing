"use server";

import { z } from "zod";
import { prisma } from "@/server/db/client";
import { actionRole } from "@/server/auth/guards";
import { checkRate } from "@/server/rate-limit";
import { conflict, forbidden, ok, rateLimited, validationError, zodFieldErrors, type ActionResult } from "@/server/action-result";
import { visibleClassWhere } from "@/lib/asset-class";
import { pathAllowedForRole } from "@/lib/workspaces";
import { pageEntity } from "@/lib/cris-picks";
import type { CrisPageContext } from "@/lib/cris-box";
import { crisAvailability } from "./settings-read";
import { CRIS_OFF_NO_KEY, CRIS_OFF_SWITCH } from "./turn-core";

const schema = z.object({ path: z.string().max(500) }).strict();

/**
 * Spec §4 "Opening state": the profile or asset record the box was opened on, for the context chip and the quick
 * starts that name it. Read with the person's own visibility (the same checks as a pick in ./turn-core.ts): a
 * record they can't open on the normal screens reads as no context, never as a refusal that confirms it exists.
 */
export async function crisPageContext(input: { path: string }): Promise<ActionResult<CrisPageContext | null>> {
  const user = await actionRole("admin", "it_staff");
  if (!user) return forbidden();
  // Like every Cris action, it answers nothing while Cris is off.
  const availability = await crisAvailability();
  if (!availability.on) return conflict(availability.reason === "no-key" ? CRIS_OFF_NO_KEY : CRIS_OFF_SWITCH);
  const rate = await checkRate(user.id, "check");
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = schema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));

  const { employeeId, assetId } = pageEntity(parsed.data.path);
  if (employeeId && pathAllowedForRole("/employees/x", user.role)) {
    const e = await prisma.employee.findUnique({ where: { id: employeeId }, select: { id: true, name: true } });
    return ok(e ? { kind: "person", id: e.id, name: e.name } : null);
  }
  if (assetId && pathAllowedForRole("/inventory/x", user.role)) {
    const a = await prisma.asset.findFirst({ where: { AND: [{ id: assetId }, visibleClassWhere(user.role)] }, select: { id: true, tag: true } });
    return ok(a ? { kind: "asset", id: a.id, tag: a.tag } : null);
  }
  return ok(null);
}
