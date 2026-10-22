"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import type { TotalKey } from "@/lib/po-totals";
import { Button } from "@/components/ui/button";
import { ButtonLink } from "@/components/ui/button-link";
import { FormError } from "@/components/ui/form-field";
import { Icon } from "@/components/ui/icon";
import { AffixInput, Eyebrow, FLAGGED_HINT, RING } from "./fields";
import type { ChecklistItem, TotalsStatus } from "./po-form-model";

/** The six ladder rows above TOTAL AMOUNT DUE, worded as on the invoice. */
const ROWS: ReadonlyArray<{ key: Exclude<TotalKey, "totalAmountDue">; label: string; note?: string }> = [
  { key: "totalSales", label: "Total sales", note: "(VAT inclusive)" },
  { key: "lessVat", label: "Less: VAT" },
  { key: "netOfVat", label: "Amount net of VAT" },
  { key: "discount", label: "Less: discount", note: "· if any" },
  { key: "amountDue", label: "Amount due" },
  { key: "addVat", label: "Add: VAT" },
];

const STATUS_TONE: Record<TotalsStatus, "neutral" | "settled" | "attention"> = {
  empty: "neutral", partial: "neutral", ok: "settled", off: "attention",
};

const clean = (v: string) => v.replace(/[^0-9.,]/g, "");

/**
 * A3's right-hand card: the invoice totals Purchasing types (nothing is computed — spec §2.9), amber where a figure
 * doesn't add up with what it expected, a status line, then "When you save", "Before you save" and the Save button.
 */
