"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { AssetClass } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Banner } from "@/components/ui/banner";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { FormError, FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { useBack } from "@/components/ui/back-link";
import { EntityCombobox, type ComboOption } from "@/components/patterns/entity-combobox";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { ASSET_CLASSES, CLASS_EXAMPLE, CLASS_LABEL, CREATABLE_BY_CLASS, DEFAULT_STATUS, HOLDER_STATUSES } from "@/lib/asset-class";
import type { CreatableStatus } from "@/lib/asset-rules";
import { defaultLoanDue, minLoanDue } from "@/lib/lifecycle";
import { nextTags, preferredPrefix, RUN_REFUSAL } from "@/lib/receiving";
import { MONEY_ERROR, normaliseCost } from "@/lib/register-input";
import {
  clampQuantity, liveQuantity, pasteSerials, resizeRows, retagRows, serialsEntered, singleRowErrors, type RegisterRow,
} from "@/lib/register-rows";
import { TAG_SHAPE, tagKey } from "@/lib/tag-key";
import { createAsset } from "@/server/modules/inventory/actions";
import { registerAssets } from "@/server/modules/purchases/receiving";
import { uploadBatchDocument, uploadDocument } from "@/server/modules/inventory/document-actions";
import { RegisterDocuments, type StagedDocument } from "./register-documents";
import { RegisterInitialState } from "./register-initial-state";
import { RegisterRows, rowFeedback } from "./register-rows";
import { RegisterSuccess } from "./register-success";
import { useIdentifierCheck } from "./use-identifier-check";

type Intent = "register" | "register-add";

/** Every error key a field on this form shows; anything else reaches the banner rather than dead-ending. */
const CLAIMED = new Set([
  "categoryId", "typeId", "model", "brand", "prefix", "tags", "serials", "requestedStatus", "assigneeId", "loanDueAt",
  "requestId", "vendorId", "purchasedAt", "warrantyUntil", "cost", "invoiceRef", "notes",
]);
const isRowKey = (key: string) => /^(tags|serials)[.][0-9]+$/.test(key);

/** The highest number a registered tag under `prefix` carries, from the page's map and this session's own writes. */
function highestOf(server: Record<string, number | null>, mine: Record<string, number>, prefix: string): number | null {
  const a = server[prefix];
  const b = mine[prefix];
  return a == null && b == null ? null : Math.max(a ?? 0, b ?? 0);
}

/**
 * Phase 30 (spec §5): the one Register flow. The fields run in the order they
 * depend on — the category decides the class, the tag prefix and the initial
 * states. Quantity 1 (P-12, P-13) keeps the one-row table and submits through
 * `createAsset` with its initial state, holder, loan date and documents;
 * more submits the batch through `registerAssets` with one invoice for every
 * unit. The submit is always enabled: client checks set every error at once,
 * the server's refusals merge in, and the first invalid field takes focus.
 */
