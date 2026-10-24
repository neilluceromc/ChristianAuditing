import { workUnitAsyncStorage } from "next/dist/server/app-render/work-unit-async-storage.external";
import { setForbiddenReasonProbe, type ForbiddenReason } from "@/server/action-result";

/**
 * Users & access (spec §4.3, Review Focus #2): why the guards refused THIS request, so the action's own bare
 * `forbidden()` can say "Choose your own password first" instead of the generic sentence.
 *
 * Keyed by Next's per-request work-unit store, the object a server action runs inside
 * (`executeActionAndPrepareForRender` → `workUnitAsyncStorage.run(requestStore, action)`); `cookies()` and
 * `headers()` read the same store. A WeakMap, so a mark is gone with its request and never leaks into another one.
 * Outside a request (tests, scripts) there is no store: nothing is marked and `forbidden()` keeps its default.
 */
const marks = new WeakMap<object, ForbiddenReason>();

function currentStore(): object | undefined {
  return workUnitAsyncStorage.getStore() ?? undefined;
}

export function markRefusal(reason: ForbiddenReason): void {
  const store = currentStore();
  if (store) marks.set(store, reason);
}

export function currentRefusal(): ForbiddenReason | null {
  const store = currentStore();
  return (store && marks.get(store)) ?? null;
}

setForbiddenReasonProbe(currentRefusal);
