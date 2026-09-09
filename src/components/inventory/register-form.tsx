"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import type { AssetClass } from "@prisma/client";
import { tagKey } from "@/lib/tag-key";
import { Button } from "@/components/ui/button";
import { Banner } from "@/components/ui/banner";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { FormError, FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { nextTags, preferredPrefix, RUN_REFUSAL, type TagRun } from "@/lib/receiving";
import { CLASS_EXAMPLE } from "@/lib/asset-class";
import { checkIdentifiers } from "@/server/modules/inventory/actions";
import { uploadBatchDocument } from "@/server/modules/inventory/document-actions";
import { RegisterSuccess } from "./register-success";
import type { ActionResult } from "@/server/action-result";

/**
 * The first serial that repeats when scanning left to right — same rule and
 * same wording as `registerAssets`'s own in-batch dupe check (`receiving.ts`):
 * `arr.find((s, i) => arr.indexOf(s) !== i)`. Kept here rather than shared,
 * because it operates on the CLIENT's live array (not yet trimmed/filtered)
 * and returns both the offending value and the full set of rows it touches —
 * `registerAssets` only ever needs the single value to refuse with.
 */
function firstDuplicate(values: string[]): { value: string | null; all: Set<string> } {
  const seen = new Set<string>();
  const dup = new Set<string>();
  let value: string | null = null;
  for (const raw of values) {
    const v = raw.trim();
    if (!v) continue;
    if (seen.has(v)) {
      dup.add(v);
      if (value === null) value = v;
    } else {
      seen.add(v);
    }
  }
  return { value, all: dup };
}

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
  requests: Array<{ id: string; refNo: string; vendorId: string | null }>;
  prefixCountsByCategory: Record<string, Array<{ prefix: string; n: number }>>;
  highestByPrefix: Record<string, number | null>;
  action: (payload: Record<string, unknown>) => Promise<ActionResult<{ created: number; ids: string[] }>>;
}) {
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
  const [warrantyUntil, setWarrantyUntil] = useState("");
  const [brand, setBrand] = useState("");
  const [notes, setNotes] = useState("");
  const [invoiceRef, setInvoiceRef] = useState("");
  const [invoiceFile, setInvoiceFile] = useState<File | null>(null);
  const invoiceInputId = useId();

  const [run, setRun] = useState<TagRun | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [conflictMsg, setConflictMsg] = useState<string | null>(null);
  const [retryAfter, setRetryAfter] = useState<number | null>(null);
  const [registered, setRegistered] = useState<{ ids: string[]; tags: string[] } | null>(null);
  const [docError, setDocError] = useState(false);

  // Task 13's live check: it runs the SAME `checkIdentifiers` call whichever
  // cell was blurred, because a batch's duplicate hazard is cross-row (any
  // tag against any other tag, any serial against any other serial) rather
  // than per-field the way the single-asset form's is. `dupSerials` is
  // computed client-side only — no round trip needed to know a batch repeats
  // itself. `registeredTags`/`registeredSerials` hold the normalised values
  // the server has already reported as taken; membership is re-tested against
  // whatever is currently typed on every render, so a row that is edited away
  // from a flagged value stops being invalid without needing its own clear.
  const [dupSerials, setDupSerials] = useState<Set<string>>(new Set());
  const [registeredTags, setRegisteredTags] = useState<Set<string>>(new Set());
  const [registeredSerials, setRegisteredSerials] = useState<Set<string>>(new Set());
  const checkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Staleness guard, same shape as `asset-form.tsx`'s `latestRef`: a 300ms
  // response can land after the arrays on screen have already moved on.
  const latestRef = useRef({ tags, serials });
  latestRef.current = { tags, serials };
  const mountedRef = useRef(true);
  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (checkTimer.current) clearTimeout(checkTimer.current);
    };
  }, []);

  /**
   * Runs the in-batch duplicate-serial check synchronously (no server round
   * trip needed) and, unless that already found something, fires the shared
   * `checkIdentifiers` lookup for both arrays as they stand right now.
   * Called on blur (debounced) and once more, undebounced, at submit — never
   * awaited by either caller, because the check is advisory only (R9 note:
   * the server remains the authority, and refuses with the same words).
   *
   * Staleness guard (below) compares array structures using JSON.stringify
   * rather than join(""), which is non-injective (e.g. ["A","BC"] and ["AB","C"]
   * both become "ABC"), so a response for a different array could incorrectly
   * pass as current.
   */
  function runIdentifierCheck() {
    const snapshot = latestRef.current;
    const { value: dupValue, all: dupAll } = firstDuplicate(snapshot.serials);
    setDupSerials(dupAll);
    if (dupValue) {
      setErrors((e) => ({ ...e, serials: `Serial ${dupValue} appears twice in this batch.` }));
    }
    const tagsToCheck = snapshot.tags;
    const serialsToCheck = snapshot.serials.filter((s) => s.trim().length > 0);
    void checkIdentifiers({ tags: tagsToCheck, serials: serialsToCheck }).then((res) => {
      if (!mountedRef.current || !res.ok) return;
      const same = (a: string[], b: string[]) => JSON.stringify(a) === JSON.stringify(b);
      const stale =
        !same(tagsToCheck, latestRef.current.tags) ||
        !same(serialsToCheck, latestRef.current.serials.filter((s) => s.trim().length > 0));
      if (stale) return;
      // R9: normalise both sides the way the server does — tags via
      // `tagKey`, serials trimmed — so a lower-case typed tag or a
      // padded serial still matches a normalised server hit.
      const takenTags = new Set(res.data.tags.map(tagKey));
      const takenSerials = new Set(res.data.serials.map((s) => s.trim()));
      setRegisteredTags(takenTags);
      setRegisteredSerials(takenSerials);
      setErrors((e) => {
        const next = { ...e };
        if (takenTags.size) next.tags = `Already registered: ${[...new Set(res.data.tags)].join(", ")}`;
        else delete next.tags;
        // The in-batch duplicate found above keeps the one text slot for
        // `errors.serials` — same precedence `registerAssets` uses server
        // side (it refuses the in-batch dupe before it ever queries for an
        // existing one).
        if (!dupValue) {
          if (takenSerials.size) next.serials = `Already registered: ${[...new Set(res.data.serials)].join(", ")}`;
          else delete next.serials;
        }
        return next;
      });
    });
  }

  function scheduleIdentifierCheck() {
    if (checkTimer.current) clearTimeout(checkTimer.current);
    checkTimer.current = setTimeout(runIdentifierCheck, 300);
  }

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
    // Step 2's other trigger point: fired here too (undebounced, unawaited)
    // so a batch submitted without ever blurring a cell still gets painted —
    // the actual submission below does not wait on it either way.
    runIdentifierCheck();
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
        warrantyUntil: warrantyUntil || undefined,
        brand: brand || undefined,
        notes: notes || undefined,
        invoiceRef: invoiceRef || undefined,
      });
      if (res.ok) {
        if (invoiceFile) {
          const fd = new FormData();
          for (const id of res.data.ids) fd.append("assetIds", id);
          fd.set("kind", "invoice");
          fd.set("file", invoiceFile);
          try {
            const up = await uploadBatchDocument(fd);
            if (!up.ok) setDocError(true);
          } catch {
            // Same reasoning as `AssetForm`'s per-file upload loop: the
            // assets themselves are already committed, so a thrown upload
            // must read as "the invoice didn't attach", never as the
            // registration having failed.
            setDocError(true);
          }
        }
        // Freeze the tags this submission actually sent, not the live `tags`
        // state: a later successful registration revalidates `/inventory`,
        // and if that also refreshes this page's server-supplied
        // `highestByPrefix` prop, the [prefix, quantity, highestByPrefix]
        // effect above recomputes a NEW suggested run for the next batch —
        // silently replacing what the success panel would otherwise display,
        // even though the assets already created keep their real tags.
        setRegistered({ ids: res.data.ids, tags });
      } else if (res.kind === "rate_limited") setRetryAfter(res.retryAfterSec ?? 60);
      else if (res.kind === "validation") {
        const fe = res.fieldErrors ?? {};
        setErrors(fe);
        const unclaimed = fe._form;
        if (unclaimed) setConflictMsg(unclaimed);
      } else setConflictMsg(res.message);
    });
  }

  /** Clears every field and the tag run — the whole form, back to its initial state. */
  function reset() {
    setCategoryId("");
    setTypeId("");
    setModel("");
    setQuantity(1);
    setPrefix("");
    setTags([]);
    setSerials([]);
    setPurchasedAt("");
    setCost("");
    setVendorId("");
    setRequestId("");
    setWarrantyUntil("");
    setBrand("");
    setNotes("");
    setInvoiceRef("");
    setInvoiceFile(null);
    setRun(null);
    setErrors({});
    setConflictMsg(null);
    setRetryAfter(null);
    setDupSerials(new Set());
    setRegisteredTags(new Set());
    setRegisteredSerials(new Set());
    setRegistered(null);
    setDocError(false);
  }

  if (registered) {
    return (
      <RegisterSuccess tags={registered.tags} ids={registered.ids} cls={cls} onAgain={reset}>
        {docError && (
          <Banner tone="attention" title="Registered — the invoice did not attach. Add it from any unit's Documents tab." />
        )}
      </RegisterSuccess>
    );
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
                    invalid={registeredTags.has(tagKey(tag))}
                    value={tag}
                    onChange={(e) => {
                      const t = e.target.value.toUpperCase();
                      setTags((prev) => prev.map((x, j) => (j === i ? t : x)));
                    }}
                    onBlur={scheduleIdentifierCheck}
                  />
                  <Input
                    aria-label={`Serial ${i + 1}`}
                    placeholder="Serial (optional)"
                    invalid={
                      !!serials[i]?.trim() &&
                      (dupSerials.has(serials[i].trim()) || registeredSerials.has(serials[i].trim()))
                    }
                    value={serials[i] ?? ""}
                    onChange={(e) => {
                      const s = e.target.value;
                      setSerials((prev) => prev.map((x, j) => (j === i ? s : x)));
                    }}
                    onBlur={scheduleIdentifierCheck}
                  />
                </div>
              ))}
              <FormError>{errors.serials}</FormError>
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
                onChange={(e) => {
                  const value = e.target.value;
                  setPurchasedAt(value);
                  // Derived, pre-filled, never blank — same +12 month rule as
                  // `asset-form.tsx:79-84`, only offered when warranty is
                  // still empty so a hand-edited date never clobbers it.
                  if (value && !warrantyUntil) {
                    const d = new Date(`${value}T00:00:00Z`);
                    d.setUTCFullYear(d.getUTCFullYear() + 1);
                    setWarrantyUntil(d.toISOString().slice(0, 10));
                  }
                }}
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
                onChange={(e) => {
                  const r = requests.find((x) => x.id === e.target.value);
                  setRequestId(e.target.value);
                  // Phase 18 spec §5.4: fill an EMPTY vendor from the request's supplier; never overwrite a chosen one.
                  // I-1: only when that supplier is among the offered options — an archived
                  // supplier no longer appears in `vendors`, and this control must never set
                  // a value the select cannot show.
                  if (r?.vendorId && !vendorId && vendors.some((v) => v.id === r.vendorId)) setVendorId(r.vendorId);
                }}
              >
                <option value="">—</option>
                {requests.map((r) => <option key={r.id} value={r.id}>{r.refNo}</option>)}
              </Select>
            )}
          </FormField>
          <FormField label="Warranty until" hint="Pre-filled at purchase + 12 months — adjust if the quote says otherwise." error={errors.warrantyUntil}>
            {(p) => (
              <Input
                id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                type="date"
                value={warrantyUntil}
                onChange={(e) => setWarrantyUntil(e.target.value)}
              />
            )}
          </FormField>
          <FormField label="Brand" error={errors.brand}>
            {(p) => (
              <Input
                id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
              />
            )}
          </FormField>
          <FormField label="Invoice / receipt no." error={errors.invoiceRef}>
            {(p) => (
              <Input
                id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                value={invoiceRef}
                onChange={(e) => setInvoiceRef(e.target.value)}
              />
            )}
          </FormField>
          <FormField label="Notes" error={errors.notes} className="sm:col-span-2">
            {(p) => (
              <Textarea
                id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            )}
          </FormField>
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <label htmlFor={invoiceInputId} className="text-xs font-medium text-fg">Invoice document</label>
            <input
              id={invoiceInputId}
              type="file"
              accept=".pdf,.png,.jpg,.jpeg"
              className="text-xs text-fg-secondary"
              onChange={(e) => setInvoiceFile(e.target.files?.[0] ?? null)}
            />
            <p className="text-[11px] text-fg-muted">Attached to every unit in this batch.</p>
          </div>
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
