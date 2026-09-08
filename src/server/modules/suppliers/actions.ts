"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { actionUser } from "@/server/auth/guards";
import { checkRate } from "@/server/rate-limit";
import { writeAudit } from "@/server/audit";
import { diffOf } from "@/lib/audit-diff";
import { canManageSuppliers } from "@/lib/supplier-access";
import { supplierSchema, toSupplierData } from "@/lib/supplier-schema";
import { conflict, forbidden, ok, rateLimited, validationError, zodFieldErrors, type ActionResult } from "@/server/action-result";

const DUPLICATE = { name: "A supplier with this name already exists" };
const isP2002 = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
const idSchema = z.object({ id: z.string().min(1) });

function revalidate(id?: string) {
  revalidatePath("/purchases/suppliers");
  if (id) revalidatePath(`/purchases/suppliers/${id}`);
  revalidatePath("/audit");
}

export async function createSupplier(input: unknown): Promise<ActionResult<{ id: string }>> {
  const user = await actionUser();
  if (!user || !canManageSuppliers(user.role)) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = supplierSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const data = toSupplierData(parsed.data);
  try {
    const created = await prisma.$transaction(async (tx) => {
      const v = await tx.vendor.create({ data });
      await writeAudit(tx, {
        actorId: user.id, actorLabel: user.name, entityType: "vendor", entityId: v.id,
        action: "supplier.created", diff: { name: { from: null, to: v.name } },
      });
      return v;
    });
    revalidate(created.id);
    return ok({ id: created.id });
  } catch (e) {
    if (isP2002(e)) return validationError(DUPLICATE);
    throw e;
  }
}

/**
 * Input is `{ id } & SupplierInput`, but `supplierSchema` carries a
 * `superRefine` (the contract-date ordering check) — zod's `.and`/`.merge`
 * fight that refinement, so `id` is parsed separately and the field errors
 * merged instead.
 */
export async function updateSupplier(input: unknown): Promise<ActionResult<{ id: string }>> {
  const user = await actionUser();
  if (!user || !canManageSuppliers(user.role)) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);

  const idParsed = idSchema.safeParse(input);
  const dataParsed = supplierSchema.safeParse(input);
  if (!idParsed.success || !dataParsed.success) {
    return validationError({
      ...(idParsed.success ? {} : zodFieldErrors(idParsed.error)),
      ...(dataParsed.success ? {} : zodFieldErrors(dataParsed.error)),
    });
  }
  const { id } = idParsed.data;
  const data = toSupplierData(dataParsed.data);

  const before = await prisma.vendor.findUnique({ where: { id } });
  if (!before) return conflict("That supplier no longer exists.");

  const diff = diffOf(before, data);
  if (Object.keys(diff).length === 0) return ok({ id });

  try {
    await prisma.$transaction(async (tx) => {
      await tx.vendor.update({ where: { id }, data });
      await writeAudit(tx, {
        actorId: user.id, actorLabel: user.name, entityType: "vendor", entityId: id,
        action: "supplier.updated", diff,
      });
    });
    revalidate(id);
    return ok({ id });
  } catch (e) {
    if (isP2002(e)) return validationError(DUPLICATE);
    throw e;
  }
}

export async function archiveSupplier(input: unknown): Promise<ActionResult<null>> {
  const user = await actionUser();
  if (!user || !canManageSuppliers(user.role)) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const { id } = parsed.data;

  const before = await prisma.vendor.findUnique({ where: { id } });
  if (!before) return conflict("That supplier no longer exists.");
  if (before.archivedAt !== null) return ok(null);

  await prisma.$transaction(async (tx) => {
    await tx.vendor.update({ where: { id }, data: { archivedAt: new Date() } });
    await writeAudit(tx, {
      actorId: user.id, actorLabel: user.name, entityType: "vendor", entityId: id,
      action: "supplier.archived", diff: { archived: { from: false, to: true } },
    });
  });
  revalidate(id);
  return ok(null);
}

export async function restoreSupplier(input: unknown): Promise<ActionResult<null>> {
  const user = await actionUser();
  if (!user || !canManageSuppliers(user.role)) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const { id } = parsed.data;

  const before = await prisma.vendor.findUnique({ where: { id } });
  if (!before) return conflict("That supplier no longer exists.");
  if (before.archivedAt === null) return ok(null);

  await prisma.$transaction(async (tx) => {
    await tx.vendor.update({ where: { id }, data: { archivedAt: null } });
    await writeAudit(tx, {
      actorId: user.id, actorLabel: user.name, entityType: "vendor", entityId: id,
      action: "supplier.restored", diff: { archived: { from: true, to: false } },
    });
  });
  revalidate(id);
  return ok(null);
}
