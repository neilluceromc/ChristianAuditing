"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

/**
 * Focus is a personal working mode, so it lives in a cookie, never the URL —
 * a shared link must not drag someone else into your collapsed view. Written
 * client-side like the theme and density toggles, then refreshed because the
 * page is server-rendered from that cookie.
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
        startTransition(() => router.refresh());
      }}
    >
      {on ? "Show everything" : "Focus"}
    </Button>
  );
}
