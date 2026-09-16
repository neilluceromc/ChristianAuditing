"use client";

import { useState } from "react";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FormError } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { fmtMoneyExact } from "@/lib/format";
import { setLotCost } from "@/server/modules/stock/movement-actions";
import { useStockRunner } from "./use-stock-runner";

/**
 * Spec §4.3/§6.4: `setLotCost` refuses once a lot already has a cost, so the
 * trigger itself only renders while `lot.unitCost` is still null — once the
 * item page revalidates after a successful save, this component stops
 * rendering anything at all (Task 6's walk: "Set unit cost 9.00 once → the
 * trigger disappears"). Hooks are declared unconditionally above the early
 * return so the hook order never depends on `lot.unitCost`.
 */
export function SetCostDialog({
  lot,
}: {
  lot: { id: string; unitCost: number | null };
}) {
  const [open, setOpen] = useState(false);
  const [unitCost, setUnitCost] = useState("");
  const { pending, error, fieldErrors, retryAfter, setRetryAfter, reset, run } = useStockRunner(["unitCost"]);

  if (lot.unitCost !== null) return null;

  function openDialog() {
    reset();
    setUnitCost("");
    setOpen(true);
  }

  function submit() {
    const cost = Number(unitCost);
    const message = `Lot priced at ${fmtMoneyExact(cost)}`;
    run(
      () => setLotCost({ lotId: lot.id, unitCost: cost }),
      message,
      { onOk: () => setOpen(false) },
    );
  }

  return (
    <>
      <Button size="sm" onClick={openDialog}>Set unit cost</Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Set unit cost"
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" loading={pending} onClick={submit}>Save</Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
          {error && <Banner tone="fault" title={error} />}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-fg">Unit cost</label>
            <Input
              type="number"
              aria-label="Unit cost"
              invalid={!!fieldErrors.unitCost}
              min={0}
              step={0.01}
              value={unitCost}
              onChange={(e) => setUnitCost(e.target.value)}
            />
            <FormError>{fieldErrors.unitCost}</FormError>
          </div>
        </div>
      </Dialog>
    </>
  );
}
