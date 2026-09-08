"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { EmploymentStatus } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { actionRole } from "@/server/auth/guards";
import { checkRate } from "@/server/rate-limit";
import { writeAudit } from "@/server/audit";
import { conflict, forbidden, ok, rateLimited, validationError, zodFieldErrors, type ActionResult } from "@/server/action-result";
import { resolvePolicy } from "@/lib/loadout";

const reason = z.string().trim().min(3, "Give a reason (at least 3 characters)").max(500);

function revalidate(employeeId: string) {
  revalidatePath(`/employees/${employeeId}`);
  revalidatePath("/employees");
  revalidatePath("/");
}

/**
 * The two refusals every exception write shares: the person exists and is not
 * gone. Return type is explicit (unlike the brief's sketch) because TS's
 * inferred return type for a helper with differently-shaped branches adds a
 * companion `otherKey?: undefined` to each member, which defeats `"failure"
 * in loaded` narrowing at the call sites below — an explicit union avoids it.
 */
async function loadEmployee(employeeId: string): Promise<
  | { failure: ActionResult<never> }
  | { employee: { id: string; title: string; departmentId: string; employment: EmploymentStatus } }
> {
  const e = await prisma.employee.findUnique({ where: { id: employeeId }, select: { id: true, title: true, departmentId: true, employment: true } });
  if (!e) return { failure: conflict("That employee no longer exists.") };
  if (e.employment === "OFFBOARDED") return { failure: conflict("This offboarding is closed — exceptions cannot change.") };
  return { employee: e };
}

const addSchema = z.object({
  employeeId: z.string().min(1),
  name: z.string().trim().min(2, "Name the slot").max(40),
  assetTypeId: z.string().min(1, "Pick an asset type"),
  required: z.boolean(),
  loaner: z.boolean(),
  reason,
});

export async function addSlotException(input: unknown): Promise<ActionResult<{ id: string }>> {
  const user = await actionRole("admin", "it_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = addSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const d = parsed.data;
  const loaded = await loadEmployee(d.employeeId);
  if ("failure" in loaded) return loaded.failure;
  const type = await prisma.assetType.findFirst({ where: { id: d.assetTypeId, category: { cls: "IT" } }, select: { name: true } });
  if (!type) return validationError({ assetTypeId: "Unknown asset type" });

  const id = await prisma.$transaction(async (tx) => {
    const row = await tx.employeeSlotException.create({
      data: { employeeId: d.employeeId, kind: "ADD", name: d.name, assetTypeId: d.assetTypeId, required: d.required, loaner: d.loaner, reason: d.reason, createdById: user.id },
    });
    await writeAudit(tx, {
      actorId: user.id, actorLabel: user.name, entityType: "employee", entityId: d.employeeId,
      action: "policy.exception.added",
      diff: { slot: { from: null, to: `${d.name}${d.loaner ? " (loaner)" : ""} · ${type.name}` }, reason: { from: null, to: d.reason } },
    });
    return row.id;
  });
  revalidate(d.employeeId);
  return ok({ id });
}

const waiveSchema = z.object({ employeeId: z.string().min(1), slotId: z.string().min(1), reason });

export async function waiveSlot(input: unknown): Promise<ActionResult<{ id: string }>> {
  const user = await actionRole("admin", "it_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = waiveSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const d = parsed.data;
  const loaded = await loadEmployee(d.employeeId);
  if ("failure" in loaded) return loaded.failure;

  const policies = await prisma.equipmentPolicy.findMany({ include: { slots: true } });
  const policy = resolvePolicy(loaded.employee, policies);
  const slot = policy?.slots.find((s) => s.id === d.slotId);
  if (!slot) return conflict("That slot is not part of this person's policy.");
  const dup = await prisma.employeeSlotException.findFirst({ where: { employeeId: d.employeeId, kind: "WAIVE", slotId: d.slotId } });
  if (dup) return conflict(`${slot.name} is already waived for this person.`);

  const id = await prisma.$transaction(async (tx) => {
    const row = await tx.employeeSlotException.create({
      data: { employeeId: d.employeeId, kind: "WAIVE", slotId: d.slotId, reason: d.reason, createdById: user.id },
    });
    await writeAudit(tx, {
      actorId: user.id, actorLabel: user.name, entityType: "employee", entityId: d.employeeId,
      action: "policy.exception.waived",
      diff: { slot: { from: `${slot.name}${slot.loaner ? " (loaner)" : ""}`, to: null }, reason: { from: null, to: d.reason } },
    });
    return row.id;
  });
  revalidate(d.employeeId);
  return ok({ id });
}

const idSchema = z.object({ id: z.string().min(1) });

export async function removeSlotException(input: unknown): Promise<ActionResult<null>> {
  const user = await actionRole("admin", "it_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const row = await prisma.employeeSlotException.findUnique({ where: { id: parsed.data.id }, include: { slot: true } });
  if (!row) return ok(null); // already gone — idempotent
  const loaded = await loadEmployee(row.employeeId);
  if ("failure" in loaded) return loaded.failure;
  const label = row.kind === "ADD" ? `${row.name}${row.loaner ? " (loaner)" : ""}` : `waiver of ${row.slot?.name ?? "a removed slot"}`;
  await prisma.$transaction(async (tx) => {
    await tx.employeeSlotException.delete({ where: { id: row.id } });
    await writeAudit(tx, {
      actorId: user.id, actorLabel: user.name, entityType: "employee", entityId: row.employeeId,
      action: "policy.exception.removed",
      diff: { slot: { from: label, to: null } },
    });
  });
  revalidate(row.employeeId);
  return ok(null);
}
