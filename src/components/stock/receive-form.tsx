"use client";

import { useState } from "react";
import Link from "next/link";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { EntityCombobox, type ComboOption } from "@/components/patterns/entity-combobox";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { packToUnits, unitsLabel } from "@/lib/stock-balance";
import { todayStr } from "@/lib/stock-schema";
import { receiveStock } from "@/server/modules/stock/movement-actions";
import { useStockRunner } from "./use-stock-runner";

/** R3: crosses from a server page as a plain object keyed by item id — never a Map. */
export interface StockItemMeta {
  unit: string;
  packSize: number | null;
  code: string;
}

export interface SupplierOption {
  id: string;
  name: string;
  archived: boolean;
}

const CLAIMED = ["itemId", "quantity", "packs", "supplierId", "lotDate", "reference", "unitCost", "occurredAt"];

interface FormState {
  itemId: string | null;
  quantity: string;
  packs: string;
  supplierId: string;
  lotDate: string;
  reference: string;
  unitCost: string;
  occurredAt: string;
}

function emptyForm(): FormState {
  const today = todayStr();
  return {
    itemId: null, quantity: "", packs: "", supplierId: "", lotDate: today, reference: "", unitCost: "", occurredAt: today,
  };
}

/** Spec §5.3, Task 5 Step 1. Packs is a convenience input over Quantity — changing it writes `packToUnits` into Quantity and shows the exact-copy helper text; Quantity itself stays directly editable. */
export function ReceiveForm({
  items,
  meta,
  suppliers,
  initialItemId,
}: {
  items: ComboOption[];
  meta: Record<string, StockItemMeta>;
  suppliers: SupplierOption[];
  initialItemId?: string | null;
}) {
  const [form, setForm] = useState<FormState>(() => ({
    ...emptyForm(),
    itemId: initialItemId && meta[initialItemId] ? initialItemId : null,
  }));
  const [notice, setNotice] = useState<{ itemId: string; message: string } | null>(null);
  const { pending, error, fieldErrors, retryAfter, setRetryAfter, run } = useStockRunner(CLAIMED);

  const selectedMeta = form.itemId ? meta[form.itemId] : null;

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function onItemChange(id: string | null) {
    // Packs cleared: a previous item's pack count means nothing for the new one's packSize (or lack of one).
    setForm((f) => ({ ...f, itemId: id, packs: "" }));
  }

  function onPacksChange(value: string) {
    setForm((f) => {
      const next = { ...f, packs: value };
      const packsNum = Number(value);
      if (selectedMeta?.packSize && value.trim() !== "" && Number.isInteger(packsNum) && packsNum > 0) {
        next.quantity = String(packToUnits(packsNum, selectedMeta.packSize));
      }
      return next;
    });
  }

  function payload() {
    return {
      itemId: form.itemId ?? "",
      quantity: form.quantity.trim() === "" ? 0 : Number(form.quantity),
      packs: form.packs.trim() === "" ? null : Number(form.packs),
      supplierId: form.supplierId,
      lotDate: form.lotDate,
      reference: form.reference,
      unitCost: form.unitCost.trim() === "" ? null : Number(form.unitCost),
      occurredAt: form.occurredAt,
    };
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const itemId = form.itemId;
    const itemMeta = itemId ? meta[itemId] : null;
    const qty = form.quantity.trim() === "" ? 0 : Number(form.quantity);
    const message = itemMeta ? `Received ${unitsLabel(qty, itemMeta.unit)} of ${itemMeta.code}` : "Receipt recorded";
    run(() => receiveStock(payload()), message, {
      onOk: () => {
        if (itemId) setNotice({ itemId, message });
        // Clear item/quantity/packs/reference/cost; keep the date and supplier for the next line.
        setForm((f) => ({ ...emptyForm(), supplierId: f.supplierId, lotDate: f.lotDate, occurredAt: f.occurredAt }));
      },
    });
  }

  const packsHelper =
    selectedMeta?.packSize && form.packs.trim() !== "" && Number.isInteger(Number(form.packs)) && Number(form.packs) > 0
      ? `${form.packs} packs × ${selectedMeta.packSize} = ${unitsLabel(packToUnits(Number(form.packs), selectedMeta.packSize), selectedMeta.unit)}`
      : undefined;

  return (
    <form onSubmit={submit} className="flex max-w-[640px] flex-col gap-4">
      {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
      {error && <Banner tone="fault" title={error} />}
      {notice && (
        <Banner tone="settled" title={notice.message}>
          <Link href={`/stock/items/${notice.itemId}`} className="text-accent hover:underline">View item</Link>
        </Banner>
      )}
      <Card>
        <CardHeader title="Receipt" />
        <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="Item" required error={fieldErrors.itemId} className="sm:col-span-2">
            {(p) => (
              <EntityCombobox
                id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                options={items} value={form.itemId} onChange={onItemChange}
                placeholder="Type a code or name…"
              />
            )}
          </FormField>
          <FormField label="Quantity" required error={fieldErrors.quantity}>
            {(p) => (
              <Input
                id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                type="number" min={1} step={1}
                value={form.quantity} onChange={(e) => set("quantity", e.target.value)}
              />
            )}
          </FormField>
          {selectedMeta?.packSize ? (
            <FormField label="Packs" hint={packsHelper} error={fieldErrors.packs}>
              {(p) => (
                <Input
                  id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                  type="number" min={1} step={1}
                  value={form.packs} onChange={(e) => onPacksChange(e.target.value)}
                />
              )}
            </FormField>
          ) : null}
          <FormField label="Supplier" error={fieldErrors.supplierId}>
            {(p) => (
              <Select
                id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                value={form.supplierId} onChange={(e) => set("supplierId", e.target.value)}
              >
                <option value="">No supplier</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </Select>
            )}
          </FormField>
          <FormField label="Lot date" error={fieldErrors.lotDate}>
            {(p) => (
              <Input
                id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                type="date" value={form.lotDate} onChange={(e) => set("lotDate", e.target.value)}
              />
            )}
          </FormField>
          <FormField label="Reference" error={fieldErrors.reference}>
            {(p) => (
              <Input
                id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                value={form.reference} onChange={(e) => set("reference", e.target.value)}
              />
            )}
          </FormField>
          <FormField label="Unit cost" error={fieldErrors.unitCost}>
            {(p) => (
              <Input
                id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                type="number" min={0} step={0.01}
                value={form.unitCost} onChange={(e) => set("unitCost", e.target.value)}
              />
            )}
          </FormField>
          <FormField label="Received on" error={fieldErrors.occurredAt}>
            {(p) => (
              <Input
                id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                type="date" max={todayStr()}
                value={form.occurredAt} onChange={(e) => set("occurredAt", e.target.value)}
              />
            )}
          </FormField>
        </CardBody>
      </Card>
      <div>
        <Button type="submit" variant="primary" loading={pending}>Record receipt</Button>
      </div>
    </form>
  );
}
