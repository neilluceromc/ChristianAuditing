"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { pushPath, readStack, writeStack } from "@/lib/nav-stack";

/** Phase 28: records every in-app route (path + query) this tab visits, for the Back control's "is there a previous page" test. */
export function NavigationTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const qs = searchParams.toString();
  useEffect(() => {
    const path = qs ? `${pathname}?${qs}` : pathname;
    writeStack(window.sessionStorage, pushPath(readStack(window.sessionStorage), path));
  }, [pathname, qs]);
  return null;
}
