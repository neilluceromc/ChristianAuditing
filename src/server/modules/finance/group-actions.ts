"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma, type Team } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { actionRole } from "@/server/auth/guards";
import { checkRate } from "@/server/rate-limit";
import { notify } from "@/server/notifications/notify";
import { conflict, forbidden, ok, rateLimited, validationError, zodFieldErrors, type ActionResult } from "@/server/action-result";
import { holdBackSchema } from "@/lib/registration-input";
import { fieldLabels, registrationState } from "@/lib/registration";
import { lockPo } from "@/server/modules/purchases/po-lock";
import { emitIfPoFullyApproved } from "@/server/modules/purchases/po-complete";
import { approveOne, approveRefusal, returnOne, returnRefusal, type ReturnTeam } from "./review-writes";
import { GROUP_ASSET_SELECT, lockGroupAssets, revalidateGroup, StaleGroupError } from "./group-shared";

/*
 * Task 6 (spec §5): Finance reviews a registration group in one go. Approve all approves every asset of the group
 * on the page — each with today's per-asset effect and audit (approveOne), the group in its diff — and sends the ones
 * Finance held back to the team it picked (returnOne), one bell per team. All or nothing: everything is decided under
 * the PO row's lock (a PO group) and the group's asset rows' locks before the first write, and a write that misses
 * rolls the whole transaction back.
 */

const schema = z.object({
  recordId: z.string().min(1),
  /** The group's "Not capitalised" switch: each asset's, unless overridden. */
  notCapitalised: z.boolean(),
  /** The assets the page showed as To review: each must still be (or the approval is refused, "changed since"). */
  assetIds: z.array(z.string().min(1)).min(1, "Nothing to approve").max(500),
  overrides: z.array(z.object({ assetId: z.string().min(1), notCapitalised: z.boolean() })).max(500).optional(),
  holdBack: z.array(holdBackSchema).max(500).optional(),
});

type Out = { approved: number; heldBack: number; refNo: string | null };

