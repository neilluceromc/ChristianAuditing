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
  // Reservation
  ACTIVE: "inflight", FULFILLED: "settled", RELEASED: "closed", EXPIRED: "closed",
  // Microsoft 365 (lowercase, canonical four)
  pending: "attention", active: "settled", offboarding: "inflight", inactive: "closed",
};

export function statusFamily(value: string): StatusFamily {
  return MAP[value] ?? "neutral";
}

/** EXECUTION_FAILED must not look like REJECTED: dashed border + diamond mark. */
export function isSystemFailure(value: string): boolean {
  return value === "EXECUTION_FAILED";
}
