"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { actionRole } from "@/server/auth/guards";
import { checkRate } from "@/server/rate-limit";
import { writeAudit } from "@/server/audit";
import { createApproval, openApprovalForAsset } from "@/server/modules/approvals/create";
import { OUTCOMES, OUTCOME_LABEL, OUTCOME_STATUS, decisionOf, reasonRequired } from "@/lib/offboarding";
import { APPROVAL_TYPE_LABEL } from "@/lib/labels";
import { candidatesFor } from "@/server/modules/offboarding/queries";
import {
  conflict, forbidden, ok, rateLimited, validationError, zodFieldErrors, type ActionResult,
} from "@/server/action-result";

// Module-local, deliberately NOT exported: every runtime export of a
// "use server" module must be an async function.
function revalidate(employeeId: string, assetId?: string) {
  revalidatePath("/offboarding");
  revalidatePath(`/offboarding/${employeeId}`);
  revalidatePath(`/offboarding/${employeeId}/report`);
  revalidatePath(`/employees/${employeeId}`);
  revalidatePath("/employees");
  revalidatePath("/approvals");
  revalidatePath("/audit");
  revalidatePath("/employees/activity");
  revalidatePath("/");
  if (assetId) {
    // requestReturn writes the identical approval + asset audit entry and
    // revalidates these; without them the inventory list keeps serving stale
    // open-request state for an asset that was just decided.
    revalidatePath("/inventory");
    revalidatePath("/inventory/activity");
    revalidatePath(`/inventory/${assetId}`);
    revalidatePath(`/inventory/${assetId}/history`);
  }
}

/**
 * Prisma throws rather than returning, and a transaction that can't get a
 * connection inside maxWait raises P2028 — reachable with two concurrent
 * transactions, and the one code where "nothing was written" is guaranteed
 * true. Everything else rethrows: an unexpected error must not be laundered
 * into a designed banner.
 *
 * NOTE for anyone editing the callbacks below: RETURNING a failure from a
 * $transaction callback COMMITS the transaction — only a throw rolls it back.
 * That is safe here because every `return conflict(...)` precedes every write.
 * Add a write before one of them and it will commit silently.
 */
async function asActionResult<T>(run: () => Promise<T>): Promise<T | ActionResult<never>> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2028") {
      return conflict("The database is busy right now — nothing was written. Try that again.");
    }
    throw err;
  }
}

const decideSchema = z.object({
  employeeId: z.string().min(1),
  assetId: z.string().min(1),
  outcome: z.enum(OUTCOMES),
  reason: z.string().trim().max(500).optional(),
});

/**
 * One decision → one approval, immediately (entry criterion #1). The payload's
 * to.status is what the worker will apply, and Task 1 taught executionPlan all
 * four outcomes — before that, three of them died as EXECUTION_FAILED.
 */
export async function decideItem(input: unknown): Promise<ActionResult<{ refNo: string }>> {
  const user = await actionRole("admin", "it_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = decideSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const d = parsed.data;
  const reason = (d.reason ?? "").trim();
  // README 3e: a reason is required for anything other than a clean return.
  if (reasonRequired(d.outcome) && reason.length < 3) {
    return validationError({
      reason: `${OUTCOME_LABEL[d.outcome]} needs a reason (at least 3 characters) — it lands in the approval and on the farewell report.`,
    });
  }

  let refNo = "";
  try {
    const failure = await prisma.$transaction(async (tx) => {
      const employee = await tx.employee.findUnique({ where: { id: d.employeeId } });
      if (!employee) return conflict("That employee no longer exists.");
      if (employee.employment !== "OFFBOARDING") {
        return conflict(
          `${employee.name} reads ${employee.employment}, not OFFBOARDING — set their employment on the employee record before collecting equipment.`,
        );
      }
      const asset = await tx.asset.findUnique({ where: { id: d.assetId } });
      if (!asset) return conflict("That asset no longer exists.");
      if (asset.assigneeId !== d.employeeId) {
        return conflict(`${asset.tag} isn't held by ${employee.name} any more — refresh the wizard.`);
      }
      // The one-open-per-asset index is per ASSET, not per approval type: a
      // pending lifecycle.change-status refuses this decision too, and
      // "that decision is already recorded" would be a lie pointing nowhere.
      const open = await openApprovalForAsset(tx, asset.id);
      if (open) {
        // A return created BEFORE this offboarding began owns the asset's one
        // open slot but decides nothing here, so claiming "already recorded"
        // would point the operator at a decision the wizard doesn't show —
        // and leave the item permanently undecidable.
        const inWindow =
          employee.offboardingAt !== null && open.createdAt >= employee.offboardingAt;
        return conflict(
          open.type === "lifecycle_return" && inWindow
            ? `${asset.tag} already has an open request — that decision is already recorded.`
            : `${asset.tag} is held by ${open.refNo} (${APPROVAL_TYPE_LABEL[open.type]}) — resolve that in Approvals first, then decide this item.`,
        );
      }
      const approval = await createApproval(tx, {
        type: "lifecycle_return",
        payload: {
          from: { assigneeId: d.employeeId },
          to: { assigneeId: null, status: OUTCOME_STATUS[d.outcome] },
          // keyed on the outcome rather than on emptiness: reasonRequired
          // guarantees a reason for the other three, and this sentinel would be
          // a lie stamped on a MISSING item if that ever changed
          reason: d.outcome === "RETURNED" ? reason || "offboarding · returned" : reason,
        },
        requestedById: user.id,
        assetId: asset.id,
        employeeId: d.employeeId,
        // Custody lost is not a "fine for now" problem.
        priority: d.outcome === "MISSING" ? "HIGH" : "NORMAL",
      });
      await writeAudit(tx, {
        actorId: user.id, actorLabel: user.name,
        entityType: "asset", entityId: asset.id,
        action: "approval.requested",
        diff: { approval: { from: null, to: approval.refNo } },
      });
      refNo = approval.refNo;
      return null;
    });
    if (failure) return failure;
  } catch (err) {
    // The partial unique index (one OPEN approval per asset) turns a
    // double-click — or a colleague on the same wizard — into a constraint
    // violation rather than two returns for one item.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return conflict("Another request just took this asset's open slot — refresh the wizard.");
    }
    // Prisma throws rather than returning: without this a P2028 (no connection
    // inside maxWait, reachable with two concurrent transactions) escapes as a
    // 500 instead of the designed conflict banner.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2028") {
      return conflict("The database is busy right now — nothing was written. Try that again.");
    }
    throw err;
  }
  revalidate(d.employeeId, d.assetId);
  return ok({ refNo });
}

