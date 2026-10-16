"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { actionRole } from "@/server/auth/guards";
import { checkRate } from "@/server/rate-limit";
import { writeAudit } from "@/server/audit";
import { conflict, forbidden, ok, rateLimited, validationError, zodFieldErrors, type ActionResult } from "@/server/action-result";
import { SETUP_COLUMN, SETUP_LABELS, SETUP_STATE_LABELS, setupStateSchema, vpnSchema } from "@/lib/it-setup";

/** Phase 37 (spec §4.6): one IT-setup row of an employee's profile, saved on change. Recordable for anyone, offboarded included. */

const employeeId = z.string().min(1);
const schema = z.discriminatedUnion("field", [
  z.object({ employeeId, field: z.literal("entra"), value: setupStateSchema }),
  z.object({ employeeId, field: z.literal("autopilot"), value: setupStateSchema }),
  z.object({ employeeId, field: z.literal("argus"), value: setupStateSchema }),
  z.object({ employeeId, field: z.literal("vpn"), value: vpnSchema }),
]);

const words = (v: string | null): string | null => (v === null ? null : (SETUP_STATE_LABELS as Record<string, string>)[v] ?? v);

export async function setItSetup(input: unknown): Promise<ActionResult<null>> {
  const user = await actionRole("admin", "it_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = schema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const d = parsed.data;
  const e = await prisma.employee.findUnique({
    where: { id: d.employeeId },
    select: { entraStatus: true, autopilotStatus: true, argusStatus: true, vpn: true },
  });
  if (!e) return conflict("That employee no longer exists.");

  const column = d.field === "vpn" ? "vpn" : SETUP_COLUMN[d.field];
  const before: string | null = e[column];
  if (before === d.value) return ok(null); // nothing to change, nothing to audit
  const label = SETUP_LABELS[d.field];

  const saved = await prisma.$transaction(async (tx) => {
    // state-guarded: only the value this change started from may be replaced
    const res = await tx.employee.updateMany({ where: { id: d.employeeId, [column]: before }, data: { [column]: d.value } });
    if (res.count === 0) return false;
    await writeAudit(tx, {
      actorId: user.id, actorLabel: user.name, entityType: "employee", entityId: d.employeeId,
      action: "employee.setup",
      diff: { [label]: { from: words(before), to: words(d.value) } },
    });
    return true;
  });
  if (!saved) return validationError({ _form: "That setting changed — reload and try again" });
  revalidatePath(`/employees/${d.employeeId}`);
  // Phase 40 (spec §7): Mark removed on the offboarding wizard saves through here too.
  revalidatePath(`/offboarding/${d.employeeId}`);
  revalidatePath("/offboarding");
  return ok(null);
}
