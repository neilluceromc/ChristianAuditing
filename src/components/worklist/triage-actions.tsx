"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ReasonField } from "@/components/patterns/reason-field";
import { chipsForTriage } from "@/lib/reason-chips";
import { TRIAGE_LABEL, TRIAGE_REASON_MESSAGE, triageReasonValid, type TriageOutcome } from "@/lib/lifecycle";

export type FinalOutcome = "DISPOSE" | "DONATED";
type QuickOutcome = "SPARE" | "DEFECTIVE";

/** The panel's tall buttons: 44 px targets (Global Constraints). */
export const PANEL_BUTTON = "h-11 w-full text-[13px] aria-disabled:cursor-default aria-disabled:opacity-55";

/**
 * While a decision runs, a panel button stays focusable — `aria-disabled`, not `disabled` — so focus never drops to
 * the page when the call starts (fix round 1, I1); the caller's handler is the guard (`unlessBusy`).
 */
export const busyProps = (busy: boolean) => (busy ? { "aria-disabled": true as const, "aria-busy": true as const } : {});
export const unlessBusy = (busy: boolean, run: () => void) => () => { if (!busy) run(); };

/** Dispose and Donate need a reason of 2+ characters (the rule triageAsset's schema applies); null when it is fine. */
export function reasonError(outcome: FinalOutcome, reason: string): string | null {
  return triageReasonValid(outcome, reason) ? null : TRIAGE_REASON_MESSAGE;
}

/**
 * Plan call 4, presentational: Keep as spare (the one primary), then Send to repair, Dispose and Donate. Choosing
 * Dispose or Donate swaps the buttons for an inline reason with Confirm and Cancel — Confirm is then the one primary.
 */
export function TriageButtons({
  tag, choice, reason, error, busy, onDecide, onChoose, onReason, onConfirm, reasonRef,
}: {
  tag: string;
  choice: FinalOutcome | null;
  reason: string;
  error: string | null;
  busy: boolean;
  onDecide: (o: QuickOutcome) => void;
  onChoose: (o: FinalOutcome | null) => void;
  onReason: (v: string) => void;
  onConfirm: () => void;
  reasonRef?: React.RefObject<HTMLTextAreaElement | null>;
}) {
  if (choice) {
    return (
      <div className="flex flex-col gap-2" role="group" aria-label={`${TRIAGE_LABEL[choice]} ${tag}`}>
        <ReasonField
          label="Reason" required rows={2} value={reason} onChange={onReason} chips={chipsForTriage(choice)}
          error={error ?? undefined} disabled={busy} inputRef={reasonRef}
        />
        <div className="grid grid-cols-2 gap-2">
          <Button variant="ghost" className={PANEL_BUTTON} {...busyProps(busy)} onClick={unlessBusy(busy, () => onChoose(null))}>Cancel</Button>
          <Button variant="primary" className={PANEL_BUTTON} {...busyProps(busy)} onClick={unlessBusy(busy, onConfirm)}>Confirm</Button>
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <Button variant="primary" className={PANEL_BUTTON} {...busyProps(busy)} onClick={unlessBusy(busy, () => onDecide("SPARE"))}>
        {TRIAGE_LABEL.SPARE}
      </Button>
      <div className="grid grid-cols-3 gap-2">
        <Button className={PANEL_BUTTON} {...busyProps(busy)} onClick={unlessBusy(busy, () => onDecide("DEFECTIVE"))}>{TRIAGE_LABEL.DEFECTIVE}</Button>
        <Button className={PANEL_BUTTON} {...busyProps(busy)} onClick={unlessBusy(busy, () => onChoose("DISPOSE"))}>{TRIAGE_LABEL.DISPOSE}</Button>
        <Button className={PANEL_BUTTON} {...busyProps(busy)} onClick={unlessBusy(busy, () => onChoose("DONATED"))}>{TRIAGE_LABEL.DONATED}</Button>
      </div>
    </div>
  );
}

/** The triage buttons with their own state; `decide` runs the server call (use-worklist-undo). Keyed by row. */
export function TriageActions({ tag, busy, decide }: {
  tag: string;
  busy: boolean;
  decide: (outcome: TriageOutcome, note?: string) => void;
}) {
  const [choice, setChoice] = useState<FinalOutcome | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  return (
    <TriageButtons
      tag={tag} choice={choice} reason={reason} error={error} busy={busy} reasonRef={reasonRef}
      onDecide={(o) => decide(o)}
      onChoose={(o) => {
        setChoice(o); setReason(""); setError(null);
        if (o) requestAnimationFrame(() => reasonRef.current?.focus());
      }}
      onReason={(v) => { setReason(v); if (error) setError(null); }}
      onConfirm={() => {
        if (!choice) return;
        const e = reasonError(choice, reason);
        setError(e);
        if (e) { reasonRef.current?.focus(); return; }
        decide(choice, reason);
      }}
    />
  );
}
