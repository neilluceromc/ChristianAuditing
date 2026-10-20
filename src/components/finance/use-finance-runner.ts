"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";
import type { ActionResult } from "@/server/action-result";
import type { ToastSpec } from "@/lib/finance-review-ui";

/**
 * Phase 35: one runner for the Finance depreciation screens (same shape as use-employee-runner.ts).
 * rate_limited -> countdown, validation -> field errors (an unclaimed key falls back into the banner),
 * anything else -> banner.
 *
 * Finance follow-up (spec §4): the success toast is a message, or a message with a detail line and buttons (Undo,
 * Open <tag>) built by finance-review-ui.ts.
 */
export function useFinanceRunner(claimedFieldKeys: string[] = []) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [retryAfter, setRetryAfter] = useState<number | null>(null);

  function run<T>(
    fn: () => Promise<ActionResult<T>>,
    okMsg: string | ((data: T) => string | ToastSpec),
    opts?: { onOk?: (data: T) => void; refresh?: boolean },
  ) {
    setError(null);
    setFieldErrors({});
    startTransition(async () => {
      const res = await fn();
      if (res.ok) {
        const msg = typeof okMsg === "function" ? okMsg(res.data) : okMsg;
        if (typeof msg === "string") toast(msg, "settled");
        else toast(msg.message, "settled", { detail: msg.detail, actions: msg.actions });
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

  function reset() {
    setError(null);
    setFieldErrors({});
    setRetryAfter(null);
  }

  return { pending, error, setError, fieldErrors, setFieldErrors, retryAfter, setRetryAfter, reset, run };
}
