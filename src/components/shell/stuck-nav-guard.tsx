"use client";

import { useEffect } from "react";
import { clickGuardTarget, watchSamePageNav } from "@/lib/stuck-nav";

/**
 * Every link click that stays on this page and changes only the query (a filter chip, a sort header, a page link,
 * a sidebar view of the list you are on) gets the stuck-navigation fallback in `@/lib/stuck-nav`: if the soft
 * navigation hasn't committed in `STUCK_NAV_MS`, the target loads the ordinary way. Listens in the capture phase so
 * it sees the click before Next's Link (or any handler) acts on it. A handler that cancels the navigation without
 * navigating is safe on its own (no request for the target is ever recorded, so the fallback stands down), and the
 * known ones also call `cancelStuckNavWatch()`.
 */
export function StuckNavGuard() {
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const target = clickGuardTarget(e, window.location);
      if (target) watchSamePageNav(target);
    };
    // The fallback only fires when the browser recorded a request for the target (performance resource entries).
    // That buffer holds 250 entries by default and then silently stops recording, so keep it from filling up in
    // a long-lived tab; otherwise every later stuck navigation would be left stuck.
    const onBufferFull = () => window.performance.clearResourceTimings();
    document.addEventListener("click", onClick, true);
    window.performance.addEventListener?.("resourcetimingbufferfull", onBufferFull);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.performance.removeEventListener?.("resourcetimingbufferfull", onBufferFull);
    };
  }, []);
  return null;
}
