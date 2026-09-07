import type { AssetStatus } from "@prisma/client";
import { HOLDER_STATUSES } from "./asset-class";

/**
 * Phase 15 (spec §1 rows 6–7). The words IT picks from when a device comes back
 * or gets triaged. TRIAGE lands on SPARE with `returnedAt` set — "back, not
 * checked" — and is the only outcome that does.
 */
export const RETURN_OUTCOMES = ["TRIAGE", "DEFECTIVE", "MISSING", "BUYOUT"] as const;
export type ReturnOutcome = (typeof RETURN_OUTCOMES)[number];

export const RETURN_OUTCOME_STATUS: Record<ReturnOutcome, AssetStatus> = {
  TRIAGE: "SPARE", DEFECTIVE: "DEFECTIVE", MISSING: "MISSING", BUYOUT: "BUYOUT",
};

export const RETURN_OUTCOME_LABEL: Record<ReturnOutcome, string> = {
  TRIAGE: "Back for triage", DEFECTIVE: "Defective", MISSING: "Missing", BUYOUT: "Buyout",
};

/** Custody lost opens an investigation; it needs a sentence. Everything else is routine. */
export function reasonRequiredFor(outcome: ReturnOutcome): boolean {
  return outcome === "MISSING";
}

export const TRIAGE_OUTCOMES = ["SPARE", "DEFECTIVE", "DISPOSE", "DONATED"] as const;
export type TriageOutcome = (typeof TRIAGE_OUTCOMES)[number];

export const TRIAGE_LABEL: Record<TriageOutcome, string> = {
  SPARE: "Keep as spare", DEFECTIVE: "Send to repair", DISPOSE: "Dispose", DONATED: "Donate",
};

/**
 * Spec §3. A replacement retires the old device by the chosen outcome and hands
 * the new one the SAME holder status the old one had (a loaner is replaced by a
 * loaner). Throws on a device nobody holds: there is nothing to replace.
 */
export function replacePlan(old: { status: AssetStatus }, outcome: ReturnOutcome): { oldStatus: AssetStatus; newStatus: AssetStatus } {
  if (!(HOLDER_STATUSES.IT as readonly string[]).includes(old.status)) {
    throw new Error(`replacePlan: ${old.status} is not held — nothing to replace`);
  }
  return { oldStatus: RETURN_OUTCOME_STATUS[outcome], newStatus: old.status };
}

/**
 * Phase 15 final review (plan D-8). prepareLifecycle's guard text is the
 * worker's, verbatim — the retry UI shows it as-is (see apply.ts). The direct
 * dialogs are a different audience: no queue, no retry, just IT telling IT
 * what refused. Strip the worker framing so the same guard reads as a normal
 * sentence there, without touching the stored `workerError` text at all.
 */
export function humanizeGuard(error: string): string {
  const PREFIX = "Execution guard: ";
  let out = error.startsWith(PREFIX) ? error.slice(PREFIX.length) : error;
  out = out.replace(
    "— request a lifecycle.return first, then change its status",
    "— return it first, then change its status",
  );
  out = out.replace("— assignment refused", "");
  out = out.replace("— return refused", "");
  return out.trimEnd();
}
