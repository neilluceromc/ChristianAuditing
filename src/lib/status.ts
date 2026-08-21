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
  // what the row needs from the reader, not which enum it came from).
  // PENDING and DEAD are ALSO JobStatus values (below) — this entry serves
  // both consumers, which is why it stays in the flat map rather than moving
  // into a namespace: a plain Job row has nowhere else to look it up.
  PENDING: "attention", APPROVED: "settled", REJECTED: "fault",
  CLAIMED: "inflight", EXECUTED: "settled", EXECUTION_FAILED: "fault",
  // JobStatus (Phase 8 worker): RUNNING is inflight (a worker holds the
  // lease right now), DONE is settled, DEAD is above (shared with
  // DeliveryStatus). FAILED is defined on the enum but never written by
  // src/worker/index.ts today — every failure either retries (PENDING) or
  // exhausts its budget (DEAD) — so this is a reserved-but-unused value
  // mapped defensively rather than a live code path.
  RUNNING: "inflight", DONE: "settled", FAILED: "fault", DEAD: "fault",
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
 *
 * `delivery` is DeliveryStatus's own namespace, not an alias of the flat
 * map's PENDING/DEAD: a queued delivery is `inflight` (the worker will pick
 * it up within its poll interval — nobody owes an action), which is a
 * different colour from the flat map's PENDING (`attention`, right for an
 * approval or purchase unit sitting in a person's queue). Reusing the flat
 * entry would have painted every freshly-seeded deliveries page amber with
 * no real signal in it — RETRYING is also amber, so colour alone couldn't
 * tell "queued and healthy" from "failing". DELIVERED and DEAD are read the
 * same way here as in the flat map; they're repeated so all four
 * DeliveryStatus values live together and a caller never has to guess which
 * one needs the namespace.
 */
export type StatusNamespace = "employment" | "delivery";

const NAMESPACED: Record<StatusNamespace, Record<string, StatusFamily>> = {
  employment: { ACTIVE: "settled", OFFBOARDING: "inflight", OFFBOARDED: "closed" },
  delivery: { PENDING: "inflight", RETRYING: "attention", DELIVERED: "settled", DEAD: "fault" },
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
