"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { AssetClass, Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { actionRole } from "@/server/auth/guards";
import { isUniqueViolation } from "@/server/prisma-errors";
import { checkRate } from "@/server/rate-limit";
import { writeAudit } from "@/server/audit";
import {
  forbidden, ok, rateLimited, validationError, zodFieldErrors, type ActionResult,
} from "@/server/action-result";

/*
 * PO form redesign (spec §2.7, §5, §5b.6–7): Purchasing (and admin) create a category on the spot from the PO form,
 * in either class. An office item is confirmed at once; IT gear is usable on purchase orders straight away but stays
 * unconfirmed (`confirmedAt` null) until IT confirms or replaces it at Register (po-register.ts). The Admin categories
 * page keeps its own rules (reference-actions.ts).
 *
 * Names are unique case-insensitively across BOTH classes (the lower(name) index): a same-class match reuses the
 * existing category instead of making a near-duplicate; an other-class match is refused, naming where it lives.
 */

export interface PoCategory {
  id: string;
  name: string;
  cls: AssetClass;
  confirmed: boolean;
  reused: boolean;
}

/**
 * "patch panel" → "Patch panel", but "iPhone case" and "eBay voucher" stay as typed (final review M6): the first
 * character is uppercased only when it is a lowercase letter and the second is not an uppercase one.
 */
const capitaliseName = (s: string) =>
  /^\p{Ll}/u.test(s) && !/^.\p{Lu}/u.test(s) ? s.charAt(0).toUpperCase() + s.slice(1) : s;

const createSchema = z.object({
  name: z.string().trim().min(2, "At least 2 characters").max(60, "At most 60 characters").transform(capitaliseName),
  cls: z.enum(["IT", "PURCHASING"]),
});

const CLASS_PHRASE: Record<AssetClass, string> = { IT: "IT gear", PURCHASING: "an Office item" };
const otherClass = (name: string, cls: AssetClass) =>
  validationError({ name: `'${name}' already exists as ${CLASS_PHRASE[cls]} — pick it from the list.` });

type Existing = { id: string; name: string; cls: AssetClass; confirmedAt: Date | null };

/** The case-insensitive match, if any: reused in its own class, refused in the other. */
async function matchFor(db: Prisma.TransactionClient, name: string): Promise<Existing | null> {
  return db.assetCategory.findFirst({
    where: { name: { equals: name, mode: "insensitive" } },
    select: { id: true, name: true, cls: true, confirmedAt: true },
  });
}

function answer(existing: Existing, cls: AssetClass): ActionResult<PoCategory> {
  if (existing.cls !== cls) return otherClass(existing.name, existing.cls);
  return ok({ id: existing.id, name: existing.name, cls: existing.cls, confirmed: existing.confirmedAt !== null, reused: true });
}

export async function createCategoryFromPo(input: unknown): Promise<ActionResult<PoCategory>> {
  const user = await actionRole("admin", "purchasing_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const { name, cls } = parsed.data;

  try {
    const result = await prisma.$transaction(async (tx): Promise<ActionResult<PoCategory>> => {
      const existing = await matchFor(tx, name);
      if (existing) return answer(existing, cls);
      // The DB default confirms every category (migration 39b): an IT one from a PO passes null explicitly.
      const confirmedAt = cls === "IT" ? null : new Date();
      const row = await tx.assetCategory.create({
        data: { name, cls, confirmedAt, createdById: user.id },
        select: { id: true, name: true, cls: true },
      });
      await writeAudit(tx, {
        actorId: user.id, actorLabel: user.name,
        entityType: "asset-category", entityId: row.id,
        action: "category.create",
        diff: { name: { from: null, to: row.name }, cls: { from: null, to: row.cls } },
        source: "web",
      });
      return ok({ id: row.id, name: row.name, cls: row.cls, confirmed: confirmedAt !== null, reused: false });
    });
    if (result.ok && !result.data.reused) revalidatePath("/admin/asset-categories");
    return result;
  } catch (err) {
    // Someone created the same name between the check and the write: answer as if it had been there first.
    if (isUniqueViolation(err)) {
      const existing = await matchFor(prisma, name);
      if (existing) return answer(existing, cls);
      return validationError({ name: "That name already exists" });
    }
    throw err;
  }
}
