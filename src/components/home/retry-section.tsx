"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

/**
 * There is no per-section refetch in RSC — the button re-runs the route, which
 * re-runs this section's loader. The label promises the effect, not the
 * mechanism, and the effect is exactly what happens.
 */
export function RetrySection({ label }: { label: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="sm"
      loading={pending}
      onClick={() => startTransition(() => router.refresh())}
      aria-label={`Retry ${label}`}
    >
      Retry this section
    </Button>
  );
}
