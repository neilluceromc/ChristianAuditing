"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { minutesLeftAt, type UndoBannerState } from "@/lib/finance-review-ui";
import { useFinanceUndo } from "./use-finance-undo";

/** How often the minutes left are read again. */
const TICK_MS = 30_000;

/**
 * Finance follow-up (spec §4): for 15 minutes after a review action, the person who did it sees "You approved this at
 * 10:42 · Undo (12 min left)" at the top of the asset's page. The page computes it on the server (`undoBanner`); the
 * minutes are re-read every 30 s here and the banner goes when they run out. The server re-checks every Undo, so the
 * countdown is only a hint. Not a live region: the minutes are not announced as they change.
 */
export function UndoBanner({ assetId, tag, state }: { assetId: string; tag: string; state: UndoBannerState }) {
  const { runUndo } = useFinanceUndo();
  const [left, setLeft] = useState(state.minutesLeft);
  const [pending, setPending] = useState(false);
  // The deadline on this device's clock: the server's time left from now, so a skewed clock does not move it.
  const deadline = useRef<number | null>(null);

  useEffect(() => {
    deadline.current = Date.now() + state.msLeft;
    setLeft(state.minutesLeft);
    const t = setInterval(() => setLeft(minutesLeftAt(deadline.current!, Date.now())), TICK_MS);
    return () => clearInterval(t);
  }, [state.msLeft, state.minutesLeft, state.endsAt]);

  if (left <= 0) return null;

  async function undo() {
    setPending(true);
    try {
      await runUndo({ assetId, tag, kind: state.kind });
    } finally {
      setPending(false);
    }
  }

  return (
    <div
      data-undo-banner=""
      className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-(--radius-card) border px-4 py-2.5 text-[13px] text-fg"
      style={{ background: "var(--st-neutral-bg)", borderColor: "var(--st-neutral-border)", borderLeft: "3px solid var(--st-neutral-dot)" }}
    >
      {/* the spaces keep the words apart in the text a screen reader or a test reads; flex ignores them on screen */}
      <span>{state.label}</span>{" "}
      <span aria-hidden="true">·</span>{" "}
      <Button size="sm" loading={pending} onClick={undo}>Undo</Button>{" "}
      <span className="text-fg-muted">({left} min left)</span>
    </div>
  );
}
