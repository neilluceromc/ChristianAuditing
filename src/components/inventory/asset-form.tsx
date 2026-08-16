"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Banner } from "@/components/ui/banner";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { EntityCombobox, type ComboOption } from "@/components/patterns/entity-combobox";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { CREATABLE_STATUSES, type CreatableStatus } from "@/lib/asset-rules";
import type { ActionResult } from "@/server/action-result";

export interface AssetFormInitial {
  tag: string;
  model: string;
  serial: string;
  categoryId: string;
  typeId: string;
  purchasedAt: string; // yyyy-mm-dd or ""
  cost: string;
  warrantyUntil: string;
  notes: string;
  vendorId: string;
  rmaRef: string;
  repairQuote: string;
}

export function AssetForm({
  mode,
  categories,
  types,
  employees,
  vendors = [],
  initial,
  action,
}: {
  mode: "new" | "edit";
  categories: Array<{ id: string; name: string }>;
  types: Array<{ id: string; name: string; categoryId: string }>;
  employees: ComboOption[];
  vendors?: Array<{ id: string; name: string }>;
  initial?: AssetFormInitial;
  action: (payload: Record<string, unknown>) => Promise<ActionResult<{ id: string }>>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState<AssetFormInitial>(
    initial ?? {
      tag: "", model: "", serial: "", categoryId: "", typeId: "", purchasedAt: "",
      cost: "", warrantyUntil: "", notes: "", vendorId: "", rmaRef: "", repairQuote: "",
    },
  );
  const [requestedStatus, setRequestedStatus] = useState<CreatableStatus>("SPARE");
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [assignReason, setAssignReason] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [conflictMsg, setConflictMsg] = useState<string | null>(null);
  const [retryAfter, setRetryAfter] = useState<number | null>(null);
  const [saved, setSaved] = useState(false);

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

  const typesForCategory = types.filter((t) => t.categoryId === form.categoryId);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});
    setConflictMsg(null);
    setRetryAfter(null);
    startTransition(async () => {
      const res = await action({
        ...form,
        requestedStatus: mode === "new" ? requestedStatus : undefined,
        assigneeId: mode === "new" ? (assigneeId ?? "") : undefined,
        assignReason: mode === "new" ? assignReason : undefined,
      });
      if (res.ok) {
        if (mode === "new") router.push(`/inventory/${res.data.id}`);
        else {
          setSaved(true);
          setTimeout(() => setSaved(false), 3000);
          router.refresh();
        }
      } else if (res.kind === "rate_limited") setRetryAfter(res.retryAfterSec ?? 60);
      else if (res.kind === "validation") {
        const fe = res.fieldErrors ?? {};
        setErrors(fe);
        // errors no FormField claims (_form/id) must not dead-end silently
        const unclaimed = fe._form ?? fe.id;
        if (unclaimed) setConflictMsg(unclaimed);
      }
      else setConflictMsg(res.message);
    });
  }

  const field = (
    label: string,
    key: keyof AssetFormInitial,
    opts: { required?: boolean; hint?: string; type?: string; disabled?: boolean; placeholder?: string } = {},
  ) => (
    <FormField label={label} required={opts.required} hint={opts.hint} error={errors[key]}>
      {(p) => (
        <Input
          id={p.id}
          aria-describedby={p["aria-describedby"]}
          invalid={p.invalid}
          type={opts.type ?? "text"}
          // every number field on this form is money — centavos must not stepMismatch
          step={opts.type === "number" ? "0.01" : undefined}
          min={opts.type === "number" ? "0" : undefined}
          inputMode={opts.type === "number" ? "decimal" : undefined}
          disabled={opts.disabled}
          placeholder={opts.placeholder}
          value={form[key]}
          onChange={(e) => set(key)(e.target.value)}
        />
      )}
    </FormField>
  );

  return (
    <form onSubmit={submit} className="flex max-w-[720px] flex-col gap-4">
      {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
      {conflictMsg && <Banner tone="fault" title={conflictMsg} />}

      <Card>
        <CardHeader title="Identity" />
        <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {field("Asset tag", "tag", {
            required: true,
            hint: mode === "edit" ? "Tags are permanent — they're printed labels." : "Format BR-XX-0000, as printed on the label.",
            disabled: mode === "edit",
            placeholder: "BR-LT-0201",
          })}
          {field("Model", "model", { required: true, placeholder: "ThinkPad T14 Gen 4" })}
          {field("Serial", "serial")}
          <FormField label="Category" required error={errors.categoryId}>
            {(p) => (
              <Select
                id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                value={form.categoryId}
                onChange={(e) => setForm((f) => ({ ...f, categoryId: e.target.value, typeId: "" }))}
              >
                <option value="">Pick a category…</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            )}
          </FormField>
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
          {field("Cost (₱)", "cost", { type: "number" })}
          {field("Warranty until", "warrantyUntil", { type: "date", hint: "Pre-filled at purchase + 12 months — adjust if the quote says otherwise." })}
          <FormField label="Notes" error={errors.notes} className="sm:col-span-2">
            {(p) => (
              <Textarea
                id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                value={form.notes}
                onChange={(e) => set("notes")(e.target.value)}
              />
            )}
          </FormField>
        </CardBody>
      </Card>

      {mode === "edit" && (
        <Card>
          <CardHeader title="Repair / RMA" />
          <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="Vendor" error={errors.vendorId}>
              {(p) => (
                <Select
                  id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                  value={form.vendorId}
                  onChange={(e) => setForm((f) => ({ ...f, vendorId: e.target.value }))}
                >
                  <option value="">—</option>
                  {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                </Select>
              )}
            </FormField>
            {field("RMA reference", "rmaRef")}
            {field("Repair quote (₱)", "repairQuote", { type: "number" })}
          </CardBody>
        </Card>
      )}

      {mode === "new" && (
        <Card>
          <CardHeader title="Initial state" />
          <CardBody className="flex flex-col gap-4">
            <SegmentedControl
              aria-label="Initial status"
              options={CREATABLE_STATUSES.map((s) => ({ value: s, label: s }))}
              value={requestedStatus}
              onChange={(v) => setRequestedStatus(v as CreatableStatus)}
            />
            {requestedStatus !== "SPARE" && (
              <>
                <p className="text-xs text-fg-muted">
                  Assignment routes through a <span className="font-mono">lifecycle.assign</span> approval —
                  the asset is registered as SPARE and flips once the request executes.
                </p>
                <FormField label="Assign to" required error={errors.assigneeId}>
                  {(p) => (
                    <EntityCombobox
                      id={p.id}
                      aria-describedby={p["aria-describedby"]}
                      invalid={p.invalid}
                      options={employees}
                      value={assigneeId}
                      onChange={setAssigneeId}
                      placeholder="Type a name or EMP number…"
                    />
                  )}
                </FormField>
                <FormField label="Reason" error={errors.assignReason}>
                  {(p) => (
                    <Textarea
                      id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                      value={assignReason}
                      onChange={(e) => setAssignReason(e.target.value)}
                    />
                  )}
                </FormField>
              </>
            )}
          </CardBody>
        </Card>
      )}

      <div className="flex items-center gap-3">
        <Button type="submit" variant="primary" loading={pending}>
          {mode === "new" ? "Register asset" : saved ? "✓ Saved" : "Save changes"}
        </Button>
        {saved && <span className="text-xs text-fg-muted">audit entry written</span>}
      </div>
    </form>
  );
}
