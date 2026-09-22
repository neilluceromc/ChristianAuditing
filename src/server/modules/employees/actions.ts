"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { actionRole, actionUser } from "@/server/auth/guards";
import { checkRate } from "@/server/rate-limit";
import { writeAudit } from "@/server/audit";
import { createApproval, openApprovalForAsset } from "@/server/modules/approvals/create";
import {
  conflict, forbidden, ok, rateLimited, validationError, zodFieldErrors, type ActionResult,
} from "@/server/action-result";
import { diffOf } from "@/lib/audit-diff";
import { ASSIGNABLE_FROM, DEFAULT_ASSIGN_STATUS, DEFAULT_STATUS, canManageClass, isAssignable, isDirectLifecycle } from "@/lib/asset-class";
import { isApprover } from "@/lib/approval-access";
import { reasonRequired, reasonOptional } from "@/lib/reason";
import { findSameName } from "@/server/modules/employees/queries";
import { dayFromISO, defaultOffboardingDue, minOffboardingDue } from "@/lib/deadlines";
import { localDateISO } from "@/lib/format";
import { nextEmployeeNo as nextNo } from "@/lib/employee-no";
import { previewPolicyFor } from "@/lib/policy-preview";

/** Phase 15: IT's lifecycle changes apply directly (Change status, Assign, Return) — the request path is closed to it. */
const DIRECT_REFUSAL = "IT changes apply directly — use Change status, Assign or Return.";

const assignSchema = z.object({
  employeeId: z.string().min(1),
  assetId: z.string().min(1),
  reason: reasonOptional(),
});

