"use client";

import { useEffect } from "react";
import { clickGuardTarget, watchSamePageNav } from "@/lib/stuck-nav";

/**
 * Every link click that stays on this page and changes only the query (a filter chip, a sort header, a page link,
 * a sidebar view of the list you are on) gets the stuck-navigation fallback in `@/lib/stuck-nav`: if the soft
 * navigation hasn't committed in `STUCK_NAV_MS`, the target loads the ordinary way. Listens in the capture phase so
 * it sees the click before Next's Link (or any handler) acts on it; a handler that cancels the navigation without
 * navigating calls `cancelStuckNavWatch()`.
 */
export function StuckNavGuard() {
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const target = clickGuardTarget(e, window.location);
      if (target) watchSamePageNav(target);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);
  return null;
}
