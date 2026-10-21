import type { NoteKind, Prisma } from "@prisma/client";
import { legacyPoState } from "../../src/lib/po-flow";
import { DAY, HOUR } from "./random";
import { pickActor, type Dept } from "./people";
import { vendorIdOf, type Actor, type Actors, type AssetRec, type AuditRow, type Gen, type ScaleContext } from "./types";
import { CANCEL_REASONS, CATEGORY_SPECS } from "./vocab";

/**
 * Phase 43 (spec §3): about 150 purchase requests over six months, every state represented, each with 1–5 units.
 * The COMPLETED ones are where the recently bought assets came from: their units name the asset's model and the
 * assets point back at the request and unit, so the "From PO-…" provenance has data.
 *
 * Migration 38: the history is still simulated in the old request flow (its notes and its "purchase-request" audit
 * rows are what a migrated database holds), and each row is then written the way migration 38 leaves it: the state
 * mapped by legacyPoState, the ref PO-, no SI number and no line categories (legacy rows).
 */
type LegacyState = Parameters<typeof legacyPoState>[0];
export const PR_COUNTS: Record<LegacyState, number> = { COMPLETED: 70, DRAFT: 25, SUBMITTED: 20, IT_REVIEWED: 20, CANCELLED: 15 };
export const FIRST_PR_NO = 1000;
const MAX_QTY_PER_UNIT = 5;

/** The old flow's thread texts (src/lib/purchase-flow.ts's CANONICAL_NOTE, removed in migration 38). */
const CANONICAL_NOTE = {
  submit: "Submitted for IT review.",
  "it-review": "Specs reviewed — passed to finance.",
  complete: "Approved and completed.",
} as const;

type Unit = Prisma.PurchaseOrderLineCreateManyInput & { id: string };
type Request = Prisma.PurchaseOrderCreateManyInput & { id: string; refNo: string; createdAt: Date };

