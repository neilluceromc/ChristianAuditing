"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { AssetClass, PurchaseOrderState } from "@prisma/client";
import { Banner } from "@/components/ui/banner";
import { Button, IconButton } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { GroupSelectOptions } from "@/components/ui/group-select-options";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { useToast } from "@/components/ui/toast";
import { PO_REASON_HINT, poFieldWords } from "@/lib/po-send-back";
import { savePurchaseOrder } from "@/server/modules/purchases/po-actions";
import type { PolicyLoadout } from "@/server/modules/purchases/queries";
import type { PickerGroup } from "@/lib/groups";

export interface UnitDraft {
  id?: string;
  description: string;
  specs: string;
  categoryId: string;
  qty: string;
  unitPrice: string;
  /** Units already registered or closed short from this line: the line can't be removed or re-categorised, and its quantity can't drop below this. */
  locked?: number;
}

export interface PoFormInitial {
  id: string;
  refNo: string;
  state: PurchaseOrderState;
  units: UnitDraft[];
  departmentId: string | null;
  vendorId: string | null;
  invoiceRef: string | null;
  receiptRef: string | null;
  purchasedAt: string | null;
  fees: number | null;
  /** The open send-back: who sent it (team and person), the fields they flagged and their note. The reply is required. */
  sentBack: { by: string | null; byName: string | null; note: string | null; fields: string[] } | null;
}

const emptyRow = (): UnitDraft => ({ description: "", specs: "", categoryId: "", qty: "1", unitPrice: "" });

/** The wire shape: strings from the inputs become numbers exactly once, here. */
function toLines(units: UnitDraft[]) {
  return units
    .filter((u) => u.description.trim().length >= 2)
    .map((u) => ({
      ...(u.id ? { id: u.id } : {}),
      description: u.description.trim(),
      specs: u.specs.trim(),
      categoryId: u.categoryId,
      qty: Number.parseInt(u.qty, 10) || 1,
      unitPrice: u.unitPrice.trim() === "" ? Number.NaN : Number(u.unitPrice),
    }));
}

const TEAM_WORDS: Record<string, string> = { IT: "IT", FINANCE: "Finance", PURCHASING: "Purchasing" };
/** A flagged field: a fault-coloured ring, and the words "Flagged" so it isn't colour alone. */
const RING = "ring-2 ring-[color:var(--st-fault-dot)]";
const FLAGGED_HINT = "Flagged — check this one";

/**
 * Purchase orders (spec §3): one form for a new PO and an edit. A PO records something already bought; saving it
 * sends it on (no drafts, no autosave — an autosave would push half-typed orders into IT's queue), so only the Save
 * button calls savePurchaseOrder. Fields are in the order Finance checks them: supplier, SI number, OR number,
 * purchase date, department, fees; then the lines. On a sent-back PO the flagged fields are ringed, the sender's note
 * sits in a banner, and a reply ("What did you fix?") is required.
 */