export function TotalsCard({
  totals, setTotal, problems, status, statusText, errors, flaggedTotals, whenYouSave, checklist, saveLabel, pending, onSave,
  cancelHref, reply, strict, className,
}: {
  totals: Record<TotalKey, string>;
  setTotal: (key: TotalKey, value: string) => void;
  problems: Partial<Record<TotalKey, string>>;
  status: TotalsStatus;
  statusText: string;
  errors: Record<string, string>;
  flaggedTotals: boolean;
  whenYouSave: [string, string];
  checklist: ChecklistItem[];
  saveLabel: string;
  pending: boolean;
  onSave: () => void;
  cancelHref: string;
  /** The sent-back reply ("What did you fix?") on an edit. */
  reply?: ReactNode;
  /** False on a legacy PO (spec §5b.3): the total amount due is optional there. */
  strict: boolean;
  className?: string;
}) {
  const tone = STATUS_TONE[status];
  const ring = flaggedTotals ? RING : undefined;
  const err = (k: TotalKey) => errors[`totals.${k}`];

  return (
    <aside aria-label="Invoice totals and save" className={cn("flex flex-col gap-3.5", className)}>
      <section
        id="po-totals" aria-labelledby="po-totals-h"
        className="flex scroll-mt-5 flex-col gap-3 rounded-(--radius-card) border border-border bg-surface px-4 pb-4 pt-[18px] shadow-card sm:px-5"
      >
        <div className="flex flex-col gap-0.5">
          <h2 id="po-totals-h" className="text-[15px] font-semibold leading-tight text-fg">Invoice totals</h2>
          <p className="text-xs text-fg-muted">Type each figure exactly as the invoice shows it.</p>
          {flaggedTotals && <p className="text-[11.5px] text-fg-muted">{FLAGGED_HINT}: the invoice totals.</p>}
        </div>

        <div className="flex flex-col border-t border-border-faint pt-2">
          {ROWS.map((r) => {
            const id = `po-total-${r.key}`;
            const problem = problems[r.key];
            const describedBy = err(r.key) ? `${id}-error` : problem ? `${id}-warn` : undefined;
            return (
              <div key={r.key} data-po-field={`totals.${r.key}`} className="flex flex-col py-[5px]">
                <div className="grid grid-cols-[minmax(0,1fr)_minmax(110px,150px)] items-center gap-3">
                  <label htmlFor={id} className="text-[13px] text-fg-secondary">
                    {r.label}{r.note && <span className="text-xs text-fg-faint"> {r.note}</span>}
                  </label>
                  <AffixInput
                    prefix="₱" id={id} aria-describedby={describedBy} invalid={!!err(r.key)} warn={!!problem}
                    boxClassName={cn("h-9", ring)} className="text-right tabular-nums" inputMode="decimal" placeholder="0.00"
                    value={totals[r.key]} onChange={(e) => setTotal(r.key, clean(e.target.value))}
                  />
                </div>
                {problem && !err(r.key) && (
                  <span id={`${id}-warn`} className="px-0.5 pt-1 text-right text-xs" style={{ color: "var(--st-attention-text)" }}>{problem}</span>
                )}
                <FormError id={`${id}-error`}>{err(r.key)}</FormError>
              </div>
            );
          })}
        </div>

        <div data-po-field="totals.totalAmountDue" className="flex flex-col gap-1 border-t-[1.5px] border-fg pt-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label htmlFor="po-total-totalAmountDue" className="text-[13px] font-semibold uppercase tracking-[0.02em] text-fg">
              Total amount due
              {strict
                ? <span aria-hidden style={{ color: "var(--required-mark)" }}> *</span>
                : <span className="font-normal normal-case tracking-normal text-fg-faint"> · optional</span>}
            </label>
            <AffixInput
              prefix="₱" id="po-total-totalAmountDue"
              aria-describedby={err("totalAmountDue") ? "po-total-totalAmountDue-error" : problems.totalAmountDue ? "po-total-totalAmountDue-warn" : undefined}
              invalid={!!err("totalAmountDue")} warn={!!problems.totalAmountDue}
              boxClassName={cn("h-11 w-[170px] max-w-full", ring)} className="text-right text-[17px] font-semibold tabular-nums"
              inputMode="decimal" placeholder="0.00" value={totals.totalAmountDue}
              onChange={(e) => setTotal("totalAmountDue", clean(e.target.value))}
            />
          </div>
          {problems.totalAmountDue && !err("totalAmountDue") && (
            <span id="po-total-totalAmountDue-warn" className="text-right text-xs" style={{ color: "var(--st-attention-text)" }}>{problems.totalAmountDue}</span>
          )}
          <FormError id="po-total-totalAmountDue-error">{err("totalAmountDue")}</FormError>
        </div>

        <div
          role="status"
          className="flex items-start gap-2.5 rounded-(--radius-card) border px-3 py-2.5"
          style={{ background: `var(--st-${tone}-bg)`, borderColor: `var(--st-${tone}-border)`, color: `var(--st-${tone}-text)` }}
        >
          <span aria-hidden="true" className="mt-px shrink-0">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16h.01" />
            </svg>
          </span>
          <span className="text-[12.5px] leading-[18px]">{statusText}</span>
        </div>

        <div className="flex flex-col gap-2.5 border-t border-border-faint pt-3">
          <Eyebrow>When you save</Eyebrow>
          <div className="flex items-start gap-2.5">
            <span aria-hidden="true" className="inline-flex size-[26px] shrink-0 items-center justify-center rounded-(--radius-btn) bg-accent-soft text-accent-soft-text">
              <Icon name="laptop" size={14} />
            </span>
            <span className="text-[13px] leading-[19px] text-fg-secondary">{whenYouSave[0]}</span>
          </div>
          <div className="flex items-start gap-2.5">
            <span aria-hidden="true" className="inline-flex size-[26px] shrink-0 items-center justify-center rounded-(--radius-btn)" style={{ background: "var(--st-settled-bg)", color: "var(--st-settled-text)" }}>
              <Icon name="approval" size={14} />
            </span>
            <span className="text-[13px] leading-[19px] text-fg-secondary">{whenYouSave[1]}</span>
          </div>
        </div>

        <div className="flex flex-col gap-2 border-t border-border-faint pt-3">
          <Eyebrow id="po-before-save">Before you save</Eyebrow>
          <ul aria-labelledby="po-before-save" className="flex flex-col gap-2">
            {checklist.map((c) => (
              <li key={c.label} className={cn("flex items-center gap-2 text-[13px]", c.done ? "text-fg-secondary" : "text-fg-muted")}>
                <span
                  aria-hidden="true"
                  className={cn(
                    "inline-flex size-4 shrink-0 items-center justify-center rounded-full border-[1.5px]",
                    c.done ? "border-[var(--st-settled-dot)] bg-[var(--st-settled-dot)] text-[var(--surface)]" : "border-border-strong bg-surface",
                  )}
                >
                  {c.done && (
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M5 12l5 5L20 7" />
                    </svg>
                  )}
                </span>
                {c.label}
                {c.optional && <span className="text-fg-faint"> · optional</span>}
                <span className="sr-only">{c.done ? " — done" : " — not yet"}</span>
              </li>
            ))}
          </ul>
        </div>

        {reply}

        <Button variant="primary" size="lg" className="w-full" loading={pending} onClick={onSave}>{saveLabel}</Button>
        <ButtonLink href={cancelHref} className="w-full">Cancel</ButtonLink>
      </section>
    </aside>
  );
}
