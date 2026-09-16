"use client";

import { cloneElement, isValidElement, useState } from "react";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FormError } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { unitsLabel } from "@/lib/stock-balance";
import { writeOffLot } from "@/server/modules/stock/movement-actions";
import { useStockRunner } from "./use-stock-runner";

/**
 * Spec §6.4. Also imported directly by Task 7's expiry report (each row's
 * own Write off button), which is why `trigger` exists: with no trigger this
 * renders its own default `Button`; with one, the given node is cloned with
 * an `onClick` that opens this same dialog, so the report row's own styling
 * is preserved. Quantity defaults to (and maxes at) the lot's own remaining;
 * Reason is prefilled "Expired" for an already-expired lot, since that's the
 * overwhelmingly common reason to write one off.
 */
export function WriteOffDialog({
  lot,
  itemCode,
  unit,
  trigger,
}: {
  lot: { id: string; remaining: number; expired: boolean; reference: string | null };
  itemCode: string;
  unit: string;
  trigger?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [quantity, setQuantity] = useState(String(lot.remaining));
  const [reason, setReason] = useState(lot.expired ? "Expired" : "");
  const { pending, error, fieldErrors, retryAfter, setRetryAfter, reset, run } = useStockRunner(["quantity", "reason"]);

  function openDialog() {
    reset();
    setQuantity(String(lot.remaining));
    setReason(lot.expired ? "Expired" : "");
    setOpen(true);
  }

  function submit() {
    const qty = Number(quantity);
    const message = `Wrote off ${unitsLabel(qty, unit)} of ${itemCode}`;
    run(
      () => writeOffLot({ lotId: lot.id, quantity: qty, reason }),
      message,
      { onOk: () => setOpen(false) },
    );
  }

  return (
    <>
      {trigger ? (
        isValidElement(trigger)
          ? cloneElement(trigger as React.ReactElement<{ onClick?: () => void }>, { onClick: openDialog })
          : trigger
      ) : (
        <Button size="sm" onClick={openDialog}>Write off</Button>
      )}
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Write off lot"
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" loading={pending} onClick={submit}>Confirm</Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
          {error && <Banner tone="fault" title={error} />}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-fg">Quantity</label>
            <Input
              type="number"
              aria-label="Quantity"
              invalid={!!fieldErrors.quantity}
              min={1}
              max={lot.remaining}
              step={1}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
            <FormError>{fieldErrors.quantity}</FormError>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-fg">Reason</label>
            <Textarea
              aria-label="Reason"
              invalid={!!fieldErrors.reason}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <FormError>{fieldErrors.reason}</FormError>
          </div>
        </div>
      </Dialog>
    </>
  );
}
