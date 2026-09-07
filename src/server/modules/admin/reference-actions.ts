"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma, type AssetClass, type Role } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { actionUser } from "@/server/auth/guards";
import { checkRate } from "@/server/rate-limit";
import { writeAudit } from "@/server/audit";
import { MANAGEABLE_CLASSES, canManageClass } from "@/lib/asset-class";
import {
  conflict, forbidden, ok, rateLimited, validationError, zodFieldErrors, type ActionResult,
} from "@/server/action-result";

const entitySchema = z.enum(["category", "type", "department"]);
type RefEntity = z.infer<typeof entitySchema>;

/** Spec §9: the class a role creates a category in — its own for a single-class role, a pick for admin, nothing for the rest. */
function classFor(role: Role, requested: AssetClass | undefined): AssetClass | null {
  const mine = MANAGEABLE_CLASSES[role];
  if (mine.length === 0) return null;
  if (mine.length === 1) return mine[0];
  return requested ?? mine[0];
}

async function loadRow(entity: RefEntity, id: string): Promise<{ name: string; locked: boolean; cls: AssetClass | null } | null> {
  if (entity === "category") {
    const r = await prisma.assetCategory.findUnique({ where: { id }, select: { name: true, locked: true, cls: true } });
    return r && { name: r.name, locked: r.locked, cls: r.cls };
  }
  if (entity === "department") {
    const r = await prisma.department.findUnique({ where: { id }, select: { name: true, locked: true } });
    return r && { name: r.name, locked: r.locked, cls: null };
  }
  const r = await prisma.assetType.findUnique({ where: { id }, select: { name: true, locked: true, category: { select: { cls: true } } } });
  return r && { name: r.name, locked: r.locked, cls: r.category.cls };
}

function mayTouch(role: Role, entity: RefEntity, cls: AssetClass | null): boolean {
  if (entity === "department") return role === "admin" || role === "it_staff";
  return cls !== null && canManageClass(role, cls);
}

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
  cls: z.enum(["IT", "PURCHASING"]).optional(), // categories only (Phase 13); defaults to IT
});

export async function createRefRow(input: unknown): Promise<ActionResult<{ id: string }>> {
  const user = await actionUser();
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const { entity, name, categoryId } = parsed.data;

  if (entity === "department" && user.role !== "admin" && user.role !== "it_staff") return forbidden();
  const cls = entity === "category" ? classFor(user.role, parsed.data.cls) : null;
  if (entity === "category" && cls === null) return forbidden();
  if (entity === "type") {
    if (!categoryId) return validationError({ categoryId: "Pick a category" });
    const category = await prisma.assetCategory.findUnique({ where: { id: categoryId }, select: { cls: true } });
    if (!category) return validationError({ categoryId: "That category no longer exists" });
    if (!canManageClass(user.role, category.cls)) return forbidden();
  }

  try {
    let id = "";
    await prisma.$transaction(async (tx) => {
      if (entity === "category") id = (await tx.assetCategory.create({ data: { name, cls: cls! } })).id;
      else if (entity === "department") id = (await tx.department.create({ data: { name } })).id;
      else id = (await tx.assetType.create({ data: { name, categoryId: categoryId! } })).id;
      await writeAudit(tx, {
        actorId: user.id, actorLabel: user.name,
        entityType: AUDIT_TYPE[entity], entityId: id,
        action: "create",
        diff: entity === "category" ? { name: { from: null, to: name }, cls: { from: null, to: cls } } : { name: { from: null, to: name } },
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
  const user = await actionUser();
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = renameSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const { entity, id, name } = parsed.data;

  const row = await loadRow(entity, id);
  if (!row) return conflict("That row no longer exists.");
  if (!mayTouch(user.role, entity, row.cls)) return forbidden();
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
  const user = await actionUser();
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = deleteSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const { entity, id } = parsed.data;

  const preRow = await loadRow(entity, id);
  if (!preRow) return conflict("That row no longer exists.");
  if (!mayTouch(user.role, entity, preRow.cls)) return forbidden();

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