export function buildPurchases(g: Gen, ctx: ScaleContext, recs: AssetRec[], depts: Dept[], actors: Actors) {
  const requests: Request[] = [];
  const units: Unit[] = [];
  const notes: Prisma.NoteEntryCreateManyInput[] = [];
  const audit: AuditRow[] = [];
  const W = g.windowStart;
  const minus = (t: number, lo: number, hi: number) => t - g.rng.int(lo, hi) * DAY - g.rng.int(1, 8) * HOUR;
  const vendor = (name: string) => vendorIdOf(ctx, name);
  const allModels = Object.values(CATEGORY_SPECS).filter((c) => c.cls === "IT" || c.count > 10)
    .flatMap((c) => Object.values(c.types).flat());

  // recently bought, registered (not imported) assets, grouped into request units by model
  const recent = recs.filter((r) => !r.row.importedAt && (r.row.purchasedAt as Date).getTime() >= W + 20 * DAY);
  const byModel = new Map<string, AssetRec[]>();
  for (const r of recent) byModel.set(r.row.model, [...(byModel.get(r.row.model) ?? []), r]);
  const groups: AssetRec[][] = [];
  for (const [, list] of [...byModel.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    for (let i = 0; i < list.length; i += MAX_QTY_PER_UNIT) groups.push(list.slice(i, i + MAX_QTY_PER_UNIT));
  }
  const queue = g.rng.shuffle(groups);

  const newRequest = (state: LegacyState, dates: { created: number; submitted?: number; reviewed?: number; completed?: number; cancelled?: number }) => {
    const dept = g.rng.pick(depts);
    const req: Request = {
      id: g.id(), refNo: "", state: legacyPoState(state), requestedById: pickActor(g, actors.purchasing, ctx.fixedUsers.purchasing, 0.2).id,
      departmentId: dept.id,
      vendorId: g.rng.weighted([[vendor("TechServe PH"), 5], [vendor("Metro Office Supply"), 2], [vendor("Quezon Furniture Works"), 1], [null, 2]] as const),
      createdAt: new Date(dates.created), updatedAt: new Date(dates.completed ?? dates.cancelled ?? dates.reviewed ?? dates.submitted ?? dates.created),
      submittedAt: dates.submitted ? new Date(dates.submitted) : null,
      reviewedAt: dates.reviewed ? new Date(dates.reviewed) : null,
      completedAt: dates.completed ? new Date(dates.completed) : null,
      cancelledAt: dates.cancelled ? new Date(dates.cancelled) : null,
    };
    requests.push(req);
    const requester: Actor = [...actors.purchasing, ctx.fixedUsers.purchasing].find((a) => a.id === req.requestedById)!;
    const note = (kind: NoteKind, by: Actor, at: number, text: string) => notes.push({ orderId: req.id, authorId: by.id, kind, text, createdAt: new Date(at) });
    const log = (by: Actor, at: number, action: string, diff?: Prisma.InputJsonObject) =>
      audit.push({ actorId: by.id, actorLabel: by.name, entityType: "purchase-request", entityId: req.id, action, createdAt: new Date(at), ...(diff ? { diff } : {}) });

    log(requester, dates.created, "create", { state: { from: null, to: "DRAFT" }, department: { from: null, to: dept.name } });
    if (dates.submitted) {
      note("SUBMIT", requester, dates.submitted, CANONICAL_NOTE.submit);
      log(requester, dates.submitted, "submit", { state: { from: "DRAFT", to: "SUBMITTED" } });
    }
    if (dates.reviewed) {
      const it = pickActor(g, actors.it, ctx.fixedUsers.it);
      req.reviewedById = it.id;
      note("IT_REVIEW", it, dates.reviewed, CANONICAL_NOTE["it-review"]);
      log(it, dates.reviewed, "it-review", { state: { from: "SUBMITTED", to: "IT_REVIEWED" } });
    }
    if (dates.completed) {
      const fin = pickActor(g, actors.finance, ctx.fixedUsers.finance, 0.15);
      note("COMPLETE", fin, dates.completed, CANONICAL_NOTE.complete);
      log(fin, dates.completed, "complete", { state: { from: "IT_REVIEWED", to: "COMPLETED" } });
    }
    if (dates.cancelled) {
      req.cancelReason = g.rng.pick(CANCEL_REASONS);
      note("CANCEL", requester, dates.cancelled, req.cancelReason);
      log(requester, dates.cancelled, "cancel", {
        state: { from: dates.reviewed ? "IT_REVIEWED" : dates.submitted ? "SUBMITTED" : "DRAFT", to: "CANCELLED" },
        reason: { from: null, to: req.cancelReason },
      });
    }
    if (g.rng.chance(0.2)) {
      const by = pickActor(g, actors.it, ctx.fixedUsers.it);
      const last = dates.completed ?? dates.cancelled ?? g.now - HOUR;
      const at = g.rng.between(dates.created + HOUR, last).getTime();
      note("COMMENT", by, at, "Checked stock first — none on hand.");
      log(by, at, "comment");
    }
    return req;
  };
  const unitState = (state: LegacyState) =>
    state === "COMPLETED" ? "APPROVED" as const : state === "CANCELLED" ? "CANCELLED" as const : "PENDING" as const;
  const synthUnits = (req: Request, state: LegacyState) => {
    for (let n = g.rng.int(1, 5); n > 0; n--) {
      const model = g.rng.pick(allModels);
      const rejected = state === "COMPLETED" && n > 1 && g.rng.chance(0.1);
      units.push({
        id: g.id(), orderId: req.id, description: model.model, qty: g.rng.int(1, 10), unitPrice: model.cost,
        state: rejected ? "REJECTED" : unitState(state), createdAt: req.createdAt, updatedAt: req.updatedAt,
        itSlotNotes: state === "IT_REVIEWED" && g.rng.chance(0.3) ? "Matches the client policy" : null,
        financeNotes: rejected ? "Over the standing rate — rebid next quarter" : null,
      });
    }
  };

  // COMPLETED: first the ones the recent assets came from, then plain ones
  for (let i = 0; i < PR_COUNTS.COMPLETED; i++) {
    const take = queue.splice(0, g.rng.int(1, 3));
    if (take.length > 0) {
      const bought = Math.min(...take.flat().map((r) => (r.row.purchasedAt as Date).getTime()));
      const completed = minus(bought, 2, 6);
      const reviewed = minus(completed, 1, 4);
      const submitted = minus(reviewed, 1, 3);
      const req = newRequest("COMPLETED", { created: minus(submitted, 0, 2), submitted, reviewed, completed });
      for (const group of take) {
        const unit: Unit = {
          id: g.id(), orderId: req.id, description: group[0].row.model, qty: group.length,
          unitPrice: group[0].row.cost ?? null, state: "APPROVED", createdAt: req.createdAt, updatedAt: req.updatedAt,
        };
        units.push(unit);
        for (const r of group) Object.assign(r.row, { purchaseOrderId: req.id, purchaseOrderLineId: unit.id });
      }
    } else {
      const completed = g.rng.between(W + 15 * DAY, g.now - 2 * DAY).getTime();
      const reviewed = minus(completed, 1, 4);
      const submitted = minus(reviewed, 1, 3);
      synthUnits(newRequest("COMPLETED", { created: minus(submitted, 0, 2), submitted, reviewed, completed }), "COMPLETED");
    }
  }
  for (let i = 0; i < PR_COUNTS.DRAFT; i++) {
    synthUnits(newRequest("DRAFT", { created: minus(g.now, 1, 30) }), "DRAFT");
  }
  for (let i = 0; i < PR_COUNTS.SUBMITTED; i++) {
    const submitted = minus(g.now, 1, 20);
    synthUnits(newRequest("SUBMITTED", { created: minus(submitted, 0, 2), submitted }), "SUBMITTED");
  }
  for (let i = 0; i < PR_COUNTS.IT_REVIEWED; i++) {
    const reviewed = minus(g.now, 1, 25);
    const submitted = minus(reviewed, 1, 3);
    synthUnits(newRequest("IT_REVIEWED", { created: minus(submitted, 0, 2), submitted, reviewed }), "IT_REVIEWED");
  }
  for (let i = 0; i < PR_COUNTS.CANCELLED; i++) {
    const created = g.rng.between(W + DAY, g.now - 15 * DAY).getTime();
    const submitted = g.rng.chance(0.6) ? created + g.rng.int(1, 48) * HOUR : undefined;
    const cancelled = (submitted ?? created) + g.rng.int(1, 10) * DAY;
    synthUnits(newRequest("CANCELLED", { created, submitted, cancelled }), "CANCELLED");
  }

  // numbering follows creation order, like the app's sequence would have
  requests.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  requests.forEach((r, i) => { r.refNo = `PO-${FIRST_PR_NO + i}`; });
  return { requests, units, notes, audit, lastPrNo: FIRST_PR_NO + requests.length - 1 };
}
