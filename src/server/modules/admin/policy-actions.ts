"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { actionRole } from "@/server/auth/guards";
import { checkRate } from "@/server/rate-limit";
import { writeAudit } from "@/server/audit";
import {
  conflict, forbidden, ok, rateLimited, validationError, zodFieldErrors, type ActionResult,
} from "@/server/action-result";

const PATHS = ["/admin/equipment-policies", "/employees", "/"] as const;

function revalidateAll() {
  for (const path of PATHS) revalidatePath(path);
}

function isUnique(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

/**
 * Prisma throws rather than returning; three shapes reach here:
 *  - P2028: the transaction couldn't get a connection inside maxWait —
 *    reachable with just two concurrent transactions.
 *  - P2025: a check-then-delete race (findUnique, then delete) — the guarded
 *    `if (!x) return conflict(...)` above each delete is the designed answer
 *    to exactly this, but a delete (or a cascade from a parent's delete)
 *    landing between the check and the delete defeats it.
 *  - P2003: a create's FK reference (policy or asset type) is validated
 *    inside the transaction but deleted concurrently before the write lands.
 * Everything else rethrows: an unexpected error must not be laundered into a
 * designed banner.
 *
 * NOTE for anyone editing the callbacks below: RETURNING a failure from a
 * $transaction callback COMMITS the transaction — only a throw rolls it back.
 * That is safe here because every `return conflict(...)` precedes every write.
 * Add a write before one of them and it will commit silently.
 */
async function asActionResult<T>(
  run: () => Promise<T>,
  opts?: { goneMessage?: string },
): Promise<T | ActionResult<never>> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === "P2028") {
        return conflict("The database is busy right now — nothing was written. Try that again.");
      }
      if (err.code === "P2025") {
        return conflict(opts?.goneMessage ?? "That record no longer exists.");
      }
      if (err.code === "P2003") {
        return conflict("Still referenced by other records — the database refused the write.");
      }
    }
    throw err;
  }
}

/** One slot, rendered the way the audit trail should read it. */
async function slotList(tx: Prisma.TransactionClient, policyId: string): Promise<string[]> {
  const slots = await tx.policySlot.findMany({
    where: { policyId },
    include: { assetType: true },
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });
  return slots.map((s) => `${s.name} · ${s.assetType?.name ?? "any type"} · ${s.required ? "required" : "optional"}`);
}

/**
 * Entry criterion #6: a policy edit changes what counts as complete from this
 * moment on and touches NO existing assignment — so before-and-after slot lists
 * are the only way the change is legible after the fact.
 */
async function auditSlots(
  tx: Prisma.TransactionClient,
  user: { id: string; name: string },
  policyId: string,
  before: string[],
  action: string,
): Promise<void> {
  await writeAudit(tx, {
    actorId: user.id,
    actorLabel: user.name,
    entityType: "equipment-policy",
    entityId: policyId,
    action,
    diff: { slots: { from: before, to: await slotList(tx, policyId) } },
  });
}

const createSchema = z.object({
  name: z.string().trim().min(2, "At least 2 characters").max(60),
  /** exactly one target: a role (title) or a department */
  appliesToTitle: z.string().trim().max(120).optional(),
  appliesToDepartmentId: z.string().optional(),
});

