import type { AssetStatus, Priority, Prisma } from "@prisma/client";
import { TRIAGE_LABEL } from "../../src/lib/lifecycle";
import { DAY, HOUR } from "./random";
import { dayFloor, pickActor } from "./people";
import type { Actor, Actors, ApprovalRow, AssetRec, AuditRow, EmpRec, Gen, ScaleContext } from "./types";
import { DEFECT_NOTES } from "./vocab";

/**
 * Phase 43 (spec §3): six months of direct IT changes. Each IT asset gets a chain of lifecycle events that ENDS in
 * the state assets.ts gave it, built backwards from that state and then replayed forwards the way
 * `prepareLifecycle` (src/server/modules/lifecycle/apply.ts) writes them, so the history, the EXECUTED approval
 * rows and the asset's own columns (status, holder, defectiveSince, repairEndedAt, returnedAt, loanDueAt) agree.
 */

/** Lifecycle events to spread across the IT assets; tuned so the EXECUTED approvals land near spec §3's 3,000. */
export const EVENT_BUDGET = 3770;
/** spares that are back from someone and not yet triaged ("back, not checked") */
export const FLAGGED_SPARES = 15;

type St = { status: AssetStatus; holder: EmpRec | null; flagged: boolean };
type Kind = "assign" | "return" | "change" | "triage" | "keep";
interface Step { kind: Kind; from: St; to: St; reason: string; offboarding?: boolean; priority?: Priority }

const SPARE: St = { status: "SPARE", holder: null, flagged: false };
const FLAGGED: St = { status: "SPARE", holder: null, flagged: true };
const DEFECTIVE: St = { status: "DEFECTIVE", holder: null, flagged: false };
const heldBy = (y: EmpRec): St => ({ status: "DEPLOYED", holder: y, flagged: false });

const CHURN: Record<string, number> = {
  Laptop: 5, "Workstation (PC)": 3, Monitor: 2, Headset: 4, Other: 2, Mouse: 1, Keyboard: 1, Webcam: 1, UPS: 0.5,
  "Windows License": 0.3, "Laptop Bag": 1,
};

/** The event that led INTO `to`, and the state before it. Terminal states only ever end a chain. */
function prev(g: Gen, to: St, stable: EmpRec[]): Step {
  const someone = () => heldBy(g.rng.pick(stable));
  switch (to.status) {
    case "DEPLOYED":
    case "TEMPORARY": {
      const fresh = to.holder!.row.joinedAt.getTime() > g.now - 30 * DAY;
      const reason = to.status === "TEMPORARY" ? "loaner while their laptop is in repair"
        : fresh ? "new hire setup"
        : g.rng.weighted([["assigned", 6], ["replacement for a faulty unit", 1], ["moved to a new seat", 1]] as const);
      return { kind: "assign", from: SPARE, to, reason };
    }
    case "SPARE":
      if (to.flagged) return { kind: "return", from: someone(), to, reason: "" };
      return g.rng.chance(0.75)
        ? { kind: "keep", from: FLAGGED, to, reason: "" }
        : { kind: "change", from: DEFECTIVE, to, reason: "Back from repair" };
    case "DEFECTIVE": {
      const kind = g.rng.weighted([["change", 3], ["return", 3], ["triage", 2]] as const);
      const reason = g.rng.pick(DEFECT_NOTES);
      if (kind === "change") return { kind, from: SPARE, to, reason };
      if (kind === "return") return { kind, from: someone(), to, reason };
      return { kind, from: FLAGGED, to, reason };
    }
    case "MISSING":
      return { kind: "return", from: someone(), to, reason: "Not returned — follow-up with the team lead" };
    case "BUYOUT":
      return { kind: "return", from: someone(), to, reason: "Bought out at separation" };
    case "DISPOSE":
      return g.rng.chance(0.5)
        ? { kind: "triage", from: FLAGGED, to, reason: "Beyond economical repair" }
        : { kind: "change", from: DEFECTIVE, to, reason: "Beyond economical repair" };
    case "DONATED":
      return g.rng.chance(0.5)
        ? { kind: "triage", from: FLAGGED, to, reason: "Donated to a partner school" }
        : { kind: "change", from: SPARE, to, reason: "Donated to a partner school" };
    default:
      throw new Error(`scale seed: no IT lifecycle leads into ${to.status}`);
  }
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);
const same = (a: Date | null, b: Date | null) => (a?.getTime() ?? null) === (b?.getTime() ?? null);

