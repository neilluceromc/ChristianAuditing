import { z } from "zod";
import { newHireStateSchema, vpnSchema } from "./it-setup";

/**
 * Phase 37 (spec §5): the pieces of Add employee that are not the person's own record — accounts & access,
 * the first note and the spares to assign — plus the wizard's pure step checks.
 */
export const ASSIGN_DISTINCT = "Each spare can be picked once";
export const ASSIGN_MAX = 20;

export const newEmployeeExtrasShape = {
  entraStatus: newHireStateSchema,
  autopilotStatus: newHireStateSchema,
  argusStatus: newHireStateSchema,
  vpn: vpnSchema,
  /** Empty (after trimming) means no first note. */
  note: z.string().trim().max(2000, "At most 2000 characters"),
  assign: z.array(z.object({ assetId: z.string().min(1) })).max(ASSIGN_MAX, `Pick at most ${ASSIGN_MAX} spares`),
};

/** The distinct-spare rule. zod 4 drops refinements on `.extend`, so the server re-applies this on its merged object. */
export function refineDistinctAssign(v: { assign: Array<{ assetId: string }> }, ctx: z.RefinementCtx): void {
  const seen = new Set<string>();
  for (const a of v.assign) {
    if (seen.has(a.assetId)) {
      ctx.addIssue({ code: "custom", path: ["assign"], message: ASSIGN_DISTINCT });
      return;
    }
    seen.add(a.assetId);
  }
}

export const newEmployeeExtras = z.object(newEmployeeExtrasShape).superRefine(refineDistinctAssign);

export type DetailsKey = "name" | "title" | "departmentId" | "employeeNo" | "joinedAt";
const DETAILS_KEYS: DetailsKey[] = ["name", "title", "departmentId", "employeeNo", "joinedAt"];

/** Step 1's Next: the keys still empty after trimming, in form order. Name and title need at least 2 characters. */
export function detailsMissing(d: Record<DetailsKey, string>): DetailsKey[] {
  return DETAILS_KEYS.filter((k) => {
    const v = (d[k] ?? "").trim();
    if (!v) return true;
    return (k === "name" || k === "title") && v.length < 2;
  });
}

export interface AssignFailure { tag: string; reason: string }

/** The reason a refused assignment shows: a validation refusal's first field message, else the message. */
export function firstFailure(res: { ok: false; kind?: string; message: string; fieldErrors?: Record<string, string> }): string {
  const field = res.fieldErrors ? Object.values(res.fieldErrors)[0] : undefined;
  return field ?? res.message;
}

/** The profile's `?assigned=&failed=` after Add employee, read defensively: a bad count is 0, bad JSON no failures. */
export function createdNoticeExtras(assigned: string | null, failed: string | null): { assigned: number; failed: AssignFailure[] } {
  const n = Number.parseInt(assigned ?? "", 10);
  let rows: AssignFailure[] = [];
  if (failed) {
    try {
      const parsed: unknown = JSON.parse(failed);
      if (Array.isArray(parsed)) {
        rows = parsed.filter(
          (r): r is AssignFailure => !!r && typeof r === "object" && typeof (r as AssignFailure).tag === "string" && typeof (r as AssignFailure).reason === "string",
        ).map((r) => ({ tag: r.tag, reason: r.reason }));
      }
    } catch {
      rows = [];
    }
  }
  return { assigned: Number.isFinite(n) && n > 0 ? n : 0, failed: rows };
}
