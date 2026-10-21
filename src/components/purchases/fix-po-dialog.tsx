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
import { useFinanceRunner } from "@/components/finance/use-finance-runner";
import { PO_REASON_HINT } from "@/lib/po-send-back";
import { REASON_CHIPS } from "@/lib/reason-chips";
import { fixPurchaseOrder } from "@/server/modules/purchases/po-actions";

export interface FixPoValues {
  id: string;
  refNo: string;
  vendorId: string | null;
  invoiceRef: string | null;
  receiptRef: string | null;
  /** YYYY-MM-DD */
  purchasedAt: string | null;
  fees: number | null;
}

export interface FixPoLine {
  id: string;
  index: number;
  description: string;
  unitPrice: number | null;
}

const CLAIMED = ["reason", "patch.vendorId", "patch.invoiceRef", "patch.receiptRef", "patch.purchasedAt", "patch.fees"];

/**
 * Spec §2, §6: a fix to money that another team owns — IT while the PO is with IT, Finance once it is registered or
 * approved. Only what changed is sent, with a reason (5–300 characters); the fix flows to every asset from the PO and
 * leaves a trace on each, and Purchasing is told.
 */
export function FixPoDialog({
  open, onClose, po, lines, vendors,
}: {
  open: boolean;
  onClose: () => void;
  po: FixPoValues;
  lines: FixPoLine[];
  vendors: Array<{ id: string; name: string }>;
}) {
  const { pending, error, setError, fieldErrors, retryAfter, setRetryAfter, reset, run } = useFinanceRunner(CLAIMED);
  const [vendorId, setVendorId] = useState("");
  const [invoiceRef, setInvoiceRef] = useState("");
  const [receiptRef, setReceiptRef] = useState("");
  const [purchasedAt, setPurchasedAt] = useState("");
  const [fees, setFees] = useState("");
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (!open) return;
    reset();
    setVendorId(po.vendorId ?? "");
    setInvoiceRef(po.invoiceRef ?? "");
    setReceiptRef(po.receiptRef ?? "");
    setPurchasedAt(po.purchasedAt ?? "");
    setFees(po.fees === null ? "" : String(po.fees));
    setPrices(Object.fromEntries(lines.map((l) => [l.id, l.unitPrice === null ? "" : String(l.unitPrice)])));
    setReason("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function fix() {
    const patch: Record<string, unknown> = {};
    if (vendorId && vendorId !== (po.vendorId ?? "")) patch.vendorId = vendorId;
    if (invoiceRef.trim() !== (po.invoiceRef ?? "")) patch.invoiceRef = invoiceRef;
    if (receiptRef.trim() !== (po.receiptRef ?? "")) patch.receiptRef = receiptRef;
    if (purchasedAt && purchasedAt !== (po.purchasedAt ?? "")) patch.purchasedAt = purchasedAt;
    if (fees.trim() !== (po.fees === null ? "" : String(po.fees))) patch.fees = fees.trim() === "" ? null : Number(fees);
    const changedLines = lines
      .filter((l) => {
        const raw = (prices[l.id] ?? "").trim();
        return raw !== "" && Number(raw) !== l.unitPrice;
      })
      .map((l) => ({ id: l.id, unitPrice: Number(prices[l.id]) }));
    if (changedLines.length) patch.lines = changedLines;
    if (Object.keys(patch).length === 0) return setError("Change at least one money detail.");
    run(
      () => fixPurchaseOrder({ id: po.id, patch, reason }),
      (d) => `${po.refNo}: fixed the ${d.changed.length === 1 ? "detail" : "details"} and told Purchasing`,
      { onOk: onClose },
    );
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Fix money details on ${po.refNo}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={pending} onClick={fix}>Save fix</Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-xs text-fg-muted">
          The change flows to every asset from this order, and Purchasing is told what changed and why.
        </p>
        {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
        {error && <Banner tone="fault" title={error} />}

        <FormField label="Supplier" error={fieldErrors["patch.vendorId"]}>
          {(p) => (
            <Select id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid} value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
              {!po.vendorId && <option value="">No supplier</option>}
              {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </Select>
          )}
        </FormField>
        <FormField label="SI number" error={fieldErrors["patch.invoiceRef"]}>
          {(p) => <Input id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid} value={invoiceRef} onChange={(e) => setInvoiceRef(e.target.value)} />}
        </FormField>
        <FormField label="OR number" error={fieldErrors["patch.receiptRef"]}>
          {(p) => <Input id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid} value={receiptRef} onChange={(e) => setReceiptRef(e.target.value)} />}
        </FormField>
        <FormField label="Purchase date" error={fieldErrors["patch.purchasedAt"]}>
          {(p) => <Input id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid} type="date" value={purchasedAt} onChange={(e) => setPurchasedAt(e.target.value)} />}
        </FormField>
        <FormField label="Fees ₱" error={fieldErrors["patch.fees"]}>
          {(p) => (
            <Input
              id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
              type="number" min="0" step="0.01" inputMode="decimal" value={fees} onChange={(e) => setFees(e.target.value)}
            />
          )}
        </FormField>

        {lines.length > 0 && (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-xs font-medium text-fg">Unit prices ₱</legend>
            {lines.map((l) => (
              <label key={l.id} className="flex items-center gap-2 text-[12.5px] text-fg-secondary">
                <span className="min-w-0 flex-1 truncate" title={l.description}>
                  <span className="font-mono text-[10.5px] text-fg-muted">{String(l.index).padStart(2, "0")}</span> {l.description}
                </span>
                <Input
                  aria-label={`Unit price for line ${l.index}`} className="w-[120px]"
                  type="number" min="0" step="0.01" inputMode="decimal"
                  value={prices[l.id] ?? ""} onChange={(e) => setPrices((m) => ({ ...m, [l.id]: e.target.value }))}
                />
              </label>
            ))}
          </fieldset>
        )}

        <ReasonField
          required error={fieldErrors.reason} value={reason} onChange={setReason}
          hint={PO_REASON_HINT} chips={REASON_CHIPS["po.fix"]} disabled={pending}
        />
      </div>
    </Dialog>
  );
}