const accountsSchema = z.object({
  employeeId: z.string().min(1),
  /** canonical four plus client-defined values stored as-is (README 4f); "" = never synced */
  m365Status: z.string().trim().max(60),
});

/**
 * Step 3. A partial update: only m365Status is written, and its before-value is
 * the updateMany guard — filling untouched fields from the row we just read is
 * how two people editing one employee silently clobber each other.
 */
export async function closeAccounts(
  input: unknown,
): Promise<ActionResult<{ m365Status: string | null; changed: boolean }>> {
  const user = await actionRole("admin", "it_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = accountsSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const { employeeId } = parsed.data;
  const next = parsed.data.m365Status === "" ? null : parsed.data.m365Status;

  let noop = false;
  const failure = await asActionResult(async () => prisma.$transaction(async (tx) => {
    const employee = await tx.employee.findUnique({ where: { id: employeeId } });
    if (!employee) return conflict("That employee no longer exists.");
    // Same gate as its siblings: step 3 of a wizard should not double as a
    // general-purpose "set anyone's account status to anything" mutation.
    if (employee.employment !== "OFFBOARDING") {
      return conflict(
        employee.employment === "OFFBOARDED"
          ? `${employee.name} is already offboarded — accounts are closed.`
          : `${employee.name} reads ${employee.employment}, not OFFBOARDING — account changes belong on the employee record.`,
      );
    }
    // Scope decision #12 lets `null` PASS the completion gate, because null
    // means "never synced — there was no account to close". That reading only
    // holds while null is the absence of a status, never the erasure of one:
    // blanking a live `active` here would complete the offboarding on an open
    // mailbox, and would leave the immutable completion audit stamping
    // `m365Status: { from: null, to: null }` over a status that did exist.
    // Correcting a genuinely wrong value back to unknown stays available on
    // the employee record, which is not the surface that closes accounts.
    if (next === null && employee.m365Status !== null) {
      return conflict(
        `"No sync yet" describes someone who never had an account — it can't be used to clear the ${employee.m365Status} already recorded against ${employee.name}.`,
      );
    }
    if (employee.m365Status === next) {
      noop = true;
      return null;
    }
    const written = await tx.employee.updateMany({
      where: { id: employeeId, m365Status: employee.m365Status },
      data: { m365Status: next },
    });
    if (written.count === 0) {
      return conflict("Someone else changed this account status while you were looking — refresh.");
    }
    await writeAudit(tx, {
      actorId: user.id, actorLabel: user.name,
      entityType: "employee", entityId: employeeId,
      action: "update",
      diff: { m365Status: { from: employee.m365Status, to: next } },
    });
    return null;
  }));
  if (failure) return failure;
  // nothing was written, so nothing is stale — updateEmployee skips the same way
  if (!noop) revalidate(employeeId);
  // `changed` so the panel can stop claiming "audit entry written" on a save
  // that wrote nothing — the noop path skips writeAudit, and AuditEntry is the
  // one immutable artifact here, so asserting an entry that doesn't exist is
  // the wrong thing to be wrong about.
  return ok({ m365Status: next, changed: !noop });
}

const completeSchema = z.object({ employeeId: z.string().min(1) });

/**
 * Step 4. Completing touches the PERSON only — every asset movement went
 * through its own approval (scope decision #7), so there is nothing to sweep up
 * here and no bulk write to time out.
 */
export async function completeOffboarding(input: unknown): Promise<ActionResult<{ employment: string }>> {
  const user = await actionRole("admin", "it_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = completeSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const { employeeId } = parsed.data;

  const failure = await asActionResult(async () => prisma.$transaction(async (tx) => {
    const employee = await tx.employee.findUnique({
      where: { id: employeeId },
      include: {
        assets: { select: { id: true } },
        approvals: {
          where: { type: "lifecycle_return", assetId: { not: null } },
          // the full ApprovalLike shape — groupCandidates needs id/refNo/createdAt
          // too, and createdAt is not a formality: without it every candidate
          // sorts on undefined and the comparator falls through to the id term
          select: { id: true, refNo: true, state: true, payload: true, createdAt: true, assetId: true },
        },
      },
    });
    if (!employee) return conflict("That employee no longer exists.");
    if (employee.employment !== "OFFBOARDING") {
      return conflict(`${employee.name} reads ${employee.employment} — only an OFFBOARDING person can be completed.`);
    }

    // Undecided is not the same as returned (entry criterion #2) — the server
    // says so too, not only the disabled Continue button. This goes through the
    // SAME groupCandidates + decisionOf the wizard reads with, because a second
    // definition of "decided" here would be a second answer: the Task 4 review
    // found the looser version counting an item the wizard still showed as open.
    const byAsset = candidatesFor(employee, employee.approvals);
    const decisions = employee.assets.map((a) => decisionOf(byAsset.get(a.id) ?? [], { held: true }));
    const undecided = decisions.filter((d) => d === null).length;
    if (undecided > 0) {
      return conflict(
        `${undecided} item${undecided === 1 ? "" : "s"} still ${undecided === 1 ? "has" : "have"} no decision — go back to Collect items.`,
      );
    }
    // `decisionOf` answers "must the operator be asked again?" — for which
    // EXECUTION_FAILED is correctly a yes-it-was-decided. Completion asks a
    // different question, "is this finished?", and a failed return never moved
    // the asset: the item is still assigned, and the person is about to drop out
    // of the /offboarding queue where anyone would notice.
    const failed = decisions.filter((d) => d?.state === "EXECUTION_FAILED");
    if (failed.length > 0) {
      return conflict(
        `${failed.map((d) => d!.refNo).join(", ")} failed to execute, so ${failed.length === 1 ? "that item is" : "those items are"} still assigned — retry or reject ${failed.length === 1 ? "it" : "them"} in Approvals first.`,
      );
    }
    // Scope decision #12: an offboarding cannot finish with a live account.
    // Case-folded: README 4f stores client-defined values as-is, so a tenant
    // using "Inactive" must not be refused forever. This is a display status,
    // not an identity field — the ILIKE hazard doesn't apply.
    const m365 = employee.m365Status?.trim().toLowerCase() ?? null;
    if (m365 !== null && m365 !== "inactive") {
      return conflict(`The M365 account still reads ${employee.m365Status} — close it on Accounts & M365 first.`);
    }

    const written = await tx.employee.updateMany({
      where: { id: employeeId, employment: "OFFBOARDING" },
      data: { employment: "OFFBOARDED" },
    });
    if (written.count === 0) return conflict("Someone else just completed this offboarding.");
    // AuditEntry is the only immutable artifact in the system, so the moment
    // worth snapshotting is this one. Everything else about a completed
    // offboarding is derived from mutable rows: reject one of these returns
    // afterwards and decisionOf re-opens that item, silently dropping it — and
    // its value — from a farewell report already treated as a signed record.
    await writeAudit(tx, {
      actorId: user.id, actorLabel: user.name,
      entityType: "employee", entityId: employeeId,
      action: "offboarding.completed",
      diff: {
        employment: { from: "OFFBOARDING", to: "OFFBOARDED" },
        m365Status: { from: employee.m365Status, to: employee.m365Status },
        decisions: {
          from: null,
          to: decisions
            .filter((d) => d !== null)
            .map((d) => `${d!.refNo} · ${d!.outcome} · ${d!.state}`),
        },
      },
    });
    return null;
  }));
  if (failure) return failure;
  revalidate(employeeId);
  return ok({ employment: "OFFBOARDED" });
}
