import type { Prisma } from "@prisma/client";
import { DAY, HOUR } from "./random";
import { dayFloor, pickActor } from "./people";
import type { Actor, Actors, ApprovalRow, AssetRec, AuditRow, EmpRec, Gen, ScaleContext } from "./types";
import type { AssignEvent } from "./history";
import { DEFECT_NOTES } from "./vocab";

/**
 * Phase 43 (spec §3): what is open right now — about 40 PENDING or CLAIMED approvals (a few past their SLA) — and
 * about 200 holds, mostly closed, about 20 ACTIVE. Every open item sits on an asset whose last change is older than
 * the item, never on two at once: one open approval per asset, one ACTIVE hold per asset (the two partial unique
 * indexes), and no asset carries both.
 */

export const OPEN_APPROVALS = { itAssign: 10, itReturn: 8, itStatus: 6, purchAssign: 6, purchStatus: 10, claimed: 12, overdue: 5 };
export const HOLDS = { active: 20, fulfilled: 90, released: 50, expired: 40 };

/** An approval.requested audit row whose diff names the approval's refNo, which is only known after numbering. */
export interface RefLink { audit: AuditRow; approval: ApprovalRow }

export function buildQueue(
  g: Gen, ctx: ScaleContext, recs: AssetRec[], employees: EmpRec[], actors: Actors,
  assigns: AssignEvent[], lastEventAt: Map<string, number>,
) {
  const approvals: ApprovalRow[] = [];
  const audit: AuditRow[] = [];
  const refLinks: RefLink[] = [];
  const reservations: Prisma.ReservationCreateManyInput[] = [];
  const byId = new Map(employees.map((e) => [e.row.id, e]));
  const active = employees.filter((e) => e.row.employment === "ACTIVE");
  const stable = active.filter((e) => e.row.joinedAt.getTime() < g.windowStart);
  const last = (r: AssetRec) => lastEventAt.get(r.row.id) ?? (r.row.createdAt as Date).getTime();
  const quiet = (r: AssetRec) => last(r) < g.now - 7 * DAY;
  const used = new Set<string>();
  const take = (pool: AssetRec[], n: number) => {
    const out = g.rng.shuffle(pool.filter((r) => !used.has(r.row.id))).slice(0, n);
    out.forEach((r) => used.add(r.row.id));
    return out;
  };
  const it = recs.filter((r) => r.row.cls === "IT" && quiet(r));
  const purch = recs.filter((r) => r.row.cls === "PURCHASING" && quiet(r));
  const assignableSpare = (r: AssetRec) => r.row.status === "SPARE" && !r.row.returnedAt && r.row.itVerifiedAt;
  const itActor = () => pickActor(g, actors.it, ctx.fixedUsers.it);
  const purchActor = () => pickActor(g, actors.purchasing, ctx.fixedUsers.purchasing);

  // ── the approvals queue ──
  type Ask = { asset: AssetRec; type: ApprovalRow["type"]; payload: Prisma.InputJsonObject; employeeId: string | null; by: () => Actor };
  const asks: Ask[] = [];
  for (const a of take(it.filter(assignableSpare), OPEN_APPROVALS.itAssign)) {
    const e = g.rng.pick(active);
    asks.push({ asset: a, type: "lifecycle_assign", employeeId: e.row.id, by: itActor, payload: { to: { assigneeId: e.row.id, status: "DEPLOYED" }, reason: "new seat on the client floor" } });
  }
  const heldByActive = (r: AssetRec) => r.row.status === "DEPLOYED" && byId.get(r.row.assigneeId as string)?.row.employment === "ACTIVE";
  for (const a of take(it.filter(heldByActive), OPEN_APPROVALS.itReturn)) {
    asks.push({ asset: a, type: "lifecycle_return", employeeId: a.row.assigneeId as string, by: itActor, payload: { from: { assigneeId: a.row.assigneeId as string }, to: { assigneeId: null, status: "SPARE" }, reason: "Upgrade — return the old unit" } });
  }
  for (const a of take(it.filter(assignableSpare), OPEN_APPROVALS.itStatus)) {
    asks.push({ asset: a, type: "lifecycle_change_status", employeeId: null, by: itActor, payload: { from: { status: "SPARE" }, to: { status: "DEFECTIVE" }, reason: g.rng.pick(DEFECT_NOTES) } });
  }
  for (const a of take(purch.filter((r) => r.row.status === "STORED"), OPEN_APPROVALS.purchAssign)) {
    const e = g.rng.pick(active);
    asks.push({ asset: a, type: "lifecycle_assign", employeeId: e.row.id, by: purchActor, payload: { to: { assigneeId: e.row.id, status: "OPERATIONAL" }, reason: "issued to the team" } });
  }
  for (const a of take(purch.filter((r) => r.row.status === "OPERATIONAL" && !r.row.assigneeId && r.category !== "Building"), OPEN_APPROVALS.purchStatus)) {
    const to = g.rng.chance(0.5) ? "REPAIRING" : "RETIRED";
    asks.push({ asset: a, type: "lifecycle_change_status", employeeId: null, by: purchActor, payload: { from: { status: "OPERATIONAL" }, to: { status: to }, reason: to === "REPAIRING" ? "Wobbly, send for repair" : "End of life" } });
  }
  const claimedIdx = new Set(g.rng.shuffle(asks.map((_, i) => i)).slice(0, OPEN_APPROVALS.claimed));
  // the SLA is 48 hours: most requests are inside it, a few are past it (spec §3: "a few overdue")
  const overdueIdx = new Set(g.rng.shuffle(asks.map((_, i) => i)).slice(0, OPEN_APPROVALS.overdue));
  asks.forEach((ask, i) => {
    const by = ask.by();
    const at = overdueIdx.has(i)
      ? g.rng.between(g.now - 6 * DAY, g.now - 50 * HOUR)
      : g.rng.between(g.now - 44 * HOUR, g.now - HOUR);
    const claimed = claimedIdx.has(i);
    const claimer = ask.asset.row.cls === "IT" ? itActor() : purchActor();
    const claimedAt = claimed ? g.rng.between(at.getTime() + 10 * 60_000, Math.min(at.getTime() + 20 * HOUR, g.now - 5 * 60_000)) : null;
    const approval: ApprovalRow = {
      id: g.id(), refNo: "", type: ask.type, state: claimed ? "CLAIMED" : "PENDING", payload: ask.payload,
      priority: g.rng.weighted([["NORMAL", 7], ["HIGH", 2], ["URGENT", 1]] as const),
      slaAt: new Date(at.getTime() + 48 * HOUR), requestedById: by.id, assetId: ask.asset.row.id, employeeId: ask.employeeId,
      claimedById: claimed ? claimer.id : null, claimedAt, createdAt: at, updatedAt: claimedAt ?? at,
    };
    approvals.push(approval);
    const requested: AuditRow = { actorId: by.id, actorLabel: by.name, entityType: "asset", entityId: ask.asset.row.id, action: "approval.requested", createdAt: at };
    audit.push(requested);
    refLinks.push({ audit: requested, approval });
    if (claimedAt) {
      audit.push({
        actorId: claimer.id, actorLabel: claimer.name, entityType: "approval", entityId: approval.id as string, action: "claim",
        createdAt: claimedAt, diff: { state: { from: "PENDING", to: "CLAIMED" } },
      });
    }
  });

  // ── holds ──
  const placed = (r: AssetRec, e: EmpRec, at: Date, expiresAt: Date, by: Actor) => audit.push({
    actorId: by.id, actorLabel: by.name, entityType: "asset", entityId: r.row.id, action: "reservation.placed", createdAt: at,
    diff: { hold: { from: null, to: e.row.employeeNo }, expiresAt: { from: null, to: expiresAt.toISOString() } },
  });
  const hires = active.filter((e) => e.row.joinedAt.getTime() > g.now - 30 * DAY);
  const holders = [...hires, ...g.rng.shuffle(stable)];
  take(it.filter((r) => assignableSpare(r) && last(r) < g.now - 3 * DAY), HOLDS.active).forEach((r, i) => {
    const e = holders[i];
    const by = itActor();
    const at = g.rng.between(Math.max(last(r) + HOUR, g.now - 10 * DAY), g.now - 2 * HOUR);
    const expiresAt = dayFloor(g.now + g.rng.int(1, 14) * DAY);
    reservations.push({ assetId: r.row.id, employeeId: e.row.id, state: "ACTIVE", reason: i < hires.length ? "New hire setup" : "Replacement for a faulty unit", expiresAt, createdAt: at, updatedAt: at });
    placed(r, e, at, expiresAt, by);
  });

  // Closed holds sit on the spare stretch just before a real assignment: FULFILLED ones by that assignment.
  const roomy = g.rng.shuffle(assigns.filter((a) => a.at - a.spareSince >= 6 * DAY));
  const pickEvents = (n: number) => roomy.splice(0, n);
  for (const a of pickEvents(HOLDS.fulfilled)) {
    const by = itActor();
    const at = g.rng.between(Math.max(a.spareSince + HOUR, a.at - 5 * DAY), a.at - HOUR);
    const expiresAt = dayFloor(Math.max(at.getTime() + 7 * DAY, a.at + DAY));
    reservations.push({ assetId: a.asset.row.id, employeeId: a.holder.row.id, state: "FULFILLED", reason: "Reserved ahead of the assignment", expiresAt, resolvedAt: new Date(a.at), createdAt: at, updatedAt: new Date(a.at) });
    placed(a.asset, a.holder, at, expiresAt, by);
  }
  for (const a of pickEvents(HOLDS.released)) {
    const by = itActor();
    const e = g.rng.pick(stable.filter((x) => x !== a.holder));
    const at = g.rng.between(a.spareSince + HOUR, a.at - 4 * DAY);
    const released = g.rng.between(at.getTime() + DAY, a.at - HOUR);
    const expiresAt = dayFloor(at.getTime() + g.rng.int(7, 14) * DAY);
    reservations.push({ assetId: a.asset.row.id, employeeId: e.row.id, state: "RELEASED", reason: "Held for a transfer", expiresAt, resolvedAt: released, createdAt: at, updatedAt: released });
    placed(a.asset, e, at, expiresAt, by);
    audit.push({
      actorId: by.id, actorLabel: by.name, entityType: "asset", entityId: a.asset.row.id, action: "reservation.released", createdAt: released,
      diff: { hold: { from: e.row.employeeNo, to: null }, reason: { from: null, to: "No longer needed" } },
    });
  }
  for (const a of pickEvents(HOLDS.expired)) {
    const by = itActor();
    const e = g.rng.pick(stable.filter((x) => x !== a.holder));
    const at = g.rng.between(a.spareSince + HOUR, a.at - 5 * DAY);
    const expiresAt = dayFloor(at.getTime() + 3 * DAY);
    const resolvedAt = new Date(expiresAt.getTime() + 16 * HOUR);
    reservations.push({ assetId: a.asset.row.id, employeeId: e.row.id, state: "EXPIRED", reason: "Held for a new hire who did not start", expiresAt, resolvedAt, createdAt: at, updatedAt: resolvedAt });
    placed(a.asset, e, at, expiresAt, by);
  }
  return { approvals, audit, refLinks, reservations };
}
