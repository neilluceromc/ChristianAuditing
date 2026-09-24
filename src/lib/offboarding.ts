import type { AssetClass, AssetStatus } from "@prisma/client";
import { daysUntil, isPastDue } from "./deadlines";

/**
 * The outcome VOCABULARY, in README 3e's order. It is no longer the control:
 * what any given item offers is `outcomesFor(cls)` -- four for an IT asset,
 * three for a Purchasing one (no Buyout). Missing is first-class because
 * "pretending everything comes back is why spreadsheets drift", and a reason
 * is required for anything other than a clean return.
 */
export const OUTCOMES = ["RETURNED", "DEFECTIVE", "BUYOUT", "MISSING"] as const;

export type Outcome = (typeof OUTCOMES)[number];

export const OUTCOME_LABEL: Record<Outcome, string> = {
  RETURNED: "Returned", DEFECTIVE: "Defective", BUYOUT: "Buyout", MISSING: "Missing",
};

/**
 * What the worker will set the asset to — the payload's `to.status` — per
 * CLASS (Phase 13). Purchasing has no Buyout: nobody buys out a company car or
 * a desk through the leaver wizard, so the key is simply absent, and
 * `outcomesFor` derives the offered set from what is present.
 */
export const OUTCOME_STATUS_BY_CLASS: Record<AssetClass, Partial<Record<Outcome, AssetStatus>>> = {
  IT: { RETURNED: "SPARE", DEFECTIVE: "DEFECTIVE", BUYOUT: "BUYOUT", MISSING: "MISSING" },
  PURCHASING: { RETURNED: "STORED", DEFECTIVE: "REPAIRING", MISSING: "LOST" },
};

/** The outcomes the wizard offers for an asset of this class, in README 3e order. */
export function outcomesFor(cls: AssetClass): readonly Outcome[] {
  return OUTCOMES.filter((o) => OUTCOME_STATUS_BY_CLASS[cls][o] !== undefined);
}

/** The status an outcome lands on for this class, or null if the class does not offer it. */
export function outcomeStatus(cls: AssetClass, outcome: Outcome): AssetStatus | null {
  return OUTCOME_STATUS_BY_CLASS[cls][outcome] ?? null;
}

export function reasonRequired(outcome: Outcome): boolean {
  return outcome !== "RETURNED";
}

export const WIZARD_STEPS = [
  { id: "review", label: "Review holdings" },
  { id: "collect", label: "Collect items" },
  { id: "accounts", label: "Accounts & M365" },
  { id: "report", label: "Finish" },
] as const;

export type StepId = (typeof WIZARD_STEPS)[number]["id"];

/** `?step=` keeps the operator's place across a refresh (entry criterion #8). */
export function parseStep(raw: string | null | undefined): StepId {
  return (WIZARD_STEPS.some((s) => s.id === raw) ? raw : "review") as StepId;
}

/**
 * Continue is blocked while any item is undecided — undecided is NOT the same
 * as Returned, and defaulting it to one would be the exact drift this screen
 * exists to prevent.
 */
export function canContinue(step: StepId, state: { undecided: number }): boolean {
  return step !== "collect" || state.undecided === 0;
}

export interface FailedReturn { refNo: string; approvalId: string }

/** One leaver as the queue, the wizard, the worklist and Home all read them (spec §3). */
export interface LeaverState {
  id: string;
  employment: string;
  dueAt: Date | null;
  undecided: number;
  /** the first held item whose return failed to execute */
  failed: FailedReturn | null;
  m365Status: string | null;
}

/** Exactly completeOffboarding's M365 gate: trimmed, case-folded, anything but null or "inactive" is live. */
export function m365Live(status: string | null): boolean {
  const s = status?.trim().toLowerCase() ?? null;
  return s !== null && s !== "inactive";
}

export interface NextStep { step: StepId | null; label: string; href: string }

/** The next step for one leaver, worst blocker first (spec §3). Null once offboarded. */
export function offboardingNext(s: LeaverState): NextStep | null {
  if (s.employment !== "OFFBOARDING") return null;
  if (s.failed) return { step: null, label: `Resolve ${s.failed.refNo}`, href: `/approvals/${s.failed.approvalId}` };
  if (s.dueAt === null) return { step: null, label: "Set a date", href: `/employees/${s.id}/edit` };
  if (s.undecided > 0) {
    return { step: "collect", label: `Collect ${s.undecided} item${s.undecided === 1 ? "" : "s"}`, href: `/offboarding/${s.id}?step=collect` };
  }
  if (m365Live(s.m365Status)) return { step: "accounts", label: "Close account", href: `/offboarding/${s.id}?step=accounts` };
  return { step: "report", label: "Complete", href: `/offboarding/${s.id}?step=report` };
}

export interface ReadinessInput { id: string; total: number; undecided: number; failed: FailedReturn[]; m365Status: string | null }
export interface ReadinessLine { kind: "equipment" | "requests" | "m365"; label: string; ok: boolean; href: string | null }

