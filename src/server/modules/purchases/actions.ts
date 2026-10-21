"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { actionRole } from "@/server/auth/guards";
import { checkRate } from "@/server/rate-limit";
import { writeAudit } from "@/server/audit";
import { PO_WRITE_ROLES } from "@/lib/po-flow";
import { reasonRequired } from "@/lib/reason";
import {
  conflict, forbidden, ok, rateLimited, validationError, zodFieldErrors, type ActionResult,
} from "@/server/action-result";

// not exported: a "use server" module's runtime exports must all be async
// functions, and Phase 4's approvals actions set the same precedent
interface Acted {
  refNo: string;
  state: string;
}

const cancelSchema = z.object({
  id: z.string().min(1),
  reason: reasonRequired({ message: "Give a reason (at least 3 characters) — it is appended to the thread." }),
});

function revalidate(id: string) {
  revalidatePath("/purchases");
  revalidatePath(`/purchases/${id}`);
  // cancelling changes whether the edit page may render an editor at all,
  // so its cache entry has to go too
  revalidatePath(`/purchases/${id}/edit`);
  revalidatePath("/purchases/activity");
  revalidatePath("/audit");
}

/**
 * Prisma throws rather than returning, and an interactive transaction that
 * can't get a connection inside `maxWait` raises P2028 — under contention that
 * is a plain "someone else is working on this", not a 500. Everything else
 * rethrows: an unexpected error must not be laundered into a friendly banner.
 */
async function asActionResult<T>(run: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2028") {
      return conflict("The database is busy right now — nothing was written. Try that again.");
    }
    throw err;
  }
}

/**
 * Migration 38: the old request transitions (submit, IT review / reject, request-info, complete) are gone; a
 * purchase order records something already bought. Cancelling stays until Task 3's cancelPurchaseOrder replaces
 * it: the requester's (or an admin's) withdrawal, reason required, only while nothing is registered from it.
 * The state-guarded updateMany makes a concurrent change a conflict instead of a lost update, and the
 * NoteEntry append and the audit write share the transaction.
 */
export async function cancelRequest(input: unknown): Promise<ActionResult<Acted>> {
  return asActionResult(() => cancelImpl(input));
}

async function cancelImpl(input: unknown): Promise<ActionResult<Acted>> {
  const parsed = cancelSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const { id, reason } = parsed.data;

  const user = await actionRole(...PO_WRITE_ROLES);
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);

  let acted: Acted | null = null;
  const failure = await prisma.$transaction(async (tx) => {
    const po = await tx.purchaseOrder.findUnique({
      where: { id },
      select: { id: true, refNo: true, state: true, requestedById: true, _count: { select: { assets: true } } },
    });
    if (!po) return conflict("That purchase order no longer exists.");
    if (po.requestedById !== user.id && user.role !== "admin") return forbidden();
    if (po.state === "CANCELLED") return conflict(`${po.refNo} is already cancelled.`);
    if (po._count.assets > 0) {
      return conflict(`${po.refNo} has assets registered from it — it can't be cancelled.`);
    }

    const now = new Date();
    const updated = await tx.purchaseOrder.updateMany({
      where: { id, state: po.state },
      data: { state: "CANCELLED", cancelledAt: now, cancelReason: reason, updatedAt: now },
    });
    if (updated.count === 0) {
      return conflict("Someone else moved this purchase order first — refresh and retry.");
    }

    // NoteEntry is the only notes surface, and it is append-only (DB trigger).
    await tx.noteEntry.create({ data: { orderId: id, authorId: user.id, kind: "PO_CANCELLED", text: reason } });

    await writeAudit(tx, {
      actorId: user.id,
      actorLabel: user.name,
      entityType: "purchase-order",
      entityId: id,
      action: "cancel",
      diff: { state: { from: po.state, to: "CANCELLED" }, reason: { from: null, to: reason } },
    });

    acted = { refNo: po.refNo, state: "CANCELLED" };
    return null;
  });

  if (failure) return failure;
  revalidate(id);
  return ok(acted!);
}

const commentSchema = z.object({
  id: z.string().min(1),
  text: z.string().trim().min(2, "Say something").max(2000),
});

/**
 * A free comment in the three-party thread — never a state change, and
 * deliberately still allowed on a READY or CANCELLED order: the thread
 * IS the record of a purchase, and "why did we buy this" gets asked after the
 * fact. Comments never move the stepper (bounceBack ignores COMMENT notes).
 */
export async function addComment(input: unknown): Promise<ActionResult<null>> {
  return asActionResult(() => addCommentImpl(input));
}

async function addCommentImpl(input: unknown): Promise<ActionResult<null>> {
  const parsed = commentSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const { id, text } = parsed.data;

  const user = await actionRole("purchasing_staff", "it_staff", "finance_staff", "admin");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);

  const failure = await prisma.$transaction(async (tx) => {
    const po = await tx.purchaseOrder.findUnique({ where: { id }, select: { id: true } });
    if (!po) return conflict("That purchase order no longer exists.");
    await tx.noteEntry.create({ data: { orderId: id, authorId: user.id, kind: "COMMENT", text } });
    await writeAudit(tx, {
      actorId: user.id, actorLabel: user.name, entityType: "purchase-order",
      entityId: id, action: "comment",
    });
    return null;
  });

  if (failure) return failure;
  revalidate(id);
  return ok(null);
}
