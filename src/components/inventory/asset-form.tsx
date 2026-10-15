"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { AssetClass } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Banner } from "@/components/ui/banner";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { useLeaveTo } from "@/components/ui/back-link";
import { EntityCombobox } from "@/components/patterns/entity-combobox";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import Link from "next/link";
import { categoryModelExample } from "@/lib/register-catalog";
import { fieldLabels } from "@/lib/registration";
import { WARRANTY_COVERED_BY, WARRANTY_COVERED_BY_LABEL } from "@/lib/purchase-summary";
import { MONEY_ERROR, normaliseCost } from "@/lib/register-input";
import type { ActionResult } from "@/server/action-result";

export interface AssetFormInitial {
  tag: string;
  model: string;
  brand: string;
  serial: string;
  categoryId: string;
  typeId: string;
  purchasedAt: string; // yyyy-mm-dd or ""
  cost: string;
  warrantyUntil: string;
  notes: string;
  vendorId: string;
  invoiceRef: string;
  rmaRef: string;
  repairQuote: string;
  receiptRef: string;
  warrantyCoveredBy: string; // "" | manufacturer | vendor | both
  warrantyContact: string;
}

type MoneyKey = "cost" | "repairQuote";
type TextKey = "model" | "brand" | "serial" | "invoiceRef" | "receiptRef" | "warrantyContact" | "rmaRef" | "notes";

/**
 * Phase 30 (spec §4.5): the record's Edit form — edit-only; registering goes
 * through the Register flow. A sticky bar carries Cancel · Save changes, and a
 * save toasts `{tag} saved` and returns to the record.
 */