export function PoForm({
  loadouts,
  departments,
  vendors,
  categories,
  initial,
}: {
  loadouts: PolicyLoadout[];
  departments: PickerGroup[];
  vendors: Array<{ id: string; name: string }>;
  categories: Array<{ id: string; name: string; cls: AssetClass }>;
  initial?: PoFormInitial;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [units, setUnits] = useState<UnitDraft[]>(initial?.units.length ? initial.units : [emptyRow()]);
  const [departmentId, setDepartmentId] = useState(initial?.departmentId ?? "");
  const [vendorId, setVendorId] = useState(initial?.vendorId ?? "");
  const [invoiceRef, setInvoiceRef] = useState(initial?.invoiceRef ?? "");
  const [receiptRef, setReceiptRef] = useState(initial?.receiptRef ?? "");
  const [purchasedAt, setPurchasedAt] = useState(initial?.purchasedAt ?? "");
  const [fees, setFees] = useState(initial?.fees === null || initial?.fees === undefined ? "" : String(initial.fees));
  const [reply, setReply] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [retryAfter, setRetryAfter] = useState<number | null>(null);
  const [loadoutId, setLoadoutId] = useState("");
  // A legacy draft (sent back, never sent) has no sender: its first save is a plain save, and no reply is asked.
  const sentBack = initial?.state === "SENT_BACK" && initial.sentBack?.by ? initial.sentBack : null;
  const flagged = new Set(sentBack?.fields ?? []);
  const ring = (key: string) => (flagged.has(key) ? RING : undefined);
  const flagHint = (key: string) => (flagged.has(key) ? FLAGGED_HINT : undefined);
  const flaggedWords = poFieldWords(sentBack?.fields ?? []);

  const set = (i: number, key: keyof UnitDraft) => (value: string) =>
    setUnits((rows) => rows.map((r, idx) => (idx === i ? { ...r, [key]: value } : r)));

  function addLoadout() {
    const policy = loadouts.find((l) => l.id === loadoutId);
    if (!policy) return;
    setUnits((rows) => [
      ...rows.filter((r) => r.description.trim() || r.unitPrice.trim() || r.id),
      ...policy.slots.map((s) => ({
        description: `${s.name}${s.type ? ` (${s.type})` : ""}`,
        specs: s.required ? "Required by policy" : "Optional",
        categoryId: "",
        qty: "1",
        unitPrice: "",
      })),
    ]);
  }

  function save() {
    const lines = toLines(units);
    if (lines.length === 0) return setError("Add at least one line before saving.");
    if (lines.some((l) => !l.categoryId)) return setError("Pick a category on every line.");
    if (lines.some((l) => !Number.isFinite(l.unitPrice))) return setError("Every line needs its unit price.");
    setError(null);
    setFieldErrors({});
    startTransition(async () => {
      const res = await savePurchaseOrder({
        ...(initial ? { id: initial.id } : {}),
        vendorId,
        invoiceRef,
        receiptRef: receiptRef.trim() || undefined,
        purchasedAt,
        departmentId: departmentId || undefined,
        fees: fees.trim() === "" ? null : Number(fees),
        lines,
        ...(reply.trim() ? { reply } : {}),
      });
      if (res.ok) {
        toast(`${res.data.refNo} saved`, "settled");
        router.push(`/purchases/${res.data.id}`);
        return;
      }
      if (res.kind === "rate_limited") return setRetryAfter(res.retryAfterSec ?? 60);
      setFieldErrors(res.fieldErrors ?? {});
      setError(res.fieldErrors ? Object.values(res.fieldErrors)[0] ?? res.message : res.message);
    });
  }

  const th = "pb-2 text-left font-mono text-[10px] uppercase tracking-[0.06em] text-fg-muted";

  return (
    <div className="flex max-w-[960px] flex-col gap-4">
      {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
      {sentBack && (
        <Banner
          tone="fault"
          title={`Sent back by ${TEAM_WORDS[sentBack.by ?? ""] ?? "another team"}${sentBack.byName ? ` — ${sentBack.byName}` : ""}`}
        >
          <p className="text-[13px] text-fg">{sentBack.note ?? "Check the flagged details, then save with what you fixed."}</p>
          {flaggedWords.length > 0 && (
            <p className="mt-1.5 font-mono text-[10px] uppercase tracking-[0.06em] text-fg-muted">Flagged: {flaggedWords.join(" · ")}</p>
          )}
        </Banner>
      )}
      {error && <Banner tone="fault" title={error} />}

      <Card>
        <CardHeader title="Purchase" />
        <CardBody className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-4">
          <FormField label="Supplier" required hint={flagHint("vendorId")} error={fieldErrors.vendorId}>
            {(p) => (
              <Select
                id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid} className={ring("vendorId")}
                value={vendorId} onChange={(e) => setVendorId(e.target.value)}
              >
                <option value="">Choose a supplier…</option>
                {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </Select>
            )}
          </FormField>
          <FormField label="SI number" required hint={flagHint("invoiceRef")} error={fieldErrors.invoiceRef}>
            {(p) => (
              <Input
                id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid} className={ring("invoiceRef")}
                value={invoiceRef} onChange={(e) => setInvoiceRef(e.target.value)}
              />
            )}
          </FormField>
          <FormField label="OR number" hint={flagHint("receiptRef")} error={fieldErrors.receiptRef}>
            {(p) => (
              <Input
                id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid} className={ring("receiptRef")}
                value={receiptRef} onChange={(e) => setReceiptRef(e.target.value)}
              />
            )}
          </FormField>
          <FormField label="Purchase date" required hint={flagHint("purchasedAt")} error={fieldErrors.purchasedAt}>
            {(p) => (
              <Input
                id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid} className={ring("purchasedAt")}
                type="date" value={purchasedAt} onChange={(e) => setPurchasedAt(e.target.value)}
              />
            )}
          </FormField>
          <FormField label="Department" error={fieldErrors.departmentId}>
            {(p) => (
              <Select id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid} value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
                <option value="">No department</option>
                <GroupSelectOptions groups={departments} keepId={initial?.departmentId} />
              </Select>
            )}
          </FormField>
          <FormField label="Fees ₱" hint={flagHint("fees")} error={fieldErrors.fees}>
            {(p) => (
              <Input
                id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid} className={ring("fees")}
                type="number" min="0" step="0.01" inputMode="decimal" value={fees} onChange={(e) => setFees(e.target.value)}
              />
            )}
          </FormField>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Lines" />
        <CardBody className="flex flex-col gap-3">
          {flagged.has("cost") && <p className="text-[11px] text-fg-muted">{FLAGGED_HINT}: the unit prices.</p>}
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr>
                <th scope="col" className={`w-[26px] ${th}`}>#</th>
                <th scope="col" className={th}>Description</th>
                <th scope="col" className={`w-[160px] ${th}`}>Category</th>
                <th scope="col" className={th}>Specs</th>
                <th scope="col" className={`w-[76px] ${th}`}>Qty</th>
                <th scope="col" className={`w-[128px] ${th}`}>Unit price ₱</th>
                <th scope="col" className="w-[40px] pb-2"><span className="sr-only">Remove row</span></th>
              </tr>
            </thead>
            <tbody>
              {units.map((u, i) => (
                <tr key={u.id ?? `row-${i}`}>
                  <td className="py-1 pr-2 font-mono text-[10.5px] text-fg-muted">{String(i + 1).padStart(2, "0")}</td>
                  <td className="py-1 pr-2">
                    <Input aria-label={`Line ${i + 1} description`} value={u.description} onChange={(e) => set(i, "description")(e.target.value)} placeholder="laptops" />
                  </td>
                  <td className="py-1 pr-2">
                    <Select
                      aria-label={`Line ${i + 1} category`} value={u.categoryId} onChange={(e) => set(i, "categoryId")(e.target.value)}
                      disabled={(u.locked ?? 0) > 0 && u.categoryId !== ""} title={(u.locked ?? 0) > 0 ? "Assets are registered from this line, so its category can't change" : undefined}
                    >
                      <option value="">Choose…</option>
                      {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </Select>
                  </td>
                  <td className="py-1 pr-2">
                    <Input aria-label={`Line ${i + 1} specs`} value={u.specs} onChange={(e) => set(i, "specs")(e.target.value)} placeholder="IPS, USB-C 90W" />
                  </td>
                  <td className="py-1 pr-2">
                    <Input
                      aria-label={`Line ${i + 1} quantity`} type="number" min={Math.max(1, u.locked ?? 0)} step="1" inputMode="numeric"
                      value={u.qty} onChange={(e) => set(i, "qty")(e.target.value)}
                    />
                  </td>
                  <td className="py-1 pr-2">
                    {/* centavos must not stepMismatch — Decimal(12,2) upstream */}
                    <Input
                      aria-label={`Line ${i + 1} unit price`} type="number" min="0" step="0.01" inputMode="decimal" className={ring("cost")}
                      value={u.unitPrice} onChange={(e) => set(i, "unitPrice")(e.target.value)}
                    />
                  </td>
                  <td className="py-1">
                    <IconButton
                      aria-label={`Remove line ${i + 1}`}
                      disabled={(u.locked ?? 0) > 0}
                      onClick={() => setUnits((rows) => (rows.length > 1 ? rows.filter((_, idx) => idx !== i) : rows))}
                    >
                      −
                    </IconButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => setUnits((rows) => [...rows, emptyRow()])}>Add line</Button>
            <span className="mx-1 h-4 w-px bg-border" aria-hidden />
            <Select aria-label="Policy loadout" value={loadoutId} onChange={(e) => setLoadoutId(e.target.value)} className="max-w-[220px]">
              <option value="">Add from a policy loadout…</option>
              {loadouts.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </Select>
            <Button size="sm" disabled={!loadoutId} onClick={addLoadout}>Add rows</Button>
          </div>
        </CardBody>
      </Card>

      {initial && (
        <Card>
          <CardBody>
            {/* Required on a sent-back PO (Purchasing's reply), and for an admin's edit while it is with IT. */}
            <FormField
              label={sentBack ? "What did you fix?" : "What changed?"}
              required={!!sentBack}
              hint={sentBack
                ? `Goes back to ${TEAM_WORDS[sentBack.by ?? ""] ?? "them"} with your save. ${PO_REASON_HINT}.`
                : `Goes on the thread. An admin editing while it's with IT must say why (${PO_REASON_HINT}).`}
              error={fieldErrors.reply}
            >
              {(p) => (
                <Textarea
                  id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                  value={reply} onChange={(e) => setReply(e.target.value)} maxLength={300}
                />
              )}
            </FormField>
          </CardBody>
        </Card>
      )}

      <div className="flex items-center gap-3">
        <Button variant="primary" loading={pending} onClick={save}>Save</Button>
        <span className="text-xs text-fg-muted">
          Saving sends it on: IT gear goes to IT to check; everything else is ready to register.
        </span>
      </div>
    </div>
  );
}
