"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { actionRole } from "@/server/auth/guards";
import { checkRate } from "@/server/rate-limit";
import { writeAudit } from "@/server/audit";
import { createApproval, openApprovalForAsset } from "@/server/modules/approvals/create";
import {
  conflict, forbidden, ok, rateLimited, validationError, zodFieldErrors, type ActionResult,
} from "@/server/action-result";
import { diffOf } from "@/lib/audit-diff";

const assignSchema = z.object({
  employeeId: z.string().min(1),
  assetId: z.string().min(1),
  reason: z.string().trim().max(500).optional(),
});

/** `+` on a slot: lifecycle.assign approval. The asset stays SPARE until execution. */
export async function requestAssign(input: unknown): Promise<ActionResult<{ refNo: string }>> {
  const user = await actionRole("admin", "it_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = assignSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const d = parsed.data;

  let refNo = "";
  try {
    const failure = await prisma.$transaction(async (tx) => {
      const employee = await tx.employee.findUnique({ where: { id: d.employeeId } });
      if (!employee) return conflict("That employee no longer exists.");
      if (employee.employment !== "ACTIVE") {
        return conflict(`${employee.name} is ${employee.employment.toLowerCase()} — slots are frozen.`);
      }
      const asset = await tx.asset.findUnique({
        where: { id: d.assetId },
        include: { reservations: { where: { state: "ACTIVE" }, include: { employee: true } } },
      });
      if (!asset) return conflict("That asset no longer exists.");
      if (asset.status !== "SPARE") return conflict(`${asset.tag} is ${asset.status}, not SPARE — only spares can be assigned.`);
      const hold = asset.reservations[0];
      if (hold && hold.employeeId !== d.employeeId) {
        return conflict(`${asset.tag} is reserved for ${hold.employee.name} — release the hold first.`);
      }
      if (await openApprovalForAsset(tx, asset.id)) {
        return conflict(`${asset.tag} already has an open request.`);
      }
      const approval = await createApproval(tx, {
        type: "lifecycle_assign",
        payload: {
          to: { assigneeId: d.employeeId, status: "DEPLOYED" },
          reason: d.reason || (hold ? "reserved — fulfilling the hold" : "slot fill"),
        },
        requestedById: user.id,
        assetId: asset.id,
        employeeId: d.employeeId,
      });
      await writeAudit(tx, {
        actorId: user.id, actorLabel: user.name,
        entityType: "asset", entityId: asset.id,
        action: "approval.requested",
        diff: { approval: { from: null, to: approval.refNo } },
      });
      refNo = approval.refNo;
      return null;
    });
    if (failure) return failure;
  } catch (err) {
    // The partial unique index (one OPEN approval per asset) turns a
    // concurrent-request race into a constraint violation.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return conflict("Someone else just requested a change on this asset — refresh and retry.");
    }
    throw err;
  }
  revalidatePath(`/employees/${d.employeeId}`);
  revalidatePath("/inventory");
  return ok({ refNo });
}

const returnSchema = z.object({
  employeeId: z.string().min(1),
  assetId: z.string().min(1),
  reason: z.string().trim().min(3, "Give a reason (at least 3 characters)").max(500),
});

/** `−` on a filled tile: lifecycle.return approval. */
export async function requestReturn(input: unknown): Promise<ActionResult<{ refNo: string }>> {
  const user = await actionRole("admin", "it_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = returnSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const d = parsed.data;

  let refNo = "";
  try {
    const failure = await prisma.$transaction(async (tx) => {
      const asset = await tx.asset.findUnique({ where: { id: d.assetId } });
      if (!asset) return conflict("That asset no longer exists.");
      if (asset.assigneeId !== d.employeeId) return conflict(`${asset.tag} isn't held by this person.`);
      if (await openApprovalForAsset(tx, asset.id)) return conflict(`${asset.tag} already has an open request.`);
      const approval = await createApproval(tx, {
        type: "lifecycle_return",
        payload: {
          from: { assigneeId: d.employeeId },
          to: { assigneeId: null, status: "SPARE" },
          reason: d.reason,
        },
        requestedById: user.id,
        assetId: asset.id,
        employeeId: d.employeeId,
      });
      await writeAudit(tx, {
        actorId: user.id, actorLabel: user.name,
        entityType: "asset", entityId: asset.id,
        action: "approval.requested",
        diff: { approval: { from: null, to: approval.refNo } },
      });
      refNo = approval.refNo;
      return null;
    });
    if (failure) return failure;
  } catch (err) {
    // The partial unique index (one OPEN approval per asset) turns a
    // concurrent-request race into a constraint violation.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return conflict("Someone else just requested a change on this asset — refresh and retry.");
    }
    throw err;
  }
  revalidatePath(`/employees/${d.employeeId}`);
  revalidatePath("/inventory");
  return ok({ refNo });
}

