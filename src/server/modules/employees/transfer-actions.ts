"use server";

import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { actionRole } from "@/server/auth/guards";
import { checkRate } from "@/server/rate-limit";
import { writeAudit } from "@/server/audit";
import {
  conflict, forbidden, ok, rateLimited, validationError, zodFieldErrors, type ActionResult,
} from "@/server/action-result";
import { transferSchema } from "@/lib/transfer-schema";
import { GROUP_ARCHIVED } from "@/lib/groups";
import { BULK_MAX } from "@/lib/inventory-list";
import {
  bulkCountMessage, bulkTransferSchema, checkBulkTransfer, peopleCount, type BlockedPerson,
} from "@/lib/bulk-transfer";

/**
 * I-4, the same local class `item-actions.ts`/`movement-actions.ts`/
 * `stocktake-actions.ts` each declare: a refusal discovered inside
 * `$transaction` must THROW so Prisma rolls back whatever the callback
 * already wrote, never `return` — a plain `return` from an interactive
 * transaction's callback COMMITS.
 */
class ActionFailure extends Error {
  constructor(public readonly result: ActionResult<never>) {
    super(result.ok ? undefined : result.message);
  }
}

/**
 * Phase 20 (spec §3): a department transfer is recorded by IT directly — no
 * approval step, `canTransferEmployee` is exactly the roles that already
 * create/edit employees. One transaction: create the `EmployeeTransfer` row
 * (the dated history `Employee.departmentId` alone can't carry — an audit
 * diff has no effective date, and an update overwrites rather than
 * accumulating), update the employee's live `departmentId`/`title`, and
 * audit `employee.transferred` with the diff the brief gives. `toTitle` is
 * REQUIRED even when unchanged (the dialog prefills it with the current
 * title) — a transfer that leaves the title exactly as it was is still a
 * real transfer, not a title-only edit.
 *
 * I-4: two concurrent transfers reading the same employee (dept A) would
 * both pass every guard above and both write `fromDepartmentId = A`,
 * silently losing whichever transfer committed second (A→B and A→C when the
 * truth is A→B→C). The employee write is made conditional on the department
 * that was actually read: `updateMany` with that department in the WHERE
 * clause matches 0 rows if someone else's transfer already moved this
 * person, and the throw rolls back the whole transaction — the
 * `EmployeeTransfer` row and the audit entry are never written for the
 * loser. Postgres read-committed guarantees the second transaction's
 * `updateMany` sees the first transaction's already-committed department.
 */
