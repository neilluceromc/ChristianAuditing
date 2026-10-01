import { describe, expect, it } from "vitest";
import { failureCause } from "./approval-failure";

const PERSON = "The target person is no longer active.";
const STATUS = "The asset's status changed since the request.";
const HOLDER = "The asset's holder changed since the request.";

// The worker's real strings (execute-approval.ts, lifecycle/apply.ts, approval-execution.ts).
const CASES: Array<[string, string | null, string | null]> = [
  ["seeded APR-2025", "Execution guard: target employee EMP-0093 is OFFBOARDED — assignment refused", PERSON],
  ["change-status from mismatch", "Execution guard: BR-LT-0148 reads REPAIRING, payload expected DEPLOYED — refused", STATUS],
  ["assign from a non-assignable status", "Execution guard: BR-LT-0181 reads DEPLOYED, not SPARE — assignment refused", STATUS],
  ["return, holder changed", "Execution guard: BR-LT-0201 is no longer held by the expected employee — return refused", HOLDER],
  ["return, nobody holds it", "Execution guard: BR-LT-0201 is not held by anyone — return refused", HOLDER],
  ["change-status while assigned", "Execution guard: BR-LT-0201 is still assigned — request a lifecycle.return first, then change its status", HOLDER],
  ["malformed payload", 'Malformed lifecycle.change-status payload: expected to.status, got {"note":"x"}', null],
  ["invalid target status", "lifecycle.change-status target FOO is not a valid status for IT assets", null],
  ["assign target status", "lifecycle.assign target status for IT assets must be DEPLOYED or TEMPORARY, got SPARE", null],
  ["no asset", "Execution guard: approval has no asset attached — nothing to execute against", null],
  ["target employee gone", "Execution guard: target employee no longer exists — assignment refused", null],
  ["reserved", "Execution guard: BR-LT-0181 is reserved for EMP-0097 — release the hold first", null],
  ["no executor", "Execution guard: lifecycle.replace has no executor yet (arrives with its producing flow).", null],
  ["empty", "", null],
];

describe("failureCause", () => {
  it.each(CASES)("%s", (_name, error, want) => {
    expect(failureCause(error)).toBe(want);
  });
  it("null error → null", () => {
    expect(failureCause(null)).toBeNull();
  });
});
