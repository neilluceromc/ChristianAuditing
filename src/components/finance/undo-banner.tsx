"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { startUndoCountdown, type UndoBannerState } from "@/lib/finance-review-ui";
import { useFinanceUndo } from "./use-finance-undo";

/**
 * Finance follow-up (spec §4): for 15 minutes after a review action, the person who did it sees "You approved this at
 * 10:42 · Undo (12 min left)" at the top of the asset's page. The page computes it on the server (`undoBanner`); the
 * minutes are re-read every 30 s here and the banner goes exactly at the deadline. The server re-checks every Undo, so the
 * countdown is only a hint. Not a live region: the minutes are not announced as they change.
 */
export function UndoBanner({ assetId, tag, state }: { assetId: string; tag: string; state: UndoBannerState }) {
  const { runUndo } = useFinanceUndo();
  const [left, setLeft] = useState(state.minutesLeft);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    setLeft(state.minutesLeft);
    // The deadline on this device's clock: the server's time left from now, so a skewed clock does not move it.
    return startUndoCountdown(Date.now() + state.msLeft, setLeft);
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

/**
 * Task 6: the same banner for an action on more than one asset — a group's Approve all, a PO's send-back — whose
 * Undo the caller wires. `msLeft` and `endsAt` come from the server; the countdown runs on this device's clock.
 */
export function TimedUndoBanner({
  state, onUndo,
}: { state: { label: string; msLeft: number; endsAt: number }; onUndo: () => Promise<boolean> }) {
  const [left, setLeft] = useState(Math.max(1, Math.ceil(state.msLeft / 60_000)));
  const [pending, setPending] = useState(false);
  useEffect(() => startUndoCountdown(Date.now() + state.msLeft, setLeft), [state.msLeft, state.endsAt]);
  if (left <= 0) return null;
  async function undo() {
    setPending(true);
    try {
      await onUndo();
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
      <span>{state.label}</span>{" "}
      <span aria-hidden="true">·</span>{" "}
      <Button size="sm" loading={pending} onClick={undo}>Undo</Button>{" "}
      <span className="text-fg-muted">({left} min left)</span>
    </div>
  );
}
