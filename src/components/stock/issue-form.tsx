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
import { ReasonField } from "@/components/patterns/reason-field";
import { REASON_CHIPS } from "@/lib/reason-chips";
import { unitsLabel } from "@/lib/stock-balance";
import { issueStock } from "@/server/modules/stock/movement-actions";
import { useStockRunner } from "./use-stock-runner";
import type { StockItemMeta } from "./receive-form";

export interface DepartmentOption {
  id: string;
  name: string;
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
  recentEmployees,
  recentItems,
  initialItemId,
}: {
  items: ComboOption[];
  meta: Record<string, StockItemMeta>;
  balances: Record<string, number>;
  departments: DepartmentOption[];
  employees: ComboOption[];
  recentEmployees: string[];
  recentItems: string[];
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
                options={items} recent={recentItems} autoFocus value={form.itemId}
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
              <EntityCombobox id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                options={employees} recent={recentEmployees} value={form.employeeId || null}
                onChange={(id) => set("employeeId", id ?? "")} placeholder="Type a name or EMP number…" />
            )}
          </FormField>
          <ReasonField label="Purpose" error={fieldErrors.reason} value={form.purpose} onChange={(v) => set("purpose", v)} chips={REASON_CHIPS["stock.issue"]} rows={2} className="sm:col-span-2" />
        </CardBody>
      </Card>
      <div>
        <Button type="submit" variant="primary" loading={pending}>Record issue</Button>
      </div>
    </form>
  );
}
