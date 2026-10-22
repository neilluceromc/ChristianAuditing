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
import { PAID_BY_LABEL } from "@/lib/po-flow";
import { PO_REASON_HINT } from "@/lib/po-send-back";
import { parseMoney, TOTAL_KEYS, TOTAL_LABEL, type TotalKey } from "@/lib/po-totals";
import { REASON_CHIPS } from "@/lib/reason-chips";
import { fixPurchaseOrder } from "@/server/modules/purchases/po-actions";

type PaidBy = keyof typeof PAID_BY_LABEL;

export interface FixPoValues {
  id: string;
  refNo: string;
  vendorId: string | null;
  invoiceRef: string | null;
  receiptRef: string | null;
  /** YYYY-MM-DD */
  purchasedAt: string | null;
  fees: number | null;
  /** Migration 39 (spec §5b.4): the PO number, how it was paid and the seven typed totals — money fields too. */
  poNumber: string | null;
  paidBy: PaidBy | null;
  totals: Record<TotalKey, number | null>;
  /** A PO from the new form: it has no fees field, so Fees shows only when an old value is there to fix. */
  formV2: boolean;
}

export interface FixPoLine {
  id: string;
  index: number;
  description: string;
  unitPrice: number | null;
}

/** What the dialog's fields hold, as typed. */
export interface FixPoForm {
  vendorId: string;
  poNumber: string;
  paidBy: PaidBy | "";
  invoiceRef: string;
  receiptRef: string;
  purchasedAt: string;
  fees: string;
  prices: Record<string, string>;
  totals: Record<TotalKey, string>;
}

/** The server's error keys this dialog shows under a field; any other goes to the banner. */
export const FIX_PO_CLAIMED = [
  "reason", "patch.vendorId", "patch.poNumber", "patch.invoiceRef", "patch.receiptRef", "patch.purchasedAt", "patch.paidBy",
  "patch.fees", ...TOTAL_KEYS.map((k) => `patch.${k}`),
];

const cents = (n: number) => Math.round(n * 100);

/** The dialog as it opens: each field showing the PO's own value. */
function formOf(po: FixPoValues, lines: FixPoLine[]): FixPoForm {
  return {
    vendorId: po.vendorId ?? "",
    poNumber: po.poNumber ?? "",
    paidBy: po.paidBy ?? "",
    invoiceRef: po.invoiceRef ?? "",
    receiptRef: po.receiptRef ?? "",
    purchasedAt: po.purchasedAt ?? "",
    fees: po.fees === null ? "" : String(po.fees),
    prices: Object.fromEntries(lines.map((l) => [l.id, l.unitPrice === null ? "" : String(l.unitPrice)])),
    totals: Object.fromEntries(TOTAL_KEYS.map((k) => [k, po.totals[k] === null ? "" : String(po.totals[k])])) as Record<TotalKey, string>,
  };
}

/**
 * Only what changed (fixPurchaseOrder's patch). A total is compared as an amount, so "₱9,100.00" is no change from
 * 9100; a cleared one is sent as null, and one that isn't an amount goes as typed so the server's words come back
 * under it. A PO number is trimmed and sent whenever it differs, even cleared (the server says it can't be).
 */
export function fixPoPatch(po: FixPoValues, lines: FixPoLine[], f: FixPoForm): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (f.vendorId && f.vendorId !== (po.vendorId ?? "")) patch.vendorId = f.vendorId;
  if (f.poNumber.trim() !== (po.poNumber ?? "")) patch.poNumber = f.poNumber.trim();
  if (f.invoiceRef.trim() !== (po.invoiceRef ?? "")) patch.invoiceRef = f.invoiceRef;
  if (f.receiptRef.trim() !== (po.receiptRef ?? "")) patch.receiptRef = f.receiptRef;
  if (f.purchasedAt && f.purchasedAt !== (po.purchasedAt ?? "")) patch.purchasedAt = f.purchasedAt;
  if (f.paidBy && f.paidBy !== (po.paidBy ?? "")) patch.paidBy = f.paidBy;
  if (f.fees.trim() !== (po.fees === null ? "" : String(po.fees))) patch.fees = f.fees.trim() === "" ? null : Number(f.fees);
  for (const k of TOTAL_KEYS) {
    const raw = (f.totals[k] ?? "").trim();
    const n = parseMoney(raw);
    const was = po.totals[k];
    if (n === null) {
      if (was !== null) patch[k] = null;
    } else if (!Number.isFinite(n) || was === null || cents(n) !== cents(was)) {
      patch[k] = raw;
    }
  }
  const changedLines = lines
    .filter((l) => {
      const raw = (f.prices[l.id] ?? "").trim();
      return raw !== "" && Number(raw) !== l.unitPrice;
    })
    .map((l) => ({ id: l.id, unitPrice: Number(f.prices[l.id]) }));
  if (changedLines.length) patch.lines = changedLines;
  return patch;
}

