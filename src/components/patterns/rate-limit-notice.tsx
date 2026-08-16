"use client";

import { useEffect, useState } from "react";
import { Banner } from "@/components/ui/banner";
import { ProgressBar } from "@/components/ui/progress-bar";

export function RateLimitNotice({
  retryAfterSec,
  onExpire,
}: {
  retryAfterSec: number;
  onExpire?: () => void;
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
    <Banner tone="attention" title="You've made 60 changes this minute — the cap">
      <p>Nothing was lost: this form still holds your input.</p>
      <div className="mt-2">
        <ProgressBar value={retryAfterSec - left} max={retryAfterSec} label="Seconds until retry" />
      </div>
      <p className="mt-1 font-mono text-[11px]">
        {left > 0 ? `you can retry in ${left}s` : "you can retry now"}
      </p>
    </Banner>
  );
}
