"use client";

import { useState } from "react";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FormError } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { unitsLabel } from "@/lib/stock-balance";
import { adjustStock } from "@/server/modules/stock/movement-actions";
import { useStockRunner } from "./use-stock-runner";

type Mode = "set" | "delta";

/** Spec §5.3: the two adjustment shapes — "set" computes target - balance server-side, "delta" writes the signed change as-is. */
export function AdjustDialog({
  itemId,
  code,
  unit,
  balance,
}: {
  itemId: string;
  code: string;
  unit: string;
  balance: number;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("set");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const { pending, error, fieldErrors, retryAfter, setRetryAfter, reset, run } = useStockRunner(["quantity", "reason"]);

  function openDialog() {
    reset();
    setMode("set");
    setQuantity("");
    setReason("");
    setOpen(true);
  }

  function submit() {
    run(
      () => adjustStock({ itemId, mode, quantity: Number(quantity), reason }),
      "Adjustment posted",
      { onOk: () => setOpen(false) },
    );
  }

  return (
    <>
      <Button onClick={openDialog}>Adjust</Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={`Adjust ${code}`}
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" loading={pending} onClick={submit}>Post adjustment</Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <p className="text-xs text-fg-secondary">
            Current balance: <span className="font-mono text-fg">{unitsLabel(balance, unit)}</span>
          </p>
          {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
          {error && <Banner tone="fault" title={error} />}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-fg">Adjustment mode</label>
            <Select aria-label="Adjustment mode" value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
              <option value="set">Set balance to</option>
              <option value="delta">Change by</option>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-fg">Quantity</label>
            <Input
              type="number"
              aria-label="Quantity"
              invalid={!!fieldErrors.quantity}
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
