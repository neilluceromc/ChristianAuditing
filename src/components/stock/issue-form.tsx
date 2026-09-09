"use client";

import { useState } from "react";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { EntityCombobox, type ComboOption } from "@/components/patterns/entity-combobox";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { unitsLabel } from "@/lib/stock-balance";
import { issueStock } from "@/server/modules/stock/movement-actions";
import { useStockRunner } from "./use-stock-runner";
import type { StockItemMeta } from "./receive-form";

export interface DepartmentOption {
  id: string;
  name: string;
}

export interface EmployeeOption {
  id: string;
  name: string;
  employeeNo: string;
}

const CLAIMED = ["itemId", "quantity", "departmentId", "employeeId", "reason"];

interface FormState {
  itemId: string | null;
  quantity: string;
  departmentId: string;
  employeeId: string;
  purpose: string;
}

function emptyForm(itemId: string | null): FormState {
  return { itemId, quantity: "", departmentId: "", employeeId: "", purpose: "" };
}

/** Spec §5.3, Task 5 Step 2. `balances` is R3's plain object (never the Map `stockItemBalances` returns) so the on-hand line renders without a round trip. */
export function IssueForm({
  items,
  meta,
  balances,
  departments,
  employees,
  initialItemId,
}: {
  items: ComboOption[];
  meta: Record<string, StockItemMeta>;
  balances: Record<string, number>;
  departments: DepartmentOption[];
  employees: EmployeeOption[];
  initialItemId?: string | null;
}) {
  const [form, setForm] = useState<FormState>(() =>
    emptyForm(initialItemId && meta[initialItemId] ? initialItemId : null),
  );
  const { pending, error, fieldErrors, retryAfter, setRetryAfter, run } = useStockRunner(CLAIMED);

  const selectedMeta = form.itemId ? meta[form.itemId] : null;
  const balance = form.itemId ? (balances[form.itemId] ?? 0) : null;
  const onHand = selectedMeta && balance !== null ? `${unitsLabel(balance, selectedMeta.unit)} on hand` : undefined;

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function payload() {
    return {
      itemId: form.itemId ?? "",
      quantity: form.quantity.trim() === "" ? 0 : Number(form.quantity),
      departmentId: form.departmentId,
      employeeId: form.employeeId,
      reason: form.purpose,
    };
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const itemMeta = form.itemId ? meta[form.itemId] : null;
    const dept = departments.find((d) => d.id === form.departmentId);
    const qty = form.quantity.trim() === "" ? 0 : Number(form.quantity);
    const message =
      itemMeta && dept ? `Issued ${unitsLabel(qty, itemMeta.unit)} of ${itemMeta.code} to ${dept.name}` : "Issue recorded";
    // A conflict (over-issue) falls through to useStockRunner's default banner path — no special handling needed here.
    run(() => issueStock(payload()), message, {
      onOk: () => setForm((f) => ({ ...f, quantity: "", purpose: "" })),
    });
  }

  return (
    <form onSubmit={submit} className="flex max-w-[640px] flex-col gap-4">
      {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
      {error && <Banner tone="fault" title={error} />}
      <Card>
        <CardHeader title="Issue" />
        <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="Item" required error={fieldErrors.itemId} className="sm:col-span-2">
            {(p) => (
              <EntityCombobox
                id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                options={items} value={form.itemId}
                onChange={(id) => setForm((f) => ({ ...f, itemId: id }))}
                placeholder="Type a code or name…"
              />
            )}
          </FormField>
          <FormField label="Quantity" required hint={onHand} error={fieldErrors.quantity}>
            {(p) => (
              <Input
                id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                type="number" min={1} step={1}
                value={form.quantity} onChange={(e) => set("quantity", e.target.value)}
              />
            )}
          </FormField>
          <FormField label="Department" required error={fieldErrors.departmentId}>
            {(p) => (
              <Select
                id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                value={form.departmentId} onChange={(e) => set("departmentId", e.target.value)}
              >
                <option value="" disabled>Select a department</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </Select>
            )}
          </FormField>
          <FormField label="Employee" error={fieldErrors.employeeId}>
            {(p) => (
              <Select
                id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                value={form.employeeId} onChange={(e) => set("employeeId", e.target.value)}
              >
                <option value="">— none —</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>{e.name} ({e.employeeNo})</option>
                ))}
              </Select>
            )}
          </FormField>
          <FormField label="Purpose" error={fieldErrors.reason} className="sm:col-span-2">
            {(p) => (
              <Input
                id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                value={form.purpose} onChange={(e) => set("purpose", e.target.value)}
              />
            )}
          </FormField>
        </CardBody>
      </Card>
      <div>
        <Button type="submit" variant="primary" loading={pending}>Record issue</Button>
      </div>
    </form>
  );
}
