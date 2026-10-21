import { DAY, Rng, idFactory } from "./random";
import {
  buildDepartments, buildEmployeeNotes, buildEmployees, buildPolicies, buildUsers, employeeAudits, namePool, pickActor,
} from "./people";
import { buildAssets } from "./assets";
import { buildHistory } from "./history";
import { buildQueue } from "./queue";
import { buildPurchases } from "./purchases";
import { buildEdits } from "./edits";
import type { AuditRow, Gen, ScaleContext, ScaleData } from "./types";

/**
 * Phase 43 (spec §3): the scale data set — 590 people, 968 assets, six months of history and 15 test accounts on
 * top of the normal seed — as plain rows. Pure and deterministic: the same context, clock and seed give the same
 * rows, ids included. prisma/seed-scale.ts reads the context from the database and writes the rows.
 */

export const SCALE_SEED = 43;
/** spec §3: about 40,000 audit rows over six months; the everyday edits top the rest up to exactly this */
export const AUDIT_TARGET = 40_000;
/** the history window: every audit row falls inside it (180 days is inside any six calendar months) */
export const WINDOW_DAYS = 180;
export const FIRST_APPROVAL_NO = 5000;

export { NEW_EMPLOYEES } from "./people";
export { NEW_ASSETS, IT_STATUS_COUNTS } from "./assets";
export type { ScaleContext, ScaleData } from "./types";

export function generateScaleData(ctx: ScaleContext, now: Date, seed: number = SCALE_SEED): ScaleData {
  const g: Gen = { rng: new Rng(seed), id: idFactory(seed + 1), now: now.getTime(), windowStart: now.getTime() - WINDOW_DAYS * DAY };
  const nextName = namePool(g);

  const { rows: departments, internal, clients } = buildDepartments(g, ctx);
  const { rows: users, actors } = buildUsers(g, nextName);
  const employees = buildEmployees(g, internal, clients, nextName);
  const { policies, slots, defs } = buildPolicies(g, ctx, internal, clients);
  const { recs, audit: assetAudit } = buildAssets(g, ctx, employees, actors, [...ctx.policies, ...defs]);
  const history = buildHistory(g, ctx, recs, employees, actors);
  const queue = buildQueue(g, ctx, recs, employees, actors, history.assigns, history.lastEventAt);
  const purchases = buildPurchases(g, ctx, recs, [...internal, ...clients], actors);
  const notes = buildEmployeeNotes(g, employees, actors, ctx);
  const peopleAudit = employeeAudits(g, employees, actors, ctx);

  // APR numbers follow creation order across the executed history and the open queue
  const approvals = [...history.approvals, ...queue.approvals].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  approvals.forEach((a, i) => { a.refNo = `APR-${FIRST_APPROVAL_NO + i}`; });
  for (const { audit, approval } of queue.refLinks) audit.diff = { approval: { from: null, to: approval.refNo } };

  // the immutable snapshot each completed offboarding leaves (src/server/modules/offboarding/actions.ts)
  const completions: AuditRow[] = employees.filter((e) => e.row.employment === "OFFBOARDED").map((e) => {
    const by = pickActor(g, actors.it, ctx.fixedUsers.it);
    return {
      actorId: by.id, actorLabel: by.name, entityType: "employee", entityId: e.row.id, action: "offboarding.completed",
      createdAt: e.completedAt!,
      diff: {
        employment: { from: "OFFBOARDING", to: "OFFBOARDED" },
        m365Status: { from: e.row.m365Status ?? null, to: e.row.m365Status ?? null },
        decisions: {
          from: null,
          to: history.decisions.filter((d) => d.employee === e).map((d) => `${d.approval.refNo} · ${d.outcome} · ${d.approval.state}`),
        },
      },
    };
  });

  const base: AuditRow[] = [
    ...assetAudit, ...history.audit, ...queue.audit, ...purchases.audit, ...notes.audit, ...peopleAudit, ...completions,
  ];
  const edits = buildEdits(g, ctx, recs, employees, actors, AUDIT_TARGET - base.length);
  const auditEntries = [...base, ...edits].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  return {
    departments,
    users,
    employees: employees.map((e) => e.row),
    employeeNotes: notes.notes,
    policies,
    policySlots: slots,
    purchaseOrders: purchases.requests,
    purchaseOrderLines: purchases.units,
    noteEntries: purchases.notes,
    assets: recs.map((r) => r.row),
    approvals,
    reservations: queue.reservations,
    auditEntries,
    sequences: { purchaseRequest: purchases.lastPrNo, approval: FIRST_APPROVAL_NO + approvals.length - 1 },
  };
}