export function RegisterForm({
  categories,
  types,
  vendors,
  recentVendors,
  employees,
  recentEmployees,
  requests,
  prefixCountsByCategory,
  highestByPrefix,
  directClasses,
  defaultCls,
  listHref,
}: {
  categories: Array<{ id: string; name: string; cls: AssetClass }>;
  types: Array<{ id: string; name: string; categoryId: string }>;
  vendors: Array<{ id: string; name: string }>;
  recentVendors: string[];
  employees: ComboOption[];
  recentEmployees: string[];
  /** Completed requests, labelled `{refNo} · {vendor} · {date}`. */
  requests: Array<{ id: string; label: string; vendorId: string | null }>;
  prefixCountsByCategory: Record<string, Array<{ prefix: string; n: number }>>;
  highestByPrefix: Record<string, number | null>;
  /** Classes this role applies lifecycle changes to directly — a set, because the category can change the class. */
  directClasses: readonly AssetClass[];
  /** The viewer's default list class (the success card's "Open the list"). */
  defaultCls: AssetClass;
  /** Where Cancel goes when this tab has no previous page. */
  listHref: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const cancel = useBack(listHref);
  const [pending, startTransition] = useTransition();

  // Card "Asset".
  const [categoryId, setCategoryId] = useState("");
  const [typeId, setTypeId] = useState("");
  const [model, setModel] = useState("");
  const [brand, setBrand] = useState("");
  const [quantityText, setQuantityText] = useState("1");
  const [prefix, setPrefix] = useState("");
  const [rows, setRows] = useState<RegisterRow[]>([{ tag: "", serial: "" }]);
  // Tags this session has written — so "add another" suggests the next free
  // number without waiting for the page's own map to be read again.
  const [written, setWritten] = useState<Record<string, number>>({});
  const [pasteNote, setPasteNote] = useState<string | null>(null);
  // Quantity 1 only (spec §5.3). The status is a sentinel until normalised
  // below against what this class offers, so a class switch never submits a
  // state the new class does not have.
  const [requestedStatus, setRequestedStatus] = useState<CreatableStatus>(DEFAULT_STATUS.IT);
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [loanDueAt, setLoanDueAt] = useState(() => defaultLoanDue(new Date()));
  const [files, setFiles] = useState<StagedDocument[]>([]);

  // Card "Procurement (optional)".
  const [requestId, setRequestId] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [purchasedAt, setPurchasedAt] = useState("");
  const [warrantyUntil, setWarrantyUntil] = useState("");
  const [cost, setCost] = useState("");
  const [invoiceRef, setInvoiceRef] = useState("");
  const [notes, setNotes] = useState("");
  const [invoiceFile, setInvoiceFile] = useState<File | null>(null);

  const [errors, setErrors] = useState<Record<string, string>>({});
  // Set by the first refused submit: from then on a bad tag is marked as the
  // rows change, rather than only when the next submit is pressed.
  const [attempted, setAttempted] = useState(false);
  // Bumped once per refused submit. The focus effect is keyed on this, not on
  // `errors`: Cost sets and clears its own error on blur, and an effect keyed
  // on `errors` would pull focus back into the field just left.
  const [refusals, setRefusals] = useState(0);
  const [banner, setBanner] = useState<string | null>(null);
  const [retryAfter, setRetryAfter] = useState<number | null>(null);
  // Phase 29 R10: which button fired, read from the DOM submitter in `submit`
  // and only ever read back on a later render (the buttons' spinners).
  const [submitted, setSubmitted] = useState<Intent | null>(null);
  const [registered, setRegistered] = useState<{ ids: string[]; tags: string[]; cls: AssetClass; invoiceFailed: boolean } | null>(null);
  const [focusModel, setFocusModel] = useState(0);

  const rootRef = useRef<HTMLFormElement>(null);
  const modelRef = useRef<HTMLInputElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (refusals === 0) return;
    const first = rootRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
    first?.focus();
    first?.scrollIntoView({ block: "center" });
  }, [refusals]);

  // After "add another" (and "Register another batch") the next unit starts at
  // Model — an effect, because the success card may be what is on screen now.
  useEffect(() => {
    if (focusModel > 0) modelRef.current?.focus();
  }, [focusModel]);

  const category = categories.find((c) => c.id === categoryId);
  // Before a category is picked, follow the first one offered — Purchasing
  // staff may see only one class, and the other's words would be wrong.
  const cls: AssetClass = category?.cls ?? categories[0]?.cls ?? "IT";
  const example = CLASS_EXAMPLE[cls];
  const quantity = rows.length;
  const single = quantity === 1;
  const direct = directClasses.includes(cls);
  // Ruling R4: Loan only where the registrant applies it directly — the
  // approval path would lose the loan date and create a loan with none.
  const offered = (CREATABLE_BY_CLASS[cls] as readonly CreatableStatus[]).filter((s) => s !== "TEMPORARY" || direct);
  const status: CreatableStatus = offered.includes(requestedStatus) ? requestedStatus : DEFAULT_STATUS[cls];
  const holder = (HOLDER_STATUSES[cls] as readonly string[]).includes(status);
  const loan = status === "TEMPORARY";

  const runFor = (p: string, count: number): string[] | null => {
    const r = nextTags(p, highestOf(highestByPrefix, written, p), count);
    return r.ok ? r.tags : null;
  };
  const run = prefix ? nextTags(prefix, highestOf(highestByPrefix, written, prefix), quantity) : null;
  // Said as soon as two letters are in; one letter is still being typed.
  const prefixError = errors.prefix ?? (prefix.length === 2 && run && !run.ok ? RUN_REFUSAL[run.reason] : undefined);

  const { hits, flush } = useIdentifierCheck(
    rows.map((r) => r.tag),
    rows.map((r) => r.serial),
    category ? category.cls : null,
  );

  // ── rows ──────────────────────────────────────────────────────────────
  const clearRowErrors = (kind: "tags" | "serials") =>
    setErrors((e) => {
      const keys = Object.keys(e).filter((k) => k === kind || k.startsWith(`${kind}.`));
      if (keys.length === 0) return e;
      const next = { ...e };
      for (const k of keys) delete next[k];
      return next;
    });

  function chooseCategory(id: string) {
    setCategoryId(id);
    setTypeId("");
    const p = preferredPrefix(prefixCountsByCategory[id] ?? []) ?? "";
    setPrefix(p);
    setRows((rs) => retagRows(rs, p ? runFor(p, rs.length) : null));
    clearRowErrors("tags");
  }

  function changePrefix(value: string) {
    const p = value.toUpperCase();
    setPrefix(p);
    const tags = p ? runFor(p, rows.length) : null;
    if (tags) setRows((rs) => retagRows(rs, tags));
    setErrors((e) => {
      if (!("prefix" in e)) return e;
      const next = { ...e };
      delete next.prefix;
      return next;
    });
  }

  const resize = (count: number) => setRows((rs) => (count === rs.length ? rs : resizeRows(rs, count, runFor(prefix, count))));

  function changeQuantity(text: string) {
    setQuantityText(text);
    const n = liveQuantity(text);
    if (n !== null) resize(n);
  }

  function commitQuantity() {
    const n = clampQuantity(quantityText, quantity);
    setQuantityText(String(n));
    resize(n);
  }

  const setRow = (i: number, patch: Partial<RegisterRow>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  function pasteColumn(at: number, values: string[]) {
    const out = pasteSerials(rows, at, values, (count) => runFor(prefix, count));
    setRows(out.rows);
    setQuantityText(String(out.rows.length));
    setPasteNote(
      out.pasted < values.length
        ? `Pasted ${out.pasted} of ${values.length} serials — the rest were not added.`
        : `Pasted ${out.pasted} serials`,
    );
    clearRowErrors("serials");
  }

  const feedback = rowFeedback({ rows, hits, errors, attempted, exampleTag: example.tag });

  // ── procurement ───────────────────────────────────────────────────────
  function choosePurchased(value: string) {
    setPurchasedAt(value);
    // Derived, pre-filled, never blank: purchase + 12 months, only while the
    // warranty is still empty, so a hand-set date is never overwritten.
    if (value && !warrantyUntil) {
      const d = new Date(`${value}T00:00:00Z`);
      d.setUTCFullYear(d.getUTCFullYear() + 1);
      setWarrantyUntil(d.toISOString().slice(0, 10));
    }
  }

  function chooseRequest(id: string) {
    setRequestId(id);
    const r = requests.find((x) => x.id === id);
    // Fill an EMPTY vendor from the request's supplier, never overwrite a chosen
    // one, and only with a supplier the picker can show (an archived one is gone).
    if (r?.vendorId && !vendorId && vendors.some((v) => v.id === r.vendorId)) setVendorId(r.vendorId);
  }

  function normaliseCostField() {
    const r = normaliseCost(cost);
    if (r.ok) {
      setCost(r.value);
      setErrors((e) => {
        if (!("cost" in e)) return e;
        const next = { ...e };
        delete next.cost;
        return next;
      });
    } else setErrors((e) => ({ ...e, cost: MONEY_ERROR }));
  }

  // ── submit ────────────────────────────────────────────────────────────
  /** Keeps what the next unit of the same delivery shares (spec §5.6); clears the rest; starts again at Model. */
  function startAnother(sentTags: string[]) {
    const mine = { ...written };
    for (const t of sentTags.map(tagKey)) {
      if (TAG_SHAPE.test(t)) mine[t.slice(3, 5)] = Math.max(mine[t.slice(3, 5)] ?? 0, Number(t.slice(6)));
    }
    setWritten(mine);
    const next = prefix ? nextTags(prefix, highestOf(highestByPrefix, mine, prefix), 1) : null;
    setRows([{ tag: next?.ok ? next.tags[0] : "", serial: "" }]);
    setQuantityText("1");
    setModel("");
    setBrand("");
    setCost("");
    setNotes("");
    setFiles([]);
    setInvoiceFile(null);
    setRequestedStatus(DEFAULT_STATUS[cls]);
    setAssigneeId(null);
    setLoanDueAt(defaultLoanDue(new Date()));
    setPasteNote(null);
    setErrors({});
    setAttempted(false);
    setBanner(null);
    setRegistered(null);
    setFocusModel((n) => n + 1);
  }

  function refuse(found: Record<string, string>) {
    setErrors(found);
    setAttempted(true);
    setRefusals((n) => n + 1);
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // R10: the button that fired, from the DOM's own record of it.
    const intent: Intent = (e.nativeEvent as SubmitEvent).submitter?.getAttribute("value") === "register-add" ? "register-add" : "register";
    setSubmitted(intent);
    setBanner(null);
    setRetryAfter(null);

    const money = normaliseCost(cost);
    const found: Record<string, string> = {};
    if (!categoryId) found.categoryId = "Pick a category";
    if (model.trim().length < 2) found.model = "Name the model";
    if (prefix && run && !run.ok) found.prefix = RUN_REFUSAL[run.reason];
    if (!money.ok) found.cost = MONEY_ERROR;
    if (single && holder && !assigneeId) found.assigneeId = "Pick who this deploys to";
    if (single && loan && (!loanDueAt || loanDueAt < minLoanDue(new Date()))) found.loanDueAt = "Pick the date the loan ends";
    if (Object.keys(found).length > 0 || feedback.blocked) {
      refuse(found);
      return;
    }
    const costValue = money.ok ? money.value : "";
    const sentTags = rows.map((r) => r.tag);

    startTransition(async () => {
      const res = single
        ? await createAsset({
            tag: rows[0].tag, serial: rows[0].serial, model, brand, categoryId, typeId, purchasedAt, cost: costValue,
            warrantyUntil, vendorId, invoiceRef, notes, requestId,
            requestedStatus: status, assigneeId: holder ? (assigneeId ?? "") : "", loanDueAt: loan ? loanDueAt : "",
          })
        : await registerAssets({
            categoryId,
            typeId: typeId || undefined,
            model,
            tags: sentTags,
            serials: rows.map((r) => r.serial),
            purchasedAt: purchasedAt || undefined,
            cost: costValue || undefined,
            vendorId: vendorId || undefined,
            requestId: requestId || undefined,
            warrantyUntil: warrantyUntil || undefined,
            brand: brand || undefined,
            notes: notes || undefined,
            invoiceRef: invoiceRef || undefined,
          });

      if (!res.ok) {
        if (res.kind === "rate_limited") setRetryAfter(res.retryAfterSec ?? 60);
        else if (res.kind === "validation") {
          const fe = single ? singleRowErrors(res.fieldErrors ?? {}) : (res.fieldErrors ?? {});
          refuse(fe);
          const stray = Object.entries(fe).find(([k]) => !CLAIMED.has(k) && !isRowKey(k));
          if (stray) setBanner(stray[1]);
        } else setBanner(res.message);
        return;
      }

      if ("id" in res.data) {
        // One asset. Documents upload after it exists, in parallel; a thrown
        // upload counts as a failed one and never strands the operator here.
        const id = res.data.id;
        const results = await Promise.all(files.map(async ({ file, kind }) => {
          const fd = new FormData();
          fd.set("assetId", id);
          fd.set("kind", kind);
          fd.set("file", file);
          try {
            return (await uploadDocument(fd)).ok;
          } catch {
            return false;
          }
        }));
        const failed = results.filter((ok) => !ok).length;
        if (failed > 0) router.push(`/inventory/${id}/documents?failed=${failed}&of=${files.length}`);
        else if (intent === "register-add") {
          toast("Registered 1 asset", "settled");
          startAnother(sentTags);
        } else router.push(`/inventory/${id}?created=1`);
        return;
      }

      // A batch. The assets are committed; the invoice failing to attach must
      // read as that, never as the registration having failed.
      const ids = res.data.ids;
      let invoiceFailed = false;
      if (invoiceFile) {
        const fd = new FormData();
        for (const id of ids) fd.append("assetIds", id);
        fd.set("kind", "invoice");
        fd.set("file", invoiceFile);
        try {
          invoiceFailed = !(await uploadBatchDocument(fd)).ok;
        } catch {
          invoiceFailed = true;
        }
      }
      if (intent === "register-add" && !invoiceFailed) {
        toast(`Registered ${ids.length} assets`, "settled");
        startAnother(sentTags);
      } else {
        // The tags this submission sent, frozen — the card must not follow a re-suggested run.
        setRegistered({ ids, tags: sentTags.map(tagKey), cls, invoiceFailed });
      }
    });
  }

  if (registered) {
    return (
      <RegisterSuccess
        tags={registered.tags}
        ids={registered.ids}
        cls={registered.cls}
        defaultCls={defaultCls}
        invoiceFailed={registered.invoiceFailed}
        onAgain={() => startAnother(registered.tags)}
      />
    );
  }

  const byClass = ASSET_CLASSES.map((c) => ({ cls: c, items: categories.filter((x) => x.cls === c) })).filter((g) => g.items.length > 0);
  const typesForCategory = types.filter((t) => t.categoryId === categoryId);

  return (
    <form
      ref={rootRef}
      onSubmit={submit}
      noValidate
      // Spec §5.4: the form submits only from its buttons. Enter in a field
      // never submits it (a scanner sends one after every scan); the rows move
      // focus on Enter themselves, Quantity and Cost settle their value.
      onKeyDown={(e) => {
        const t = e.target;
        if (e.key === "Enter" && t instanceof HTMLInputElement && !["button", "submit", "reset", "file"].includes(t.type)) {
          e.preventDefault();
        }
      }}
      className="flex max-w-[720px] flex-col gap-4"
    >
      {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
      {banner && <Banner tone="fault" title={banner} />}

      <Card>
        <CardHeader title="Asset" />
        <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="Category" required error={errors.categoryId}>
            {(p) => (
              <Select
                id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                value={categoryId}
                autoFocus
                onChange={(e) => chooseCategory(e.target.value)}
              >
                <option value="">Pick a category…</option>
                {byClass.length > 1
                  ? byClass.map((g) => (
                      <optgroup key={g.cls} label={CLASS_LABEL[g.cls]}>
                        {g.items.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </optgroup>
                    ))
                  : categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            )}
          </FormField>
          <FormField label="Type" hint="Leave blank only if no loadout slot should match it." error={errors.typeId}>
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
          <FormField label="Model" required error={errors.model}>
            {(p) => (
              <Input
                id={p.id} ref={modelRef} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                placeholder={example.model}
                value={model}
                onChange={(e) => setModel(e.target.value)}
                onBlur={() => setModel((m) => m.trim())}
              />
            )}
          </FormField>
          <FormField label="Brand" error={errors.brand}>
            {(p) => (
              <Input
                id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                onBlur={() => setBrand((b) => b.trim())}
              />
            )}
          </FormField>
          <FormField label="Quantity" required hint="Between 1 and 200">
            {(p) => (
              <Input
                id={p.id} aria-describedby={p["aria-describedby"]}
                inputMode="numeric"
                value={quantityText}
                onChange={(e) => changeQuantity(e.target.value)}
                onBlur={commitQuantity}
                onKeyDown={(e) => e.key === "Enter" && commitQuantity()}
              />
            )}
          </FormField>
          <FormField label="Prefix" hint={example.prefixHint} error={prefixError}>
            {(p) => (
              <Input
                id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                className="font-mono"
                maxLength={2}
                value={prefix}
                onChange={(e) => changePrefix(e.target.value)}
              />
            )}
          </FormField>

          <RegisterRows
            rows={rows}
            invalidTags={feedback.invalidTags}
            invalidSerials={feedback.invalidSerials}
            tagPlaceholder={example.tag}
            onTag={(i, tag) => {
              setRow(i, { tag });
              clearRowErrors("tags");
            }}
            onSerial={(i, serial) => {
              setRow(i, { serial });
              clearRowErrors("serials");
            }}
            onPasteSerials={pasteColumn}
            onBlur={flush}
            onLastEnter={() => primaryRef.current?.focus()}
          >
            <p className="text-[11px] text-fg-muted">The label is printed after you register.</p>
            {pasteNote && <p role="status" className="text-[11px] text-fg-secondary">{pasteNote}</p>}
            {feedback.lines.map((l) => <FormError key={l.text}>{l.node}</FormError>)}
          </RegisterRows>

          {single && (
            <RegisterInitialState
              cls={cls}
              offered={offered}
              status={status}
              onStatus={setRequestedStatus}
              holder={holder}
              direct={direct}
              employees={employees}
              recentEmployees={recentEmployees}
              assigneeId={assigneeId}
              onAssignee={setAssigneeId}
              loanDueAt={loanDueAt}
              onLoanDue={setLoanDueAt}
              errors={errors}
            />
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Procurement (optional)" />
        <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="Purchase request" hint="Only if this delivery fulfils a completed request." error={errors.requestId}>
            {(p) => (
              <Select
                id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                value={requestId}
                onChange={(e) => chooseRequest(e.target.value)}
              >
                <option value="">—</option>
                {requests.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
              </Select>
            )}
          </FormField>
          <FormField label="Vendor" error={errors.vendorId}>
            {(p) => (
              <EntityCombobox
                id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                options={vendors.map((v) => ({ value: v.id, label: v.name }))}
                recent={recentVendors}
                value={vendorId || null}
                onChange={(id) => setVendorId(id ?? "")}
                placeholder="Type a vendor name…"
              />
            )}
          </FormField>
          <FormField label="Purchased" error={errors.purchasedAt}>
            {(p) => (
              <Input
                id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                type="date"
                value={purchasedAt}
                onChange={(e) => choosePurchased(e.target.value)}
              />
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
          <FormField label="Cost (₱)" error={errors.cost}>
            {(p) => (
              <Input
                id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                inputMode="decimal"
                value={cost}
                onChange={(e) => setCost(e.target.value)}
                onBlur={normaliseCostField}
                onKeyDown={(e) => e.key === "Enter" && normaliseCostField()}
              />
            )}
          </FormField>
          <FormField label="Invoice / receipt no." error={errors.invoiceRef}>
            {(p) => (
              <Input
                id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                value={invoiceRef}
                onChange={(e) => setInvoiceRef(e.target.value)}
                onBlur={() => setInvoiceRef((v) => v.trim())}
              />
            )}
          </FormField>

          <RegisterDocuments
            single={single}
            files={files}
            onFiles={setFiles}
            invoiceFile={invoiceFile}
            onInvoiceFile={setInvoiceFile}
            disabled={pending}
          />

          <FormField label="Notes" error={errors.notes} className="sm:col-span-2">
            {(p) => (
              <Textarea
                id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                onBlur={() => setNotes((v) => v.trim())}
              />
            )}
          </FormField>
        </CardBody>
      </Card>

      <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center gap-3 border-t border-border bg-surface px-1 py-3">
        <Button type="button" variant="ghost" disabled={pending} onClick={cancel}>Cancel</Button>
        {/* Both submits disable while either is in flight (Phase 29 M-4); the one that fired keeps its spinner. */}
        <Button
          ref={primaryRef} type="submit" name="intent" value="register" variant="primary"
          disabled={pending} loading={pending && submitted === "register"}
        >
          {single ? "Register 1 asset" : `Register ${quantity} assets`}
        </Button>
        <Button
          type="submit" name="intent" value="register-add" variant="secondary"
          disabled={pending} loading={pending && submitted === "register-add"}
        >
          Register and add another
        </Button>
        {!single && (
          <span className="ml-auto text-[11px] tabular-nums text-fg-muted">
            {serialsEntered(rows)} of {quantity} serials entered
          </span>
        )}
      </div>
    </form>
  );
}
