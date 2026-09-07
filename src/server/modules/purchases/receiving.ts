"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { actionRole } from "@/server/auth/guards";
import { checkRate } from "@/server/rate-limit";
import { writeAudit } from "@/server/audit";
import { TAG_SHAPE } from "@/lib/tag-key";
import {
  CLASS_LABEL, CLASS_PHRASE, DEFAULT_STATUS, canManageClass, canRegisterClass,
} from "@/lib/asset-class";
import {
  conflict, forbidden, ok, rateLimited, validationError, zodFieldErrors, type ActionResult,
} from "@/server/action-result";

const registerSchema = z.object({
  categoryId: z.string().min(1, "Pick a category"),
  typeId: z.string().optional(),
  model: z.string().trim().min(1, "Model is required").max(200),
  // One tag per asset. The COUNT is the quantity — there is no separate qty
  // field, so the two cannot disagree.
  tags: z.array(z.string().trim().toUpperCase().regex(TAG_SHAPE, "Format: BR-XX-0000")).min(1).max(200),
  serials: z.array(z.string().trim().max(120)).optional(),
  purchasedAt: z.string().optional(),
  cost: z.string().optional(),
  vendorId: z.string().optional(),
  warrantyUntil: z.string().optional(),
  brand: z.string().trim().max(60).optional(),
  notes: z.string().trim().max(2000).optional(),
  invoiceRef: z.string().trim().max(60).optional(),
  // OPTIONAL metadata, never a gate (C-5). If a request is named it must be
  // COMPLETED, because linking an asset to a request still in flight would
  // claim a provenance that is not settled.
  requestId: z.string().optional(),
});

interface Registered {
  created: number;
  ids: string[];
}

export async function registerAssets(input: unknown): Promise<ActionResult<Registered>> {
  const user = await actionRole("admin", "it_staff", "purchasing_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);

  const parsed = registerSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const d = parsed.data;

  const dupe = d.tags.find((t, i) => d.tags.indexOf(t) !== i);
  if (dupe) return conflict(`${dupe} appears twice in this batch.`);

  // The category decides the class; the class decides who may register into
  // it. Finance and viewers never reach here (actionRole above), so the only
  // refusal this produces is IT registering a Purchasing category — named,
  // because "forbidden" would not say what to do instead.
  const category = await prisma.assetCategory.findUnique({
    where: { id: d.categoryId },
    select: { name: true, cls: true },
  });
  if (!category) return validationError({ categoryId: "Unknown category" });
  // Spec §4: Purchasing registers both classes, IT its own. Registering is not
  // managing — an IT asset Purchasing registers is IT's from this moment.
  if (!canRegisterClass(user.role, category.cls)) {
    return validationError({
      categoryId: `${category.name} is ${CLASS_PHRASE[category.cls]} category — your department does not register ${CLASS_LABEL[category.cls]} assets.`,
    });
  }
  // Spec §4 stamping: born checked when the registrant manages the class.
  const selfChecked = category.cls === "IT" && canManageClass(user.role, "IT");

  // Serial is unique fleet-wide (like tag), but a batch never gets to check
  // itself against the database mid-loop — two rows of ONE submission naming
  // the same serial would otherwise fail only on the second `create()`, deep
  // inside the transaction, with a P2002 message that cannot say WHICH row.
  // Named here, before either check below.
  const serials = (d.serials ?? []).map((s) => s.trim()).filter(Boolean);
  const dupSerial = serials.find((s, i) => serials.indexOf(s) !== i);
  if (dupSerial) return conflict(`Serial ${dupSerial} appears twice in this batch.`);
  if (serials.length) {
    const taken = await prisma.asset.findFirst({ where: { serial: { in: serials } }, select: { serial: true } });
    if (taken) return validationError({ serials: `Serial ${taken.serial} is already registered` });
  }

  let done: Registered | null = null;
  let failure: ActionResult<Registered> | null = null;

  try {
    await prisma.$transaction(async (tx) => {
      // SAME two-pass discipline as receiveUnits, and for the same reason
      // (C-4): Prisma commits when this callback resolves and rolls back only
      // when it throws, so every refusal must sit above every write.
      if (d.requestId) {
        const req = await tx.purchaseRequest.findUnique({
          where: { id: d.requestId },
          select: { refNo: true, state: true },
        });
        if (!req) {
          failure = validationError({ requestId: "Unknown request" });
          return;
        }
        if (req.state !== "COMPLETED") {
          failure = conflict(`${req.refNo} is ${req.state.toLowerCase()} — only a completed request can be linked.`);
          return;
        }
      }

      let created = 0;
      const ids: string[] = [];
      for (const [i, tag] of d.tags.entries()) {
        const asset = await tx.asset.create({
          data: {
            tag,
            model: d.model,
            serial: d.serials?.[i]?.trim() || null,
            categoryId: d.categoryId,
            typeId: d.typeId || null,
            status: DEFAULT_STATUS[category.cls],
            cls: category.cls,
            purchasedAt: d.purchasedAt ? new Date(d.purchasedAt) : null,
            // NOT `toCost` from inventory/actions.ts (checked, see report): it
            // is a private, non-exported, synchronous helper inside a
            // top-of-file "use server" module, which under Next's Server
            // Actions contract may only export async functions — exporting it
            // would break that module. `d.cost` here is a plain trimmed
            // string (Prisma coerces string → Decimal on write), a different
            // shape than `toCost`'s `number | "" | undefined` input, so this
            // is a pass-through, not a re-implementation of its rule.
            cost: d.cost ? d.cost : null,
            vendorId: d.vendorId || null,
            warrantyUntil: d.warrantyUntil ? new Date(d.warrantyUntil) : null,
            brand: d.brand || null,
            notes: d.notes || null,
            invoiceRef: d.invoiceRef || null,
            purchaseRequestId: d.requestId || null,
            itVerifiedAt: selfChecked ? new Date() : null,
            itVerifiedById: selfChecked ? user.id : null,
          },
        });
        created++;
        ids.push(asset.id);
        await writeAudit(tx, {
          actorId: user.id,
          actorLabel: user.name,
          entityType: "asset",
          entityId: asset.id,
          action: "register",
          diff: {
            tag: { from: null, to: asset.tag },
            status: { from: null, to: DEFAULT_STATUS[category.cls] },
          },
        });
      }
      done = { created, ids };
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const target = (e.meta as { target?: string[] | string } | undefined)?.target;
      const t = Array.isArray(target) ? target.join(",") : String(target ?? "");
      return t.includes("serial")
        ? validationError({ serials: "That serial is already registered" })
        : conflict("One of those tags was just taken. Reload and try again.");
    }
    throw e;
  }

  if (failure) return failure;
  revalidatePath("/inventory");
  return ok(done!);
}
