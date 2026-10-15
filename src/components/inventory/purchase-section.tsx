"use client";

import { useId, useState } from "react";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { EntityCombobox, type ComboOption } from "@/components/patterns/entity-combobox";
import { cn } from "@/lib/cn";
import {
  formatPeso, moneyToCentavos, purchaseTotal, WARRANTY_COVERED_BY, WARRANTY_COVERED_BY_LABEL, WARRANTY_LENGTHS,
} from "@/lib/purchase-summary";
import { DocumentSlots, slotCount, type SlotFiles } from "./document-slots";

const LENGTH_LABEL: Record<(typeof WARRANTY_LENGTHS)[number], string> = { 0: "None", 6: "6 mo", 12: "1 yr", 24: "2 yr", 36: "3 yr" };

/** The keys whose fields live inside this section — a refusal naming one opens it. */
export const PURCHASE_KEYS = [
  "vendorId", "purchasedAt", "requestId", "invoiceRef", "receiptRef", "cost", "fees",
  "warrantyUntil", "warrantyCoveredBy", "warrantyContact", "brand", "notes",
] as const;
/** The keys whose fields live in the "Notes" fold-out. */
const FOLD_KEYS = ["brand", "notes"] as const;

/** A typed amount as centavos for the live total; anything unreadable counts as nothing until it is fixed. */
const centavos = (text: string) => {
  const c = moneyToCentavos(text);
  return c === "bad" ? null : c;
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const fieldset = "flex min-w-0 flex-col gap-3 rounded-[12px] border border-border p-4";
const legend = "sec px-1";

/**
 * Phase 34 (spec §4.5): Purchase and warranty — optional, and closed until
 * opened. Closed, the header says what is filled in on one line. Open, four
 * boxes: the purchase, its cost with the live total (never stored), the
 * warranty, and the documents; then the "Tag prefix and notes" fold-out.
 * The section owns no state: the Register form keeps every value so that
 * "Register and add another" can decide what carries over.
 */
export function PurchaseSection(props: {
  open: boolean;
  onOpen: (v: boolean) => void;
  single: boolean;
  quantity: number;
  requests: Array<{ id: string; label: string; vendorId: string | null }>;
  requestId: string;
  onRequest: (id: string) => void;
  vendors: ComboOption[];
  recentVendors: string[];
  vendorId: string;
  onVendor: (id: string | null) => void;
  purchasedAt: string;
  onPurchased: (v: string) => void;
  invoiceRef: string;
  onInvoice: (v: string) => void;
  receiptRef: string;
  onReceipt: (v: string) => void;
  cost: string;
  onCost: (v: string) => void;
  /** Normalise a money field on blur (and on Enter). */
  onMoneyBlur: (key: "cost" | "fees") => void;
  fees: string;
  onFees: (v: string) => void;
  /** null until a length is chosen. */
  warrantyMonths: number | null;
  onWarrantyMonths: (m: number) => void;
  warrantyUntil: string;
  onWarrantyUntil: (v: string) => void;
  /** "Warranty until" was typed by hand: later date or length changes leave it. */
  warrantyManual: boolean;
  coveredBy: string;
  onCoveredBy: (v: string) => void;
  contact: string;
  onContact: (v: string) => void;
  /** Ruling R10: Brand has no home in the spec; it lives in the fold-out. */
  brand: string;
  onBrand: (v: string) => void;
  notes: string;
  onNotes: (v: string) => void;
  slots: SlotFiles;
  onSlots: (next: SlotFiles) => void;
  errors: Record<string, string>;
  disabled?: boolean;
}) {
  const {
    open, onOpen, single, quantity, errors,
  } = props;
  const base = useId();
  const titleId = `${base}-title`;
  const summaryId = `${base}-summary`;
  const bodyId = `${base}-body`;
  const lengthId = `${base}-length`;
  const [fold, setFold] = useState(false);
  const foldInvalid = FOLD_KEYS.some((k) => k in errors);

  const unit = centavos(props.cost);
  const fee = centavos(props.fees);
  const total = purchaseTotal(unit, quantity, fee);
  const files = slotCount(props.slots);
  const vendorName = props.vendors.find((v) => v.value === props.vendorId)?.label;

  const summary = [
    vendorName,
    total > 0 ? formatPeso(total) : null,
    props.warrantyUntil ? `warranty to ${props.warrantyUntil}` : null,
    files > 0 ? plural(files, "file", "files") : null,
  ].filter(Boolean).join(" · ");

  const moneyKeys = (key: "cost" | "fees") => (e: React.KeyboardEvent) => {
    if (e.key === "Enter") props.onMoneyBlur(key);
  };

  return (
    <section className="flex flex-col gap-4 border-t border-border pt-6">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        aria-labelledby={titleId}
        aria-describedby={!open && summary ? summaryId : undefined}
        onClick={() => onOpen(!open)}
        className="flex w-full items-center gap-3 rounded-(--radius-btn) text-left"
      >
        <span id={titleId} className="sec">Purchase and warranty</span>
        <span className="text-[11px] text-fg-muted">optional</span>
        {!open && summary && (
          <span id={summaryId} className="min-w-0 flex-1 truncate text-[12.5px] text-fg-secondary">{summary}</span>
        )}
        <svg
          aria-hidden viewBox="0 0 12 12" width={12} height={12} fill="none" stroke="currentColor" strokeWidth={1.5}
          className={cn("ml-auto shrink-0 text-fg-muted transition-transform", open && "rotate-180")}
        >
          <polyline points="2.5,4.5 6,8 9.5,4.5" />
        </svg>
      </button>

      {open && (
        <div id={bodyId} className="flex flex-col gap-[18px]">
          <div className="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-[18px]">
            <fieldset className={fieldset}>
              <legend className={legend}>Purchase</legend>
              <FormField label="Vendor" error={errors.vendorId}>
                {(p) => (
                  <EntityCombobox
                    id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                    options={props.vendors}
                    recent={props.recentVendors}
                    value={props.vendorId || null}
                    onChange={props.onVendor}
                    placeholder="Type a vendor name…"
                  />
                )}
              </FormField>
              <FormField label="Purchase date" error={errors.purchasedAt}>
                {(p) => (
                  <Input
                    id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                    type="date"
                    value={props.purchasedAt}
                    onChange={(e) => props.onPurchased(e.target.value)}
                  />
                )}
              </FormField>
              <FormField label="Purchase request" hint="Only if this delivery fulfils a completed request." error={errors.requestId}>
                {(p) => (
                  <Select
                    id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                    value={props.requestId}
                    onChange={(e) => props.onRequest(e.target.value)}
                  >
                    <option value="">—</option>
                    {props.requests.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                  </Select>
                )}
              </FormField>
              <FormField label="Invoice no." error={errors.invoiceRef}>
                {(p) => (
                  <Input
                    id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                    value={props.invoiceRef}
                    onChange={(e) => props.onInvoice(e.target.value)}
                    onBlur={(e) => props.onInvoice(e.target.value.trim())}
                  />
                )}
              </FormField>
              <FormField label="Official receipt (OR) no." error={errors.receiptRef}>
                {(p) => (
                  <Input
                    id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                    value={props.receiptRef}
                    onChange={(e) => props.onReceipt(e.target.value)}
                    onBlur={(e) => props.onReceipt(e.target.value.trim())}
                  />
                )}
              </FormField>
            </fieldset>

            <fieldset className={fieldset}>
              <legend className={legend}>Cost</legend>
              <FormField label={single ? "Cost (₱)" : "Cost per unit (₱)"} error={errors.cost}>
                {(p) => (
                  <Input
                    id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                    inputMode="decimal"
                    className="tabular-nums"
                    value={props.cost}
                    onChange={(e) => props.onCost(e.target.value)}
                    onBlur={() => props.onMoneyBlur("cost")}
                    onKeyDown={moneyKeys("cost")}
                  />
                )}
              </FormField>
              <FormField label="Delivery and fees (₱)" error={errors.fees}>
                {(p) => (
                  <Input
                    id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                    inputMode="decimal"
                    className="tabular-nums"
                    value={props.fees}
                    onChange={(e) => props.onFees(e.target.value)}
                    onBlur={() => props.onMoneyBlur("fees")}
                    onKeyDown={moneyKeys("fees")}
                  />
                )}
              </FormField>
              <dl className="flex flex-col gap-1.5 rounded-(--radius-card) bg-surface-subtle px-3 py-3 text-[12.5px] tabular-nums">
                <div className="flex justify-between gap-3 text-fg-secondary">
                  <dt>{quantity} × {formatPeso(unit ?? 0)}</dt>
                  <dd>{formatPeso((unit ?? 0) * quantity)}</dd>
                </div>
                <div className="flex justify-between gap-3 text-fg-secondary">
                  <dt>Delivery and fees</dt>
                  <dd>{formatPeso(fee ?? 0)}</dd>
                </div>
                <div className="mt-1 flex items-baseline justify-between gap-3 border-t border-border pt-2 text-fg">
                  <dt className="font-semibold">Total</dt>
                  <dd data-testid="purchase-total" className="text-[20px] font-bold">{formatPeso(total)}</dd>
                </div>
              </dl>
            </fieldset>

            <fieldset className={fieldset}>
              <legend className={legend}>Warranty</legend>
              <div className="flex flex-col gap-1.5">
                <span id={lengthId} className="text-xs font-medium text-fg">Length</span>
                <div role="group" aria-labelledby={lengthId} className="flex flex-wrap gap-1.5">
                  {WARRANTY_LENGTHS.map((m) => (
                    <button
                      key={m}
                      type="button"
                      aria-pressed={props.warrantyMonths === m}
                      onClick={() => props.onWarrantyMonths(m)}
                      className={cn(
                        "h-8 min-w-12 rounded-(--radius-btn) border px-2.5 text-[12.5px] font-medium",
                        props.warrantyMonths === m
                          ? "border-accent bg-accent-soft text-accent-soft-text"
                          : "border-border-strong bg-surface text-fg-secondary hover:bg-surface-subtle",
                      )}
                    >
                      {LENGTH_LABEL[m]}
                    </button>
                  ))}
                </div>
              </div>
              <FormField
                label="Warranty until"
                hint={props.warrantyManual
                  ? "Set by hand — a new purchase date leaves it; pick a length to follow it again."
                  : "Set by the length you pick; a date you type stays until you pick a length again."}
                error={errors.warrantyUntil}
              >
                {(p) => (
                  <Input
                    id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                    type="date"
                    value={props.warrantyUntil}
                    onChange={(e) => props.onWarrantyUntil(e.target.value)}
                  />
                )}
              </FormField>
              <FormField label="Covered by" error={errors.warrantyCoveredBy}>
                {(p) => (
                  <Select
                    id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                    value={props.coveredBy}
                    onChange={(e) => props.onCoveredBy(e.target.value)}
                  >
                    <option value="">—</option>
                    {WARRANTY_COVERED_BY.map((c) => <option key={c} value={c}>{WARRANTY_COVERED_BY_LABEL[c]}</option>)}
                  </Select>
                )}
              </FormField>
              <FormField label="Who to call for repairs" error={errors.warrantyContact}>
                {(p) => (
                  <Input
                    id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                    value={props.contact}
                    onChange={(e) => props.onContact(e.target.value)}
                    onBlur={(e) => props.onContact(e.target.value.trim())}
                  />
                )}
              </FormField>
            </fieldset>

            <fieldset className={fieldset}>
              <legend className={legend}>Documents</legend>
              <DocumentSlots slots={props.slots} onSlots={props.onSlots} single={single} disabled={props.disabled} />
            </fieldset>
          </div>

          <details
            open={fold || foldInvalid}
            onToggle={(e) => setFold(e.currentTarget.open)}
            className="rounded-[12px] border border-border px-4 py-3"
          >
            <summary className="cursor-pointer text-[12.5px] font-medium text-fg-secondary">Notes</summary>
            <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField label="Brand" error={errors.brand}>
                {(p) => (
                  <Input
                    id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                    value={props.brand}
                    onChange={(e) => props.onBrand(e.target.value)}
                    onBlur={(e) => props.onBrand(e.target.value.trim())}
                  />
                )}
              </FormField>
              <FormField label="Notes" error={errors.notes} className="sm:col-span-2">
                {(p) => (
                  <Textarea
                    id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                    value={props.notes}
                    onChange={(e) => props.onNotes(e.target.value)}
                    onBlur={(e) => props.onNotes(e.target.value.trim())}
                  />
                )}
              </FormField>
            </div>
          </details>
        </div>
      )}
    </section>
  );
}
