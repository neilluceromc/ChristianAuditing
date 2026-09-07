"use server";

import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { actionRole } from "@/server/auth/guards";
import { checkRate } from "@/server/rate-limit";
import { writeAudit } from "@/server/audit";
import { storeUpload, validateUpload } from "@/server/uploads";
import { conflict, forbidden, ok, rateLimited, validationError, type ActionResult } from "@/server/action-result";
import type { AckItem } from "@/lib/acknowledgement";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Spec §6: the signed paper, recorded on the person with what they held at that moment. */
export async function recordAcknowledgement(formData: FormData): Promise<ActionResult<{ id: string }>> {
  const user = await actionRole("admin", "it_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const employeeId = String(formData.get("employeeId") ?? "");
  const signedRaw = String(formData.get("signedAt") ?? "");
  if (!employeeId) return conflict("Missing employee.");
  if (!DAY.test(signedRaw)) return validationError({ signedAt: "Use the date picker" });
  const signedAt = new Date(`${signedRaw}T00:00:00Z`);
  if (signedAt.getTime() > Date.now()) return validationError({ signedAt: "A signing date cannot be in the future" });
  const checked = validateUpload(formData.get("file"));
  if (!checked.ok) return validationError({ file: checked.error });

  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { id: true, assets: { select: { id: true, tag: true, model: true, serial: true }, orderBy: [{ tag: "asc" }, { id: "asc" }] } },
  });
  if (!employee) return conflict("That employee no longer exists.");
  const items: AckItem[] = employee.assets.map((a) => ({ assetId: a.id, tag: a.tag, model: a.model, serial: a.serial }));

  const stored = await storeUpload(`employees/${employeeId}`, checked.file);
  const id = await prisma.$transaction(async (tx) => {
    const row = await tx.acknowledgement.create({
      data: {
        employeeId, signedAt, fileName: stored.fileName, path: stored.relPath, checksum: stored.checksum,
        items: items as unknown as Prisma.InputJsonValue,
        recordedById: user.id,
      },
    });
    await writeAudit(tx, {
      actorId: user.id, actorLabel: user.name, entityType: "employee", entityId: employeeId,
      action: "acknowledgement.recorded",
      diff: { signedAt: { from: null, to: signedAt }, items: { from: null, to: String(items.length) } },
    });
    return row.id;
  });
  revalidatePath(`/employees/${employeeId}`);
  return ok({ id });
}
