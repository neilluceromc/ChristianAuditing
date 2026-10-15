"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { actionRole } from "@/server/auth/guards";
import { isUniqueViolation } from "@/server/prisma-errors";
import { checkRate } from "@/server/rate-limit";
import { writeAudit } from "@/server/audit";
import type { AuditDiff } from "@/lib/audit-diff";
import { GROUP_ARCHIVED } from "@/lib/groups";
import { slotLabel } from "@/lib/loadout";
import { planSlotChanges, policyNameFor, POLICY_LINES_MIN, type ExistingSlot, type PolicyLine } from "@/lib/policy-lines";
import {
  conflict, forbidden, ok, rateLimited, validationError, zodFieldErrors, type ActionResult,
} from "@/server/action-result";

const PATHS = ["/admin/equipment-policies", "/employees", "/", "/admin/departments"] as const;

function revalidateAll() {
  for (const path of PATHS) revalidatePath(path);
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
        // Only the two creates can reach this: nothing references
        // EquipmentPolicy but PolicySlot (which cascades), and nothing
        // references PolicySlot at all. So an FK violation here always means
        // the row being pointed AT was just deleted — the inverse of
        // reference-actions.ts's "still referenced" P2003, and the message
        // has to say the true thing for the state it renders in.
        return conflict("Something this refers to was just deleted — nothing was written. Refresh and try again.");
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
  return slots.map((s) => {
    const label = s.loaner ? `${s.name} (loaner)` : s.name;
    return `${label} · ${s.assetType?.name ?? "any type"} · ${s.required ? "required" : "optional"}`;
  });
}

/** Phase 37 (spec §3.1): thrown from inside a transaction to refuse before any write; the throw rolls it back. */
class Refusal extends Error {
  constructor(public readonly result: ActionResult<never>) {
    super("refused");
  }
}
function refuse(message: string, field = "_form"): never {
  throw new Refusal(validationError({ [field]: message }));
}

const lineSchema = z.object({
  slotId: z.string().min(1).optional(),
  assetTypeId: z.string().min(1),
  required: z.boolean(),
  loaner: z.boolean(),
});

const saveSchema = z.object({
  departmentId: z.string().min(1),
  title: z.string().trim().min(2).max(120).nullable().optional(),
  policyId: z.string().min(1).optional(),
  lines: z.array(lineSchema).min(1, POLICY_LINES_MIN).max(20),
});

const copySchema = z.object({
  fromPolicyId: z.string().min(1),
  toDepartmentIds: z.array(z.string().min(1)).min(1).max(60),
});

interface GroupRef { id: string; name: string; kind: "INTERNAL" | "CLIENT"; archivedAt: Date | null }

const sameTitle = (a: string | null, b: string | null) =>
  a === null || b === null ? a === b : a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Create the group's policy (no `policyId`) or replace the lines of an existing one, in the caller's
 * transaction. Every refusal is thrown before the first write.
 */
async function writePolicy(
  tx: Prisma.TransactionClient,
  user: { id: string; name: string },
  w: { group: GroupRef; title: string | null; policyId?: string; lines: PolicyLine[]; copiedFrom?: string },
): Promise<string> {
  const { group, title } = w;
  if (!w.policyId && group.archivedAt) refuse(GROUP_ARCHIVED);

  const typeIds = [...new Set(w.lines.map((l) => l.assetTypeId))];
  const types = await tx.assetType.findMany({ where: { id: { in: typeIds } }, include: { category: true } });
  const typeById = new Map(types.map((t) => [t.id, t]));
  if (typeIds.some((id) => typeById.get(id)?.category.cls !== "IT")) refuse("Unknown asset type", "lines");
  const labelFor = (typeId: string) => {
    const t = typeById.get(typeId)!;
    return slotLabel(t.category.name, t.name);
  };

  let policyId = w.policyId;
  let before: string[] = [];
  let existingSlots: ExistingSlot[] = [];
  let name = "";
  if (policyId) {
    const policy = await tx.equipmentPolicy.findUnique({ where: { id: policyId }, include: { slots: true } });
    if (!policy) throw new Refusal(conflict("That policy no longer exists."));
    if (policy.appliesToDepartmentId !== group.id || !sameTitle(policy.appliesToTitle, title)) {
      refuse("That policy belongs elsewhere");
    }
    existingSlots = policy.slots;
    before = await slotList(tx, policy.id);
  } else {
    const clash = await tx.equipmentPolicy.findFirst({
      where: title === null
        ? { appliesToDepartmentId: group.id, appliesToTitle: null }
        : { appliesToDepartmentId: group.id, appliesToTitle: { equals: title, mode: "insensitive" } },
      select: { id: true },
    });
    if (clash) refuse(title === null ? `${group.name} already has a policy` : `${group.name} already has a rule for ${title}`);
    const taken = new Set((await tx.equipmentPolicy.findMany({ select: { name: true } })).map((p) => p.name.toLowerCase()));
    name = policyNameFor(group.name, title, (n) => taken.has(n.toLowerCase()));
    policyId = (await tx.equipmentPolicy.create({
      data: { name, appliesToDepartmentId: group.id, appliesToTitle: title },
    })).id;
  }

  const plan = planSlotChanges(existingSlots, w.lines);
  if (plan.remove.length) await tx.policySlot.deleteMany({ where: { id: { in: plan.remove }, policyId } });
  for (const u of plan.update) {
    await tx.policySlot.update({
      where: { id: u.id },
      data: { assetTypeId: u.assetTypeId, required: u.required, loaner: u.loaner, name: labelFor(u.assetTypeId) },
    });
  }
  for (const c of plan.create) {
    await tx.policySlot.create({
      data: { policyId, assetTypeId: c.assetTypeId, required: c.required, loaner: c.loaner, name: labelFor(c.assetTypeId) },
    });
  }
  const after = await slotList(tx, policyId);

  const copied: AuditDiff = w.copiedFrom ? { copiedFrom: { from: null, to: w.copiedFrom } } : {};
  await writeAudit(tx, {
    actorId: user.id, actorLabel: user.name,
    entityType: "equipment-policy", entityId: policyId,
    action: w.policyId ? "policy.saved" : "create",
    diff: w.policyId
      ? { slots: { from: before, to: after }, ...copied }
      : {
          name: { from: null, to: name },
          appliesTo: { from: null, to: title ? `${group.name} · ${title}` : group.name },
          slots: { from: null, to: after },
          ...copied,
        },
  });
  return policyId;
}