/** `+` on a slot: lifecycle.assign approval. The asset stays SPARE until execution. */
export async function requestAssign(input: unknown): Promise<ActionResult<{ refNo: string }>> {
  const user = await actionUser();
  if (!user || !isApprover(user.role)) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = assignSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const d = parsed.data;

  let refNo = "";
  try {
    const failure = await prisma.$transaction(async (tx) => {
      const employee = await tx.employee.findUnique({ where: { id: d.employeeId } });
      if (!employee) return conflict("That employee no longer exists.");
      if (employee.employment !== "ACTIVE") {
        return conflict(`${employee.name} is ${employee.employment.toLowerCase()} — slots are frozen.`);
      }
      const asset = await tx.asset.findUnique({
        where: { id: d.assetId },
        include: { reservations: { where: { state: "ACTIVE" }, include: { employee: true } } },
      });
      if (!asset) return conflict("That asset no longer exists.");
      if (!canManageClass(user.role, asset.cls)) return forbidden();
      if (isDirectLifecycle(user.role, asset.cls)) return conflict(DIRECT_REFUSAL);
      if (!isAssignable(asset)) {
        return conflict(`${asset.tag} is ${asset.status}, not ${ASSIGNABLE_FROM[asset.cls]} — only idle stock can be assigned.`);
      }
      const hold = asset.reservations[0];
      if (hold && hold.employeeId !== d.employeeId) {
        return conflict(`${asset.tag} is reserved for ${hold.employee.name} — release the hold first.`);
      }
      if (await openApprovalForAsset(tx, asset.id)) {
        return conflict(`${asset.tag} already has an open request.`);
      }
      const approval = await createApproval(tx, {
        type: "lifecycle_assign",
        payload: {
          to: { assigneeId: d.employeeId, status: DEFAULT_ASSIGN_STATUS[asset.cls] },
          reason: d.reason || (hold ? "reserved — fulfilling the hold" : "slot fill"),
        },
        requestedById: user.id,
        assetId: asset.id,
        employeeId: d.employeeId,
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
    // concurrent-request race into a constraint violation.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return conflict("Someone else just requested a change on this asset — refresh and retry.");
    }
    throw err;
  }
  revalidatePath(`/employees/${d.employeeId}`);
  revalidatePath("/inventory");
  revalidatePath(`/inventory/${d.assetId}`);
  return ok({ refNo });
}

const returnSchema = z.object({
  employeeId: z.string().min(1),
  assetId: z.string().min(1),
  reason: reasonRequired(),
});

/** `−` on a filled tile: lifecycle.return approval. */
export async function requestReturn(input: unknown): Promise<ActionResult<{ refNo: string }>> {
  const user = await actionUser();
  if (!user || !isApprover(user.role)) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = returnSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const d = parsed.data;

  let refNo = "";
  try {
    const failure = await prisma.$transaction(async (tx) => {
      const asset = await tx.asset.findUnique({ where: { id: d.assetId } });
      if (!asset) return conflict("That asset no longer exists.");
      if (!canManageClass(user.role, asset.cls)) return forbidden();
      if (isDirectLifecycle(user.role, asset.cls)) return conflict(DIRECT_REFUSAL);
      if (asset.assigneeId !== d.employeeId) return conflict(`${asset.tag} isn't held by this person.`);
      if (await openApprovalForAsset(tx, asset.id)) return conflict(`${asset.tag} already has an open request.`);
      const approval = await createApproval(tx, {
        type: "lifecycle_return",
        payload: {
          from: { assigneeId: d.employeeId },
          to: { assigneeId: null, status: DEFAULT_STATUS[asset.cls] },
          reason: d.reason,
        },
        requestedById: user.id,
        assetId: asset.id,
        employeeId: d.employeeId,
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
    // concurrent-request race into a constraint violation.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return conflict("Someone else just requested a change on this asset — refresh and retry.");
    }
    throw err;
  }
  revalidatePath(`/employees/${d.employeeId}`);
  revalidatePath("/inventory");
  revalidatePath(`/inventory/${d.assetId}`);
  return ok({ refNo });
}

const reservedSchema = z.object({ employeeId: z.string().min(1) });

/** Day-one: one button turns every ACTIVE reservation into its own assign request. */
export async function requestAssignReserved(input: unknown): Promise<ActionResult<{ created: number }>> {
  const user = await actionRole("admin", "it_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = reservedSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const { employeeId } = parsed.data;

  let created = 0;
  try {
    const failure = await prisma.$transaction(async (tx) => {
      const employee = await tx.employee.findUnique({ where: { id: employeeId } });
      if (!employee) return conflict("That employee no longer exists.");
      if (employee.employment !== "ACTIVE") return conflict("Slots are frozen for a leaver.");
      const holds = await tx.reservation.findMany({
        where: { employeeId, state: "ACTIVE" },
        include: { asset: true },
      });
      for (const hold of holds) {
        // Reservations for a direct-lifecycle class are fulfilled through
        // assignReserved (lifecycle/actions.ts), not this request path.
        if (isDirectLifecycle(user.role, hold.asset.cls)) continue;
        if (!isAssignable(hold.asset)) continue;
        if (await openApprovalForAsset(tx, hold.assetId)) continue;
        const approval = await createApproval(tx, {
          type: "lifecycle_assign",
          payload: { to: { assigneeId: employeeId, status: DEFAULT_ASSIGN_STATUS[hold.asset.cls] }, reason: "reserved — day-one setup" },
          requestedById: user.id,
          assetId: hold.assetId,
          employeeId,
        });
        await writeAudit(tx, {
          actorId: user.id, actorLabel: user.name,
          entityType: "asset", entityId: hold.assetId,
          action: "approval.requested",
          diff: { approval: { from: null, to: approval.refNo } },
        });
        created += 1;
      }
      return null;
    });
    if (failure) return failure;
  } catch (err) {
    // The partial unique index (one OPEN approval per asset) turns a
    // concurrent-request race into a constraint violation.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return conflict("Someone else just requested a change on one of these assets — refresh and retry.");
    }
    throw err;
  }
  if (created === 0) return conflict("No reserved spares were available to request.");
  revalidatePath(`/employees/${employeeId}`);
  return ok({ created });
}

/**
 * Phase 20 (spec §3): NO `departmentId` here any more — a department change
 * always goes through Transfer, which is what makes it dated and recorded
 * (`transferEmployee`, `transfer-actions.ts`). `createEmployeeSchema` below
 * extends this WITH `departmentId` back in (a new person has no transfer
 * history to start from); `updateEmployee`'s own data omits it entirely, so
 * the edit form cannot move a department as a side effect of any other edit.
 */
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use the date picker");

const employeeSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(2, "Name the person").max(120),
  title: z.string().trim().min(2, "Give a title").max(120),
  employment: z.enum(["ACTIVE", "OFFBOARDING", "OFFBOARDED"]),
  /** null = never synced ("no sync yet"); custom strings stored as-is → Neutral family */
  m365Status: z.string().trim().max(60).nullable(),
  offboardingDueAt: z.union([z.literal(""), dateStr]).optional(),
});

export async function updateEmployee(input: unknown): Promise<ActionResult<{ id: string }>> {
  const user = await actionRole("admin", "it_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = employeeSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const d = parsed.data;

  const employee = await prisma.employee.findUnique({ where: { id: d.id } });
  if (!employee) return conflict("That employee no longer exists.");

  const today = localDateISO(new Date());
  // Ruling R8: the floor guards a CHANGE, not a re-send. An employee whose
  // completion date is already in the past (the seed's Dennis, and every row
  // the migration backfilled) must still be able to have their name or title
  // edited — an unconditional floor made the whole form unsavable, since the
  // form posts the stored date back untouched. Only a date that actually
  // differs from what is stored has to be today or later.
  const storedDueISO = employee.offboardingDueAt ? localDateISO(employee.offboardingDueAt) : null;
  let offboardingDueAt: Date | null;
  if (d.employment === "OFFBOARDING") {
    if (d.offboardingDueAt) {
      if (d.offboardingDueAt !== storedDueISO && d.offboardingDueAt < minOffboardingDue(today)) {
        return validationError({ offboardingDueAt: "Pick today or later" });
      }
      offboardingDueAt = dayFromISO(d.offboardingDueAt);
    } else {
      offboardingDueAt = employee.offboardingDueAt ?? dayFromISO(defaultOffboardingDue(today));
    }
  } else if (d.employment === "ACTIVE") offboardingDueAt = null;
  else offboardingDueAt = employee.offboardingDueAt; // OFFBOARDED keeps the record

  const data = {
    name: d.name,
    title: d.title,
    employment: d.employment,
    m365Status: d.m365Status === "" ? null : d.m365Status,
    // The offboarding wizard reads "this offboarding" as everything decided
    // since this moment, so entering OFFBOARDING is what starts the window —
    // otherwise a routine return from years ago lands on a farewell report.
    // Re-entering ACTIVE clears it; OFFBOARDED keeps it, so the report of what
    // happened stays readable afterwards.
    offboardingAt:
      d.employment === "OFFBOARDING"
        ? employee.offboardingAt ?? new Date()
        : d.employment === "ACTIVE"
          ? null
          : employee.offboardingAt,
    offboardingDueAt,
  };
  const diff = diffOf(employee as unknown as Record<string, unknown>, data);
  if (Object.keys(diff).length === 0) return ok({ id: employee.id });

  await prisma.$transaction(async (tx) => {
    await tx.employee.update({ where: { id: employee.id }, data });
    await writeAudit(tx, {
      actorId: user.id, actorLabel: user.name,
      entityType: "employee", entityId: employee.id,
      action: "update", diff,
    });
  });
  revalidatePath(`/employees/${employee.id}`);
  revalidatePath("/employees");
  // Phase 23/25: the two writers of `offboardingDueAt` are this action and
  // `startOffboarding` below — their revalidation lists must stay identical.
  // That date is rendered on four further surfaces — the offboarding list's
  // Due column and facet, the wizard header's pill, the farewell report's
  // completion line and the IT worklist's leaver row (Home and
  // /inventory/work). The dynamic segments take the `"page"` form, the same
  // shape `revalidateStockReads` uses (`src/server/modules/stock/revalidate.ts`).
  revalidatePath("/offboarding");
  revalidatePath("/offboarding/[employeeId]", "page");
  revalidatePath("/offboarding/[employeeId]/report", "page");
  revalidatePath("/inventory/work");
  revalidatePath("/");
  return ok({ id: employee.id });
}

const startOffboardingSchema = z.object({
  employeeId: z.string().min(1),
  offboardingDueAt: dateStr,
});

/**
 * Phase 25 (spec §3.1): the profile's "Start offboarding" button. A DIRECT
 * employee edit — exactly what the Edit form does when Employment is switched
 * to OFFBOARDING: same guard order, same date floor and message, same audit
 * vocabulary (`action: "update"`), same revalidations — so every surface that
 * already renders the Edit-form path renders this one identically.
 */
export async function startOffboarding(input: unknown): Promise<ActionResult<{ id: string }>> {
  const user = await actionRole("admin", "it_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = startOffboardingSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const d = parsed.data;

  const employee = await prisma.employee.findUnique({ where: { id: d.employeeId } });
  if (!employee) return conflict("That employee no longer exists.");
  if (employee.employment !== "ACTIVE") {
    return conflict(`${employee.name} is already ${employee.employment.toLowerCase()}.`);
  }

  const today = localDateISO(new Date());
  if (d.offboardingDueAt < minOffboardingDue(today)) {
    return validationError({ offboardingDueAt: "Pick today or later" });
  }

  const now = new Date();
  const due = dayFromISO(d.offboardingDueAt);
  await prisma.$transaction(async (tx) => {
    await tx.employee.update({
      where: { id: employee.id },
      data: { employment: "OFFBOARDING", offboardingAt: now, offboardingDueAt: due },
    });
    await writeAudit(tx, {
      actorId: user.id, actorLabel: user.name,
      entityType: "employee", entityId: employee.id,
      action: "update",
      diff: {
        employment: { from: employee.employment, to: "OFFBOARDING" },
        offboardingAt: { from: employee.offboardingAt, to: now },
        offboardingDueAt: { from: employee.offboardingDueAt, to: due },
      },
    });
  });
  // The same seven revalidations as updateEmployee (see its Phase 23/25 note) — keep the two lists identical.
  revalidatePath(`/employees/${employee.id}`);
  revalidatePath("/employees");
  revalidatePath("/offboarding");
  revalidatePath("/offboarding/[employeeId]", "page");
  revalidatePath("/offboarding/[employeeId]/report", "page");
  revalidatePath("/inventory/work");
  revalidatePath("/");
  return ok({ id: employee.id });
}

const createEmployeeSchema = employeeSchema.omit({ id: true }).extend({
  departmentId: z.string().min(1, "Pick a department"),
  // No format rule: Employee.employeeNo has none anywhere and the importer
  // (import-employees.ts, E-2) refuses to invent one. Uniqueness is
  // case-insensitive, matching the importer's refKey.
  employeeNo: z.string().trim().min(1, "Give an employee number").max(60),
  joinedAt: dateStr,
  // Phase 20 (spec §5): ticked when the operator confirmed a same-name match
  // in the SAME department really is a different person — lets the create
  // through the guard below on a second submit.
  confirmSameName: z.boolean().default(false),
});

/** Phase 14 (spec §11): the first manual create path — before this, employees arrived only by import or seed. */
export async function createEmployee(input: unknown): Promise<ActionResult<{ id: string }>> {
  const user = await actionRole("admin", "it_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = createEmployeeSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const d = parsed.data;

  const errors: Record<string, string> = {};
  const joinedAt = new Date(`${d.joinedAt}T00:00:00Z`);
  if (Number.isNaN(joinedAt.getTime())) errors.joinedAt = "Use the date picker";
  if (!(await prisma.department.findUnique({ where: { id: d.departmentId } }))) errors.departmentId = "Unknown department";
  const today = localDateISO(new Date());
  if (d.employment === "OFFBOARDING" && d.offboardingDueAt && d.offboardingDueAt < minOffboardingDue(today)) {
    errors.offboardingDueAt = "Pick today or later";
  }
  // Phase 20 (spec §5) → Phase 29 (plan P-3): the same-name warning is one statement, carried under a key no field
  // claims so the form hands it to the banner that holds the checkbox — never under Name.
  if (!d.confirmSameName && !errors.departmentId) {
    const match = await findSameName(d.name, d.departmentId);
    if (match) {
      errors._sameName = "Not added — tick 'This is a different person' to add them anyway"; // ruling R3: the banner's title already names the match, with the linked number
    }
  }
  const taken = await prisma.employee.findFirst({ where: { employeeNo: { equals: d.employeeNo, mode: "insensitive" } }, select: { id: true } });
  if (taken) errors.employeeNo = "That employee number is already in use";
  if (Object.keys(errors).length) return validationError(errors);

  const data = {
    employeeNo: d.employeeNo,
    name: d.name,
    title: d.title,
    departmentId: d.departmentId,
    employment: d.employment,
    m365Status: d.m365Status === "" ? null : d.m365Status,
    joinedAt,
    offboardingAt: d.employment === "OFFBOARDING" ? new Date() : null,
    offboardingDueAt: d.employment === "OFFBOARDING" ? dayFromISO(d.offboardingDueAt || defaultOffboardingDue(today)) : null,
  };

  let id = "";
  try {
    await prisma.$transaction(async (tx) => {
      const created = await tx.employee.create({ data });
      id = created.id;
      await writeAudit(tx, {
        actorId: user.id, actorLabel: user.name,
        entityType: "employee", entityId: created.id,
        action: "create",
        diff: {
          employeeNo: { from: null, to: d.employeeNo }, name: { from: null, to: d.name },
          ...(data.offboardingDueAt ? { offboardingDueAt: { from: null, to: data.offboardingDueAt } } : {}),
        },
      });
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return validationError({ employeeNo: "That employee number is already in use" });
    }
    throw err;
  }
  revalidatePath("/employees");
  return ok({ id });
}

const checkSameNameSchema = z.object({
  name: z.string(),
  departmentId: z.string(),
  excludeId: z.string().optional(),
});

/**
 * Phase 20 (spec §5): read-only — the create/edit form's own live check, run
 * on blur of the name and department fields, never a write. `excludeId` lets
 * an edit form run the same check without a person matching their own
 * existing record. Blank name/department (nothing typed yet) reads as "no
 * match" without touching the database — the same fail-open shape every
 * other lookup in this app uses for "not enough to search on yet".
 */
export async function checkSameName(
  input: unknown,
): Promise<ActionResult<{ match: { id: string; employeeNo: string; department: string } | null }>> {
  const user = await actionRole("admin", "it_staff");
  if (!user) return forbidden();
  // Phase 29 (final review I-4): a read-only check meters on the "check" kind,
  // never the 60/min write budget the create button itself still needs.
  const rate = await checkRate(user.id, "check");
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = checkSameNameSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const { name, departmentId, excludeId } = parsed.data;
  if (!name.trim() || !departmentId) return ok({ match: null });
  const match = await findSameName(name, departmentId, excludeId);
  return ok({ match: match ? { id: match.id, employeeNo: match.employeeNo, department: match.department } : null });
}

const checkEmployeeNoSchema = z.object({ employeeNo: z.string() });

/** Phase 29 (spec §5.2): read-only — the create form's live number check; the same insensitive query createEmployee refuses on. */
export async function checkEmployeeNo(input: unknown): Promise<ActionResult<{ taken: { id: string; name: string } | null }>> {
  const user = await actionRole("admin", "it_staff");
  if (!user) return forbidden();
  // Final review I-4: read-only — the "check" budget, not the mutation one.
  const rate = await checkRate(user.id, "check");
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = checkEmployeeNoSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const no = parsed.data.employeeNo.trim();
  if (!no) return ok({ taken: null });
  const taken = await prisma.employee.findFirst({ where: { employeeNo: { equals: no, mode: "insensitive" } }, select: { id: true, name: true } });
  return ok({ taken });
}

/** Phase 29 (spec §5.2): the next free EMP-#### — a suggestion the operator accepts with one click, never a prefill. */
export async function nextEmployeeNo(): Promise<ActionResult<{ next: string | null }>> {
  const user = await actionRole("admin", "it_staff");
  if (!user) return forbidden();
  // Final review I-4: read-only — the "check" budget, not the mutation one.
  const rate = await checkRate(user.id, "check");
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const rows = await prisma.employee.findMany({ select: { employeeNo: true } });
  return ok({ next: nextNo(rows.map((r) => r.employeeNo)) });
}

const previewPolicySchema = z.object({ title: z.string(), departmentId: z.string() });

/** Phase 29 (spec §5.3): read-only — which policy the typed title (or the department) will resolve to. */
export async function previewPolicy(input: unknown): Promise<ActionResult<{ preview: { name: string; slots: number; via: "title" | "department" } | null }>> {
  const user = await actionRole("admin", "it_staff");
  if (!user) return forbidden();
  // Final review I-4: read-only — the "check" budget, not the mutation one.
  const rate = await checkRate(user.id, "check");
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = previewPolicySchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const policies = await prisma.equipmentPolicy.findMany({ include: { slots: { select: { id: true } } }, orderBy: [{ name: "asc" }] });
  return ok({ preview: previewPolicyFor(parsed.data.title, parsed.data.departmentId, policies) });
}
