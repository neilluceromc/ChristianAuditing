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
  conflict, forbidden, ok, rateLimited, validationError, zodFieldErrors, type ActionResult,
} from "@/server/action-result";

/** The prefixes already in use by assets of a given category, most-used first
 *  — the raw material for `preferredPrefix`. Grouped in SQL rather than pulled
 *  into memory, because this runs on every render of the register screen. */
export async function prefixCountsForCategory(
  categoryId: string,
): Promise<Array<{ prefix: string; n: number }>> {
  const rows = await prisma.$queryRaw<Array<{ prefix: string; n: bigint }>>`
    SELECT substring("tag", 4, 2) AS prefix, count(*) AS n
    FROM "Asset"
    WHERE "categoryId" = ${categoryId}
    GROUP BY 1
    ORDER BY 2 DESC, 1 ASC
  `;
  return rows.map((r) => ({ prefix: r.prefix, n: Number(r.n) }));
}

/** The highest number currently used by a prefix, or null if unused. */
export async function highestTagNumber(prefix: string): Promise<number | null> {
  const rows = await prisma.$queryRaw<Array<{ max: string | null }>>`
    SELECT max(substring("tag", 7, 4)) AS max
    FROM "Asset"
    WHERE substring("tag", 4, 2) = ${prefix}
  `;
  const raw = rows[0]?.max;
  return raw == null ? null : Number(raw);
}

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
  // OPTIONAL metadata, never a gate (C-5). If a request is named it must be
  // COMPLETED, because linking an asset to a request still in flight would
  // claim a provenance that is not settled.
  requestId: z.string().optional(),
});

interface Registered {
  created: number;
}

export async function registerAssets(input: unknown): Promise<ActionResult<Registered>> {
  const user = await actionRole("admin", "it_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);

  const parsed = registerSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const d = parsed.data;

  const dupe = d.tags.find((t, i) => d.tags.indexOf(t) !== i);
  if (dupe) return conflict(`${dupe} appears twice in this batch.`);

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
      for (const [i, tag] of d.tags.entries()) {
        const asset = await tx.asset.create({
          data: {
            tag,
            model: d.model,
            serial: d.serials?.[i]?.trim() || null,
            categoryId: d.categoryId,
            typeId: d.typeId || null,
            status: "SPARE",
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
            purchaseRequestId: d.requestId || null,
          },
        });
        created++;
        await writeAudit(tx, {
          actorId: user.id,
          actorLabel: user.name,
          entityType: "asset",
          entityId: asset.id,
          action: "register",
          diff: {
            tag: { from: null, to: asset.tag },
            status: { from: null, to: "SPARE" },
          },
        });
      }
      done = { created };
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return conflict("One of those tags was just taken. Reload and try again.");
    }
    throw e;
  }

  if (failure) return failure;
  revalidatePath("/inventory");
  return ok(done!);
}