const TX_OPTS = { timeout: 60_000, maxWait: 10_000 } as const;

/** Run `body` as one transaction, mapping a thrown Refusal, a name race and Prisma's transient errors to results. */
async function inTransaction<T>(
  body: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<{ ok: true; data: T } | ActionResult<never>> {
  try {
    return await asActionResult(async () => ({ ok: true as const, data: await prisma.$transaction(body, TX_OPTS) }));
  } catch (err) {
    if (err instanceof Refusal) return err.result;
    if (isUniqueViolation(err)) return conflict("Someone else just saved a policy with that name — try again.");
    throw err;
  }
}

/** One policy per group: its base list (title null) or a rule for one title. Creates, or replaces the lines of `policyId`. */
export async function savePolicy(input: unknown): Promise<ActionResult<{ id: string }>> {
  const user = await actionRole("admin", "it_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const d = parsed.data;

  const result = await inTransaction(async (tx) => {
    const group = await tx.department.findUnique({ where: { id: d.departmentId } });
    if (!group) return refuse("That department or client no longer exists");
    return writePolicy(tx, user, { group, title: d.title ?? null, policyId: d.policyId, lines: d.lines });
  });
  if (!result.ok) return result;
  revalidateAll();
  return ok({ id: result.data });
}

/** Independent copies of one policy's lines onto other groups' base policies (created, or replaced when one exists). */
export async function copyPolicy(input: unknown): Promise<ActionResult<{ copied: number }>> {
  const user = await actionRole("admin", "it_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = copySchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const d = parsed.data;

  const result = await inTransaction(async (tx) => {
    const source = await tx.equipmentPolicy.findUnique({
      where: { id: d.fromPolicyId },
      include: { appliesToDepartment: true, slots: { orderBy: [{ name: "asc" }, { id: "asc" }] } },
    });
    if (!source) throw new Refusal(conflict("That policy no longer exists."));
    const from = source.appliesToDepartment;
    if (!from) return refuse("That policy belongs to no department or client");
    const pickOthers = `Pick other active ${from.kind === "CLIENT" ? "clients" : "departments"} to copy to`;
    if (new Set(d.toDepartmentIds).size !== d.toDepartmentIds.length || d.toDepartmentIds.includes(from.id)) refuse(pickOthers);

    const targets = await tx.department.findMany({ where: { id: { in: d.toDepartmentIds } } });
    if (targets.length !== d.toDepartmentIds.length || targets.some((t) => t.archivedAt || t.kind !== from.kind)) refuse(pickOthers);

    const lines: PolicyLine[] = source.slots.flatMap((s) =>
      s.assetTypeId ? [{ assetTypeId: s.assetTypeId, required: s.required, loaner: s.loaner }] : []);
    if (!lines.length) refuse("That policy has no items to copy");

    // every refusal above precedes the first write below
    for (const id of d.toDepartmentIds) {
      const target = targets.find((t) => t.id === id)!;
      const existing = await tx.equipmentPolicy.findFirst({
        where: { appliesToDepartmentId: target.id, appliesToTitle: null }, select: { id: true },
      });
      await writePolicy(tx, user, { group: target, title: null, policyId: existing?.id, lines, copiedFrom: source.name });
    }
    return d.toDepartmentIds.length;
  });
  if (!result.ok) return result;
  revalidateAll();
  return ok({ copied: result.data });
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
