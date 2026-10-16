export type Employment = "ACTIVE" | "OFFBOARDING" | "OFFBOARDED";

/** The spec's refusal sentence (Phase 40 §2.2), shown by `updateEmployee` and the Edit form. */
export const EMPLOYMENT_CHANGE_REFUSAL = "Use Start offboarding — leavers go through the offboarding wizard";

/**
 * Phase 40 (spec §2.2, ruling 1): the Edit form may not move someone's employment, with one exception — cancelling
 * an offboarding (OFFBOARDING → ACTIVE). Starting goes through the Start offboarding dialog (`startOffboarding`), completing
 * through the wizard (`completeOffboarding`). Re-sending the current value is not a change, so it is always allowed;
 * that is what lets an edit of a name or title save for an ACTIVE, OFFBOARDING or OFFBOARDED person.
 */
export function employmentChangeAllowed(from: Employment, to: Employment): boolean {
  if (from === to) return true;
  return from === "OFFBOARDING" && to === "ACTIVE";
}
