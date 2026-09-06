"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { AssetClass } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Banner } from "@/components/ui/banner";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { nextTags, preferredPrefix, type TagRun } from "@/lib/receiving";
import { CLASS_EXAMPLE, withClsQS } from "@/lib/asset-class";
import type { ActionResult } from "@/server/action-result";

// Mirrors the discriminated union `nextTags` returns (`./lib/receiving.ts`) —
// the reason for each refusal, in words a form can show next to Submit.
const RUN_REFUSAL: Record<Exclude<TagRun, { ok: true }>["reason"], string> = {
  "bad-prefix": "Prefix must be two capital letters",
  overflow: "That run passes BR-XX-9999 — register fewer, or use another prefix",
  "bad-count": "Quantity must be at least 1",
};

export function RegisterForm({
  categories,
  types,
  vendors,
  requests,
  prefixCountsByCategory,
  highestByPrefix,
  action,
}: {
  categories: Array<{ id: string; name: string; cls: AssetClass }>;
  types: Array<{ id: string; name: string; categoryId: string }>;
  vendors: Array<{ id: string; name: string }>;
  requests: Array<{ id: string; refNo: string }>;
  prefixCountsByCategory: Record<string, Array<{ prefix: string; n: number }>>;
  highestByPrefix: Record<string, number | null>;
  action: (payload: Record<string, unknown>) => Promise<ActionResult<{ created: number }>>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [categoryId, setCategoryId] = useState("");
  const [typeId, setTypeId] = useState("");
  const [model, setModel] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [prefix, setPrefix] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [serials, setSerials] = useState<string[]>([]);
  const [purchasedAt, setPurchasedAt] = useState("");
  const [cost, setCost] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [requestId, setRequestId] = useState("");

  const [run, setRun] = useState<TagRun | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [conflictMsg, setConflictMsg] = useState<string | null>(null);
  const [retryAfter, setRetryAfter] = useState<number | null>(null);

  const typesForCategory = types.filter((t) => t.categoryId === categoryId);
  const cls: AssetClass = categories.find((c) => c.id === categoryId)?.cls ?? categories[0]?.cls ?? "IT";

  // A category switch picks a fresh default prefix (the one already most
  // used in that category) rather than carrying over a prefix that may not
  // belong there at all.
  useEffect(() => {
    if (!categoryId) {
      setPrefix("");
      return;
    }
    const counts = prefixCountsByCategory[categoryId] ?? [];
    setPrefix(preferredPrefix(counts) ?? "");
  }, [categoryId, prefixCountsByCategory]);

  // Recompute the tag run whenever prefix or quantity changes — nextTags is
  // the only place that is allowed to decide what the next free numbers are.
  // The client never guesses the highest number; it looks it up in the map
  // the server already computed.
  useEffect(() => {
    if (!prefix) {
      setRun(null);
      setTags([]);
      setSerials([]);
      return;
    }
    const highest = highestByPrefix[prefix.toUpperCase()] ?? null;
    const result = nextTags(prefix.toUpperCase(), highest, quantity);
    setRun(result);
    if (result.ok) {
      setTags(result.tags);
      // Array.from, not `next.length = n` + `.map`: growing an array by
      // assigning `.length` creates HOLES, and `.map` skips holes rather than
      // filling them — so every added row kept an empty slot that serialized
      // to `undefined` and was rejected by `serials: z.array(z.string())`.
      // The per-index onChange below is `.map`-based too, so typing into the
      // field could not repair it either: registration failed at every
      // quantity, including 1. Found by Task 7's first e2e run.
      setSerials((prev) => Array.from({ length: result.tags.length }, (_, i) => prev[i] ?? ""));
    } else {
      setTags([]);
    }
  }, [prefix, quantity, highestByPrefix]);

  const canSubmit = !!run?.ok && !!categoryId && model.trim().length > 0 && !pending;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!run?.ok) return;
    setErrors({});
    setConflictMsg(null);
    setRetryAfter(null);
    startTransition(async () => {
      const res = await action({
        categoryId,
        typeId: typeId || undefined,
        model,
        tags,
        serials,
        purchasedAt: purchasedAt || undefined,
        cost: cost || undefined,
        vendorId: vendorId || undefined,
        requestId: requestId || undefined,
      });
      if (res.ok) {
        router.push("/inventory" + withClsQS("", cls));
      } else if (res.kind === "rate_limited") setRetryAfter(res.retryAfterSec ?? 60);
      else if (res.kind === "validation") {
        const fe = res.fieldErrors ?? {};
        setErrors(fe);
        const unclaimed = fe._form;
        if (unclaimed) setConflictMsg(unclaimed);
      } else setConflictMsg(res.message);
    });
  }

  return (
    <form onSubmit={submit} className="flex max-w-[720px] flex-col gap-4">
      {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
      {conflictMsg && <Banner tone="fault" title={conflictMsg} />}

      <Card>
        <CardHeader title="What was purchased" />
        <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="Category" required error={errors.categoryId}>
            {(p) => (
              <Select
                id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                value={categoryId}
                onChange={(e) => {
                  setCategoryId(e.target.value);
                  setTypeId("");
                }}
              >
                <option value="">Pick a category…</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            )}
          </FormField>
          <FormField label="Type" hint="Optional." error={errors.typeId}>
            {(p) => (
              <Select
                id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                value={typeId}
                disabled={!categoryId}
                onChange={(e) => setTypeId(e.target.value)}
              >
                <option value="">—</option>
                {typesForCategory.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </Select>
            )}
          </FormField>
          <FormField label="Model" required error={errors.model} className="sm:col-span-2">
            {(p) => (
              <Input
                id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                placeholder={CLASS_EXAMPLE[cls].model}
                value={model}
                onChange={(e) => setModel(e.target.value)}
              />
            )}
          </FormField>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Tag numbering" />
        <CardBody className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="Quantity" required error={errors.tags}>
              {(p) => (
                <Input
                  id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                  type="number"
                  min={1}
                  max={200}
                  value={quantity}
                  onChange={(e) => setQuantity(Math.max(1, Number(e.target.value) || 1))}
                />
              )}
            </FormField>
            <FormField label="Prefix" required hint={CLASS_EXAMPLE[cls].prefixHint}>
              {(p) => (
                <Input
                  id={p.id} aria-describedby={p["aria-describedby"]}
                  invalid={!!run && !run.ok && run.reason === "bad-prefix"}
                  maxLength={2}
                  value={prefix}
                  onChange={(e) => setPrefix(e.target.value.toUpperCase())}
                />
              )}
            </FormField>
          </div>

          {run && !run.ok && <Banner tone="fault" title={RUN_REFUSAL[run.reason]} />}

          {run?.ok && (
            <div className="flex flex-col gap-2">
              <p className="text-xs font-medium text-fg-muted">
                Tag / serial — one row per unit, tags pre-filled with the next free numbers.
              </p>
              {tags.map((tag, i) => (
                <div key={i} className="grid grid-cols-2 gap-2">
                  <Input
                    aria-label={`Tag ${i + 1}`}
                    value={tag}
                    onChange={(e) => {
                      const t = e.target.value.toUpperCase();
                      setTags((prev) => prev.map((x, j) => (j === i ? t : x)));
                    }}
                  />
                  <Input
                    aria-label={`Serial ${i + 1}`}
                    placeholder="Serial (optional)"
                    value={serials[i] ?? ""}
                    onChange={(e) => {
                      const s = e.target.value;
                      setSerials((prev) => prev.map((x, j) => (j === i ? s : x)));
                    }}
                  />
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Procurement (optional)" />
        <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="Purchased" error={errors.purchasedAt}>
            {(p) => (
              <Input
                id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                type="date"
                value={purchasedAt}
                onChange={(e) => setPurchasedAt(e.target.value)}
              />
            )}
          </FormField>
          <FormField label="Cost (₱)" error={errors.cost}>
            {(p) => (
              <Input
                id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                type="number"
                step="0.01"
                min="0"
                inputMode="decimal"
                value={cost}
                onChange={(e) => setCost(e.target.value)}
              />
            )}
          </FormField>
          <FormField label="Vendor" error={errors.vendorId}>
            {(p) => (
              <Select
                id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                value={vendorId}
                onChange={(e) => setVendorId(e.target.value)}
              >
                <option value="">—</option>
                {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </Select>
            )}
          </FormField>
          <FormField label="Purchase request" hint="Only if this batch fulfils a completed request." error={errors.requestId}>
            {(p) => (
              <Select
                id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                value={requestId}
                onChange={(e) => setRequestId(e.target.value)}
              >
                <option value="">—</option>
                {requests.map((r) => <option key={r.id} value={r.id}>{r.refNo}</option>)}
              </Select>
            )}
          </FormField>
        </CardBody>
      </Card>

      <div className="flex items-center gap-3">
        <Button type="submit" variant="primary" loading={pending} disabled={!canSubmit}>
          Register {quantity > 1 ? `${quantity} assets` : "asset"}
        </Button>
      </div>
    </form>
  );
}
