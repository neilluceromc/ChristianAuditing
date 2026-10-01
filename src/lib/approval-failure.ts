/**
 * Spec §4.1 (ruling R3): one plain sentence naming a known cause of a failed
 * execution, keyed on the worker's real guard phrases (src/worker/execute-approval.ts,
 * src/server/modules/lifecycle/apply.ts). Anything else gets no sentence — never a wrong one.
 */
export function failureCause(workerError: string | null): string | null {
  if (!workerError) return null;
  if (/OFFBOARDED/.test(workerError)) return "The target person is no longer active.";
  if (/reads \S+, payload expected/.test(workerError) || /reads \S+, not /.test(workerError)) {
    return "The asset's status changed since the request.";
  }
  if (/no longer held by|not held by anyone|is still assigned/.test(workerError)) {
    return "The asset's holder changed since the request.";
  }
  return null;
}
