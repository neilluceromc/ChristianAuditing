"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { actionUser } from "@/server/auth/guards";
import { checkRate } from "@/server/rate-limit";
import { writeAudit } from "@/server/audit";
import { diffOf } from "@/lib/audit-diff";
import { canManageStock } from "@/lib/stock-access";
import { categorySchema, itemSchema } from "@/lib/stock-schema";
import { formatStockCode } from "@/lib/stock-code";
import {
  conflict, forbidden, ok, rateLimited, validationError, zodFieldErrors, type ActionResult,
} from "@/server/action-result";

const idSchema = z.object({ id: z.string().min(1) });

function isP2002(e: unknown): e is Prisma.PrismaClientKnownRequestError {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

function p2002Target(e: Prisma.PrismaClientKnownRequestError): string {
  const target = (e.meta as { target?: string[] | string } | undefined)?.target;
  return Array.isArray(target) ? target.join(",") : String(target ?? "");
}

/**
 * R2: this module's one in-transaction-refusal pattern — a small local class
 * wrapping an `ActionResult`, thrown inside `$transaction` and caught by the
 * calling function so a refusal rolls the transaction back and is returned
 * as-is. `updateStockItem`'s category-change refusal runs BEFORE any
 * transaction (a plain early return), so it never mixes with this.
 */
class ActionFailure extends Error {
  constructor(public readonly result: ActionResult<never>) {
    super(result.ok ? undefined : result.message);
  }
}

function revalidateItem(id?: string) {
  revalidatePath("/stock");
  if (id) revalidatePath(`/stock/items/${id}`);
  revalidatePath("/audit");
}

function revalidateCategories() {
  revalidatePath("/stock/categories");
  revalidatePath("/stock");
  revalidatePath("/audit");
}

// ---- Categories -----------------------------------------------------------

export async function createStockCategory(input: unknown): Promise<ActionResult<{ id: string }>> {
  const user = await actionUser();
  if (!user || !canManageStock(user.role)) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = categorySchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const d = parsed.data;
  try {
    const created = await prisma.$transaction(async (tx) => {
      const cat = await tx.stockCategory.create({ data: { name: d.name, prefix: d.prefix } });
      await writeAudit(tx, {
        actorId: user.id, actorLabel: user.name, entityType: "stock-category", entityId: cat.id,
        action: "stock.category.created", diff: { name: { from: null, to: cat.name }, prefix: { from: null, to: cat.prefix } },
      });
      return cat;
    });
    revalidateCategories();
    return ok({ id: created.id });
  } catch (e) {
    if (isP2002(e)) {
      return p2002Target(e).includes("prefix")
        ? validationError({ prefix: "That prefix is already in use" })
        : validationError({ name: "A category with this name already exists" });
    }
    throw e;
  }
}

/** Spec §2.1/§5.2: a prefix cannot change once the category has an item — the codes already carry it. */
export async function updateStockCategory(input: unknown): Promise<ActionResult<{ id: string }>> {
  const user = await actionUser();
  if (!user || !canManageStock(user.role)) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);

  const idParsed = idSchema.safeParse(input);
  const dataParsed = categorySchema.safeParse(input);
  if (!idParsed.success || !dataParsed.success) {
    return validationError({
      ...(idParsed.success ? {} : zodFieldErrors(idParsed.error)),
      ...(dataParsed.success ? {} : zodFieldErrors(dataParsed.error)),
    });
  }
  const { id } = idParsed.data;
  const d = dataParsed.data;

  const before = await prisma.stockCategory.findUnique({ where: { id }, include: { _count: { select: { items: true } } } });
  if (!before) return conflict("That category no longer exists.");
  if (d.prefix !== before.prefix && before._count.items > 0) {
    return validationError({ prefix: "This prefix already numbers items and cannot change" });
  }

  const data = { name: d.name, prefix: d.prefix };
  const diff = diffOf(before, data);
  if (Object.keys(diff).length === 0) return ok({ id });

  try {
    await prisma.$transaction(async (tx) => {
      await tx.stockCategory.update({ where: { id }, data });
      await writeAudit(tx, {
        actorId: user.id, actorLabel: user.name, entityType: "stock-category", entityId: id,
        action: "stock.category.updated", diff,
      });
    });
    revalidateCategories();
    return ok({ id });
  } catch (e) {
    if (isP2002(e)) {
      return p2002Target(e).includes("prefix")
        ? validationError({ prefix: "That prefix is already in use" })
        : validationError({ name: "A category with this name already exists" });
    }
    throw e;
  }
}

export async function archiveStockCategory(input: unknown): Promise<ActionResult<null>> {
  const user = await actionUser();
  if (!user || !canManageStock(user.role)) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const { id } = parsed.data;

  const before = await prisma.stockCategory.findUnique({ where: { id } });
  if (!before) return conflict("That category no longer exists.");
  if (before.archivedAt !== null) return ok(null);

  await prisma.$transaction(async (tx) => {
    await tx.stockCategory.update({ where: { id }, data: { archivedAt: new Date() } });
    await writeAudit(tx, {
      actorId: user.id, actorLabel: user.name, entityType: "stock-category", entityId: id,
      action: "stock.category.archived", diff: { archived: { from: false, to: true } },
    });
  });
  revalidateCategories();
  return ok(null);
}

