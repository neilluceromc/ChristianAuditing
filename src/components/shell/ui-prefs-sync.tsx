"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { needsUiRestore } from "@/lib/ui-prefs";
import { restoreUiPrefs } from "@/server/ui-prefs";

/**
 * Phase 47 spec §5.4 (ruling): one mechanism for every way in (credentials, quick login, sign-up, bootstrap, Entra).
 * The app layout hands over the signed-in person's id and the `br.uid` cookie it read. When they differ, this
 * browser's settings cookies are nobody's or someone else's: restoreUiPrefs() rewrites all six from the person's
 * `ui:prefs` (or the defaults), the live html attributes follow at once, and the page refreshes to render from them.
 * Costs one refresh on the first page after a different person signs in here; renders nothing.
 */
export function UiPrefsSync({ userId, cookieUid }: { userId: string; cookieUid: string | undefined }) {
  const router = useRouter();
  // Once per person per mount: a failed restore is not retried in a loop.
  const tried = useRef<string | null>(null);
  useEffect(() => {
    if (!needsUiRestore(userId, cookieUid) || tried.current === userId) return;
    tried.current = userId;
    restoreUiPrefs()
      .then((prefs) => {
        if (!prefs) return;
        document.documentElement.dataset.theme = prefs.theme;
        document.documentElement.dataset.density = prefs.density;
        router.refresh();
      })
      .catch((err: unknown) => console.error("[ui-prefs] restore failed:", err));
  }, [userId, cookieUid, router]);
  return null;
}
