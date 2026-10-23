import { workUnitAsyncStorage } from "next/dist/server/app-render/work-unit-async-storage.external";
import { unstable_update } from "./index";
import { signedSessionUpdate } from "./session-version";

export interface OwnSession {
  sessionVersion: number;
  mustChangePassword: boolean;
}

/**
 * Users & access (Task 5, found by e2e): after a person's own change committed with a bump (their own password, an
 * admin's own email), keep THIS device signed in. The signed update goes through Auth.js's server-side
 * `unstable_update`, which writes the new session cookie into the action's response.
 *
 * A server action that sets cookies is followed, in the same request, by a render of the page. That render's
 * `auth()` reads the request's Cookie header, which Next does not update after the action (request-store.js
 * `synchronizeMutableCookies` refreshes `cookies()` only: "TODO: does this need to update headers as well?"), so the
 * guards saw the token from before the bump and sent the person to /logout. So the values the new cookie now holds
 * are also marked on this request, and the guards read them for this account in this request only.
 *
 * Keyed by Next's per-request work-unit store, as refusal.ts is; a WeakMap, so a mark dies with its request. Outside a
 * request (tests, scripts) nothing is marked. Unlike refusal.ts the mark is written by the action and read by the
 * page's render, which Next bundles in different layers, each with its own copy of this module: the map therefore
 * lives on globalThis under a registered symbol, so both copies share it (measured: a module-level map was empty in
 * the render).
 */
const MARKS = Symbol.for("cris.own-session.marks");
const marks: WeakMap<object, Map<string, OwnSession>> = ((globalThis as { [MARKS]?: WeakMap<object, Map<string, OwnSession>> })[MARKS] ??=
  new WeakMap());

export async function refreshOwnSession(userId: string, sessionVersion: number, mustChangePassword: boolean): Promise<void> {
  // Auth.js types the update as a Partial<Session>; the jwt callback (config.edge.ts) reads this signed shape instead.
  const update = await signedSessionUpdate(userId, sessionVersion, mustChangePassword);
  await unstable_update(update as unknown as Parameters<typeof unstable_update>[0]);
  markOwnSessionRefreshed(userId, { sessionVersion, mustChangePassword });
}

/** Records that this request's response carries a new session cookie for `userId` with these values. */
export function markOwnSessionRefreshed(userId: string, values: OwnSession): void {
  const store = workUnitAsyncStorage.getStore();
  if (!store) return;
  const forRequest = marks.get(store) ?? new Map<string, OwnSession>();
  forRequest.set(userId, { ...values });
  marks.set(store, forRequest);
}

/** The values this request refreshed `userId`'s own session to, or null. */
export function refreshedOwnSession(userId: string): OwnSession | null {
  const store = workUnitAsyncStorage.getStore();
  return (store && marks.get(store)?.get(userId)) ?? null;
}
