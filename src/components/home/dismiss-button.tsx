"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { IconButton } from "@/components/ui/button";
import { dismissShiftRow } from "@/server/modules/home/actions";

/** Clears one row for the rest of the day — the count is a promise, not a feed. */
export function DismissButton({ shiftKey, title }: { shiftKey: string; title: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <IconButton
      aria-label={`Clear "${title}" for today`}
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await dismissShiftRow({ key: shiftKey });
          router.refresh();
        })
      }
    >
      ✓
    </IconButton>
  );
}
