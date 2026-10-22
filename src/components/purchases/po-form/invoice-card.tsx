"use client";

import { cn } from "@/lib/cn";
import { Input } from "@/components/ui/input";
import { Radio } from "@/components/ui/radio";
import { FormError } from "@/components/ui/form-field";
import { EntityCombobox, type ComboOption } from "@/components/patterns/entity-combobox";
import { groupPickerOptions, type PickerGroup } from "@/lib/groups";
import { PAID_BY_LABEL } from "@/lib/po-flow";
import { AffixInput, Field, FLAGGED_HINT, RING, SectionCard } from "./fields";
import type { PaidByValue, PoDraft } from "./po-form-model";

type InvoiceKey = "poNumber" | "invoiceRef" | "purchasedAt" | "receiptRef" | "paidBy" | "departmentId";

const PAY: ReadonlyArray<{ value: PaidByValue; hint: string; card: string }> = [
  { value: "CREDIT_CARD", hint: "Shown as CC on most invoices", card: "var(--accent)" },
  { value: "DEBIT_CARD", hint: "Paid straight from the account", card: "var(--st-settled-dot)" },
];

const dot = (color: string) => <span aria-hidden="true" className="inline-block size-2 rounded-full" style={{ background: color }} />;

/**
 * A3's Invoice & payment card: the numbers that tie the order to the paperwork — PO number (the company's own),
 * SI number, invoice date, OR number, how it was paid (credit or debit card, nothing else) and the department.
 */
export function InvoiceCard({
  draft, set, errors, flagged, departments, keepDepartmentId, strict,
}: {
  draft: Pick<PoDraft, InvoiceKey>;
  set: (key: InvoiceKey, value: string) => void;
  errors: Record<string, string>;
  flagged: (key: string) => boolean;
  departments: PickerGroup[];
  keepDepartmentId?: string | null;
  /** False on a legacy PO (spec §5b.3): the PO number and paid by are optional there. */
  strict: boolean;
}) {
  const { internal, client } = groupPickerOptions(departments, keepDepartmentId);
  const deptOptions: ComboOption[] = [
    { value: "", label: "Not for one department", icon: dot("var(--border-strong)") },
    ...internal.map((g) => ({ value: g.id, label: g.name, group: "Internal departments", tag: "Internal", icon: dot("var(--st-settled-dot)") })),
    ...client.map((g) => ({ value: g.id, label: g.name, group: "Clients", tag: "Client", icon: dot("var(--accent)") })),
  ];

  return (
    <SectionCard id="po-invoice" icon="requests" title="Invoice & payment" sub="Numbers that tie this order to the paperwork.">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(210px,1fr))] gap-4 px-4 pb-5 pt-4 sm:gap-[18px] sm:px-5">
        <Field
          label="Purchase order number" required={strict} optional={!strict} error={errors.poNumber} flagged={flagged("poNumber")} mark="poNumber"
          hint="Your own number. It doesn't need to be on the invoice."
        >
          {(p) => (
            <AffixInput
              prefix="PO" id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
              boxClassName={cn(flagged("poNumber") && RING)} className="font-mono" maxLength={40}
              value={draft.poNumber} onChange={(e) => set("poNumber", e.target.value)} placeholder="2025-0418"
            />
          )}
        </Field>
        <Field label="SI number" required error={errors.invoiceRef} flagged={flagged("invoiceRef")} mark="invoiceRef" hint="Top right of the sales invoice.">
          {(p) => (
            <AffixInput
              prefix="№" id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
              boxClassName={cn(flagged("invoiceRef") && RING)} className="font-mono" maxLength={60}
              value={draft.invoiceRef} onChange={(e) => set("invoiceRef", e.target.value)} placeholder="44511"
            />
          )}
        </Field>
        <Field label="Invoice date" required error={errors.purchasedAt} flagged={flagged("purchasedAt")} mark="purchasedAt" hint="The date written on it, not today.">
          {(p) => (
            <Input
              id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid} className={cn(flagged("purchasedAt") && RING)}
              type="date" value={draft.purchasedAt} onChange={(e) => set("purchasedAt", e.target.value)}
            />
          )}
        </Field>
        <Field label="OR number" optional error={errors.receiptRef} flagged={flagged("receiptRef")} mark="receiptRef" hint="Add it later if the receipt hasn't come.">
          {(p) => (
            <Input
              id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid} className={cn("font-mono", flagged("receiptRef") && RING)}
              maxLength={60} value={draft.receiptRef} onChange={(e) => set("receiptRef", e.target.value)} placeholder="Official receipt"
            />
          )}
        </Field>

        <fieldset
          data-po-field="paidBy"
          className="col-span-full flex min-w-0 flex-col gap-1.5"
          aria-describedby={errors.paidBy ? "po-paid-by-error" : flagged("paidBy") ? "po-paid-by-hint" : undefined}
        >
          <legend className="mb-1.5 text-[13px] font-medium text-fg">
            Paid by
            {strict
              ? <span aria-hidden style={{ color: "var(--required-mark)" }}> *</span>
              : <span className="font-normal text-fg-faint"> · optional</span>}
          </legend>
          <div className="flex flex-wrap gap-2.5">
            {PAY.map((p) => (
              <label
                key={p.value}
                className={cn(
                  "flex min-w-[150px] flex-1 cursor-pointer items-center gap-3 rounded-(--radius-card) border border-border-strong bg-surface px-3.5 py-3",
                  "transition-[border-color,background,box-shadow] duration-(--dur-1) hover:border-fg-faint",
                  "has-[:checked]:border-accent has-[:checked]:bg-accent-tint has-[:focus-visible]:shadow-[0_0_0_3px_var(--focus-shadow)]",
                  flagged("paidBy") && RING,
                )}
              >
                <Radio name="paidBy" value={p.value} checked={draft.paidBy === p.value} onChange={() => set("paidBy", p.value)} />
                <span aria-hidden="true" className="relative h-6 w-[34px] shrink-0 overflow-hidden rounded-[5px]" style={{ background: p.card }}>
                  <span className="absolute inset-x-0 top-1.5 h-1 bg-black/35" />
                  <span className="absolute bottom-1 left-1 h-1 w-2.5 rounded-[1px] bg-white/70" />
                </span>
                <span className="flex flex-col leading-[18px]">
                  <span className="text-[13.5px] font-medium text-fg">{PAID_BY_LABEL[p.value]}</span>
                  <span className="text-xs text-fg-muted">{p.hint}</span>
                </span>
              </label>
            ))}
          </div>
          {flagged("paidBy") && !errors.paidBy && <p id="po-paid-by-hint" className="text-[11.5px] text-fg-muted">{FLAGGED_HINT}</p>}
          <FormError id="po-paid-by-error">{errors.paidBy}</FormError>
        </fieldset>

        <Field label="For department" optional error={errors.departmentId} className="col-span-full" mark="departmentId">
          {(p) => (
            <EntityCombobox
              id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
              options={deptOptions} value={draft.departmentId} onChange={(v) => set("departmentId", v ?? "")}
              placeholder="Not for one department"
            />
          )}
        </Field>
      </div>
    </SectionCard>
  );
}
