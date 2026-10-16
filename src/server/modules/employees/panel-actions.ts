"use server";

import { z } from "zod";
import { prisma } from "@/server/db/client";
import { actionUser } from "@/server/auth/guards";
import { checkRate } from "@/server/rate-limit";
import { forbidden, ok, rateLimited, validationError, zodFieldErrors, type ActionResult } from "@/server/action-result";
import { canSeeClass } from "@/lib/asset-class";
import { auditSentence } from "@/lib/activity";
import { fmtMoney } from "@/lib/format";
import { heldSinceByAsset } from "./held-since";

/** Phase 37 (spec §4.4): what the held-item side panel shows. Dates are ISO strings; the panel formats them. */
export interface HeldItemPanel {
  id: string; tag: string; model: string; status: string; serial: string | null;
  categoryName: string | null; typeName: string | null; loanDueAt: string | null;
  heldSince: string | null; bookValue: string | null;
  history: Array<{ at: string; sentence: string }>;
}

const schema = z.object({ employeeId: z.string().min(1), assetId: z.string().min(1) });

/** Read-only: any signed-in user, the "check" rate kind, and only an item this person holds right now. Nothing is written. */
export async function heldItemPanel(input: unknown): Promise<ActionResult<{ panel: HeldItemPanel }>> {
  const user = await actionUser();
  if (!user) return forbidden();
  const rate = await checkRate(user.id, "check");
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = schema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const { employeeId, assetId } = parsed.data;

  const asset = await prisma.asset.findUnique({
    where: { id: assetId },
    select: {
      id: true, tag: true, model: true, status: true, serial: true, cls: true, cost: true, loanDueAt: true, assigneeId: true,
      category: { select: { name: true } }, type: { select: { name: true } },
      assignee: { select: { employeeNo: true } },
    },
  });
  if (!asset || asset.assigneeId !== employeeId) return validationError({ _form: "That item is no longer with this person" });
  if (!canSeeClass(user.role, asset.cls)) return forbidden();

  const onAsset = { entityType: "asset", entityId: assetId };
  const recent = await prisma.auditEntry.findMany({
    where: onAsset,
    orderBy: { createdAt: "desc" },
    take: 5,
    select: { actorLabel: true, action: true, diff: true, createdAt: true },
  });
  // "Held since" is the shared rule (held-since.ts), here for the one item.
  const since = (await heldSinceByAsset(asset.assignee ? [{ assetId, employeeId, employeeNo: asset.assignee.employeeNo }] : [])).get(assetId) ?? null;

  return ok({
    panel: {
      id: asset.id, tag: asset.tag, model: asset.model, status: asset.status, serial: asset.serial,
      categoryName: asset.category?.name ?? null, typeName: asset.type?.name ?? null,
      loanDueAt: asset.loanDueAt ? asset.loanDueAt.toISOString() : null,
      heldSince: since ? since.toISOString() : null,
      // the profile's Book value stat is the sum of cost over the items held; for one item that is its cost
      bookValue: asset.cost === null ? null : fmtMoney(Number(asset.cost)),
      history: recent.map((e) => ({
        at: e.createdAt.toISOString(),
        sentence: auditSentence({ actorLabel: e.actorLabel, action: e.action, diff: e.diff, entityLabel: asset.tag }),
      })),
    },
  });
}
