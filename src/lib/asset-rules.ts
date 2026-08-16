/** Only these are offered on creation (README 3b). */
export const CREATABLE_STATUSES = ["SPARE", "DEPLOYED", "TEMPORARY"] as const;
export type CreatableStatus = (typeof CREATABLE_STATUSES)[number];

export type CreationPlan =
  | { ok: true; status: "SPARE"; approval: null | { toStatus: "DEPLOYED" | "TEMPORARY"; assigneeId: string } }
  | { ok: false; error: "assignee_required" };

/**
 * Assets are always CREATED as SPARE. Requesting DEPLOYED/TEMPORARY yields a
 * lifecycle.assign approval — the worker (Phase 4) performs the actual flip,
 * and until then the asset honestly reads SPARE everywhere.
 */
export function creationPlan(requested: CreatableStatus, assigneeId: string | null): CreationPlan {
  if (requested === "SPARE") return { ok: true, status: "SPARE", approval: null };
  if (!assigneeId) return { ok: false, error: "assignee_required" };
  return { ok: true, status: "SPARE", approval: { toStatus: requested, assigneeId } };
}

const DAY_MS = 86_400_000;

/** Warranty as text + mini bar (record Overview). pct = elapsed share of the span. */
export function warrantyProgress(
  purchasedAt: Date | null,
  warrantyUntil: Date | null,
  now: Date = new Date(),
): { pct: number; label: string } | null {
  if (!warrantyUntil) return null;
  const end = warrantyUntil.getTime();
  const start = purchasedAt?.getTime() ?? end - 365 * DAY_MS;
  const span = Math.max(1, end - start);
  const pct = Math.min(100, Math.max(0, ((now.getTime() - start) / span) * 100));
  const days = Math.ceil((end - now.getTime()) / DAY_MS);
  return { pct, label: days >= 0 ? `expires in ${days} d` : `expired ${-days} d ago` };
}