/** The Finish step's checklist: one line per server gate, in completeOffboarding's order. */
export function readiness(d: ReadinessInput): ReadinessLine[] {
  const lines: ReadinessLine[] = [{
    kind: "equipment",
    label: `Equipment · ${d.total - d.undecided} of ${d.total} decided`,
    ok: d.undecided === 0,
    href: d.undecided === 0 ? null : `/offboarding/${d.id}?step=collect`,
  }];
  for (const f of d.failed) {
    lines.push({ kind: "requests", label: `Requests · ${f.refNo} failed to execute`, ok: false, href: `/approvals/${f.approvalId}` });
  }
  const live = m365Live(d.m365Status);
  lines.push({
    kind: "m365",
    label: `Microsoft 365 · ${d.m365Status ?? "never had an account"}`,
    ok: !live,
    href: live ? `/offboarding/${d.id}?step=accounts` : null,
  });
  return lines;
}

/** Empty means Complete may be offered; the server gate stays the backstop. */
export function completionBlockers(d: ReadinessInput): ReadinessLine[] {
  return readiness(d).filter((l) => !l.ok);
}

export type OffboardingAttentionKind = "failed" | "overdue" | "no-date" | "undecided" | "m365" | "ready";
export interface OffboardingAttention { kind: OffboardingAttentionKind; label: string; severity: number }

/** The one worst reason a leaver needs attention (spec §3), the Phase 30 severity shape. */
export function offboardingAttention(s: LeaverState, todayISO: string): OffboardingAttention | null {
  if (s.employment !== "OFFBOARDING") return null;
  if (s.failed) return { kind: "failed", label: `return failed · ${s.failed.refNo}`, severity: 6000 };
  if (s.dueAt !== null && isPastDue(s.dueAt, todayISO)) {
    const days = -daysUntil(s.dueAt, todayISO);
    return { kind: "overdue", label: `overdue by ${days} d`, severity: 5000 + days };
  }
  if (s.dueAt === null) return { kind: "no-date", label: "no completion date", severity: 4000 };
  if (s.undecided > 0) return { kind: "undecided", label: `${s.undecided} to decide`, severity: 3000 + s.undecided };
  if (m365Live(s.m365Status)) return { kind: "m365", label: `account still ${s.m365Status}`, severity: 2000 };
  return { kind: "ready", label: "ready to complete", severity: 1000 };
}

/** desc = worst first. Ties by name then id; rows without a reason last either way. */
export function orderByOffboardingAttention<T extends { attention: OffboardingAttention | null; name: string; id: string }>(
  rows: T[], dir: "asc" | "desc",
): T[] {
  const sign = dir === "desc" ? -1 : 1;
  const tie = (x: T, y: T) => x.name.localeCompare(y.name) || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0);
  return [...rows].sort((x, y) => {
    if (!x.attention || !y.attention) {
      if (!x.attention && !y.attention) return tie(x, y);
      return x.attention ? -1 : 1;
    }
    return sign * (x.attention.severity - y.attention.severity) || tie(x, y);
  });
}

/** Without ?step=, open where the work is (spec §3). */
export function defaultStep(s: { employment: string; undecided: number; m365Status: string | null }): StepId {
  if (s.employment !== "OFFBOARDING") return "review";
  if (s.undecided > 0) return "collect";
  if (m365Live(s.m365Status)) return "accounts";
  return "report";
}

const DECISION_STATE_WORD: Record<string, string> = {
  PENDING: "awaiting approval", CLAIMED: "awaiting approval", APPROVED: "approved",
  EXECUTED: "done", EXECUTION_FAILED: "failed to execute",
};
export function decisionStateLabel(state: string): string {
  return DECISION_STATE_WORD[state] ?? state.toLowerCase().replaceAll("_", " ");
}

export interface ReportItem {
  outcome: Outcome;
  cost: number | null;
}

export interface ReportTotals {
  /** back in the fleet: returned + defective */
  recovered: number;
  /** the employee paid for it */
  boughtOut: number;
  /** custody lost */
  lost: number;
  total: number;
  counts: Record<Outcome, number>;
}

/**
 * Which total each outcome feeds. A table rather than an if/else chain because
 * `Record<Outcome, …>` is exhaustive by construction: a fifth outcome is a
 * compile error here, instead of silently landing in `lost` and reporting a
 * financial loss on somebody's farewell receipt.
 */
const OUTCOME_BUCKET: Record<Outcome, "recovered" | "boughtOut" | "lost"> = {
  RETURNED: "recovered",
  DEFECTIVE: "recovered",
  BUYOUT: "boughtOut",
  MISSING: "lost",
};

export function reportTotals(items: ReportItem[]): ReportTotals {
  const counts: Record<Outcome, number> = { RETURNED: 0, DEFECTIVE: 0, BUYOUT: 0, MISSING: 0 };
  const money = { recovered: 0, boughtOut: 0, lost: 0 };
  for (const item of items) {
    // an unknown cost still counts as an item — it just adds no money
    counts[item.outcome] += 1;
    money[OUTCOME_BUCKET[item.outcome]] += item.cost ?? 0;
  }
  return { ...money, total: items.length, counts };
}

