"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { saveUiPref } from "@/server/ui-prefs";

/**
 * Focus is a personal working mode, so it lives in a cookie, never the URL —
 * a shared link must not drag someone else into your collapsed view. Written
 * client-side like the theme and density toggles, then refreshed because the
 * page is server-rendered from that cookie. Phase 47 spec §5.4: also saved to the
 * person's prefs, so it follows them rather than the browser.
 */
export function FocusToggle({ on }: { on: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="sm"
      loading={pending}
      aria-pressed={on}
      onClick={() => {
        document.cookie = `br.focus=${on ? "off" : "on"};path=/;max-age=31536000;samesite=lax`;
        void saveUiPref({ focus: !on }).catch(() => {});
        startTransition(() => router.refresh());
      }}
    >
      {on ? "Show everything" : "Focus"}
    </Button>
  );
}
