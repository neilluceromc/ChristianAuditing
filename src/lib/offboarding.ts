import type { AssetStatus } from "@prisma/client";

/**
 * README 3e: per item, a 4-way control — Returned / Defective / Buyout /
 * **Missing**. Missing is first-class because "pretending everything comes
 * back is why spreadsheets drift", and a reason is required for anything
 * other than a clean return.
 */
export const OUTCOMES = ["RETURNED", "DEFECTIVE", "BUYOUT", "MISSING"] as const;

export type Outcome = (typeof OUTCOMES)[number];

export const OUTCOME_LABEL: Record<Outcome, string> = {
  RETURNED: "Returned", DEFECTIVE: "Defective", BUYOUT: "Buyout", MISSING: "Missing",
};

/** What the worker will set the asset to — the payload's `to.status`. */
export const OUTCOME_STATUS: Record<Outcome, AssetStatus> = {
  RETURNED: "SPARE", DEFECTIVE: "DEFECTIVE", BUYOUT: "BUYOUT", MISSING: "MISSING",
};

export function reasonRequired(outcome: Outcome): boolean {
  return outcome !== "RETURNED";
}

export const WIZARD_STEPS = [
  { id: "review", label: "Review holdings" },
  { id: "collect", label: "Collect items" },
  { id: "accounts", label: "Accounts & M365" },
  { id: "report", label: "Farewell report" },
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

/** Reverse of OUTCOME_STATUS: what a stored payload's target status meant. */
export function outcomeOfStatus(status: string | null | undefined): Outcome | null {
  return OUTCOMES.find((o) => OUTCOME_STATUS[o] === status) ?? null;
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
}

export interface Decision {
  refNo: string;
  outcome: Outcome;
  state: string;
  reason: string | null;
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
 * `assigneeId: null` — so if they hold the thing now, that return decided an
 * EARLIER holding and the item came back to them afterwards. Without this, a
 * laptop returned once and later reassigned to the same person reads "decided"
 * forever, and the wizard completes leaving it assigned to someone who no
 * longer works here — the dangling assignment scope decision #2 exists to
 * prevent. EXECUTION_FAILED is deliberately NOT excluded: that return never
 * moved the asset, so it is still the live (retryable) decision.
 */
export function decisionOf(
  candidates: DecisionCandidate[],
  { held }: { held: boolean },
): Decision | null {
  const live = candidates
    .flatMap((c) => {
      if (c.state === "REJECTED") return [];
      if (held && c.state === "EXECUTED") return [];
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
    refNo: winner.refNo,
    outcome: winner.outcome,
    state: winner.state,
    reason: winner.reason,
  };
}
