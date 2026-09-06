import type { AssetClass, AssetStatus } from "@prisma/client";
import { CREATABLE_BY_CLASS, DEFAULT_STATUS } from "./asset-class";

/** Re-exported for the form; the source of truth is asset-class.ts (Phase 13). */
export { CREATABLE_BY_CLASS };

/** Any creatable status of either class — the zod enum on the create payload. */
export const CREATABLE_STATUSES = [
  ...CREATABLE_BY_CLASS.IT, ...CREATABLE_BY_CLASS.PURCHASING,
] as const satisfies readonly AssetStatus[];
export type CreatableStatus = (typeof CREATABLE_STATUSES)[number];

export type CreationPlan =
  | { ok: true; status: AssetStatus; approval: null | { toStatus: AssetStatus; assigneeId: string } }
  | { ok: false; error: "assignee_required" | "not_creatable_for_class" };

/**
 * Assets are always CREATED in their class's default state (SPARE / STORED).
 * Requesting anything else yields a lifecycle.assign approval — the worker
 * performs the flip, and until then the asset honestly reads its default.
 */
export function creationPlan(requested: CreatableStatus, assigneeId: string | null, cls: AssetClass): CreationPlan {
  if (!(CREATABLE_BY_CLASS[cls] as readonly string[]).includes(requested)) {
    return { ok: false, error: "not_creatable_for_class" };
  }
  const base = DEFAULT_STATUS[cls];
  if (requested === base) return { ok: true, status: base, approval: null };
  if (!assigneeId) return { ok: false, error: "assignee_required" };
  return { ok: true, status: base, approval: { toStatus: requested, assigneeId } };
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
