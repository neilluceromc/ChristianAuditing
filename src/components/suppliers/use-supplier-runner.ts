"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";
import type { ActionResult } from "@/server/action-result";

/**
 * Shared action-result plumbing for the Suppliers area (mirrors
 * policy-editor.tsx's useRunner, one copy instead of one per file per the
 * task-4 brief). Every mutation returns the house ActionResult union:
 * rate_limited -> countdown, validation -> field errors (any key the caller
 * doesn't claim with a FormField falls back into the banner so it never
 * dead-ends silently), anything else (conflict/forbidden) -> banner.
 *
 * `refresh` defaults to true (`router.refresh()` after a successful
 * mutation); the one caller that navigates away instead (supplier-form's
 * create path) passes `refresh: false` so the soon-to-be-unmounted list page
 * isn't refetched for nothing.
 */
export function useSupplierRunner(claimedFieldKeys: string[] = []) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [retryAfter, setRetryAfter] = useState<number | null>(null);

  function run<T>(
    fn: () => Promise<ActionResult<T>>,
    okMsg: string,
    opts?: { onOk?: (data: T) => void; refresh?: boolean },
  ) {
    setError(null);
    setFieldErrors({});
    startTransition(async () => {
      const res = await fn();
      if (res.ok) {
        toast(okMsg, "settled");
        opts?.onOk?.(res.data);
        if (opts?.refresh ?? true) router.refresh();
      } else if (res.kind === "rate_limited") {
        setRetryAfter(res.retryAfterSec ?? 60);
      } else if (res.kind === "validation") {
        const errs = res.fieldErrors ?? {};
        setFieldErrors(errs);
        const unclaimed = Object.keys(errs).find((key) => !claimedFieldKeys.includes(key));
        if (unclaimed) setError(errs[unclaimed]);
      } else {
        setError(res.message);
      }
    });
  }

  /** Clears leftover error/field-error/retry state — call from a dialog's open-handler so a failed submit in one dialog never bleeds into another freshly opened one. */
  function reset() {
    setError(null);
    setFieldErrors({});
    setRetryAfter(null);
  }

  return { pending, error, setError, fieldErrors, setFieldErrors, retryAfter, setRetryAfter, reset, run };
}