export async function transferEmployee(input: unknown): Promise<ActionResult<{ id: string }>> {
  const user = await actionRole("admin", "it_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = transferSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const d = parsed.data;

  const employee = await prisma.employee.findUnique({
    where: { id: d.employeeId },
    include: { department: true },
  });
  if (!employee) return conflict("That employee no longer exists.");
  if (employee.employment === "OFFBOARDED") return conflict("A leaver cannot be transferred");
  if (d.toDepartmentId === employee.departmentId) {
    return validationError({ toDepartmentId: "Already in this department" });
  }
  const toDepartment = await prisma.department.findUnique({ where: { id: d.toDepartmentId } });
  if (!toDepartment) return validationError({ toDepartmentId: "Unknown department" });
  // Phase 37 (spec §2.1): an archived department or client takes no new people.
  if (toDepartment.archivedAt) return validationError({ toDepartmentId: GROUP_ARCHIVED });

  const effectiveAt = new Date(`${d.effectiveAt}T00:00:00Z`);
  if (Number.isNaN(effectiveAt.getTime())) return validationError({ effectiveAt: "Use the date picker" });

  try {
    await prisma.$transaction(async (tx) => {
      await recordTransfer(tx, {
        employee, toDepartment, toTitle: d.toTitle, effectiveAt, reason: d.reason || null, actor: user,
        raceMessage: "Someone else just transferred this person — reload and try again.",
      });
    });
  } catch (e) {
    if (e instanceof ActionFailure) return e.result;
    throw e;
  }

  revalidateTransferred([employee.id]);
  return ok({ id: employee.id });
}

/**
 * One person's transfer writes, shared by `transferEmployee` and `bulkTransferEmployees` and always run inside the
 * caller's `$transaction`: the employee's department and title, the dated `EmployeeTransfer` row, and the
 * `employee.transferred` audit entry with its diff. `employee` is the row the caller READ (its department included).
 *
 * I-4: the employee write is conditional on the department this action actually read. Zero rows means someone
 * else's transfer already moved this person since that read — throw before the transfer row or the audit entry
 * are written, so the loser's transaction rolls back clean (in the bulk path, everyone's does).
 */
async function recordTransfer(
  tx: Prisma.TransactionClient,
  t: {
    employee: { id: string; departmentId: string; title: string; department: { name: string } };
    toDepartment: { id: string; name: string };
    toTitle: string;
    effectiveAt: Date;
    reason: string | null;
    actor: { id: string; name: string };
    raceMessage: string;
  },
): Promise<void> {
  const { employee, toDepartment, toTitle, effectiveAt, actor } = t;
  const moved = await tx.employee.updateMany({
    where: { id: employee.id, departmentId: employee.departmentId },
    data: { departmentId: toDepartment.id, title: toTitle },
  });
  if (moved.count === 0) throw new ActionFailure(conflict(t.raceMessage));
  await tx.employeeTransfer.create({
    data: {
      employeeId: employee.id,
      fromDepartmentId: employee.departmentId,
      toDepartmentId: toDepartment.id,
      fromTitle: employee.title,
      toTitle,
      effectiveAt,
      reason: t.reason,
      actorId: actor.id,
    },
  });
  await writeAudit(tx, {
    actorId: actor.id, actorLabel: actor.name,
    entityType: "employee", entityId: employee.id,
    action: "employee.transferred",
    diff: {
      department: { from: employee.department.name, to: toDepartment.name },
      title: { from: employee.title, to: toTitle },
      effectiveAt: { from: null, to: effectiveAt },
    },
  });
}

function revalidateTransferred(ids: string[]) {
  revalidatePath("/employees");
  for (const id of ids) {
    revalidatePath(`/employees/${id}`);
    revalidatePath(`/employees/${id}/timeline`);
  }
  revalidatePath("/offboarding");
}

/**
 * Phase 45 (spec §3.4): Transfer… from the Employees bulk bar — the same role check, rate limit and per-person
 * writes as `transferEmployee`, for up to `BULK_MAX` people in ONE transaction. All or nothing: every person is
 * checked first (`checkBulkTransfer`), and if anyone can't move nothing is written and the refusal carries
 * `blocked` (who, and why) for the dialog to list. Each person keeps their own title (`toTitle` = their current
 * one); one audit entry per person, exactly as a single transfer writes.
 */
export async function bulkTransferEmployees(
  input: unknown,
): Promise<ActionResult<{ count: number }> & { blocked?: BlockedPerson[] }> {
  const user = await actionRole("admin", "it_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = bulkTransferSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const d = parsed.data;
  // refuse an empty or oversized selection before reading anyone
  const sizeMessage = bulkCountMessage(d.ids.length, BULK_MAX);
  if (sizeMessage) return validationError({ ids: sizeMessage });

  const [found, toDepartment] = await Promise.all([
    prisma.employee.findMany({ where: { id: { in: d.ids } }, include: { department: true } }),
    prisma.department.findUnique({ where: { id: d.toDepartmentId } }),
  ]);
  if (found.length !== d.ids.length) {
    return conflict("Someone in this selection no longer exists — reload and try again.");
  }
  // the order the operator ticked them in (the page's order), so the blocked list reads like the table
  const byId = new Map(found.map((e) => [e.id, e]));
  const people = d.ids.map((id) => byId.get(id)!);

  const check = checkBulkTransfer(people, toDepartment, BULK_MAX);
  if (!check.ok) {
    if (check.message) return validationError({ ids: check.message });
    return {
      ...conflict(`${peopleCount(check.blocked.length)} can't be transferred`),
      blocked: check.blocked,
    };
  }
  // checkBulkTransfer blocks everyone when the destination is missing, so it is here
  const dest = toDepartment!;

  const effectiveAt = new Date(`${d.effectiveAt}T00:00:00Z`);
  if (Number.isNaN(effectiveAt.getTime())) return validationError({ effectiveAt: "Use the date picker" });

  try {
    // Sequential per-person writes (3 round trips each, up to BULK_MAX people): the long-transaction budget the
    // other bulk and batch writers use, not Prisma's 5 s default.
    await prisma.$transaction(async (tx) => {
      for (const employee of people) {
        await recordTransfer(tx, {
          employee, toDepartment: dest, toTitle: employee.title, effectiveAt, reason: d.note || null, actor: user,
          raceMessage: `Someone else just transferred ${employee.name} — reload and try again.`,
        });
      }
    }, { timeout: 60_000, maxWait: 10_000 });
  } catch (e) {
    if (e instanceof ActionFailure) return e.result;
    throw e;
  }

  revalidateTransferred(people.map((p) => p.id));
  return ok({ count: people.length });
}
