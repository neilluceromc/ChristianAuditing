/**
 * The six-family status system (design_handover/README.md, "The status system").
 * Every enum value in the app maps into exactly one family; nothing gets a
 * bespoke colour. Unknown/client-defined values map to neutral.
 *
 * Case-sensitive by design: reservation "ACTIVE" is inflight (someone owes an
 * action), M365 "active" is settled (account is in the right state).
 */
export const STATUS_FAMILIES = [
  "neutral", "inflight", "settled", "attention", "fault", "closed",
] as const;

export type StatusFamily = (typeof STATUS_FAMILIES)[number];

const MAP: Record<string, StatusFamily> = {
  // Asset status (MISSING: custody lost — a fault demanding investigation, not "fine for now")
  DEPLOYED: "settled", SPARE: "neutral", DEFECTIVE: "fault", MISSING: "fault", DONATED: "closed",
  TEMPORARY: "attention", BUYOUT: "closed", DISPOSE: "closed",
  // Purchase request state
  DRAFT: "neutral", SUBMITTED: "inflight", IT_REVIEWED: "inflight",
  COMPLETED: "settled", CANCELLED: "closed",
  // Purchase unit + approval (shared values agree by design: the family is
  // what the row needs from the reader, not which enum it came from)
  PENDING: "attention", APPROVED: "settled", REJECTED: "fault",
  CLAIMED: "inflight", EXECUTED: "settled", EXECUTION_FAILED: "fault",
  // DeliveryStatus (Phase 8): DELIVERED landed, DEAD spent its budget,
  // RETRYING is failing but not finished.
  DELIVERED: "settled", DEAD: "fault", RETRYING: "attention",
  // Reservation
  ACTIVE: "inflight", FULFILLED: "settled", RELEASED: "closed", EXPIRED: "closed",
  // Microsoft 365 (lowercase, canonical four)
  pending: "attention", active: "settled", offboarding: "inflight", inactive: "closed",
};

/**
 * Namespaced lookups override the flat map where enum values collide across
 * entities. Employment ACTIVE is *settled* (person is in the right state);
 * reservation ACTIVE is *inflight* (someone owes an action). Entry criterion
 * #2 of the Phase 2 → 3 handoff.
 */
export type StatusNamespace = "employment";

const NAMESPACED: Record<StatusNamespace, Record<string, StatusFamily>> = {
  employment: { ACTIVE: "settled", OFFBOARDING: "inflight", OFFBOARDED: "closed" },
};

export function statusFamily(value: string, ns?: StatusNamespace): StatusFamily {
  if (ns) return Object.hasOwn(NAMESPACED[ns], value) ? NAMESPACED[ns][value] : "neutral";
  // Object.hasOwn: a client-defined status named "constructor" or "toString"
  // must map to neutral, not walk the prototype chain into a Function.
  return Object.hasOwn(MAP, value) ? MAP[value] : "neutral";
}

/** EXECUTION_FAILED must not look like REJECTED: dashed border + diamond mark. */
export function isSystemFailure(value: string): boolean {
  return value === "EXECUTION_FAILED";
}
