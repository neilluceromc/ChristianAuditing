"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { actionRole } from "@/server/auth/guards";
import { checkRate } from "@/server/rate-limit";
import { writeAudit } from "@/server/audit";
import { asActionResult } from "@/server/prisma-errors";
import { ROLE_OPTIONS, disableChange, roleChange, type TargetUser } from "@/lib/admin-users";
import {
  conflict, forbidden, ok, rateLimited, validationError, zodFieldErrors, type ActionResult,
} from "@/server/action-result";

/** The narrow select every rule in `@/lib/admin-users` reads. */
const TARGET_SELECT = { id: true, role: true, isPermanentAdmin: true, disabled: true } as const;

const roleSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(ROLE_OPTIONS as [string, ...string[]]),
});

export async function setUserRole(input: unknown): Promise<ActionResult<null>> {
  const actor = await actionRole("admin");
  if (!actor) return forbidden();
  const rate = await checkRate(actor.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = roleSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const nextRole = parsed.data.role as TargetUser["role"];

  const failure = await asActionResult(
    async () =>
      prisma.$transaction(async (tx) => {
        const target = await tx.user.findUnique({
          where: { id: parsed.data.userId },
          select: { ...TARGET_SELECT, name: true, email: true },
        });
        if (!target) return conflict("That user no longer exists.");

        // Task 1's rule, called by the server independently of the UI — the page
        // hides the select for a locked row, and this refuses a request that
        // never came from that page.
        const verdict = roleChange(target, nextRole, actor.id);
        if (!verdict.allowed) return conflict(verdict.reason);
        if (target.role === nextRole) return null; // no-op: don't pollute the trail

        // Guarded on the before-value: two admins changing one row must not
        // silently agree on whichever write landed last.
        const written = await tx.user.updateMany({
          where: { id: target.id, role: target.role },
          data: { role: nextRole },
        });
        if (written.count === 0) {
          return conflict("Someone else just changed that user's role — refresh.");
        }
        await writeAudit(tx, {
          actorId: actor.id,
          actorLabel: actor.name,
          entityType: "user",
          entityId: target.id,
          action: "role-change",
          diff: { role: { from: target.role, to: nextRole } },
        });
        return null;
      }),
    { goneMessage: "That user no longer exists." },
  );
  if (failure) return failure;
  revalidatePath("/admin/users");
  return ok(null);
}

const disableSchema = z.object({
  userId: z.string().min(1),
  disabled: z.boolean(),
});

export async function setUserDisabled(input: unknown): Promise<ActionResult<null>> {
  const actor = await actionRole("admin");
  if (!actor) return forbidden();
  const rate = await checkRate(actor.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = disableSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const next = parsed.data.disabled;

  const failure = await asActionResult(
    async () =>
      prisma.$transaction(async (tx) => {
        const target = await tx.user.findUnique({
          where: { id: parsed.data.userId },
          select: { ...TARGET_SELECT, name: true, email: true },
        });
        if (!target) return conflict("That user no longer exists.");

        const verdict = disableChange(target, next, actor.id);
        if (!verdict.allowed) return conflict(verdict.reason);
        if (target.disabled === next) return null;

        const written = await tx.user.updateMany({
          where: { id: target.id, disabled: target.disabled },
          data: { disabled: next },
        });
        if (written.count === 0) {
          return conflict("Someone else just changed that user's access — refresh.");
        }
        await writeAudit(tx, {
          actorId: actor.id,
          actorLabel: actor.name,
          entityType: "user",
          entityId: target.id,
          action: next ? "disable" : "enable",
          // The email is in the diff because a disabled user drops out of every
          // list that would otherwise say who this row was.
          diff: {
            disabled: { from: target.disabled, to: next },
            email: { from: target.email, to: target.email },
          },
        });
        return null;
      }),
    { goneMessage: "That user no longer exists." },
  );
  if (failure) return failure;
  revalidatePath("/admin/users");
  return ok(null);
}
