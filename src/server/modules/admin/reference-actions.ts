"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { actionRole } from "@/server/auth/guards";
import { checkRate } from "@/server/rate-limit";
import { writeAudit } from "@/server/audit";
import {
  conflict, forbidden, ok, rateLimited, validationError, zodFieldErrors, type ActionResult,
} from "@/server/action-result";

const entitySchema = z.enum(["category", "type", "department"]);
type RefEntity = z.infer<typeof entitySchema>;

const PATHS: Record<RefEntity, string> = {
  category: "/admin/asset-categories",
  type: "/admin/asset-types",
  department: "/admin/departments",
};
const AUDIT_TYPE: Record<RefEntity, string> = {
  category: "asset-category",
  type: "asset-type",
  department: "department",
};

const nameSchema = z.string().trim().min(2, "At least 2 characters").max(60);

function isUnique(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

const createSchema = z.object({
  entity: entitySchema,
  name: nameSchema,
  categoryId: z.string().optional(), // types only
});

export async function createRefRow(input: unknown): Promise<ActionResult<{ id: string }>> {
  const user = await actionRole("admin", "it_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const { entity, name, categoryId } = parsed.data;
  if (entity === "type" && !categoryId) return validationError({ categoryId: "Pick a category" });

  try {
    let id = "";
    await prisma.$transaction(async (tx) => {
      if (entity === "category") id = (await tx.assetCategory.create({ data: { name } })).id;
      else if (entity === "department") id = (await tx.department.create({ data: { name } })).id;
      else id = (await tx.assetType.create({ data: { name, categoryId: categoryId! } })).id;
      await writeAudit(tx, {
        actorId: user.id, actorLabel: user.name,
        entityType: AUDIT_TYPE[entity], entityId: id,
        action: "create", diff: { name: { from: null, to: name } },
      });
    });
    revalidatePath(PATHS[entity]);
    return ok({ id });
  } catch (err) {
    if (isUnique(err)) return validationError({ name: "That name already exists" });
    throw err;
  }
}

const renameSchema = z.object({ entity: entitySchema, id: z.string().min(1), name: nameSchema });

export async function renameRefRow(input: unknown): Promise<ActionResult<null>> {
  const user = await actionRole("admin", "it_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = renameSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const { entity, id, name } = parsed.data;

  const row =
    entity === "category" ? await prisma.assetCategory.findUnique({ where: { id } })
    : entity === "department" ? await prisma.department.findUnique({ where: { id } })
    : await prisma.assetType.findUnique({ where: { id } });
  if (!row) return conflict("That row no longer exists.");
  if (row.locked) return conflict(`"${row.name}" is locked and can't be renamed.`);
  if (row.name === name) return ok(null);

  try {
    await prisma.$transaction(async (tx) => {
      if (entity === "category") await tx.assetCategory.update({ where: { id }, data: { name } });
      else if (entity === "department") await tx.department.update({ where: { id }, data: { name } });
      else await tx.assetType.update({ where: { id }, data: { name } });
      await writeAudit(tx, {
        actorId: user.id, actorLabel: user.name,
        entityType: AUDIT_TYPE[entity], entityId: id,
        action: "rename", diff: { name: { from: row.name, to: name } },
      });
    });
    revalidatePath(PATHS[entity]);
    return ok(null);
  } catch (err) {
    if (isUnique(err)) return validationError({ name: "That name already exists" });
    throw err;
  }
}

const deleteSchema = z.object({ entity: entitySchema, id: z.string().min(1) });

/** The friendly usage check runs first; the DB's Restrict FKs are the backstop. */
export async function deleteRefRow(input: unknown): Promise<ActionResult<null>> {
  const user = await actionRole("admin", "it_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = deleteSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const { entity, id } = parsed.data;

  if (entity === "category") {
    const row = await prisma.assetCategory.findUnique({
      where: { id }, include: { _count: { select: { types: true, assets: true } } },
    });
    if (!row) return conflict("That row no longer exists.");
    if (row.locked) return conflict(`"${row.name}" is locked.`);
    if (row._count.types || row._count.assets) {
      return conflict(`"${row.name}" is in use by ${row._count.types} type(s) and ${row._count.assets} asset(s) — move them first.`);
    }
  } else if (entity === "department") {
    const row = await prisma.department.findUnique({
      where: { id }, include: { _count: { select: { employees: true, policies: true } } },
    });
    if (!row) return conflict("That row no longer exists.");
    if (row.locked) return conflict(`"${row.name}" is locked.`);
    if (row._count.employees || row._count.policies) {
      return conflict(`"${row.name}" is in use by ${row._count.employees} employee(s) and ${row._count.policies} polic(ies) — move them first.`);
    }
  } else {
    const row = await prisma.assetType.findUnique({
      where: { id }, include: { _count: { select: { assets: true, policySlots: true } } },
    });
    if (!row) return conflict("That row no longer exists.");
    if (row.locked) return conflict(`"${row.name}" is locked.`);
    if (row._count.assets || row._count.policySlots) {
      return conflict(`"${row.name}" is in use by ${row._count.assets} asset(s) and ${row._count.policySlots} policy slot(s) — move them first.`);
    }
  }

  let name = "";
  try {
    await prisma.$transaction(async (tx) => {
      if (entity === "category") name = (await tx.assetCategory.delete({ where: { id } })).name;
      else if (entity === "department") name = (await tx.department.delete({ where: { id } })).name;
      else name = (await tx.assetType.delete({ where: { id } })).name;
      await writeAudit(tx, {
        actorId: user.id, actorLabel: user.name,
        entityType: AUDIT_TYPE[entity], entityId: id,
        action: "delete", diff: { name: { from: name, to: null } },
      });
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003") {
      return conflict("Still referenced by other records — the database refused the delete.");
    }
    throw err;
  }
  revalidatePath(PATHS[entity]);
  return ok(null);
}
