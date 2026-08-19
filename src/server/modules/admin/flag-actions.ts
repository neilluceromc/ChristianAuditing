"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { actionRole } from "@/server/auth/guards";
import { checkRate } from "@/server/rate-limit";
import { writeAudit } from "@/server/audit";
import { domainValue, flagChange, specFor, type FlagState } from "@/lib/admin-flags";
import { asActionResult } from "@/server/prisma-errors";
import {
  conflict, forbidden, ok, rateLimited, validationError, zodFieldErrors, type ActionResult,
} from "@/server/action-result";

/**
 * Both /login and /signup read these flags on every render, and the bootstrap
 * action upserts allowed_domain — so a flag write has to invalidate the auth
 * pages as well as its own.
 */
const PATHS = ["/admin/flags", "/login", "/signup"] as const;

function revalidateAll() {
  for (const path of PATHS) revalidatePath(path);
}

const setSchema = z.object({ key: z.string().min(1), enabled: z.boolean() });

export async function setFlag(input: unknown): Promise<ActionResult<null>> {
  const actor = await actionRole("admin");
  if (!actor) return forbidden();
  const rate = await checkRate(actor.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = setSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const { key, enabled } = parsed.data;

  // Same discriminated-on-.ok shape as user-actions.ts: every path below
  // returns a full ActionResult, so the caller can tell a real refusal apart
  // from a truthy-but-successful no-op.
  //
  // flagChange is called AFTER the row is read, inside this transaction —
  // not before it. It used to run pre-transaction against just the key, but
  // the new signature needs `value`, and the guarantee this task owns is
  // that the value it checks is the one this write is guarded on, not
  // whatever the page happened to render with: the stored value can change
  // between the render and this click, so re-reading it here is the point,
  // not an optimization to skip.
  const result = await asActionResult(
    async () =>
      prisma.$transaction(async (tx) => {
        const flag = await tx.featureFlag.findUnique({ where: { key } });
        if (!flag) return conflict(`The flag "${key}" isn't in the database.`);

        const state: FlagState = {
          key: flag.key,
          enabled: flag.enabled,
          value: typeof flag.value === "string" ? flag.value : null,
        };
        const verdict = flagChange(state, enabled);
        if (!verdict.allowed) return conflict(verdict.reason);

        if (flag.enabled === enabled) return ok(null); // no-op: don't pollute the trail

        const written = await tx.featureFlag.updateMany({
          where: { key, enabled: flag.enabled },
          data: { enabled },
        });
        if (written.count === 0) return conflict("Someone else just changed that flag — refresh.");

        await writeAudit(tx, {
          actorId: actor.id,
          actorLabel: actor.name,
          entityType: "feature-flag",
          entityId: flag.id,
          action: "update",
          // The key is in the diff because the entity label resolves to it, and
          // a reader three months from now needs to know WHICH flag moved.
          diff: { key: { from: flag.key, to: flag.key }, enabled: { from: flag.enabled, to: enabled } },
        });
        return ok(null);
      }),
    { goneMessage: "That flag no longer exists." },
  );
  if (!result.ok) return result;
  revalidateAll();
  return result;
}

const valueSchema = z.object({ key: z.string().min(1), value: z.string() });

export async function setFlagValue(input: unknown): Promise<ActionResult<null>> {
  const actor = await actionRole("admin");
  if (!actor) return forbidden();
  const rate = await checkRate(actor.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = valueSchema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const { key } = parsed.data;

  const spec = specFor(key);
  if (!spec?.hasValue) return conflict(`The flag "${key}" doesn't carry a value.`);

  // `value` has exactly one write path, and this is it: domainValue is the
  // only function on it, there is no clear/reset branch, and nothing past
  // this line can store null, "", or a non-string. flagChange is deliberately
  // NOT called here — it takes a direction (turning the flag on/off), and a
  // value edit isn't that; the flag's `enabled` column is untouched by this
  // action on every path.
  const domain = domainValue(parsed.data.value);
  if (!domain.ok) return validationError({ value: domain.reason });

  // Today allowed_domain is the only value flag, and its value is a domain.
  // When a second one arrives, this is the line that has to learn to branch.
  const result = await asActionResult(
    async () =>
      prisma.$transaction(async (tx) => {
        const flag = await tx.featureFlag.findUnique({ where: { key } });
        if (!flag) return conflict(`The flag "${key}" isn't in the database.`);
        const before = typeof flag.value === "string" ? flag.value : null;
        if (before === domain.value) return ok(null);

        await tx.featureFlag.update({ where: { key }, data: { value: domain.value } });
        await writeAudit(tx, {
          actorId: actor.id,
          actorLabel: actor.name,
          entityType: "feature-flag",
          entityId: flag.id,
          action: "update",
          diff: { key: { from: flag.key, to: flag.key }, value: { from: before, to: domain.value } },
        });
        return ok(null);
      }),
    { goneMessage: "That flag no longer exists." },
  );
  if (!result.ok) return result;
  revalidateAll();
  return result;
}
