"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { actionRole } from "@/server/auth/guards";
import { checkRate } from "@/server/rate-limit";
import { writeAudit } from "@/server/audit";
import { conflict, forbidden, ok, rateLimited, validationError, zodFieldErrors, type ActionResult } from "@/server/action-result";
import { canDeleteNote, canEditNote, noteSchema } from "@/lib/employee-notes";

/** Phase 37 (spec §4.5): the note log on an employee's profile. Notes can be added for anyone, offboarded people included. */

const CHANGED = "That note changed — reload and try again";

const addSchema = z.object({ employeeId: z.string().min(1), text: noteSchema });
const editSchema = z.object({ id: z.string().min(1), text: noteSchema });
const idSchema = z.object({ id: z.string().min(1) });

export async function addEmployeeNote(input: unknown): Promise<ActionResult<{ id: string }>> {
  const user = await actionRole("admin", "it_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = addSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const d = parsed.data;
  const employee = await prisma.employee.findUnique({ where: { id: d.employeeId }, select: { id: true } });
  if (!employee) return conflict("That employee no longer exists.");

  const id = await prisma.$transaction(async (tx) => {
    const row = await tx.employeeNote.create({ data: { employeeId: d.employeeId, authorId: user.id, text: d.text }, select: { id: true } });
    await writeAudit(tx, {
      actorId: user.id, actorLabel: user.name, entityType: "employee", entityId: d.employeeId,
      action: "note.added", diff: { note: { from: null, to: d.text } },
    });
    return row.id;
  });
  revalidatePath(`/employees/${d.employeeId}`);
  return ok({ id });
}

export async function editEmployeeNote(input: unknown): Promise<ActionResult<null>> {
  const user = await actionRole("admin", "it_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = editSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const d = parsed.data;
  const note = await prisma.employeeNote.findUnique({ where: { id: d.id }, select: { id: true, employeeId: true, authorId: true, text: true } });
  if (!note) return validationError({ _form: CHANGED });
  if (!canEditNote(note, user)) return forbidden();
  if (note.text === d.text) return ok(null);

  const changed = await prisma.$transaction(async (tx) => {
    // state-guarded: only the text this edit started from may be replaced
    const res = await tx.employeeNote.updateMany({ where: { id: note.id, text: note.text }, data: { text: d.text, editedAt: new Date() } });
    if (res.count === 0) return false;
    await writeAudit(tx, {
      actorId: user.id, actorLabel: user.name, entityType: "employee", entityId: note.employeeId,
      action: "note.edited", diff: { note: { from: note.text, to: d.text } },
    });
    return true;
  });
  if (!changed) return validationError({ _form: CHANGED });
  revalidatePath(`/employees/${note.employeeId}`);
  return ok(null);
}

export async function deleteEmployeeNote(input: unknown): Promise<ActionResult<null>> {
  const user = await actionRole("admin", "it_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const note = await prisma.employeeNote.findUnique({ where: { id: parsed.data.id }, select: { id: true, employeeId: true, authorId: true, text: true } });
  if (!note) return ok(null); // already gone — idempotent
  if (!canDeleteNote(note, user)) return forbidden();

  await prisma.$transaction(async (tx) => {
    const res = await tx.employeeNote.deleteMany({ where: { id: note.id } });
    if (res.count === 0) return; // deleted meanwhile: nothing to audit
    await writeAudit(tx, {
      actorId: user.id, actorLabel: user.name, entityType: "employee", entityId: note.employeeId,
      action: "note.deleted", diff: { note: { from: note.text, to: null } },
    });
  });
  revalidatePath(`/employees/${note.employeeId}`);
  return ok(null);
}
