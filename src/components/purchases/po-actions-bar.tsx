"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { ButtonLink } from "@/components/ui/button-link";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { ReasonField } from "@/components/patterns/reason-field";
import type { PoControls } from "@/lib/po-controls";
import { PO_REASON_HINT } from "@/lib/po-send-back";
import { REASON_CHIPS } from "@/lib/reason-chips";
import { cancelPurchaseOrder } from "@/server/modules/purchases/po-actions";
import { FixPoDialog, type FixPoLine, type FixPoValues } from "./fix-po-dialog";
import { SendBackPoDialog } from "./send-back-po-dialog";

/**
 * The purchase order's buttons, shown per `poControls` (src/lib/po-controls.ts — the rules the server enforces; it
 * re-checks every one). Register only links to the register page. Close short sits on each line (CloseShortButton).
 */
export function PoActionsBar({
  po, controls, lines, vendors,
}: {
  po: FixPoValues;
  controls: PoControls;
  lines: FixPoLine[];
  vendors: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [cancelling, setCancelling] = useState(false);
  const [sendingBack, setSendingBack] = useState(false);
  const [fixing, setFixing] = useState(false);
  const [reason, setReason] = useState("");
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [retryAfter, setRetryAfter] = useState<number | null>(null);

  function cancel() {
    setError(null);
    setFieldError(undefined);
    startTransition(async () => {
      const res = await cancelPurchaseOrder({ id: po.id, reason });
      if (res.ok) {
        setCancelling(false);
        setReason("");
        toast(`${res.data.refNo} cancelled`, "settled");
        router.refresh();
      } else if (res.kind === "validation") setFieldError(res.fieldErrors?.reason ?? res.message);
      else if (res.kind === "rate_limited") setRetryAfter(res.retryAfterSec ?? 60);
      else {
        setCancelling(false);
        setError(res.message);
      }
    });
  }

  if (!controls.register && !controls.sendBack && !controls.fix && !controls.edit && !controls.cancel) return null;

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {controls.register && <ButtonLink href={`/purchases/${po.id}/register`} variant="primary">Register</ButtonLink>}
        {controls.sendBack && <Button variant="danger" onClick={() => setSendingBack(true)}>Send back to Purchasing</Button>}
        {controls.fix && <Button onClick={() => setFixing(true)}>Fix money details</Button>}
        {controls.edit && <ButtonLink href={`/purchases/${po.id}/edit`}>Edit</ButtonLink>}
        {controls.cancel && <Button variant="danger" onClick={() => setCancelling(true)}>Cancel purchase order</Button>}
      </div>
      {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
      {error && <Banner tone="fault" title={error} />}

      {controls.sendBack && (
        <SendBackPoDialog
          open={sendingBack} onClose={() => setSendingBack(false)} id={po.id} refNo={po.refNo} formV2={po.formV2} fees={po.fees}
        />
      )}
      {controls.fix && <FixPoDialog open={fixing} onClose={() => setFixing(false)} po={po} lines={lines} vendors={vendors} />}

      <Dialog
        open={cancelling}
        onClose={() => setCancelling(false)}
        title="Cancel purchase order"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCancelling(false)}>Keep it</Button>
            <Button variant="danger" loading={pending} onClick={cancel}>Cancel purchase order</Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <p className="text-xs text-fg-muted">Cancelling cannot be undone. Your reason is appended to the thread.</p>
          <ReasonField
            required error={fieldError} value={reason} onChange={setReason}
            hint={PO_REASON_HINT} chips={REASON_CHIPS["po.cancel"]} disabled={pending}
          />
        </div>
      </Dialog>
    </div>
  );
}
