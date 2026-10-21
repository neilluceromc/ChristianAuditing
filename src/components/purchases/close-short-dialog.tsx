"use client";

import { useEffect, useState } from "react";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { ReasonField } from "@/components/patterns/reason-field";
import { useFinanceRunner } from "@/components/finance/use-finance-runner";
import { PO_REASON_HINT } from "@/lib/po-send-back";
import { REASON_CHIPS } from "@/lib/reason-chips";
import { closeLineShort } from "@/server/modules/purchases/po-actions";

/**
 * Spec §4 (partial deliveries): the rest of a line will never arrive. Closing it short counts those units as done,
 * with a reason. The button sits on the line; the dialog asks how many and why.
 */
export function CloseShortButton({
  lineId, lineLabel, remaining,
}: { lineId: string; lineLabel: string; remaining: number }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="ghost" aria-label={`Close ${lineLabel} short`} onClick={() => setOpen(true)}>
        Close short
      </Button>
      <CloseShortDialog open={open} onClose={() => setOpen(false)} lineId={lineId} lineLabel={lineLabel} remaining={remaining} />
    </>
  );
}

export function CloseShortDialog({
  open, onClose, lineId, lineLabel, remaining,
}: { open: boolean; onClose: () => void; lineId: string; lineLabel: string; remaining: number }) {
  const { pending, error, fieldErrors, retryAfter, setRetryAfter, reset, run } = useFinanceRunner(["qty", "reason"]);
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (!open) return;
    reset();
    setQty(String(remaining));
    setReason("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function close() {
    run(
      () => closeLineShort({ lineId, qty: Number.parseInt(qty, 10) || 0, reason }),
      (d) => (d.remaining === 0 ? `${lineLabel} closed short — nothing left to register` : `${lineLabel} closed short — ${d.remaining} left to register`),
      { onOk: onClose },
    );
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Close ${lineLabel} short`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="danger" loading={pending} onClick={close}>Close short</Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-xs text-fg-muted">
          The units that will never arrive count as done, and the reason goes on the thread. {remaining} still to register.
        </p>
        {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
        {error && <Banner tone="fault" title={error} />}
        <FormField label="How many units" required error={fieldErrors.qty}>
          {(p) => (
            <Input
              id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
              type="number" min="1" max={remaining} step="1" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)}
            />
          )}
        </FormField>
        <ReasonField
          required error={fieldErrors.reason} value={reason} onChange={setReason}
          hint={PO_REASON_HINT} chips={REASON_CHIPS["po.close-short"]} disabled={pending}
        />
      </div>
    </Dialog>
  );
}