export async function approveGroup(input: unknown): Promise<ActionResult<Out>> {
  const user = await actionRole("admin", "finance_staff");
  if (!user) return forbidden();
  const rate = await checkRate(user.id);
  if (!rate.allowed) return rateLimited(rate.retryAfterSec);
  const parsed = schema.safeParse(input);
  if (!parsed.success) return validationError(zodFieldErrors(parsed.error));
  const { recordId, assetIds } = parsed.data;
  const holdBack = parsed.data.holdBack ?? [];
  const override = new Map((parsed.data.overrides ?? []).map((o) => [o.assetId, o.notCapitalised]));
  if (new Set(assetIds).size !== assetIds.length) return validationError({ assetIds: "Each asset once" });
  const held = new Map(holdBack.map((b) => [b.assetId, b]));
  if (held.size !== holdBack.length || holdBack.some((b) => !assetIds.includes(b.assetId))) {
    return validationError({ holdBack: "Hold back only assets of this group, each once" });
  }

  let out: Out | null = null;
  let failure: ActionResult<Out> | null = null;
  let poId: string | null = null;

  try {
    await prisma.$transaction(async (tx) => {
      const record = await tx.purchaseRecord.findUnique({
        where: { id: recordId }, select: { id: true, purchaseOrderId: true, createdById: true },
      });
      if (!record) { failure = conflict("That registration no longer exists."); return; }

      // The PO row first (every action that reads or changes a PO's assets takes it: a fix, a send-back or a
      // registration waits), then this group's asset rows; everything below is read after both.
      let refNo: string | null = null;
      if (record.purchaseOrderId) {
        poId = record.purchaseOrderId;
        await lockPo(tx, poId);
        const po = await tx.purchaseOrder.findUnique({ where: { id: poId }, select: { refNo: true, state: true, invoiceRef: true } });
        if (!po) { failure = conflict("That purchase order no longer exists."); return; }
        refNo = po.refNo;
        if (po.state === "SENT_BACK") { failure = conflict(`${po.refNo} is with Purchasing for corrections.`); return; }
        if (!po.invoiceRef?.trim()) { failure = conflict("No SI number yet. Add it before approving."); return; }
      }
      await lockGroupAssets(tx, recordId);
      const assets = await tx.asset.findMany({ where: { purchaseRecordId: recordId }, select: GROUP_ASSET_SELECT });
      const byId = new Map(assets.map((a) => [a.id, a]));

      for (const id of assetIds) {
        const a = byId.get(id);
        if (!a) { failure = conflict("This group changed since you opened it. Reload."); return; }
        if (registrationState(a) !== "with-finance") { failure = conflict(`${a.tag} changed since you opened this. Reload.`); return; }
      }

      const registrant = await tx.user.findUnique({ where: { id: record.createdById }, select: { role: true } });
      for (const b of holdBack) {
        const a = byId.get(b.assetId)!;
        const refused = returnRefusal(b.fields, b.team, { cls: a.cls, refNo, registeredByRole: registrant?.role ?? null });
        if (refused) { failure = conflict(`${a.tag}: ${Object.values(refused)[0]}.`); return; }
      }
      const toApprove = assetIds.filter((id) => !held.has(id)).map((id) => byId.get(id)!);
      for (const a of toApprove) {
        const why = approveRefusal(a, override.get(a.id) ?? parsed.data.notCapitalised);
        if (why) { failure = conflict(why); return; }
      }

      // ---- writes (every refusal is above this line; a miss below rolls everything back) ----
      const meta = { group: { from: null, to: recordId }, batch: { from: null, to: randomUUID() } };
      for (const a of toApprove) {
        if (!(await approveOne(tx, a, user, override.get(a.id) ?? parsed.data.notCapitalised, meta))) throw new StaleGroupError(a.tag);
      }
      const sentTo = new Map<ReturnTeam, Array<{ id: string; tag: string; cls: string; fields: string[]; note: string | null }>>();
      for (const b of holdBack) {
        const a = byId.get(b.assetId)!;
        const note = b.note ? b.note : null;
        if (!(await returnOne(tx, a, user, { team: b.team, fields: b.fields, note }, meta))) throw new StaleGroupError(a.tag);
        sentTo.set(b.team, [...(sentTo.get(b.team) ?? []), { id: a.id, tag: a.tag, cls: a.cls, fields: b.fields, note }]);
      }
      // Spec §7: one notification per team that got assets back, however many.
      for (const [team, list] of sentTo) {
        const what = list.length === 1
          ? `${list[0].tag} sent back by Finance: ${fieldLabels(list[0].fields).join(", ")}`
          : `${list.length} assets sent back by Finance`;
        const notes = [...new Set(list.map((x) => x.note).filter((x): x is string => !!x))];
        await notify(tx, {
          team: team as Team, kind: "SENT_BACK", title: refNo ? `${refNo} · ${what}` : what,
          body: notes.length ? notes.join(" · ") : null,
          href: list.length === 1
            ? `/inventory/${list[0].id}`
            : `/inventory?${list.every((x) => x.cls === "PURCHASING") ? "cls=PURCHASING&" : ""}reg=needs-correction`,
          actorId: user.id, actorRole: user.role, entityType: "purchase-record", entityId: recordId,
        });
      }
      // The PO fully registered and now fully approved: its approval webhooks, once.
      if (poId) await emitIfPoFullyApproved(tx, poId);
      out = { approved: toApprove.length, heldBack: holdBack.length, refNo };
    });
  } catch (err) {
    if (err instanceof StaleGroupError) return conflict(`${err.tag} changed since you opened this. Reload.`);
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2028") {
      return conflict("The database is busy right now — nothing was written. Try that again.");
    }
    throw err;
  }

  if (failure) return failure;
  revalidateGroup(recordId, assetIds, poId);
  revalidatePath("/inventory");
  return ok(out!);
}
