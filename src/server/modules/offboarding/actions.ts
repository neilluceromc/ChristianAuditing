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
import { groupCandidates } from "@/server/modules/offboarding/queries";
import {
  conflict, forbidden, ok, rateLimited, validationError, zodFieldErrors, type ActionResult,
} from "@/server/action-result";

// Module-local, deliberately NOT exported: every runtime export of a
// "use server" module must be an async function.
function revalidate(employeeId: string) {
  revalidatePath("/offboarding");
  revalidatePath(`/offboarding/${employeeId}`);
  revalidatePath(`/offboarding/${employeeId}/report`);
  revalidatePath(`/employees/${employeeId}`);
  revalidatePath("/employees");
  revalidatePath("/approvals");
  revalidatePath("/audit");
  revalidatePath("/");
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
        return conflict(
          open.type === "lifecycle_return"
            ? `${asset.tag} already has an open request — that decision is already recorded.`
            : `${asset.tag} is held by ${open.refNo} (${APPROVAL_TYPE_LABEL[open.type]}) — resolve that in Approvals first, then decide this item.`,
        );
      }
      const approval = await createApproval(tx, {
        type: "lifecycle_return",
        payload: {
          from: { assigneeId: d.employeeId },
          to: { assigneeId: null, status: OUTCOME_STATUS[d.outcome] },
          reason: reason || "offboarding · returned",
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
      return conflict("That item was just decided by someone else — refresh the wizard.");
    }
    // Prisma throws rather than returning: without this a P2028 (no connection
    // inside maxWait, reachable with two concurrent transactions) escapes as a
    // 500 instead of the designed conflict banner.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2028") {
      return conflict("The database is busy right now — nothing was written. Try that again.");
    }
    throw err;
  }
  revalidate(d.employeeId);
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
export async function closeAccounts(input: unknown): Promise<ActionResult<{ m365Status: string | null }>> {
  const user = await actionRole("admin", "it_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = accountsSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const { employeeId } = parsed.data;
  const next = parsed.data.m365Status === "" ? null : parsed.data.m365Status;

  const failure = await prisma.$transaction(async (tx) => {
    const employee = await tx.employee.findUnique({ where: { id: employeeId } });
    if (!employee) return conflict("That employee no longer exists.");
    if (employee.employment === "OFFBOARDED") {
      return conflict(`${employee.name} is already offboarded — accounts are closed.`);
    }
    if (employee.m365Status === next) return null;
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
  });
  if (failure) return failure;
  revalidate(employeeId);
  return ok({ m365Status: next });
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

  const failure = await prisma.$transaction(async (tx) => {
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
    const byAsset = groupCandidates(employee.approvals);
    const undecided = employee.assets.filter(
      (a) => decisionOf(byAsset.get(a.id) ?? [], { held: true }) === null,
    ).length;
    if (undecided > 0) {
      return conflict(
        `${undecided} item${undecided === 1 ? "" : "s"} still ${undecided === 1 ? "has" : "have"} no decision — go back to Collect items.`,
      );
    }
    // Scope decision #12: an offboarding cannot finish with a live account.
    if (employee.m365Status !== null && employee.m365Status !== "inactive") {
      return conflict(`The M365 account still reads ${employee.m365Status} — close it on Accounts & M365 first.`);
    }

    const written = await tx.employee.updateMany({
      where: { id: employeeId, employment: "OFFBOARDING" },
      data: { employment: "OFFBOARDED" },
    });
    if (written.count === 0) return conflict("Someone else just completed this offboarding.");
    await writeAudit(tx, {
      actorId: user.id, actorLabel: user.name,
      entityType: "employee", entityId: employeeId,
      action: "offboarding.completed",
      diff: { employment: { from: "OFFBOARDING", to: "OFFBOARDED" } },
    });
    return null;
  });
  if (failure) return failure;
  revalidate(employeeId);
  return ok({ employment: "OFFBOARDED" });
}
