"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Banner } from "@/components/ui/banner";
import { markLabelsPrinted } from "@/server/modules/inventory/label-actions";

/**
 * Phase 34 (spec §5): opens the browser print for the sheet. The waiting labels on it — the
 * queue's, and (ruling R26, M5) any still-waiting asset that came in through `?ids=` — are
 * stamped printed. Tags from the Reprint box are not sent (they were printed before); a reprint
 * never moves labelPrintedAt.
 *
 * Phase 40 (spec §2.6): the stamp waits for a person to say the sheet came out. A cancelled print
 * dialog and a jammed printer look the same to the page, so once the print dialog closes
 * (`afterprint`, or `print()` returning — Chromium's blocks until the dialog closes and a headless
 * one may never fire `afterprint`; the flag keeps the two paths from asking twice) a dialog asks
 * "Did the labels print correctly?". Only "Yes, mark printed" sends `markLabelsPrinted`, which stays
 * idempotent either way (Review Focus 5). No, Escape and the backdrop all keep them in the queue.
 * With nothing waiting on the sheet (a reprint) there is nothing to mark, so nothing is asked.
 *
 * Focus: the Dialog's trap hands focus back to this button on close. The button is never natively
 * `disabled` (an empty sheet uses `aria-disabled`), and the stamp's pending state lives on the
 * dialog's Yes button, so a sheet that empties after Yes never strands focus on <body>.
 */
export function PrintLabelsButton({ count, waitingAssetIds }: { count: number; waitingAssetIds: string[] }) {
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const yesRef = useRef<HTMLButtonElement>(null);
  const empty = count === 0;

  // A refused stamp re-enables Yes; put focus back on it (the spinner disabled it, which drops focus).
  useEffect(() => {
    if (confirming && error && !pending) yesRef.current?.focus();
  }, [confirming, error, pending]);

  function print() {
    if (empty) return;
    let done = false;
    const ask = () => {
      window.removeEventListener("afterprint", ask);
      if (done) return;
      done = true;
      if (waitingAssetIds.length) { setError(null); setConfirming(true); }
    };
    window.addEventListener("afterprint", ask);
    window.print();
    ask();
  }

  function keep() {
    if (pending) return;
    setConfirming(false);
  }

  function markPrinted() {
    setError(null);
    start(async () => {
      const res = await markLabelsPrinted({ assetIds: waitingAssetIds.slice(0, 200) });
      if (res.ok) setConfirming(false);
      else setError(res.message);
    });
  }

  return (
    <>
      <Button
        variant="primary"
        className="print:hidden aria-disabled:cursor-not-allowed aria-disabled:opacity-55"
        onClick={print}
        aria-disabled={empty || undefined}
      >
        {`Print ${count} label${count === 1 ? "" : "s"}`}
      </Button>
      <Dialog
        open={confirming}
        onClose={keep}
        title="Did the labels print correctly?"
        footer={
          <>
            <Button variant="ghost" onClick={keep} disabled={pending}>No, keep them in the queue</Button>
            <Button ref={yesRef} variant="primary" loading={pending} onClick={markPrinted}>Yes, mark printed</Button>
          </>
        }
      >
        <div className="flex flex-col gap-2">
          {error && <Banner tone="fault" title={error} />}
          <p>
            {waitingAssetIds.length === 1
              ? "Marked printed, the label leaves the waiting queue."
              : `Marked printed, the ${waitingAssetIds.length} labels leave the waiting queue.`}
          </p>
        </div>
      </Dialog>
    </>
  );
}
