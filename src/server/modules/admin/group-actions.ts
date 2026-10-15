"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { actionRole } from "@/server/auth/guards";
import { isUniqueViolation } from "@/server/prisma-errors";
import { checkRate } from "@/server/rate-limit";
import { writeAudit } from "@/server/audit";
import { GROUP_NAME_TAKEN } from "@/lib/groups";
import {
  forbidden, ok, rateLimited, validationError, zodFieldErrors, type ActionResult,
} from "@/server/action-result";

/** Phase 37 (spec §2.2): create, rename and end/archive for departments and clients — one table, one set of actions. */

const nameSchema = z.string().trim().min(2, "At least 2 characters").max(60);

function revalidate() {
  for (const p of ["/admin/departments", "/admin/equipment-policies", "/employees", "/employees/new"]) revalidatePath(p);
}

/** The friendly first answer; the lower(name) unique index is the real guard (P2002 is caught below). */
async function nameTaken(name: string, excludeId?: string): Promise<boolean> {
  const hit = await prisma.department.findFirst({
    where: { name: { equals: name, mode: "insensitive" }, ...(excludeId ? { NOT: { id: excludeId } } : {}) },
    select: { id: true },
  });
  return !!hit;
}

const createSchema = z.object({ kind: z.enum(["INTERNAL", "CLIENT"]), name: nameSchema });

export async function createGroup(input: unknown): Promise<ActionResult<{ id: string }>> {
  const user = await actionRole("admin", "it_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const { kind, name } = parsed.data;

  if (await nameTaken(name)) return validationError({ name: GROUP_NAME_TAKEN });
  try {
    const id = await prisma.$transaction(async (tx) => {
      const row = await tx.department.create({ data: { name, kind }, select: { id: true } });
      await writeAudit(tx, {
        actorId: user.id, actorLabel: user.name,
        entityType: "department", entityId: row.id,
        action: "create", diff: { name: { from: null, to: name }, kind: { from: null, to: kind } },
      });
      return row.id;
    });
    revalidate();
    return ok({ id });
  } catch (err) {
    if (isUniqueViolation(err)) return validationError({ name: GROUP_NAME_TAKEN });
    throw err;
  }
}

const renameSchema = z.object({ id: z.string().min(1), name: nameSchema });

export async function renameGroup(input: unknown): Promise<ActionResult<{ id: string }>> {
  const user = await actionRole("admin", "it_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = renameSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const { id, name } = parsed.data;

  const row = await prisma.department.findUnique({ where: { id }, select: { name: true, locked: true } });
  if (!row) return validationError({ _form: "That department or client no longer exists" });
  if (row.locked) return validationError({ _form: `${row.name} is locked` });
  if (row.name === name) return ok({ id });
  if (await nameTaken(name, id)) return validationError({ name: GROUP_NAME_TAKEN });

  try {
    await prisma.$transaction(async (tx) => {
      await tx.department.update({ where: { id }, data: { name } });
      await writeAudit(tx, {
        actorId: user.id, actorLabel: user.name,
        entityType: "department", entityId: id,
        action: "rename", diff: { name: { from: row.name, to: name } },
      });
    });
    revalidate();
    return ok({ id });
  } catch (err) {
    if (isUniqueViolation(err)) return validationError({ name: GROUP_NAME_TAKEN });
    throw err;
  }
}

const archiveSchema = z.object({ id: z.string().min(1), archived: z.boolean() });

export async function setGroupArchived(input: unknown): Promise<ActionResult<{ id: string }>> {
  const user = await actionRole("admin", "it_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = archiveSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const { id, archived } = parsed.data;

  const row = await prisma.department.findUnique({ where: { id }, select: { name: true, kind: true, locked: true } });
  if (!row) return validationError({ _form: "That department or client no longer exists" });
  if (row.locked) return validationError({ _form: `${row.name} is locked` });

  await prisma.$transaction(async (tx) => {
    // State-guarded: only a row that is not already in the target state moves, so a double click audits once.
    const res = await tx.department.updateMany({
      where: { id, archivedAt: archived ? null : { not: null } },
      data: { archivedAt: archived ? new Date() : null },
    });
    if (res.count === 0) return;
    await writeAudit(tx, {
      actorId: user.id, actorLabel: user.name,
      entityType: "department", entityId: id,
      action: archived ? "archive" : "restore",
      diff: { name: { from: row.name, to: row.name }, kind: { from: row.kind, to: row.kind } },
    });
  });
  revalidate();
  return ok({ id });
}