export async function createPolicy(input: unknown): Promise<ActionResult<{ id: string }>> {
  const user = await actionRole("admin", "it_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const title = (parsed.data.appliesToTitle ?? "").trim();
  const departmentId = parsed.data.appliesToDepartmentId ?? "";

  // A policy that targets nothing can never resolve; one that targets both
  // would hide which rule won. Role beats department, so it must be one.
  if ((title === "") === (departmentId === "")) {
    return validationError({
      appliesToTitle: "Target exactly one: a role title OR a department (role policy beats department policy).",
    });
  }
  const department = departmentId
    ? await prisma.department.findUnique({ where: { id: departmentId } })
    : null;
  if (departmentId && !department) {
    return validationError({ appliesToDepartmentId: "Unknown department" });
  }

  try {
    const result = await asActionResult(async () => {
      let id = "";
      await prisma.$transaction(async (tx) => {
        const policy = await tx.equipmentPolicy.create({
          data: {
            name: parsed.data.name,
            appliesToTitle: title || null,
            appliesToDepartmentId: departmentId || null,
          },
        });
        id = policy.id;
        await writeAudit(tx, {
          actorId: user.id, actorLabel: user.name,
          entityType: "equipment-policy", entityId: policy.id,
          action: "create",
          diff: {
            name: { from: null, to: policy.name },
            // The trail never exposes raw ids — the department name is
            // fetched above and carried through, not the cuid.
            appliesTo: { from: null, to: title ? `role: ${title}` : `department: ${department?.name}` },
            slots: { from: null, to: [] },
          },
        });
      });
      return id;
    });
    if (typeof result !== "string") return result;
    revalidateAll();
    return ok({ id: result });
  } catch (err) {
    if (isUnique(err)) return validationError({ name: "That policy name already exists" });
    throw err;
  }
}

const idSchema = z.object({ id: z.string().min(1) });

export async function deletePolicy(input: unknown): Promise<ActionResult<null>> {
  const user = await actionRole("admin", "it_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));

  const failure = await asActionResult(async () => prisma.$transaction(async (tx) => {
    const policy = await tx.equipmentPolicy.findUnique({ where: { id: parsed.data.id } });
    if (!policy) return conflict("That policy no longer exists.");
    const before = await slotList(tx, policy.id);
    // The row about to be deleted is the only one that can ever answer whom
    // this policy applied to — resolve it now or lose it forever (AuditEntry
    // is append-only; this row cannot be corrected after the fact).
    const department = policy.appliesToDepartmentId
      ? await tx.department.findUnique({ where: { id: policy.appliesToDepartmentId } })
      : null;
    const appliesTo = policy.appliesToTitle
      ? `role: ${policy.appliesToTitle}`
      : `department: ${department?.name}`;
    // PolicySlot cascades with the policy; assignments are untouched by design.
    await tx.equipmentPolicy.delete({ where: { id: policy.id } });
    await writeAudit(tx, {
      actorId: user.id, actorLabel: user.name,
      entityType: "equipment-policy", entityId: policy.id,
      action: "delete",
      diff: {
        name: { from: policy.name, to: null },
        appliesTo: { from: appliesTo, to: null },
        slots: { from: before, to: null },
      },
    });
    return null;
  }), { goneMessage: "That policy no longer exists." });
  if (failure) return failure;
  revalidateAll();
  return ok(null);
}

const addSlotSchema = z.object({
  policyId: z.string().min(1),
  name: z.string().trim().min(2, "Name the slot").max(40),
  assetTypeId: z.string().min(1, "Pick an asset type"),
  required: z.boolean(),
});

export async function addSlot(input: unknown): Promise<ActionResult<{ id: string }>> {
  const user = await actionRole("admin", "it_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = addSlotSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const d = parsed.data;

  let id = "";
  const failure = await asActionResult(async () => prisma.$transaction(async (tx) => {
    const policy = await tx.equipmentPolicy.findUnique({ where: { id: d.policyId } });
    if (!policy) return conflict("That policy no longer exists.");
    // A typeless slot could never be filled — computeLoadout matches on type —
    // so it would be a permanent policy gap. Require the type.
    if (!(await tx.assetType.findUnique({ where: { id: d.assetTypeId } }))) {
      return validationError({ assetTypeId: "Unknown asset type" });
    }
    const before = await slotList(tx, policy.id);
    const slot = await tx.policySlot.create({
      data: { policyId: policy.id, name: d.name, assetTypeId: d.assetTypeId, required: d.required },
    });
    id = slot.id;
    await auditSlots(tx, user, policy.id, before, "policy.slot.added");
    return null;
  }));
  if (failure) return failure;
  revalidateAll();
  return ok({ id });
}

const slotIdSchema = z.object({ slotId: z.string().min(1) });

export async function removeSlot(input: unknown): Promise<ActionResult<null>> {
  const user = await actionRole("admin", "it_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = slotIdSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));

  const failure = await asActionResult(async () => prisma.$transaction(async (tx) => {
    const slot = await tx.policySlot.findUnique({ where: { id: parsed.data.slotId } });
    if (!slot) return conflict("That slot no longer exists.");
    const before = await slotList(tx, slot.policyId);
    await tx.policySlot.delete({ where: { id: slot.id } });
    await auditSlots(tx, user, slot.policyId, before, "policy.slot.removed");
    return null;
  }), { goneMessage: "That slot no longer exists." });
  if (failure) return failure;
  revalidateAll();
  return ok(null);
}

const requiredSchema = z.object({ slotId: z.string().min(1), required: z.boolean() });

/** Solid chip ⇄ grey chip: the difference between a policy gap and a nice-to-have. */
export async function setSlotRequired(input: unknown): Promise<ActionResult<null>> {
  const user = await actionRole("admin", "it_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = requiredSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const d = parsed.data;

  const failure = await asActionResult(async () => prisma.$transaction(async (tx) => {
    const slot = await tx.policySlot.findUnique({ where: { id: d.slotId } });
    if (!slot) return conflict("That slot no longer exists.");
    if (slot.required === d.required) return null;
    const before = await slotList(tx, slot.policyId);
    // guarded on the before-value: two people flipping the same chip must not
    // silently agree on whichever write landed last
    const written = await tx.policySlot.updateMany({
      where: { id: slot.id, required: slot.required },
      data: { required: d.required },
    });
    if (written.count === 0) return conflict("Someone else just changed that slot — refresh.");
    await auditSlots(tx, user, slot.policyId, before, "policy.slot.changed");
    return null;
  }));
  if (failure) return failure;
  revalidateAll();
  return ok(null);
}
