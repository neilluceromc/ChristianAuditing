import type { EmploymentStatus } from "@prisma/client";

/** The spec's refusal sentence (Phase 40 §2.2), shown by `updateEmployee` and the Edit form. */
export const EMPLOYMENT_CHANGE_REFUSAL = "Use Start offboarding — leavers go through the offboarding wizard";

/** `updateEmployee`'s state-guarded write found the person changed since the form was read (final review I1). */
export const EMPLOYEE_CHANGED = "That person changed — reload and try again";

/**
 * Phase 40 (spec §2.2, ruling 1): the Edit form may not move someone's employment, with one exception — cancelling
 * an offboarding (OFFBOARDING → ACTIVE). Starting goes through the Start offboarding dialog (`startOffboarding`), completing
 * through the wizard (`completeOffboarding`). Re-sending the current value is not a change, so it is always allowed;
 * that is what lets an edit of a name or title save for an ACTIVE, OFFBOARDING or OFFBOARDED person.
 */
export function employmentChangeAllowed(from: EmploymentStatus, to: EmploymentStatus): boolean {
  if (from === to) return true;
  return from === "OFFBOARDING" && to === "ACTIVE";
}

/**
 * Final review I1: the employment `updateEmployee` writes. The Edit form sends `employment` only when its select is
 * shown (a leaver); a missing value means "keep what is stored", so an ACTIVE person's stale form can never post
 * ACTIVE over an offboarding someone started meanwhile.
 */
export function editEmploymentTarget(
  stored: EmploymentStatus, posted: EmploymentStatus | undefined,
): { ok: true; target: EmploymentStatus } | { ok: false; field: "employment"; message: string } {
  const target = posted ?? stored;
  if (!employmentChangeAllowed(stored, target)) return { ok: false, field: "employment", message: EMPLOYMENT_CHANGE_REFUSAL };
  return { ok: true, target };
}

/** The where of `updateEmployee`'s write: only the employment the edit was read with may be replaced. */
export function employmentGuard(id: string, stored: EmploymentStatus): { id: string; employment: EmploymentStatus } {
  return { id, employment: stored };
}
