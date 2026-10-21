/**
 * When the notification bell asks the server for its count (final review I4: every poll is a function call on Vercel
 * Hobby). Pure and time-injected, so the rules are unit-tested; the bell keeps the state in a ref and asks
 * `bellPollStep` on each event.
 *
 * - **interval** (every BELL_POLL_MS while the tab is visible): polls unless the person has been idle — no pointer or
 *   key input — for BELL_IDLE_MS, or a poll already ran within the last BELL_ROUTE_THROTTLE_MS.
 * - **input** (pointer or key): marks the person active; the first input after an idle spell polls at once (the
 *   count may have gone stale while polling was stopped).
 * - **focus** (the window gains focus, or the tab becomes visible again): marks the person active and polls, unless a
 *   poll ran in the last BELL_WAKE_DEDUPE_MS (focus and visibilitychange often fire together).
 * - **route** (a navigation): marks the person active and polls at most once per BELL_ROUTE_THROTTLE_MS.
 */

export const BELL_POLL_MS = 120_000;
export const BELL_IDLE_MS = 10 * 60_000;
export const BELL_ROUTE_THROTTLE_MS = 30_000;
export const BELL_WAKE_DEDUPE_MS = 5_000;

export type BellPollEvent = "interval" | "input" | "focus" | "route";

export interface BellPollState {
  /** When the count was last asked for (the layout's render counts as one). */
  lastPollAt: number;
  /** The person's last sign of life: pointer, key, focus or a navigation. */
  lastInputAt: number;
}

export function initialBellPollState(now: number): BellPollState {
  return { lastPollAt: now, lastInputAt: now };
}

export function isBellIdle(s: BellPollState, now: number): boolean {
  return now - s.lastInputAt >= BELL_IDLE_MS;
}

/** The next state, and whether to poll now. */
export function bellPollStep(s: BellPollState, event: BellPollEvent, now: number): { poll: boolean; state: BellPollState } {
  const sincePoll = now - s.lastPollAt;
  const polled = (state: BellPollState) => ({ poll: true, state: { ...state, lastPollAt: now } });
  switch (event) {
    case "interval":
      if (isBellIdle(s, now) || sincePoll < BELL_ROUTE_THROTTLE_MS) return { poll: false, state: s };
      return polled(s);
    case "input": {
      const active = { ...s, lastInputAt: now };
      return isBellIdle(s, now) ? polled(active) : { poll: false, state: active };
    }
    case "focus": {
      const active = { ...s, lastInputAt: now };
      return sincePoll < BELL_WAKE_DEDUPE_MS ? { poll: false, state: active } : polled(active);
    }
    case "route": {
      const active = { ...s, lastInputAt: now };
      return sincePoll < BELL_ROUTE_THROTTLE_MS ? { poll: false, state: active } : polled(active);
    }
  }
}