export async function restoreStockCategory(input: unknown): Promise<ActionResult<null>> {
  const user = await actionUser();
  if (!user || !canManageStock(user.role)) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const { id } = parsed.data;

  const before = await prisma.stockCategory.findUnique({ where: { id } });
  if (!before) return conflict("That category no longer exists.");
  if (before.archivedAt === null) return ok(null);

  await prisma.$transaction(async (tx) => {
    await tx.stockCategory.update({ where: { id }, data: { archivedAt: null } });
    await writeAudit(tx, {
      actorId: user.id, actorLabel: user.name, entityType: "stock-category", entityId: id,
      action: "stock.category.restored", diff: { archived: { from: true, to: false } },
    });
  });
  revalidateCategories();
  return ok(null);
}

// ---- Items ------------------------------------------------------------

/**
 * Spec §5.2: the counter advance is a raw `UPDATE … RETURNING` under the row
 * it locks, so two concurrent creates in the same category cannot mint the
 * same code. Refusals inside the transaction throw `ActionFailure` so the
 * counter increment (and any create) rolls back with them.
 */
export async function createStockItem(input: unknown): Promise<ActionResult<{ id: string; code: string }>> {
  const user = await actionUser();
  if (!user || !canManageStock(user.role)) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = itemSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const d = parsed.data;

  try {
    const created = await prisma.$transaction(async (tx) => {
      const cat = await tx.stockCategory.findUnique({ where: { id: d.categoryId }, select: { prefix: true, archivedAt: true } });
      if (!cat) throw new ActionFailure(validationError({ categoryId: "Unknown category" }));
      if (cat.archivedAt) throw new ActionFailure(conflict("That category is archived — restore it first."));
      const [{ nextNumber }] = await tx.$queryRaw<[{ nextNumber: number }]>`UPDATE "StockCategory" SET "nextNumber" = "nextNumber" + 1 WHERE "id" = ${d.categoryId} RETURNING "nextNumber"`;
      const code = formatStockCode(cat.prefix, nextNumber - 1);
      const item = await tx.stockItem.create({
        data: {
          code, name: d.name, unit: d.unit, packSize: d.packSize, reorderLevel: d.reorderLevel,
          notes: d.notes || null, categoryId: d.categoryId,
        },
      });
      await writeAudit(tx, {
        actorId: user.id, actorLabel: user.name, entityType: "stock-item", entityId: item.id,
        action: "stock.item.created", diff: { code: { from: null, to: code }, name: { from: null, to: d.name } },
      });
      return item;
    });
    revalidateItem(created.id);
    revalidatePath("/stock/categories");
    return ok({ id: created.id, code: created.code });
  } catch (e) {
    if (e instanceof ActionFailure) return e.result;
    throw e;
  }
}

/** Category may only change while the item has no movements — a code carries its prefix, moving a used item would lie. */
export async function updateStockItem(input: unknown): Promise<ActionResult<{ id: string }>> {
  const user = await actionUser();
  if (!user || !canManageStock(user.role)) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);

  const idParsed = idSchema.safeParse(input);
  const dataParsed = itemSchema.safeParse(input);
  if (!idParsed.success || !dataParsed.success) {
    return validationError({
      ...(idParsed.success ? {} : zodFieldErrors(idParsed.error)),
      ...(dataParsed.success ? {} : zodFieldErrors(dataParsed.error)),
    });
  }
  const { id } = idParsed.data;
  const d = dataParsed.data;

  const before = await prisma.stockItem.findUnique({
    where: { id },
    select: {
      name: true, unit: true, packSize: true, reorderLevel: true, notes: true, categoryId: true,
      _count: { select: { movements: true } },
    },
  });
  if (!before) return conflict("That item no longer exists.");
  if (d.categoryId !== before.categoryId && before._count.movements > 0) {
    return conflict("This code belongs to its category — the item already has movements");
  }

  const data = { name: d.name, unit: d.unit, packSize: d.packSize, reorderLevel: d.reorderLevel, notes: d.notes || null, categoryId: d.categoryId };
  const diff = diffOf(before, data);
  if (Object.keys(diff).length === 0) return ok({ id });

  await prisma.$transaction(async (tx) => {
    await tx.stockItem.update({ where: { id }, data });
    await writeAudit(tx, {
      actorId: user.id, actorLabel: user.name, entityType: "stock-item", entityId: id,
      action: "stock.item.updated", diff,
    });
  });
  revalidateItem(id);
  return ok({ id });
}

export async function archiveStockItem(input: unknown): Promise<ActionResult<null>> {
  const user = await actionUser();
  if (!user || !canManageStock(user.role)) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const { id } = parsed.data;

  const before = await prisma.stockItem.findUnique({ where: { id } });
  if (!before) return conflict("That item no longer exists.");
  if (before.archivedAt !== null) return ok(null);

  await prisma.$transaction(async (tx) => {
    await tx.stockItem.update({ where: { id }, data: { archivedAt: new Date() } });
    await writeAudit(tx, {
      actorId: user.id, actorLabel: user.name, entityType: "stock-item", entityId: id,
      action: "stock.item.archived", diff: { archived: { from: false, to: true } },
    });
  });
  revalidateItem(id);
  return ok(null);
}

export async function restoreStockItem(input: unknown): Promise<ActionResult<null>> {
  const user = await actionUser();
  if (!user || !canManageStock(user.role)) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const { id } = parsed.data;

  const before = await prisma.stockItem.findUnique({ where: { id } });
  if (!before) return conflict("That item no longer exists.");
  if (before.archivedAt === null) return ok(null);

  await prisma.$transaction(async (tx) => {
    await tx.stockItem.update({ where: { id }, data: { archivedAt: null } });
    await writeAudit(tx, {
      actorId: user.id, actorLabel: user.name, entityType: "stock-item", entityId: id,
      action: "stock.item.restored", diff: { archived: { from: true, to: false } },
    });
  });
  revalidateItem(id);
  return ok(null);
}
