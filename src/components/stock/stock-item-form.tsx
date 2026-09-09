"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { FormError, FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import type { ItemInput } from "@/lib/stock-schema";
import { createStockItem, updateStockItem } from "@/server/modules/stock/item-actions";
import { useStockRunner } from "./use-stock-runner";

export interface StockCategoryOption {
  id: string;
  name: string;
  prefix: string;
}

/** Numeric fields hold their raw text while typing (the `cost` pattern in register-form.tsx) and convert to numbers only at submit. */
interface FormState {
  categoryId: string;
  name: string;
  unit: string;
  packSize: string;
  reorderLevel: string;
  notes: string;
}

const EMPTY: FormState = { categoryId: "", name: "", unit: "", packSize: "", reorderLevel: "0", notes: "" };
const CLAIMED = ["categoryId", "name", "unit", "packSize", "reorderLevel", "notes"];

function toFormState(initial: ItemInput): FormState {
  return {
    categoryId: initial.categoryId,
    name: initial.name,
    unit: initial.unit,
    packSize: initial.packSize === null ? "" : String(initial.packSize),
    reorderLevel: String(initial.reorderLevel),
    notes: initial.notes,
  };
}

type Props =
  | { mode: "new"; categories: StockCategoryOption[]; units: string[] }
  | {
      mode: "edit";
      id: string;
      categories: StockCategoryOption[];
      units: string[];
      initial: ItemInput;
      hasMovements: boolean;
    };

export function StockItemForm(props: Props) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(props.mode === "edit" ? toFormState(props.initial) : EMPTY);
  const { pending, error, fieldErrors, retryAfter, setRetryAfter, run } = useStockRunner(CLAIMED);
  const categoryFieldId = useId();

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  const disabledCategory = props.mode === "edit" && props.hasMovements;

  function payload() {
    return {
      categoryId: form.categoryId,
      name: form.name,
      unit: form.unit,
      packSize: form.packSize.trim() === "" ? null : Number(form.packSize),
      reorderLevel: form.reorderLevel.trim() === "" ? 0 : Number(form.reorderLevel),
      notes: form.notes,
    };
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (props.mode === "new") {
      run(() => createStockItem(payload()), (data) => `Item ${data.code} created`, {
        refresh: false,
        onOk: (data) => router.push(`/stock/items/${data.id}`),
      });
    } else {
      run(() => updateStockItem({ id: props.id, ...payload() }), "Saved");
    }
  }

  return (
    <form onSubmit={submit} className="flex max-w-[640px] flex-col gap-4">
      {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
      {error && <Banner tone="fault" title={error} />}
      <Card>
        <CardHeader title="Item" />
        <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label htmlFor={categoryFieldId} className="text-xs font-medium text-fg">
              Category<span aria-hidden style={{ color: "var(--required-mark)" }}> *</span>
            </label>
            <Select
              id={categoryFieldId}
              aria-label="Category"
              invalid={!!fieldErrors.categoryId}
              disabled={disabledCategory}
              value={form.categoryId}
              onChange={(e) => set("categoryId", e.target.value)}
            >
              <option value="" disabled>Select a category</option>
              {props.categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name} ({c.prefix})</option>
              ))}
            </Select>
            {disabledCategory && (
              <p className="text-[11px] text-fg-muted">This code belongs to its category</p>
            )}
            <FormError>{fieldErrors.categoryId}</FormError>
          </div>
          <FormField label="Name" required error={fieldErrors.name}>
            {(p) => (
              <Input id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                value={form.name} onChange={(e) => set("name", e.target.value)} />
            )}
          </FormField>
          <FormField label="Unit" required error={fieldErrors.unit}>
            {(p) => (
              <>
                <Input id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid} list="stock-units"
                  value={form.unit} onChange={(e) => set("unit", e.target.value)} />
                <datalist id="stock-units">
                  {props.units.map((u) => <option key={u} value={u} />)}
                </datalist>
              </>
            )}
          </FormField>
          <FormField label="Pack size" hint="Blank means no pack — items are received one at a time" error={fieldErrors.packSize}>
            {(p) => (
              <Input id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                type="number" min={2} step={1}
                value={form.packSize} onChange={(e) => set("packSize", e.target.value)} />
            )}
          </FormField>
          <FormField label="Reorder level" error={fieldErrors.reorderLevel}>
            {(p) => (
              <Input id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                type="number" min={0} step={1}
                value={form.reorderLevel} onChange={(e) => set("reorderLevel", e.target.value)} />
            )}
          </FormField>
          <FormField label="Notes" error={fieldErrors.notes} className="sm:col-span-2">
            {(p) => (
              <Textarea id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                value={form.notes} onChange={(e) => set("notes", e.target.value)} />
            )}
          </FormField>
        </CardBody>
      </Card>
      <div>
        <Button type="submit" variant="primary" loading={pending}>
          {props.mode === "new" ? "Create item" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}
