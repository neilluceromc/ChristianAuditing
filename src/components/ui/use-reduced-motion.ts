"use client";

import { useSyncExternalStore } from "react";

/*
 * The person's reduced-motion setting, shared by the login room and Cris at Work (the Disposal page), so neither
 * pulls in the other's scene data just for this hook.
 */

const reducedQuery = "(prefers-reduced-motion: reduce)";
function subscribeReduced(cb: () => void) {
  const m = window.matchMedia(reducedQuery);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
}
const readReduced = () => window.matchMedia(reducedQuery).matches;
const no = () => false;

/** The person's reduced-motion setting (false on the server and during hydration). */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReduced, readReduced, no);
}
