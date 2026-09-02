"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { actionRole } from "@/server/auth/guards";
import { checkRate } from "@/server/rate-limit";
import { writeAudit } from "@/server/audit";
import { TAG_SHAPE } from "@/lib/tag-key";
import { isFullyReceived, outstanding, type UnitReceipt } from "@/lib/receiving";
import {
  conflict, forbidden, ok, rateLimited, validationError, zodFieldErrors, type ActionResult,
} from "@/server/action-result";

const lineSchema = z.object({
  unitId: z.string().min(1),
  categoryId: z.string().min(1, "Pick a category"),
  typeId: z.string().optional(),
  // One tag per asset to create. The COUNT is the received quantity — there is
  // no separate qty field, so the two can never disagree.
  tags: z.array(z.string().trim().toUpperCase().regex(TAG_SHAPE, "Format: BR-XX-0000")).min(1),
  serials: z.array(z.string().trim().max(120)).optional(),
});

const receiveSchema = z.object({
  requestId: z.string().min(1),
  lines: z.array(lineSchema).min(1, "Nothing to receive"),
});

interface Received {
  refNo: string;
  created: number;
}

/**
 * Units of a request with how many assets already point at each.
 *
 * `received` is a COUNT, never a flag (spec decision 4). Only APPROVED units
 * are returned: a REJECTED or CANCELLED unit was not bought, and a PENDING one
 * on a COMPLETED request is a data inconsistency rather than something to
 * receive.
 */
export async function receivableUnits(requestId: string): Promise<UnitReceipt[]> {
  const units = await prisma.purchaseUnit.findMany({
    where: { requestId, state: "APPROVED" },
    select: { id: true, qty: true, _count: { select: { assets: true } } },
    orderBy: { createdAt: "asc" },
  });
  return units.map((u) => ({ unitId: u.id, ordered: u.qty, received: u._count.assets }));
}

/** The prefixes already in use by assets of a given category, most-used first
 *  — the raw material for `preferredPrefix`. Grouped in SQL rather than pulled
 *  into memory, because this runs on every render of the receive screen. */
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

export async function receiveUnits(input: unknown): Promise<ActionResult<Received>> {
  const user = await actionRole("admin", "it_staff");
  if (!user) return forbidden();
  // checkRate takes a bare userId and returns { allowed, retryAfterSec } — it
  // is NOT a boolean, and the kind defaults to "mutation". This is the exact
  // shape purchases/actions.ts:74-75 uses; do not invent a composite key.
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);

  const parsed = receiveSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const d = parsed.data;

  // A duplicate WITHIN one submission would otherwise reach the database and
  // surface as a P2002 that reads like a concurrent receipt. Catch it here so
  // the message names the real cause.
  const all = d.lines.flatMap((l) => l.tags);
  const dupe = all.find((t, i) => all.indexOf(t) !== i);
  if (dupe) return conflict(`${dupe} appears twice in this receipt.`);

  let done: Received | null = null;
  let failure: ActionResult<Received> | null = null;

  try {
    await prisma.$transaction(async (tx) => {
      const req = await tx.purchaseRequest.findUnique({
        where: { id: d.requestId },
        select: { id: true, refNo: true, state: true },
      });
      if (!req) {
        failure = validationError({ requestId: "Unknown request" });
        return;
      }
      if (req.state !== "COMPLETED") {
        failure = conflict(`${req.refNo} is ${req.state.toLowerCase()} — only a completed request can be received.`);
        return;
      }

      let created = 0;
      for (const line of d.lines) {
        const unit = await tx.purchaseUnit.findUnique({
          where: { id: line.unitId },
          select: {
            id: true, requestId: true, qty: true, state: true, description: true,
            unitPrice: true, _count: { select: { assets: true } },
          },
        });
        if (!unit || unit.requestId !== req.id) {
          failure = validationError({ lines: "A unit does not belong to this request" });
          return;
        }
        if (unit.state !== "APPROVED") {
          failure = conflict(`"${unit.description}" is ${unit.state.toLowerCase()} — it was not purchased.`);
          return;
        }

        // Re-read INSIDE the transaction: the screen was rendered from a
        // snapshot, and someone else may have received in between.
        const receipt: UnitReceipt = { unitId: unit.id, ordered: unit.qty, received: unit._count.assets };
        if (isFullyReceived(receipt)) {
          failure = conflict(`"${unit.description}" is already fully received.`);
          return;
        }
        if (line.tags.length > outstanding(receipt)) {
          failure = conflict(
            `"${unit.description}" has ${outstanding(receipt)} outstanding — cannot receive ${line.tags.length}.`,
          );
          return;
        }

        for (const [i, tag] of line.tags.entries()) {
          const asset = await tx.asset.create({
            data: {
              tag,
              model: unit.description,
              serial: line.serials?.[i]?.trim() || null,
              categoryId: line.categoryId,
              typeId: line.typeId || null,
              status: "SPARE",
              cost: unit.unitPrice ?? null,
              purchaseRequestId: req.id,
              purchaseUnitId: unit.id,
            },
          });
          created++;
          await writeAudit(tx, {
            actorId: user.id,
            actorLabel: user.name,
            entityType: "asset",
            entityId: asset.id,
            action: "receive",
            diff: {
              tag: { from: null, to: asset.tag },
              status: { from: null, to: "SPARE" },
              purchaseRequest: { from: null, to: req.refNo },
            },
          });
        }
      }

      // One note for the whole receipt, not one per asset: the thread is a
      // human conversation about the request, and twelve identical lines would
      // bury it.
      await tx.noteEntry.create({
        data: {
          requestId: req.id,
          authorId: user.id,
          kind: "RECEIVE",
          text: `Received ${created} asset${created === 1 ? "" : "s"}.`,
        },
      });

      done = { refNo: req.refNo, created };
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      // Asset.tag is @unique, so a concurrent receipt collides here rather
      // than silently duplicating. Loud is the whole point.
      return conflict("One of those tags was just taken. Reload and try again.");
    }
    throw e;
  }

  if (failure) return failure;
  revalidatePath(`/purchases/${d.requestId}`);
  revalidatePath(`/purchases/${d.requestId}/receive`);
  revalidatePath("/inventory");
  return ok(done!);
}
