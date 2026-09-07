"use client";

import { useEffect, useId, useRef, useState, useTransition, type MutableRefObject } from "react";
import { useRouter } from "next/navigation";
import type { AssetClass } from "@prisma/client";
import { tagKey } from "@/lib/tag-key";
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
import { CREATABLE_BY_CLASS, type CreatableStatus } from "@/lib/asset-rules";
import { CLASS_EXAMPLE, DEFAULT_STATUS } from "@/lib/asset-class";
import { nextTags, preferredPrefix, RUN_REFUSAL } from "@/lib/receiving";
import { DOCUMENT_KINDS } from "@/lib/documents";
import { checkIdentifiers } from "@/server/modules/inventory/actions";
import { uploadDocument } from "@/server/modules/inventory/document-actions";
import type { CategorySuggestion } from "@/server/modules/inventory/tag-suggest";
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
}

export function AssetForm({
  mode,
  categories,
  types,
  employees,
  vendors = [],
  suggestions,
  initial,
  action,
  directClasses = [],
}: {
  mode: "new" | "edit";
  categories: Array<{ id: string; name: string; cls: AssetClass }>;
  types: Array<{ id: string; name: string; categoryId: string }>;
  employees: ComboOption[];
  vendors?: Array<{ id: string; name: string }>;
  /** Per-category next-tag suggestion data (Task 11's `tagSuggestions`) — new mode only. */
  suggestions?: Record<string, CategorySuggestion>;
  initial?: AssetFormInitial;
  action: (payload: Record<string, unknown>) => Promise<ActionResult<{ id: string }>>;
  /** Classes `role` is direct-lifecycle for — passed as a set, not a single
   * boolean, because the category control (and so the class) can change
   * client-side without a page reload; a static boolean would go stale the
   * moment an admin switches from a Laptop to a Vehicle category. */
  directClasses?: readonly AssetClass[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState<AssetFormInitial>(
    initial ?? {
      tag: "", model: "", brand: "", serial: "", categoryId: "", typeId: "", purchasedAt: "",
      cost: "", warrantyUntil: "", notes: "", vendorId: "", invoiceRef: "", rmaRef: "", repairQuote: "",
    },
  );
  // A sentinel only: `effectiveStatus` below normalizes it to the chosen
  // category's class, so this never reaches the control or the payload raw.
  const [requestedStatus, setRequestedStatus] = useState<CreatableStatus>(DEFAULT_STATUS.IT);
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [assignReason, setAssignReason] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [conflictMsg, setConflictMsg] = useState<string | null>(null);
  const [retryAfter, setRetryAfter] = useState<number | null>(null);
  const [saved, setSaved] = useState(false);

  // Task 12: next-tag suggestion (new mode). `tagTouched` freezes the
  // suggestion the moment the tag field is hand-edited — a later category
  // change must not clobber a number the user already chose.
  const [tagTouched, setTagTouched] = useState(false);
  const [tagHint, setTagHint] = useState<string | null>(null);

  // Task 12: documents attached at registration (new mode) — uploaded one by
  // one, after createAsset, once the asset id exists to attach them to.
  const [files, setFiles] = useState<Array<{ file: File; kind: string }>>([]);
  const filesInputId = useId();

  // Task 12: live duplicate check, debounced so every keystroke-then-blur
  // does not fire a request. Two independent timers — checking Tag must not
  // cancel an in-flight check for Serial, or vice versa.
  const tagCheckTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const serialCheckTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Staleness guard for the two checks above: a 300 ms response can land
  // after the user has already changed the field again (edit without an
  // intervening blur, or Enter to submit) — `latestRef` always holds
  // whatever the fields currently say, kept fresh every render (a plain
  // assignment, not an effect, so it is current before the timer's .then
  // ever runs), so a response for an old value can be told apart from one
  // for the value that's still on screen.
  const latestRef = useRef({ tag: form.tag, serial: form.serial });
  latestRef.current = { tag: form.tag, serial: form.serial };
  const mountedRef = useRef(true);
  useEffect(() => {
    return () => {
      mountedRef.current = false;
      // Both timer refs hold a live setTimeout id (never a DOM node) that
      // `scheduleIdentifierCheck` keeps reassigning outside this effect —
      // reading `.current` at unmount time is exactly the point.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      if (tagCheckTimer.current) clearTimeout(tagCheckTimer.current);
      // eslint-disable-next-line react-hooks/exhaustive-deps
      if (serialCheckTimer.current) clearTimeout(serialCheckTimer.current);
    };
  }, []);

  function scheduleIdentifierCheck(
    kind: "tag" | "serial",
    value: string,
    timer: MutableRefObject<ReturnType<typeof setTimeout> | null>,
  ) {
    if (timer.current) clearTimeout(timer.current);
    if (!value) return;
    timer.current = setTimeout(() => {
      // Never blocks submit — this only ever paints an early hint; the
      // server's unique constraint remains the authority at submit time.
      void checkIdentifiers(kind === "tag" ? { tags: [value] } : { serials: [value] }).then((res) => {
        if (!mountedRef.current || !res.ok) return;
        // The field this response is about may no longer hold the value we
        // checked — ignore it rather than label whatever is there now.
        // Tag is compared the same way `checkIdentifiers` itself normalises
        // it (trim + upper-case); serial is compared as-is, matching the
        // server, which does not normalise serials.
        const latest = latestRef.current[kind];
        const stale = kind === "tag" ? tagKey(value) !== tagKey(latest) : value !== latest;
        if (stale) return;
        const hit = kind === "tag" ? res.data.tags.includes(value) : res.data.serials.includes(value);
        setErrors((e) => {
          if (hit) return { ...e, [kind]: "Already registered" };
          if (!(kind in e)) return e;
          const next = { ...e };
          delete next[kind];
          return next;
        });
      });
    }, 300);
  }

  const set = (key: keyof AssetFormInitial) => (value: string) => {
    if (key === "tag") setTagTouched(true);
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

  // The category decides the class; the class decides which initial states
  // exist. Before a category is picked, follow the first category offered —
  // a purchasing_staff user sees only Purchasing categories, so IT's states
  // would be wrong for them (D-14b, D-15).
  const cls: AssetClass = categories.find((c) => c.id === form.categoryId)?.cls ?? categories[0]?.cls ?? "IT";
  const creatable = CREATABLE_BY_CLASS[cls];
  const direct = directClasses.includes(cls);
  // Derived, not reset by an effect: what the control shows and what the
  // payload carries are the same expression, so they cannot disagree, and a
  // class switch never paints an out-of-class selection for a frame.
  const effectiveStatus: CreatableStatus = (creatable as readonly string[]).includes(requestedStatus)
    ? requestedStatus
    : DEFAULT_STATUS[cls];

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});
    setConflictMsg(null);
    setRetryAfter(null);
    startTransition(async () => {
      const res = await action({
        ...form,
        requestedStatus: mode === "new" ? effectiveStatus : undefined,
        assigneeId: mode === "new" ? (assigneeId ?? "") : undefined,
        assignReason: mode === "new" ? assignReason : undefined,
      });
      if (res.ok) {
        if (mode === "new") {
          let failed = 0;
          for (const { file, kind } of files) {
            const fd = new FormData();
            fd.set("assetId", res.data.id);
            fd.set("kind", kind);
            fd.set("file", file);
            try {
              const up = await uploadDocument(fd);
              if (!up.ok) failed += 1;
            } catch {
              // storeUpload can throw (disk I/O) — a thrown upload counts as a
              // failure exactly like `!up.ok`; it must never abort the loop or
              // strand the user on the form after the asset was already created.
              failed += 1;
            }
          }
          router.push(
            failed
              ? `/inventory/${res.data.id}/documents?failed=${failed}&of=${files.length}`
              : `/inventory/${res.data.id}?created=1`,
          );
        } else {
          setSaved(true);
          setTimeout(() => setSaved(false), 3000);
          router.refresh();
        }
      } else if (res.kind === "rate_limited") setRetryAfter(res.retryAfterSec ?? 60);
      else if (res.kind === "validation") {
        const fe = res.fieldErrors ?? {};
        setErrors(fe);
        // errors no FormField claims (_form/id/requestedStatus) must not dead-end silently
        const unclaimed = fe._form ?? fe.id ?? fe.requestedStatus;
        if (unclaimed) setConflictMsg(unclaimed);
      }
      else setConflictMsg(res.message);
    });
  }

  const field = (
    label: string,
    key: keyof AssetFormInitial,
    opts: {
      required?: boolean;
      hint?: string;
      type?: string;
      disabled?: boolean;
      placeholder?: string;
      onBlur?: () => void;
    } = {},
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
          onBlur={opts.onBlur}
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
            hint: mode === "edit"
              ? "Tags are permanent — they're printed labels."
              : (tagHint ?? "Format BR-XX-0000, as printed on the label."),
            disabled: mode === "edit",
            placeholder: CLASS_EXAMPLE[cls].tag,
            onBlur: mode === "new" ? () => scheduleIdentifierCheck("tag", form.tag, tagCheckTimer) : undefined,
          })}
          {field("Model", "model", { required: true, placeholder: CLASS_EXAMPLE[cls].model })}
          {field("Brand", "brand")}
          {field("Serial", "serial", {
            onBlur: mode === "new" ? () => scheduleIdentifierCheck("serial", form.serial, serialCheckTimer) : undefined,
          })}
          <FormField label="Category" required error={errors.categoryId}>
            {(p) => (
              <Select
                id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                value={form.categoryId}
                onChange={(e) => {
                  const categoryId = e.target.value;
                  const s = suggestions?.[categoryId];
                  const prefix = s ? preferredPrefix(s.prefixes) : null;
                  const run = prefix ? nextTags(prefix, s!.highest[prefix] ?? null, 1) : null;
                  setForm((f) => ({
                    ...f,
                    categoryId,
                    typeId: "",
                    tag: mode === "new" && !tagTouched && run?.ok ? run.tags[0] : f.tag,
                  }));
                  if (mode === "new") {
                    setTagHint(
                      !categoryId
                        ? null
                        : !prefix
                          ? "No tags yet for this category — type BR-XX-0000."
                          : run?.ok
                            ? `Suggested — next free number for BR-${prefix}. Edit if you need another.`
                            : RUN_REFUSAL[run!.reason],
                    );
                  }
                }}
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
          {field("Invoice / receipt no.", "invoiceRef")}
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
            {field("RMA reference", "rmaRef")}
            {field("Repair quote (₱)", "repairQuote", { type: "number" })}
          </CardBody>
        </Card>
      )}

      {mode === "new" && (
        <Card>
          <CardHeader title="Documents" />
          <CardBody className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor={filesInputId} className="text-xs font-medium text-fg">Documents</label>
              <input
                id={filesInputId}
                type="file"
                accept=".pdf,.png,.jpg,.jpeg"
                multiple
                className="text-xs text-fg-secondary"
                onChange={(e) => {
                  const chosen = Array.from(e.target.files ?? []);
                  setFiles((prev) => [...prev, ...chosen.map((file) => ({ file, kind: "receipt" }))]);
                  e.target.value = "";
                }}
              />
              <p className="text-[11px] text-fg-muted">PDF · PNG · JPG — max 10 MB each.</p>
            </div>
            {files.length > 0 && (
              <ul className="flex flex-col gap-2">
                {files.map((f, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-xs text-fg-secondary">{f.file.name}</span>
                    <Select
                      aria-label={`Kind for ${f.file.name}`}
                      value={f.kind}
                      onChange={(e) =>
                        setFiles((prev) => prev.map((x, j) => (j === i ? { ...x, kind: e.target.value } : x)))
                      }
                      className="w-auto"
                    >
                      {DOCUMENT_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
                    </Select>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                    >
                      Remove
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      )}

      {mode === "new" && (
        <Card>
          <CardHeader title="Initial state" />
          <CardBody className="flex flex-col gap-4">
            <SegmentedControl
              aria-label="Initial status"
              options={creatable.map((s) => ({ value: s, label: s }))}
              value={effectiveStatus}
              onChange={(v) => setRequestedStatus(v as CreatableStatus)}
            />
            {effectiveStatus !== DEFAULT_STATUS[cls] && (
              <>
                <p className="text-xs text-fg-muted">
                  {direct ? (
                    "Deployed to the chosen person at registration — recorded in the audit trail."
                  ) : (
                    <>Assignment routes through a <span className="font-mono">lifecycle.assign</span> approval —
                    the asset is registered as {DEFAULT_STATUS[cls]} and flips once the request executes.</>
                  )}
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