/** Reverse of the outcome maps, across BOTH classes: what a stored payload's target status meant. */
export function outcomeOfStatus(status: string | null | undefined): Outcome | null {
  for (const cls of ["IT", "PURCHASING"] as const) {
    const hit = OUTCOMES.find((o) => OUTCOME_STATUS_BY_CLASS[cls][o] === status);
    if (hit) return hit;
  }
  return null;
}

/** `to.status` out of an approval payload, trusting nothing about its shape. */
export function returnTargetStatus(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const to = (payload as { to?: unknown }).to;
  if (!to || typeof to !== "object" || Array.isArray(to)) return null;
  const status = (to as { status?: unknown }).status;
  return typeof status === "string" && status.length > 0 ? status : null;
}

export interface DecisionCandidate {
  id: string;
  refNo: string;
  state: string;
  /** payload.to.status, already extracted by returnTargetStatus */
  toStatus: string | null;
  reason: string | null;
  createdAt: Date;
  /**
   * Phase 20 (spec §4.1): the approval's claimer and resolved time. OPTIONAL
   * here — a PENDING approval has neither, and every existing caller/fixture
   * that builds a `DecisionCandidate` with no notion of attribution yet stays
   * valid. `decisionOf` defaults an absent value to `null` on the winning
   * `Decision`, whose own fields are required — every caller of `decisionOf`
   * gets a real (if `null`) answer, never `undefined`.
   */
  decidedBy?: string | null;
  decidedAt?: Date | null;
}

export interface Decision {
  /** Phase 25: the winning approval's id, so the wizard can link the ref to /approvals/{id}. */
  id: string;
  refNo: string;
  outcome: Outcome;
  state: string;
  reason: string | null;
  /** payload.to.status, exactly as stored — the payload's real target, not a re-derivation. */
  toStatus: string | null;
  /** Phase 20 (spec §4.1): the winning candidate's claimer/resolved time, or both null (still PENDING, or the candidate carried none). */
  decidedBy: string | null;
  decidedAt: Date | null;
}

/**
 * "Decided" is DERIVED from the approvals that exist (scope decision #3) —
 * no wizard-state table, which is exactly what makes a half-finished
 * offboarding N correct records instead of a lost session. Every non-rejected
 * state counts, EXECUTION_FAILED included: the decision WAS made, and the
 * operator must not be asked for it twice. A REJECTED return re-opens the item.
 *
 * `held` says whether the employee holds that asset RIGHT NOW, and it is what
 * stops one offboarding inheriting an older one's answer. An EXECUTED return
 * cleared the holder by construction — `executionPlan` hard-codes
 * `assigneeId: null` — so if they hold the thing now, the asset came back to
 * them AFTER that return, and everything up to and including it decided the
 * holding that ended there. Hence the boundary below rather than a bare "skip
 * EXECUTED": a stale EXECUTION_FAILED left behind by an abandoned earlier
 * return would otherwise still answer for this holding. Without any of this, a
 * laptop returned once and later reassigned to the same person reads "decided"
 * forever, and the wizard completes leaving it assigned to someone who no
 * longer works here — the dangling assignment scope decision #2 exists to
 * prevent. An EXECUTION_FAILED *after* the boundary is deliberately kept: that
 * return never moved the asset, so it is still this holding's live, retryable
 * decision.
 */
export function decisionOf(
  candidates: DecisionCandidate[],
  { held }: { held: boolean },
): Decision | null {
  const boundary = held
    ? candidates.reduce(
        (t, c) => (c.state === "EXECUTED" ? Math.max(t, c.createdAt.getTime()) : t),
        -Infinity,
      )
    : -Infinity;
  const live = candidates
    .flatMap((c) => {
      if (c.state === "REJECTED") return [];
      if (c.createdAt.getTime() <= boundary) return [];
      const outcome = outcomeOfStatus(c.toStatus);
      // carrying the outcome on the surviving row makes the winner's
      // non-null-ness structural, instead of an assertion sitting several
      // lines away from the filter that proves it
      return outcome ? [{ ...c, outcome }] : [];
    })
    // Two reads of the same rows must agree. createdAt alone is not a stable
    // order — a worker commit and an operator's decision can land in the same
    // millisecond — so id breaks the tie. Plain comparison rather than
    // localeCompare: this needs to be deterministic, not locale-aware.
    .sort((a, b) =>
      b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  const winner = live[0];
  if (!winner) return null;
  return {
    id: winner.id,
    refNo: winner.refNo,
    outcome: winner.outcome,
    state: winner.state,
    reason: winner.reason,
    toStatus: winner.toStatus,
    decidedBy: winner.decidedBy ?? null,
    decidedAt: winner.decidedAt ?? null,
  };
}