const reservedSchema = z.object({ employeeId: z.string().min(1) });

/** Day-one: one button turns every ACTIVE reservation into its own assign request. */
export async function requestAssignReserved(input: unknown): Promise<ActionResult<{ created: number }>> {
  const user = await actionRole("admin", "it_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = reservedSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const { employeeId } = parsed.data;

  let created = 0;
  try {
    const failure = await prisma.$transaction(async (tx) => {
      const employee = await tx.employee.findUnique({ where: { id: employeeId } });
      if (!employee) return conflict("That employee no longer exists.");
      if (employee.employment !== "ACTIVE") return conflict("Slots are frozen for a leaver.");
      const holds = await tx.reservation.findMany({
        where: { employeeId, state: "ACTIVE" },
        include: { asset: true },
      });
      for (const hold of holds) {
        if (hold.asset.status !== "SPARE") continue;
        if (await openApprovalForAsset(tx, hold.assetId)) continue;
        const approval = await createApproval(tx, {
          type: "lifecycle_assign",
          payload: { to: { assigneeId: employeeId, status: "DEPLOYED" }, reason: "reserved — day-one setup" },
          requestedById: user.id,
          assetId: hold.assetId,
          employeeId,
        });
        await writeAudit(tx, {
          actorId: user.id, actorLabel: user.name,
          entityType: "asset", entityId: hold.assetId,
          action: "approval.requested",
          diff: { approval: { from: null, to: approval.refNo } },
        });
        created += 1;
      }
      return null;
    });
    if (failure) return failure;
  } catch (err) {
    // The partial unique index (one OPEN approval per asset) turns a
    // concurrent-request race into a constraint violation.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return conflict("Someone else just requested a change on one of these assets — refresh and retry.");
    }
    throw err;
  }
  if (created === 0) return conflict("No reserved spares were available to request.");
  revalidatePath(`/employees/${employeeId}`);
  return ok({ created });
}

const employeeSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(2, "Name the person").max(120),
  title: z.string().trim().min(2, "Give a title").max(120),
  departmentId: z.string().min(1, "Pick a department"),
  employment: z.enum(["ACTIVE", "OFFBOARDING", "OFFBOARDED"]),
  /** null = never synced ("no sync yet"); custom strings stored as-is → Neutral family */
  m365Status: z.string().trim().max(60).nullable(),
});

export async function updateEmployee(input: unknown): Promise<ActionResult<{ id: string }>> {
  const user = await actionRole("admin", "it_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = employeeSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const d = parsed.data;

  const employee = await prisma.employee.findUnique({ where: { id: d.id } });
  if (!employee) return conflict("That employee no longer exists.");
  if (!(await prisma.department.findUnique({ where: { id: d.departmentId } }))) {
    return validationError({ departmentId: "Unknown department" });
  }

  const data = {
    name: d.name,
    title: d.title,
    departmentId: d.departmentId,
    employment: d.employment,
    m365Status: d.m365Status === "" ? null : d.m365Status,
  };
  const diff = diffOf(employee as unknown as Record<string, unknown>, data);
  if (Object.keys(diff).length === 0) return ok({ id: employee.id });

  await prisma.$transaction(async (tx) => {
    await tx.employee.update({ where: { id: employee.id }, data });
    await writeAudit(tx, {
      actorId: user.id, actorLabel: user.name,
      entityType: "employee", entityId: employee.id,
      action: "update", diff,
    });
  });
  revalidatePath(`/employees/${employee.id}`);
  revalidatePath("/employees");
  return ok({ id: employee.id });
}
