"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma, type Role } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { actionRole } from "@/server/auth/guards";
import { checkRate } from "@/server/rate-limit";
import { writeAudit } from "@/server/audit";
import { diffOf } from "@/lib/audit-diff";
import {
  CANONICAL_NOTE, PURCHASE_ACTION_ROLES, PURCHASE_NOTE_KIND, REASON_REQUIRED,
  purchaseTransition, unitEditorMode, type PurchaseAction,
} from "@/lib/purchase-flow";
import {
  conflict, forbidden, ok, rateLimited, validationError, zodFieldErrors, type ActionResult,
} from "@/server/action-result";

// not exported: a "use server" module's runtime exports must all be async
// functions, and Phase 4's approvals actions set the same precedent
interface Acted {
  refNo: string;
  state: string;
}

const transitionSchema = z.object({
  id: z.string().min(1),
  reason: z.string().trim().max(500).optional(),
});

function revalidate(id: string) {
  revalidatePath("/purchases");
  revalidatePath(`/purchases/${id}`);
  // submit, it-reject and cancel all change whether the edit page may render
  // an editor at all, so its cache entry has to go too
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
 * Shared skeleton (Phase 4's transition() shape): read → pure transition check
 * → state-guarded updateMany. `where: { id, state: current }` makes a
 * concurrent transition a no-op (count 0 → conflict) instead of a lost update.
 * The NoteEntry append and the audit write share the transaction, so a
 * transition can never land without its thread entry.
 */
async function runTransition(action: PurchaseAction, input: unknown): Promise<ActionResult<Acted>> {
  const parsed = transitionSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const { id } = parsed.data;
  const reason = (parsed.data.reason ?? "").trim();

  const user = await actionRole(...(PURCHASE_ACTION_ROLES[action] as Role[]));
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  if (REASON_REQUIRED.includes(action) && reason.length < 3) {
    return validationError({ reason: "Give a reason (at least 3 characters) — it is appended to the thread." });
  }

  let acted: Acted | null = null;
  const failure = await prisma.$transaction(async (tx) => {
    const req = await tx.purchaseRequest.findUnique({
      where: { id },
      select: { id: true, refNo: true, state: true, requestedById: true },
    });
    if (!req) return conflict("That request no longer exists.");

    const t = purchaseTransition(req.state, action, user.role);
    if (!t.ok) return conflict(t.error);

    // Submitting and cancelling are the REQUESTER's own acts (scope decision
    // #2: cancel is a withdrawal). The party check above only proves someone
    // is purchasing staff — without this, any colleague could irreversibly
    // cancel a request finance had already worked, and draft-actions.ts
    // already refuses to let them so much as edit it.
    if ((action === "submit" || action === "cancel") && req.requestedById !== user.id && user.role !== "admin") {
      return forbidden();
    }

    // README 3f: vague specs are exactly what IT review is for. Missing prices
    // are not — finance can't approve a number nobody wrote down.
    if (action === "submit") {
      const unpriced = await tx.purchaseUnit.count({ where: { requestId: id, unitPrice: null } });
      if (unpriced > 0) {
        return conflict(
          `${unpriced} line${unpriced === 1 ? "" : "s"} still ${unpriced === 1 ? "has" : "have"} no price — IT review sharpens specs, it doesn't invent budgets.`,
        );
      }
    }

    const now = new Date();
    // reviewedById is a relation FK: UpdateManyMutationInput omits it, so it
    // rides along in the intersection type (the same shape Phase 4 used for
    // claimedById on the approvals queue).
    const data: Prisma.PurchaseRequestUpdateManyMutationInput & { reviewedById?: string } = {
      state: t.next,
      updatedAt: now,
    };
    if (action === "submit") data.submittedAt = now;
    if (action === "it-review") {
      data.reviewedAt = now;
      data.reviewedById = user.id;
    }
    if (action === "complete") data.completedAt = now;
    if (action === "cancel") {
      data.cancelledAt = now;
      data.cancelReason = reason;
    }

    const updated = await tx.purchaseRequest.updateMany({ where: { id, state: req.state }, data });
    if (updated.count === 0) {
      return conflict("Someone else moved this request first — refresh and retry.");
    }

    // Scope decision #6: cancelling withdraws its open units; completing IS
    // the money approval for whatever finance left PENDING.
    let unitDiff: Record<string, { from: unknown; to: unknown }> = {};
    if (action === "cancel" || action === "complete") {
      const to = action === "cancel" ? "CANCELLED" : "APPROVED";
      const moved = await tx.purchaseUnit.updateMany({
        where: { requestId: id, state: "PENDING" },
        data: { state: to },
      });
      if (moved.count > 0) {
        unitDiff = { units: { from: `${moved.count} PENDING`, to: `${moved.count} ${to}` } };
      }
    }

    // NoteEntry is the only notes surface, and it is append-only (DB trigger).
    await tx.noteEntry.create({
      data: {
        requestId: id,
        authorId: user.id,
        kind: PURCHASE_NOTE_KIND[action],
        text: reason || CANONICAL_NOTE[action],
      },
    });

    await writeAudit(tx, {
      actorId: user.id,
      actorLabel: user.name,
      entityType: "purchase-request",
      entityId: id,
      action,
      diff: {
        state: { from: req.state, to: t.next },
        ...unitDiff,
        ...(reason ? { reason: { from: null, to: reason } } : {}),
      },
    });

    acted = { refNo: req.refNo, state: t.next };
    return null;
  });

  if (failure) return failure;
  revalidate(id);
  return ok(acted!);
}

export async function submitRequest(input: unknown): Promise<ActionResult<Acted>> {
  return asActionResult(() => runTransition("submit", input));
}
export async function itReviewRequest(input: unknown): Promise<ActionResult<Acted>> {
  return asActionResult(() => runTransition("it-review", input));
}
export async function itRejectRequest(input: unknown): Promise<ActionResult<Acted>> {
  return asActionResult(() => runTransition("it-reject", input));
}
export async function requestMoreInfo(input: unknown): Promise<ActionResult<Acted>> {
  return asActionResult(() => runTransition("request-info", input));
}
export async function cancelRequest(input: unknown): Promise<ActionResult<Acted>> {
  return asActionResult(() => runTransition("cancel", input));
}
export async function completeRequest(input: unknown): Promise<ActionResult<Acted>> {
  return asActionResult(() => runTransition("complete", input));
}

const commentSchema = z.object({
  id: z.string().min(1),
  text: z.string().trim().min(2, "Say something").max(2000),
});

/**
 * A free comment in the three-party thread — never a state change, and
 * deliberately still allowed on a COMPLETED or CANCELLED request: the thread
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
    const req = await tx.purchaseRequest.findUnique({ where: { id }, select: { id: true } });
    if (!req) return conflict("That request no longer exists.");
    await tx.noteEntry.create({ data: { requestId: id, authorId: user.id, kind: "COMMENT", text } });
    await writeAudit(tx, {
      actorId: user.id, actorLabel: user.name, entityType: "purchase-request",
      entityId: id, action: "comment",
    });
    return null;
  });

  if (failure) return failure;
  revalidate(id);
  return ok(null);
}

const unitSaveSchema = z.object({
  unitId: z.string().min(1),
  specs: z.string().trim().max(500).optional(),
  itSlotNotes: z.string().trim().max(500).optional(),
  financeNotes: z.string().trim().max(500).optional(),
  state: z.enum(["PENDING", "APPROVED", "REJECTED"]).optional(),
});

/**
 * The editor a person gets is decided by `unitEditorMode` (pure, in
 * `@/lib/purchase-flow` — a "use server" module may only export async
 * functions). Saving a unit does NOT re-submit the request: nothing below
 * touches PurchaseRequest.state.
 */
export async function saveUnit(input: unknown): Promise<ActionResult<null>> {
  return asActionResult(() => saveUnitImpl(input));
}

async function saveUnitImpl(input: unknown): Promise<ActionResult<null>> {
  const parsed = unitSaveSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const { unitId, specs, itSlotNotes, financeNotes, state } = parsed.data;

  const user = await actionRole("it_staff", "finance_staff", "admin");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);

  let requestId: string | null = null;
  const failure = await prisma.$transaction(async (tx) => {
    const unit = await tx.purchaseUnit.findUnique({
      where: { id: unitId },
      select: {
        id: true, requestId: true, specs: true, itSlotNotes: true, financeNotes: true, state: true,
        request: { select: { state: true } },
      },
    });
    if (!unit) return conflict("That unit no longer exists.");
    requestId = unit.requestId;

    const mode = unitEditorMode(unit.request.state, user.role);
    if (!mode) {
      return conflict(`A ${unit.request.state} request has no editable units for your role.`);
    }
    if (unit.state === "CANCELLED") return conflict("A cancelled unit is read-only.");

    /**
     * Write ONLY the fields this caller actually sent. Filling the untouched
     * ones from the row we just read would rewrite them with a value that is
     * already stale under READ COMMITTED: two people saving different fields
     * of the same line would each clobber the other's, and `diffOf` — reading
     * the same stale row — wouldn't even record the loss.
     *
     * Empty string normalizes to null, matching what draft-actions.ts stores,
     * so a cleared field reads as absent everywhere rather than as "".
     */
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    const write = (key: "specs" | "itSlotNotes" | "financeNotes", value: string | undefined) => {
      if (value === undefined) return;
      before[key] = unit[key];
      after[key] = value || null;
    };
    if (mode === "it") {
      write("specs", specs);
      write("itSlotNotes", itSlotNotes);
    } else {
      write("financeNotes", financeNotes);
      if (state !== undefined) {
        before.state = unit.state;
        after.state = state;
      }
    }
    if (Object.keys(after).length === 0) return null; // the caller sent nothing to write

    const diff = diffOf(before, after);
    if (Object.keys(diff).length === 0) return null; // nothing changed — no write, no audit row

    const updated = await tx.purchaseUnit.updateMany({
      // every field being written is also in the guard, so a concurrent edit
      // to the same field loses and conflicts instead of vanishing
      where: { id: unitId, state: unit.state, request: { state: unit.request.state }, ...before },
      data: after,
    });
    if (updated.count === 0) {
      return conflict("Someone else changed this unit first — refresh and retry.");
    }

    await writeAudit(tx, {
      actorId: user.id,
      actorLabel: user.name,
      entityType: "purchase-request",
      entityId: unit.requestId,
      action: "unit-update",
      diff: { unit: { from: null, to: unit.id }, ...diff },
    });
    return null;
  });

  if (failure) return failure;
  if (requestId) revalidate(requestId);
  return ok(null);
}
