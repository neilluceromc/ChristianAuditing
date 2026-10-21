"use client";

import { useEffect, useState } from "react";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { ReasonField } from "@/components/patterns/reason-field";
import { FixPoDialog, type FixPoLine, type FixPoValues } from "@/components/purchases/fix-po-dialog";
import { EDIT_REASON } from "@/lib/intake-rules";
import { updateAsset } from "@/server/modules/inventory/actions";
import { useFinanceRunner } from "./use-finance-runner";

/** An asset's own money (one with no PO): what Finance can fix on it. */
export interface AssetMoney {
  id: string;
  tag: string;
  /** Pesos. */
  cost: number | null;
  vendorId: string | null;
  invoiceRef: string | null;
  receiptRef: string | null;
  /** YYYY-MM-DD */
  purchasedAt: string | null;
}

export type FixMoneyTarget =
  | { kind: "po"; po: FixPoValues; lines: FixPoLine[] }
  | { kind: "asset"; asset: AssetMoney };

const REASON_HINT = `Required: ${EDIT_REASON.min}–${EDIT_REASON.max} characters. It's kept with the change.`;
const CLAIMED = ["reason", "cost", "vendorId", "invoiceRef", "receiptRef", "purchasedAt"];

/**
 * Task 6 (spec §5, §6): Finance fixes money details itself, with a reason. Money lives on the PO, so an asset from a PO
 * is fixed on its PO (fixPurchaseOrder — the fix flows to every asset from it); an asset with no PO is fixed on the
 * asset (updateAsset). Either way only what changed is sent, and the change leaves a trace with the reason.
 */
export function FixMoneyButton({
  target, vendors, label = "Fix money details",
}: {
  target: FixMoneyTarget;
  vendors: Array<{ id: string; name: string }>;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>{label}</Button>
      {target.kind === "po"
        ? <FixPoDialog open={open} onClose={() => setOpen(false)} po={target.po} lines={target.lines} vendors={vendors} />
        : <AssetMoneyDialog open={open} onClose={() => setOpen(false)} asset={target.asset} vendors={vendors} />}
    </>
  );
}

function AssetMoneyDialog({
  open, onClose, asset, vendors,
}: {
  open: boolean;
  onClose: () => void;
  asset: AssetMoney;
  vendors: Array<{ id: string; name: string }>;
}) {
  const { pending, error, setError, fieldErrors, retryAfter, setRetryAfter, reset, run } = useFinanceRunner(CLAIMED);
  const [cost, setCost] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [invoiceRef, setInvoiceRef] = useState("");
  const [receiptRef, setReceiptRef] = useState("");
  const [purchasedAt, setPurchasedAt] = useState("");
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (!open) return;
    reset();
    setCost(asset.cost === null ? "" : String(asset.cost));
    setVendorId(asset.vendorId ?? "");
    setInvoiceRef(asset.invoiceRef ?? "");
    setReceiptRef(asset.receiptRef ?? "");
    setPurchasedAt(asset.purchasedAt ?? "");
    setReason("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function fix() {
    const patch: Record<string, unknown> = {};
    const was = asset.cost === null ? "" : String(asset.cost);
    if (cost.trim() !== was) patch.cost = cost.trim();
    if (vendorId !== (asset.vendorId ?? "")) patch.vendorId = vendorId;
    if (invoiceRef.trim() !== (asset.invoiceRef ?? "")) patch.invoiceRef = invoiceRef.trim();
    if (receiptRef.trim() !== (asset.receiptRef ?? "")) patch.receiptRef = receiptRef.trim();
    if (purchasedAt !== (asset.purchasedAt ?? "")) patch.purchasedAt = purchasedAt;
    if (Object.keys(patch).length === 0) return setError("Change at least one money detail.");
    run(
      () => updateAsset({ id: asset.id, ...patch, reason }),
      () => `${asset.tag}: fixed the money details`,
      { onOk: onClose },
    );
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Fix money details on ${asset.tag}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={pending} onClick={fix}>Save fix</Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-xs text-fg-muted">
          This asset has no purchase order, so its own money details are fixed here. Its history keeps what changed and why.
        </p>
        {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
        {error && <Banner tone="fault" title={error} />}
        <FormField label="Cost ₱" error={fieldErrors.cost}>
          {(p) => (
            <Input
              id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
              type="number" min="0" step="0.01" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)}
            />
          )}
        </FormField>
        <FormField label="Supplier" error={fieldErrors.vendorId}>
          {(p) => (
            <Select id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid} value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
              <option value="">No supplier</option>
              {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </Select>
          )}
        </FormField>
        <FormField label="SI number" error={fieldErrors.invoiceRef}>
          {(p) => <Input id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid} value={invoiceRef} onChange={(e) => setInvoiceRef(e.target.value)} />}
        </FormField>
        <FormField label="OR number" error={fieldErrors.receiptRef}>
          {(p) => <Input id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid} value={receiptRef} onChange={(e) => setReceiptRef(e.target.value)} />}
        </FormField>
        <FormField label="Purchase date" error={fieldErrors.purchasedAt}>
          {(p) => <Input id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid} type="date" value={purchasedAt} onChange={(e) => setPurchasedAt(e.target.value)} />}
        </FormField>
        <ReasonField required error={fieldErrors.reason} value={reason} onChange={setReason} hint={REASON_HINT} chips={[]} disabled={pending} />
      </div>
    </Dialog>
  );
}