interface Fields {
  status: AssetStatus; loanDueAt: Date | null; defectiveSince: Date | null; repairEndedAt: Date | null; returnedAt: Date | null;
}

export interface AssignEvent { asset: AssetRec; holder: EmpRec; at: number; spareSince: number }
export interface OffboardingDecision { employee: EmpRec; approval: ApprovalRow; outcome: string }

const ACTION: Record<Kind, string> = {
  assign: "lifecycle.assign", return: "lifecycle.return", change: "lifecycle.change-status", triage: "lifecycle.triage", keep: "lifecycle.triage",
};
const TYPE: Record<Exclude<Kind, "keep">, ApprovalRow["type"]> = {
  assign: "lifecycle_assign", return: "lifecycle_return", change: "lifecycle_change_status", triage: "lifecycle_change_status",
};

export function buildHistory(g: Gen, ctx: ScaleContext, recs: AssetRec[], employees: EmpRec[], actors: Actors) {
  const W = g.windowStart;
  const byId = new Map(employees.map((e) => [e.row.id, e]));
  const stable = employees.filter((e) => e.row.employment === "ACTIVE" && e.row.joinedAt.getTime() < W);
  const it = recs.filter((r) => r.row.cls === "IT");
  const approvals: ApprovalRow[] = [];
  const audit: AuditRow[] = [];
  const assigns: AssignEvent[] = [];
  const decisions: OffboardingDecision[] = [];
  /** the last lifecycle event per asset id (epoch ms), so later requests and holds start after it */
  const lastEventAt = new Map<string, number>();
  const createdOf = (r: AssetRec) => (r.row.createdAt as Date).getTime();

  // ── leavers who already left handed their things back at offboarding (their farewell report reads these) ──
  const designated = new Map<AssetRec, { employee: EmpRec; outcome: string }>();
  const outcomeFor: Partial<Record<AssetStatus, string>> = { SPARE: "RETURNED", DEFECTIVE: "DEFECTIVE", MISSING: "MISSING", BUYOUT: "BUYOUT" };
  const candidates = g.rng.shuffle(it.filter((r) => outcomeFor[r.row.status as AssetStatus] && r.row.itVerifiedAt));
  for (const e of employees.filter((x) => x.row.employment === "OFFBOARDED")) {
    const by = (e.row.offboardingAt as Date).getTime() - 30 * DAY;
    for (let n = g.rng.int(1, 3); n > 0; n--) {
      const a = candidates.find((r) => !designated.has(r) && createdOf(r) < by);
      if (a) designated.set(a, { employee: e, outcome: outcomeFor[a.row.status as AssetStatus]! });
    }
  }

  // ── which spares are back but not yet triaged, and how many events each asset gets ──
  const flagged = new Set(g.rng.shuffle(it.filter((r) => r.row.status === "SPARE" && r.row.itVerifiedAt && !designated.has(r) && createdOf(r) < g.now - 10 * DAY)).slice(0, FLAGGED_SPARES));
  const generic = it.filter((r) => !designated.has(r));
  const k = new Map<AssetRec, number>(generic.map((r) => [r, 0]));
  const cumulative: number[] = [];
  generic.reduce((s, r) => { const v = s + CHURN[r.category]; cumulative.push(v); return v; }, 0);
  const total = cumulative[cumulative.length - 1];
  for (let i = 0; i < EVENT_BUDGET; i++) {
    const x = g.rng.float() * total;
    let lo = 0, hi = cumulative.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (cumulative[mid] > x) hi = mid; else lo = mid + 1; }
    const r = generic[lo];
    k.set(r, k.get(r)! + 1);
  }

  const emit = (r: AssetRec, f: Fields, step: Step, at: Date, actor: Actor) => {
    const diff: Record<string, { from: unknown; to: unknown }> = {};
    const to = step.to;
    if (step.kind === "keep") {
      diff.triage = { from: null, to: TRIAGE_LABEL.SPARE };
      diff.returnedAt = { from: iso(f.returnedAt), to: null };
      f.returnedAt = null;
    } else {
      const due = step.kind === "assign" && to.status === "TEMPORARY" ? dayFloor(at.getTime() + g.rng.int(14, 45) * DAY) : null;
      if (!same(due, f.loanDueAt)) { diff.loanDueAt = { from: iso(f.loanDueAt), to: iso(due) }; f.loanDueAt = due; }
      if (to.status === "DEFECTIVE" && f.status !== "DEFECTIVE") {
        diff.defectiveSince = { from: iso(f.defectiveSince), to: iso(at) }; f.defectiveSince = at;
        diff.repairEndedAt = { from: iso(f.repairEndedAt), to: null }; f.repairEndedAt = null;
      }
      if (to.status !== "DEFECTIVE" && f.status === "DEFECTIVE") {
        diff.repairEndedAt = { from: iso(f.repairEndedAt), to: iso(at) }; f.repairEndedAt = at;
      }
      if (step.kind === "return" && to.status === "SPARE") {
        diff.returnedAt = { from: iso(f.returnedAt), to: iso(at) }; f.returnedAt = at;
      } else if (f.returnedAt !== null) {
        diff.returnedAt = { from: iso(f.returnedAt), to: null }; f.returnedAt = null;
      }
      if (to.status !== f.status) diff.status = { from: f.status, to: to.status };
      if (step.kind === "assign") diff.assignee = { from: null, to: to.holder!.row.employeeNo };
      if (step.kind === "return") diff.assignee = { from: step.from.holder!.row.employeeNo, to: null };
      if (step.kind === "triage") {
        diff.triage = { from: null, to: TRIAGE_LABEL[to.status as keyof typeof TRIAGE_LABEL] };
        diff[to.status === "DISPOSE" || to.status === "DONATED" ? "reason" : "note"] = { from: null, to: step.reason };
      }
      const payload: Prisma.InputJsonObject =
        step.kind === "assign"
          ? { to: { assigneeId: to.holder!.row.id, status: to.status, ...(f.loanDueAt ? { loanDueAt: f.loanDueAt.toISOString() } : {}) }, reason: step.reason }
          : step.kind === "return"
            ? { from: { assigneeId: step.from.holder!.row.id }, to: { assigneeId: null, status: to.status }, reason: step.reason }
            : { from: { status: step.from.status }, to: { status: to.status }, reason: step.reason || "triage" };
      const approval: ApprovalRow = {
        id: g.id(), refNo: "", type: TYPE[step.kind], state: "EXECUTED", payload, priority: step.priority ?? "NORMAL",
        slaAt: new Date(at.getTime() + 48 * HOUR), requestedById: actor.id, claimedById: actor.id, claimedAt: at, resolvedAt: at,
        assetId: r.row.id, employeeId: step.kind === "assign" ? to.holder!.row.id : step.kind === "return" ? step.from.holder!.row.id : null,
        appliedDirectly: true, createdAt: at, updatedAt: at,
      };
      approvals.push(approval);
      if (step.offboarding) {
        decisions.push({ employee: step.from.holder!, approval, outcome: designated.get(r)!.outcome });
      }
    }
    f.status = to.status;
    audit.push({ actorId: actor.id, actorLabel: actor.name, entityType: "asset", entityId: r.row.id, action: ACTION[step.kind], createdAt: at, diff: diff as Prisma.InputJsonObject });
    lastEventAt.set(r.row.id, at.getTime());
  };

  const replay = (r: AssetRec, steps: Step[], times: Date[], final: St) => {
    const start = steps.length ? steps[0].from : final;
    const f: Fields = {
      status: start.status, loanDueAt: null, repairEndedAt: null,
      defectiveSince: start.status === "DEFECTIVE" ? new Date(W - g.rng.int(1, 60) * DAY) : null,
      returnedAt: start.flagged ? new Date(W - g.rng.int(1, 20) * DAY) : null,
    };
    let spareSince = Math.max(W, createdOf(r));
    steps.forEach((s, i) => {
      const at = times[i];
      if (s.kind === "assign") assigns.push({ asset: r, holder: s.to.holder!, at: at.getTime(), spareSince });
      emit(r, f, s, at, pickActor(g, actors.it, ctx.fixedUsers.it));
      spareSince = at.getTime();
    });
    Object.assign(r.row, {
      status: f.status, assigneeId: final.holder?.row.id ?? null,
      loanDueAt: f.loanDueAt, defectiveSince: f.defectiveSince, repairEndedAt: f.repairEndedAt, returnedAt: f.returnedAt,
    });
  };

  // generic chains
  for (const r of generic) {
    const holder = r.row.assigneeId ? byId.get(r.row.assigneeId as string)! : null;
    const final: St = { status: r.row.status as AssetStatus, holder, flagged: flagged.has(r) };
    const createdInWindow = createdOf(r) >= W;
    const forced = final.flagged || final.status === "DEFECTIVE" || final.status === "MISSING" || final.status === "TEMPORARY"
      || (holder !== null && holder.row.joinedAt.getTime() >= W);
    const want = Math.max(k.get(r)!, forced ? 1 : 0);
    const steps: Step[] = [];
    let cur = final;
    while (steps.length < want || (createdInWindow && !(cur.status === "SPARE" && !cur.flagged))) {
      const s = prev(g, cur, stable);
      steps.unshift(s);
      cur = s.from;
    }
    const lo = Math.max(W, createdOf(r)) + HOUR;
    let fLo = lo;
    let fHi = g.now - HOUR;
    if (holder) {
      fLo = Math.max(fLo, holder.row.joinedAt.getTime() + DAY);
      if (holder.row.offboardingAt) fHi = Math.min(fHi, (holder.row.offboardingAt as Date).getTime() - HOUR);
      if (final.status === "TEMPORARY") fLo = Math.max(fLo, g.now - 60 * DAY);
    }
    const n = steps.length;
    const times: Date[] = [];
    if (n > 0) {
      const tf = g.rng.between(fLo, Math.max(fLo, fHi)).getTime();
      times.push(...g.rng.sortedBetween(n - 1, lo, tf), new Date(tf));
    }
    replay(r, steps, times, final);
  }

  // designated offboarding returns: held since before the window (or assigned after registration), handed back
  // between the offboarding's start and its completion, then (for a plain return) kept as a spare
  for (const [r, { employee: e, outcome }] of designated) {
    const offAt = (e.row.offboardingAt as Date).getTime();
    const done = e.completedAt!.getTime();
    const status = r.row.status as AssetStatus;
    const steps: Step[] = [];
    const times: Date[] = [];
    if (createdOf(r) >= W) {
      steps.push({ kind: "assign", from: SPARE, to: heldBy(e), reason: "assigned" });
      times.push(g.rng.between(createdOf(r) + HOUR, offAt - DAY));
    }
    const returnsTo: St = { status, holder: null, flagged: status === "SPARE" };
    const reason = outcome === "RETURNED" ? "offboarding · returned"
      : outcome === "MISSING" ? "Not returned at offboarding" : outcome === "BUYOUT" ? "Bought out at separation" : g.rng.pick(DEFECT_NOTES);
    steps.push({ kind: "return", from: heldBy(e), to: returnsTo, reason, offboarding: true, priority: outcome === "MISSING" ? "HIGH" : "NORMAL" });
    const back = g.rng.between(offAt + HOUR, done - HOUR);
    times.push(back);
    if (status === "SPARE") {
      steps.push({ kind: "keep", from: FLAGGED, to: SPARE, reason: "" });
      times.push(g.rng.between(back.getTime() + DAY, Math.min(back.getTime() + 10 * DAY, g.now - HOUR)));
    }
    replay(r, steps, times, { status, holder: null, flagged: false });
  }

  return { approvals, audit, assigns, decisions, lastEventAt };
}