export function AssetForm({
  assetId,
  categories,
  types,
  vendors = [],
  recentVendors,
  initial,
  action,
  flagged,
  flagNote,
}: {
  assetId: string;
  categories: Array<{ id: string; name: string; cls: AssetClass }>;
  types: Array<{ id: string; name: string; categoryId: string }>;
  vendors?: Array<{ id: string; name: string }>;
  recentVendors?: string[];
  initial: AssetFormInitial;
  action: (payload: Record<string, unknown>) => Promise<ActionResult<{ id: string }>>;
  /** Phase 35 (spec §3.5): the checklist keys Finance ticked when it sent this back (REGISTRATION_FIELDS keys). */
  flagged?: string[];
  /** Finance's note on that send-back. */
  flagNote?: string | null;
}) {
  const toast = useToast();
  // Save and Cancel leave the way Back does (review R9): a plain push would stack
  // record → edit → record, and the record's Back would land on this form.
  const leave = useLeaveTo();
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState<AssetFormInitial>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [conflictMsg, setConflictMsg] = useState<string | null>(null);
  const [retryAfter, setRetryAfter] = useState<number | null>(null);
  // Bumped once per refused submit. The focus effect below is keyed on this,
  // not on `errors` itself: the money fields also set and clear their error on
  // blur, and an effect keyed on `errors` would pull focus straight back into
  // the field the operator just tabbed out of.
  const [refusals, setRefusals] = useState(0);
  const rootRef = useRef<HTMLFormElement>(null);

  // Every field error renders in one pass; focus and scroll to the first
  // invalid field after a refused submit. An effect (not a microtask beside
  // the setState) because the refusal lands inside a transition, whose commit
  // comes after the microtask queue has already run.
  useEffect(() => {
    if (refusals === 0) return;
    const first = rootRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
    first?.focus();
    first?.scrollIntoView({ block: "center" });
  }, [refusals]);

  const clearError = (key: string) =>
    setErrors((e) => {
      if (!(key in e)) return e;
      const next = { ...e };
      delete next[key];
      return next;
    });

  const set = (key: keyof AssetFormInitial) => (value: string) => {
    setForm((f) => {
      const next = { ...f, [key]: value };
      // Derived, pre-filled, never blank: purchase date suggests +12 mo warranty.
      if (key === "purchasedAt" && value && !f.warrantyUntil) {
        const d = new Date(`${value}T00:00:00Z`);
        d.setUTCFullYear(d.getUTCFullYear() + 1);
        next.warrantyUntil = d.toISOString().slice(0, 10);
      }
      return next;
    });
  };

  const trim = (key: TextKey) => () => setForm((f) => ({ ...f, [key]: f[key].trim() }));

  // "₱12,500.50" becomes "12500.50" on blur; anything that is not an amount
  // keeps what was typed and says why, rather than being silently blanked.
  const normaliseMoney = (key: MoneyKey) => () => {
    const r = normaliseCost(form[key]);
    if (r.ok) {
      setForm((f) => ({ ...f, [key]: r.value }));
      clearError(key);
    } else setErrors((e) => ({ ...e, [key]: MONEY_ERROR }));
  };

  const typesForCategory = types.filter((t) => t.categoryId === form.categoryId);
  const cls: AssetClass = categories.find((c) => c.id === form.categoryId)?.cls ?? categories[0]?.cls ?? "IT";

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setConflictMsg(null);
    setRetryAfter(null);
    // Client checks set every error at once; the server's own refusals merge
    // in the same way below.
    const cost = normaliseCost(form.cost);
    const repairQuote = normaliseCost(form.repairQuote);
    const found: Record<string, string> = {};
    if (form.model.trim().length < 2) found.model = "Name the model";
    if (!form.categoryId) found.categoryId = "Pick a category";
    if (!cost.ok) found.cost = MONEY_ERROR;
    if (!repairQuote.ok) found.repairQuote = MONEY_ERROR;
    if (Object.keys(found).length > 0) {
      setErrors(found);
      setRefusals((n) => n + 1);
      return;
    }
    setErrors({});
    const payload = {
      ...form,
      cost: cost.ok ? cost.value : form.cost,
      repairQuote: repairQuote.ok ? repairQuote.value : form.repairQuote,
    };
    startTransition(async () => {
      const res = await action(payload);
      if (res.ok) {
        toast(`${initial.tag} saved`, "settled");
        leave(`/inventory/${res.data.id}`);
      } else if (res.kind === "rate_limited") setRetryAfter(res.retryAfterSec ?? 60);
      else if (res.kind === "validation") {
        const fe = res.fieldErrors ?? {};
        setErrors(fe);
        setRefusals((n) => n + 1);
        // errors no FormField claims (_form/id) must not dead-end silently
        const unclaimed = fe._form ?? fe.id;
        if (unclaimed) setConflictMsg(unclaimed);
      }
      else setConflictMsg(res.message);
    });
  }

  // Finance's send-back (spec §3.5): a flagged field is ringed and its hint says so.
  const isFlagged = (key: string) => !!flagged?.includes(key);
  const flagHint = (key: string, hint?: string) => (isFlagged(key) ? (hint ? `Finance flagged this \u00b7 ${hint}` : "Finance flagged this") : hint);
  const flag = (key: string, node: React.ReactNode) =>
    isFlagged(key) ? (
      <div key={key} data-flagged className="rounded-(--radius-ctl) p-2 ring-2 ring-[var(--st-attention-border)]">{node}</div>
    ) : node;
  const flaggedDocs = (flagged ?? []).some((k) => k.startsWith("doc:"));

  const field = (
    label: string,
    key: keyof AssetFormInitial,
    opts: {
      required?: boolean;
      hint?: string;
      type?: string;
      inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
      disabled?: boolean;
      placeholder?: string;
      onBlur?: () => void;
      autoFocus?: boolean;
    } = {},
  ) => flag(key, (
    <FormField label={label} required={opts.required} hint={flagHint(key, opts.hint)} error={errors[key]}>
      {(p) => (
        <Input
          id={p.id}
          aria-describedby={p["aria-describedby"]}
          invalid={p.invalid}
          type={opts.type ?? "text"}
          inputMode={opts.inputMode}
          disabled={opts.disabled}
          placeholder={opts.placeholder}
          autoFocus={opts.autoFocus}
          value={form[key]}
          onChange={(e) => set(key)(e.target.value)}
          onBlur={opts.onBlur}
        />
      )}
    </FormField>
  ));

  return (
    <form ref={rootRef} onSubmit={submit} className="flex max-w-[720px] flex-col gap-4">
      {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
      {conflictMsg && <Banner tone="fault" title={conflictMsg} />}
      {(!!flagged?.length || !!flagNote) && (
        <Banner tone="attention" title="Finance sent this back">
          {!!flagged?.length && <p>{fieldLabels(flagged).join(", ")}</p>}
          {flagNote && <p className="mt-1">{`\u201c${flagNote}\u201d`}</p>}
          {flaggedDocs && (
            <p className="mt-1">
              <Link href={`/inventory/${assetId}/documents`} className="underline">Upload documents on the record &rarr;</Link>
            </p>
          )}
        </Banner>
      )}

      <Card>
        <CardHeader title="Identity" />
        <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {field("Asset tag", "tag", {
            required: true,
            hint: "Tags are permanent — they're printed labels.",
            disabled: true,
          })}
          {field("Model", "model", {
            required: true, placeholder: categoryModelExample(categories.find((c) => c.id === form.categoryId)?.name, cls), autoFocus: true, onBlur: trim("model"),
          })}
          {field("Brand", "brand", { onBlur: trim("brand") })}
          {field("Serial", "serial", { onBlur: trim("serial") })}
          {flag("categoryId", <FormField label="Category" required hint={flagHint("categoryId")} error={errors.categoryId}>
            {(p) => (
              <Select
                id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                value={form.categoryId}
                onChange={(e) => {
                  const categoryId = e.target.value;
                  setForm((f) => ({ ...f, categoryId, typeId: "" }));
                }}
              >
                <option value="">Pick a category…</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            )}
          </FormField>)}
          <FormField label="Type" hint="Types drive loadout-slot matching." error={errors.typeId}>
            {(p) => (
              <Select
                id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                value={form.typeId}
                disabled={!form.categoryId}
                onChange={(e) => setForm((f) => ({ ...f, typeId: e.target.value }))}
              >
                <option value="">—</option>
                {typesForCategory.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </Select>
            )}
          </FormField>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Procurement" />
        <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {field("Purchased", "purchasedAt", { type: "date" })}
          {field("Cost (₱)", "cost", { inputMode: "decimal", onBlur: normaliseMoney("cost") })}
          {flag("vendorId", <FormField label="Vendor" hint={flagHint("vendorId")} error={errors.vendorId}>
            {(p) => (
              <EntityCombobox id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                options={vendors.map((v) => ({ value: v.id, label: v.name }))} recent={recentVendors}
                value={form.vendorId || null} onChange={(id) => setForm((f) => ({ ...f, vendorId: id ?? "" }))}
                placeholder="Type a vendor name…" />
            )}
          </FormField>)}
          {field("Invoice no.", "invoiceRef", { onBlur: trim("invoiceRef") })}
          {field("Official receipt (OR) no.", "receiptRef", { onBlur: trim("receiptRef") })}
          <FormField label="Notes" error={errors.notes} className="sm:col-span-2">
            {(p) => (
              <Textarea
                id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                value={form.notes}
                onChange={(e) => set("notes")(e.target.value)}
                onBlur={trim("notes")}
              />
            )}
          </FormField>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Warranty" />
        <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {field("Warranty until", "warrantyUntil", { type: "date", hint: "Pre-filled at purchase + 12 months — adjust if the quote says otherwise." })}
          {flag("warrantyCoveredBy", <FormField label="Covered by" hint={flagHint("warrantyCoveredBy")} error={errors.warrantyCoveredBy}>
            {(p) => (
              <Select
                id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                value={form.warrantyCoveredBy}
                onChange={(e) => set("warrantyCoveredBy")(e.target.value)}
              >
                <option value="">—</option>
                {WARRANTY_COVERED_BY.map((c) => <option key={c} value={c}>{WARRANTY_COVERED_BY_LABEL[c]}</option>)}
              </Select>
            )}
          </FormField>)}
          {field("Who to call for repairs", "warrantyContact", { onBlur: trim("warrantyContact") })}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Repair / RMA" />
        <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {field("RMA reference", "rmaRef", { onBlur: trim("rmaRef") })}
          {field("Repair quote (₱)", "repairQuote", { inputMode: "decimal", onBlur: normaliseMoney("repairQuote") })}
        </CardBody>
      </Card>

      <div className="sticky bottom-0 z-10 -mx-1 flex items-center gap-3 border-t border-border bg-surface px-1 py-3">
        <Button type="button" variant="ghost" disabled={pending} onClick={() => leave(`/inventory/${assetId}`)}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={pending}>Save changes</Button>
      </div>
    </form>
  );
}
