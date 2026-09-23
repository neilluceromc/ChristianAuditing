"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { actionRole } from "@/server/auth/guards";
import { checkRate } from "@/server/rate-limit";
import { writeAudit } from "@/server/audit";
import { TAG_SHAPE } from "@/lib/tag-key";
import { identifierWhere } from "@/lib/inventory-list";
import {
  CLASS_LABEL, CLASS_PHRASE, DEFAULT_STATUS, canManageClass, canRegisterClass,
} from "@/lib/asset-class";
import {
  conflict, forbidden, ok, rateLimited, validationError, zodFieldErrors, type ActionResult,
} from "@/server/action-result";

// Same shape createSchema uses (inventory/actions.ts) — a malformed date
// string is a field error at the picker, never an Invalid Date reaching
// Prisma's `new Date(...)` write.
const dateStr = z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use the date picker")]);
const toDate = (s: string | undefined) => (s ? new Date(`${s}T00:00:00Z`) : null);

const registerSchema = z.object({
  categoryId: z.string().min(1, "Pick a category"),
  typeId: z.string().optional(),
  // Phase 30 (plan P-13): the one model rule createAsset uses — Register is one flow at any quantity.
  model: z.string().trim().min(2, "Name the model").max(120),
  // One tag per asset. The COUNT is the quantity — there is no separate qty
  // field, so the two cannot disagree.
  tags: z.array(z.string().trim().toUpperCase().regex(TAG_SHAPE, "Format: BR-XX-0000")).min(1).max(200),
  serials: z.array(z.string().trim().max(120)).optional(),
  purchasedAt: dateStr.optional(),
  cost: z.string().optional(),
  vendorId: z.string().optional(),
  warrantyUntil: dateStr.optional(),
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

  // Phase 30 (spec §5.4): every post-schema refusal in ONE pass, worded per row — a refused
  // submit shows every error at once instead of one per round trip. Rows are 1-based, as the
  // form labels them (Tag 1, Serial 1).
  const errors: Record<string, string> = {};
  const more = (k: number) => (k > 0 ? ` and ${k} more` : "");

  const dupAt = d.tags.findIndex((t, i) => d.tags.indexOf(t) !== i);
  if (dupAt >= 0) errors.tags = `Row ${dupAt + 1} · ${d.tags[dupAt]} appears twice in this batch`;

  // The category decides the class; the class decides who may register into
  // it. Finance and viewers never reach here (actionRole above), so the only
  // refusal this produces is IT registering a Purchasing category — named,
  // because "forbidden" would not say what to do instead.
  const category = await prisma.assetCategory.findUnique({
    where: { id: d.categoryId },
    select: { name: true, cls: true },
  });
  if (!category) errors.categoryId = "Unknown category";
  // Spec §4: Purchasing registers both classes, IT its own. Registering is not
  // managing — an IT asset Purchasing registers is IT's from this moment.
  else if (!canRegisterClass(user.role, category.cls)) {
    errors.categoryId = `${category.name} is ${CLASS_PHRASE[category.cls]} category — your department does not register ${CLASS_LABEL[category.cls]} assets.`;
  }
  if (d.typeId) {
    const type = await prisma.assetType.findUnique({ where: { id: d.typeId }, select: { categoryId: true } });
    if (!type || type.categoryId !== d.categoryId) errors.typeId = "That type doesn't belong to the chosen category";
  }

  // Serial is unique fleet-wide (like tag), but a batch never gets to check
  // itself against the database mid-loop — two rows of ONE submission naming
  // the same serial would otherwise fail only on the second `create()`, deep
  // inside the transaction, with a P2002 message that cannot say WHICH row.
  // Named here, by row, before the registered check below.
  const rowSerials = d.tags.map((_, i) => d.serials?.[i]?.trim() ?? "");
  const serials = rowSerials.filter(Boolean);
  const dupSerialAt = rowSerials.findIndex((s, i) => s !== "" && rowSerials.indexOf(s) !== i);
  if (dupSerialAt >= 0) errors.serials = `Row ${dupSerialAt + 1} · serial ${rowSerials[dupSerialAt]} appears twice in this batch`;

  // Already registered — scoped to the class being registered into (identifierWhere, the same rule
  // checkIdentifiers uses): these messages name rows and records, and a record of the OTHER class
  // must not be named. A cross-class collision still lands on the unique constraint in the
  // transaction below, as its neutral copy. Skipped when the category itself is refused.
  if (category && canRegisterClass(user.role, category.cls)) {
    const where = identifierWhere(category.cls, d.tags, serials);
    const [tagsTaken, serialsTaken] = await Promise.all([
      prisma.asset.findMany({ where: where.tags, select: { tag: true } }),
      serials.length ? prisma.asset.findMany({ where: where.serials, select: { serial: true, tag: true } }) : [],
    ]);
    if (tagsTaken.length && !errors.tags) {
      const taken = new Set(tagsTaken.map((a) => a.tag));
      const first = d.tags.findIndex((t) => taken.has(t));
      errors.tags = `Row ${first + 1} · ${d.tags[first]} is already registered${more(taken.size - 1)}`;
    }
    if (serialsTaken.length && !errors.serials) {
      const on = new Map(serialsTaken.map((a) => [a.serial as string, a.tag]));
      const first = rowSerials.find((s) => on.has(s)) as string;
      errors.serials = `Serial ${first} is already on ${on.get(first)}${more(on.size - 1)}`;
    }
  }

  // OPTIONAL metadata, never a gate (C-5) — but a named request must exist and be COMPLETED.
  if (d.requestId) {
    const req = await prisma.purchaseRequest.findUnique({
      where: { id: d.requestId },
      select: { refNo: true, state: true },
    });
    if (!req) errors.requestId = "Unknown request";
    else if (req.state !== "COMPLETED") errors.requestId = `${req.refNo} is ${req.state.toLowerCase()} — only a completed request can be linked.`;
  }

  if (Object.keys(errors).length || !category) return validationError(errors);
  // Spec §4 stamping: born checked when the registrant manages the class.
  const selfChecked = category.cls === "IT" && canManageClass(user.role, "IT");

  let done: Registered | null = null;

  try {
    await prisma.$transaction(async (tx) => {
      // Every refusal sits above this transaction (C-4): Prisma commits when
      // this callback resolves and rolls back only when it throws, so nothing
      // in here may decide to refuse after a write.
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
            purchasedAt: toDate(d.purchasedAt),
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
            warrantyUntil: toDate(d.warrantyUntil),
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
    }, {
      // 200 units x (one create + one audit write) can clear Prisma's 5s
      // interactive-transaction default well before the loop finishes — same
      // reasoning as bulkChangeStatus/bulkAssign (lifecycle/actions.ts) and
      // uploadBatchDocument (inventory/document-actions.ts).
      timeout: 60_000, maxWait: 10_000,
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

  revalidatePath("/inventory");
  return ok(done!);
}
