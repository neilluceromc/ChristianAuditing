"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { actionRole } from "@/server/auth/guards";
import { checkRate } from "@/server/rate-limit";
import { writeAudit } from "@/server/audit";
import { asActionResult } from "@/server/prisma-errors";
import { ROLE_OPTIONS, disableChange, roleChange, selfRoleChangeWarning } from "@/lib/admin-users";
import {
  conflict, forbidden, ok, rateLimited, validationError, zodFieldErrors, type ActionResult,
} from "@/server/action-result";

/** The narrow select every rule in `@/lib/admin-users` reads. */
const TARGET_SELECT = { id: true, role: true, isPermanentAdmin: true, disabled: true } as const;

const roleSchema = z.object({
  userId: z.string().min(1),
  // zod 4 accepts ROLE_OPTIONS's plain `Role[]` directly and preserves the
  // element type, so `parsed.data.role` below is already `Role` — no cast.
  role: z.enum(ROLE_OPTIONS),
});

export async function setUserRole(
  input: unknown,
): Promise<ActionResult<{ changed: boolean; signsOutActor: boolean }>> {
  const actor = await actionRole("admin");
  if (!actor) return forbidden();
  const rate = await checkRate(actor.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = roleSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const nextRole = parsed.data.role;

  // The callback below always returns an ActionResult — `conflict(...)` on
  // every failure path, `ok({...})` on both the no-op and the written path —
  // so the check after `asActionResult` can discriminate on `.ok` instead of
  // truthiness. A bare `{ changed: false }` is truthy; `if (result)` would
  // have silently treated a no-op as a failure to propagate.
  //
  // Every `return conflict(...)` below precedes every write in this callback
  // (see prisma-errors.ts's precondition): the two lookups and both rule
  // checks return before `updateMany` is ever reached.
  const result = await asActionResult(
    async () =>
      prisma.$transaction(async (tx) => {
        const target = await tx.user.findUnique({
          where: { id: parsed.data.userId },
          select: TARGET_SELECT,
        });
        if (!target) return conflict("That user no longer exists.");

        // Task 1's rule, called by the server independently of the UI — the page
        // hides the select for a locked row, and this refuses a request that
        // never came from that page.
        const verdict = roleChange(target, nextRole, actor.id);
        if (!verdict.allowed) return conflict(verdict.reason);

        // lockReason's sibling flag, not a refusal: an admin changing their OWN
        // role gets signed out on the very next request (the JWT freezes role
        // at sign-in — see selfRoleChangeWarning's doc comment in admin-users.ts).
        // Derived from the same rule the page will use, so the two surfaces can
        // never disagree about when this applies.
        const signsOutActor = selfRoleChangeWarning(target, nextRole, actor.id) !== null;

        if (target.role === nextRole) return ok({ changed: false, signsOutActor }); // no-op: don't pollute the trail

        // Guarded on the before-value, so two admins changing one row can't
        // silently agree on whichever write landed last. `isPermanentAdmin:
        // false` restates the lock the verdict check above already enforces —
        // unreachable today, but scope decision #2 stakes the "no last-admin
        // guard needed" call entirely on this lock holding, so it shouldn't
        // hold only in application code. If this predicate ever DID fire,
        // `count === 0` below would read as an ordinary "someone else changed
        // it" conflict, which would be the wrong message for what actually
        // happened — the honest one is the lock message `roleChange` already
        // returned above.
        const written = await tx.user.updateMany({
          where: { id: target.id, role: target.role, isPermanentAdmin: false },
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
        return ok({ changed: true, signsOutActor });
      }),
    { goneMessage: "That user no longer exists." },
  );
  if (!result.ok) return result;
  // A no-op cache bust is what this guard exists to avoid — see offboarding's
  // m365 action, which the same fix is modeled on.
  if (result.data.changed) revalidatePath("/admin/users");
  return result;
}

const disableSchema = z.object({
  userId: z.string().min(1),
  disabled: z.boolean(),
});

export async function setUserDisabled(input: unknown): Promise<ActionResult<{ changed: boolean }>> {
  const actor = await actionRole("admin");
  if (!actor) return forbidden();
  const rate = await checkRate(actor.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = disableSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const next = parsed.data.disabled;

  // Same discriminated-on-.ok shape as setUserRole above, and the same
  // precondition holds: every `return conflict(...)` below precedes the write.
  const result = await asActionResult(
    async () =>
      prisma.$transaction(async (tx) => {
        const target = await tx.user.findUnique({
          where: { id: parsed.data.userId },
          select: TARGET_SELECT,
        });
        if (!target) return conflict("That user no longer exists.");

        // No `signsOutActor` flag here: self-disable is refused outright by
        // this rule, so the actor can never be the target of a written change.
        const verdict = disableChange(target, next, actor.id);
        if (!verdict.allowed) return conflict(verdict.reason);
        if (target.disabled === next) return ok({ changed: false });

        // `isPermanentAdmin: false` restates the lock enforced above — see the
        // matching comment in setUserRole.
        const written = await tx.user.updateMany({
          where: { id: target.id, disabled: target.disabled, isPermanentAdmin: false },
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
          diff: { disabled: { from: target.disabled, to: next } },
        });
        return ok({ changed: true });
      }),
    { goneMessage: "That user no longer exists." },
  );
  if (!result.ok) return result;
  if (result.data.changed) revalidatePath("/admin/users");
  return result;
}
