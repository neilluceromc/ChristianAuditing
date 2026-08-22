"use client";

import { useEffect, useState } from "react";
import { Banner } from "@/components/ui/banner";
import { ProgressBar } from "@/components/ui/progress-bar";

export function RateLimitNotice({
  retryAfterSec,
  onExpire,
  message,
}: {
  retryAfterSec: number;
  onExpire?: () => void;
  /**
   * Task 11 round two, V-3: an optional override for both sentences below.
   * Defaulted, so none of this component's ~30 other call sites (a shared
   * 60/min mutation cap, where the default text is true) change. Import's
   * two stages each carry their OWN real cap (60/min for the dry run, 10/min
   * for the write) and a true claim about what was or wasn't written — the
   * hardcoded "60 changes" and "this form still holds your input" are wrong
   * on both, which is exactly why `planAssetImport` and `applyAssetImport`
   * already build and return the right sentence via `rateLimited(...,
   * message)`. Before this prop existed, `res.message` was computed
   * server-side and then discarded on the way to the screen.
   */
  message?: string;
}) {
  const [left, setLeft] = useState(retryAfterSec);
  useEffect(() => {
    setLeft(retryAfterSec);
    const timer = setInterval(() => {
      setLeft((s) => {
        if (s <= 1) {
          clearInterval(timer);
          onExpire?.();
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryAfterSec]);

  return (
    <Banner tone="attention" title={message ?? "You've made 60 changes this minute — the cap"}>
      {!message && <p>Nothing was lost: this form still holds your input.</p>}
      <div className="mt-2">
        <ProgressBar value={retryAfterSec - left} max={retryAfterSec} label="Seconds until retry" />
      </div>
      <p className="mt-1 font-mono text-[11px]">
        {left > 0 ? `you can retry in ${left}s` : "you can retry now"}
      </p>
    </Banner>
  );
}
