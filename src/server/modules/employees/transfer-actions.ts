"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db/client";
import { actionRole } from "@/server/auth/guards";
import { checkRate } from "@/server/rate-limit";
import { writeAudit } from "@/server/audit";
import {
  conflict, forbidden, ok, rateLimited, validationError, zodFieldErrors, type ActionResult,
} from "@/server/action-result";
import { transferSchema } from "@/lib/transfer-schema";

/**
 * Phase 20 (spec §3): a department transfer is recorded by IT directly — no
 * approval step, `canTransferEmployee` is exactly the roles that already
 * create/edit employees. One transaction: create the `EmployeeTransfer` row
 * (the dated history `Employee.departmentId` alone can't carry — an audit
 * diff has no effective date, and an update overwrites rather than
 * accumulating), update the employee's live `departmentId`/`title`, and
 * audit `employee.transferred` with the diff the brief gives. `toTitle` is
 * REQUIRED even when unchanged (the dialog prefills it with the current
 * title) — a transfer that leaves the title exactly as it was is still a
 * real transfer, not a title-only edit.
 */
export async function transferEmployee(input: unknown): Promise<ActionResult<{ id: string }>> {
  const user = await actionRole("admin", "it_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = transferSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const d = parsed.data;

  const employee = await prisma.employee.findUnique({
    where: { id: d.employeeId },
    include: { department: true },
  });
  if (!employee) return conflict("That employee no longer exists.");
  if (employee.employment === "OFFBOARDED") return conflict("A leaver cannot be transferred");
  if (d.toDepartmentId === employee.departmentId) {
    return validationError({ toDepartmentId: "Already in this department" });
  }
  const toDepartment = await prisma.department.findUnique({ where: { id: d.toDepartmentId } });
  if (!toDepartment) return validationError({ toDepartmentId: "Unknown department" });

  const effectiveAt = new Date(`${d.effectiveAt}T00:00:00Z`);
  if (Number.isNaN(effectiveAt.getTime())) return validationError({ effectiveAt: "Use the date picker" });

  await prisma.$transaction(async (tx) => {
    await tx.employeeTransfer.create({
      data: {
        employeeId: employee.id,
        fromDepartmentId: employee.departmentId,
        toDepartmentId: d.toDepartmentId,
        fromTitle: employee.title,
        toTitle: d.toTitle,
        effectiveAt,
        reason: d.reason || null,
        actorId: user.id,
      },
    });
    await tx.employee.update({
      where: { id: employee.id },
      data: { departmentId: d.toDepartmentId, title: d.toTitle },
    });
    await writeAudit(tx, {
      actorId: user.id, actorLabel: user.name,
      entityType: "employee", entityId: employee.id,
      action: "employee.transferred",
      diff: {
        department: { from: employee.department.name, to: toDepartment.name },
        title: { from: employee.title, to: d.toTitle },
        effectiveAt: { from: null, to: effectiveAt },
      },
    });
  });

  revalidatePath("/employees");
  revalidatePath(`/employees/${employee.id}`);
  revalidatePath(`/employees/${employee.id}/timeline`);
  revalidatePath("/offboarding");
  return ok({ id: employee.id });
}