/**
 * Spec §2, §6: a fix to money that another team owns — IT while the PO is with IT, Finance once it is registered or
 * approved. Only what changed is sent, with a reason (5–300 characters); the fix flows to every asset from the PO and
 * leaves a trace on each, and Purchasing is told. Migration 39 (spec §5b.4): the PO number, paid by and each typed
 * total are fixed here too, under the same reason rule.
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
  const { pending, error, setError, fieldErrors, retryAfter, setRetryAfter, reset, run } = useFinanceRunner(FIX_PO_CLAIMED);
  const [form, setForm] = useState<FixPoForm>(() => formOf(po, lines));
  const [reason, setReason] = useState("");
  const set = <K extends keyof FixPoForm>(key: K, value: FixPoForm[K]) => setForm((f) => ({ ...f, [key]: value }));
  const setTotal = (key: TotalKey, value: string) => setForm((f) => ({ ...f, totals: { ...f.totals, [key]: value } }));
  const showFees = !po.formV2 || po.fees !== null;

  useEffect(() => {
    if (!open) return;
    reset();
    setForm(formOf(po, lines));
    setReason("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function fix() {
    const patch = fixPoPatch(po, lines, form);
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

        <FormField label="PO number" error={fieldErrors["patch.poNumber"]}>
          {(p) => (
            <Input
              id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid} maxLength={40}
              value={form.poNumber} onChange={(e) => set("poNumber", e.target.value)}
            />
          )}
        </FormField>
        <FormField label="Vendor" error={fieldErrors["patch.vendorId"]}>
          {(p) => (
            <Select id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid} value={form.vendorId} onChange={(e) => set("vendorId", e.target.value)}>
              {!po.vendorId && <option value="">No vendor</option>}
              {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </Select>
          )}
        </FormField>
        <FormField label="SI number" error={fieldErrors["patch.invoiceRef"]}>
          {(p) => <Input id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid} value={form.invoiceRef} onChange={(e) => set("invoiceRef", e.target.value)} />}
        </FormField>
        <FormField label="OR number" error={fieldErrors["patch.receiptRef"]}>
          {(p) => <Input id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid} value={form.receiptRef} onChange={(e) => set("receiptRef", e.target.value)} />}
        </FormField>
        <FormField label="Invoice date" error={fieldErrors["patch.purchasedAt"]}>
          {(p) => <Input id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid} type="date" value={form.purchasedAt} onChange={(e) => set("purchasedAt", e.target.value)} />}
        </FormField>
        <FormField label="Paid by" error={fieldErrors["patch.paidBy"]}>
          {(p) => (
            <Select
              id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
              value={form.paidBy} onChange={(e) => set("paidBy", e.target.value as PaidBy | "")}
            >
              {!po.paidBy && <option value="">Not recorded</option>}
              {(Object.keys(PAID_BY_LABEL) as PaidBy[]).map((k) => <option key={k} value={k}>{PAID_BY_LABEL[k]}</option>)}
            </Select>
          )}
        </FormField>
        {showFees && (
          <FormField label="Fees ₱" error={fieldErrors["patch.fees"]}>
            {(p) => (
              <Input
                id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                type="number" min="0" step="0.01" inputMode="decimal" value={form.fees} onChange={(e) => set("fees", e.target.value)}
              />
            )}
          </FormField>
        )}

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
                  value={form.prices[l.id] ?? ""} onChange={(e) => setForm((f) => ({ ...f, prices: { ...f.prices, [l.id]: e.target.value } }))}
                />
              </label>
            ))}
          </fieldset>
        )}

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-xs font-medium text-fg">Invoice totals ₱</legend>
          <p className="-mt-1 text-[11.5px] text-fg-muted">
            As the sales invoice shows them. Nothing is computed; the fix re-checks whether they add up.
          </p>
          {TOTAL_KEYS.map((k) => (
            <FormField key={k} label={TOTAL_LABEL[k]} error={fieldErrors[`patch.${k}`]}>
              {(p) => (
                <Input
                  id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                  inputMode="decimal" placeholder="0.00" className="text-right tabular-nums"
                  value={form.totals[k]} onChange={(e) => setTotal(k, e.target.value)}
                />
              )}
            </FormField>
          ))}
        </fieldset>

        <ReasonField
          required error={fieldErrors.reason} value={reason} onChange={setReason}
          hint={PO_REASON_HINT} chips={REASON_CHIPS["po.fix"]} disabled={pending}
        />
      </div>
    </Dialog>
  );
}
