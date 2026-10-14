"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { AssetClass } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Banner } from "@/components/ui/banner";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { useBack } from "@/components/ui/back-link";
import { EntityCombobox, type ComboOption } from "@/components/patterns/entity-combobox";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { cn } from "@/lib/cn";
import { CLASS_EXAMPLE, CREATABLE_BY_CLASS, DEFAULT_STATUS, HOLDER_STATUSES, withClsQS } from "@/lib/asset-class";
import type { CreatableStatus } from "@/lib/asset-rules";
import { defaultLoanDue, minLoanDue } from "@/lib/lifecycle";
import { nextTags, preferredPrefix, RUN_REFUSAL } from "@/lib/receiving";
import { MONEY_ERROR, normaliseCost } from "@/lib/register-input";
import {
  clampQuantity, liveQuantity, MAX_BATCH, pasteSerials, resizeRows, retagRows, singleRowErrors, type RegisterRow,
} from "@/lib/register-rows";
import { carryDocuments } from "@/lib/register-documents";
import { categoryNoun } from "@/lib/register-catalog";
import { resolveModelType } from "@/lib/known-models";
import { serialProblems } from "@/lib/serial-rules";
import { qrBase } from "@/lib/label-qr";
import { TAG_SHAPE, tagKey } from "@/lib/tag-key";
import { createAsset } from "@/server/modules/inventory/actions";
import { registerAssets } from "@/server/modules/purchases/receiving";
import { uploadBatchDocument, uploadDocument } from "@/server/modules/inventory/document-actions";
import type { CatalogCategory } from "@/server/modules/inventory/register-queries";
import { CategoryCards } from "./category-cards";
import { LabelCell } from "./label-cell";
import { ModelCombobox } from "./model-combobox";
import { RegisterDocuments, type StagedDocument } from "./register-documents";
import { RegisterInitialState } from "./register-initial-state";
import { rowFeedback } from "./register-rows";
import { SERIAL_REQUIRED, SerialSection } from "./serial-section";
import { useIdentifierCheck } from "./use-identifier-check";

type Intent = "register" | "register-add";

/** Every error key a field on this form shows; anything else reaches the banner rather than dead-ending. */
const CLAIMED = new Set([
  "categoryId", "typeId", "model", "brand", "prefix", "tags", "serials", "requestedStatus", "assigneeId", "loanDueAt",
  "requestId", "vendorId", "purchasedAt", "warrantyUntil", "cost", "invoiceRef", "notes",
  "receiptRef", "warrantyCoveredBy", "warrantyContact", "fees",
]);
const isRowKey = (key: string) => /^(tags|serials)[.][0-9]+$/.test(key);

/** The highest number a registered tag under `prefix` carries, from the page's map and this session's own writes. */
function highestOf(server: Record<string, number | null>, mine: Record<string, number>, prefix: string): number | null {
  const a = server[prefix];
  const b = mine[prefix];
  return a == null && b == null ? null : Math.max(a ?? 0, b ?? 0);
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Phase 34 (spec §4): the Register tab — one screen, top to bottom: what
 * (category cards), the model (which sets the type) and how many, the serial,
 * where it goes beside the live actual-size label, purchase details, and the
 * footer that says what is still missing. Quantity 1 submits through
 * `createAsset` with its initial state and holder; more submits the batch
 * through `registerAssets`. Both land on the Labels tab with the new
 * purchase record ticked (plan P-5). The submit is always enabled: client
 * checks set every error at once, the server's refusals merge in, and the
 * first invalid field takes focus.
 */
export function RegisterForm({
  catalog,
  vendors,
  recentVendors,
  employees,
  recentEmployees,
  requests,
  prefixCountsByCategory,
  highestByPrefix,
  directClasses,
  listHref,
  baseUrl,
}: {
  catalog: CatalogCategory[];
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
  /** The viewer's default list class. */
  defaultCls: AssetClass;
  /** Where Cancel goes when this tab has no previous page. */
  listHref: string;
  /** `APP_BASE_URL`, for the live label's QR. */
  baseUrl: string | undefined;
}) {
  const router = useRouter();
  const toast = useToast();
  const cancel = useBack(listHref);
  const [pending, startTransition] = useTransition();

  // What, model and quantity.
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
  // Quantity 1 only (spec §4.4). The status is a sentinel until normalised
  // below against what this class offers, so a class switch never submits a
  // state the new class does not have.
  const [requestedStatus, setRequestedStatus] = useState<CreatableStatus>(DEFAULT_STATUS.IT);
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [loanDueAt, setLoanDueAt] = useState(() => defaultLoanDue(new Date()));
  const [files, setFiles] = useState<StagedDocument[]>([]);

  // Purchase (Task 7 replaces this block with the Purchase and warranty section).
  const [requestId, setRequestId] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [purchasedAt, setPurchasedAt] = useState("");
  const [warrantyUntil, setWarrantyUntil] = useState("");
  const [cost, setCost] = useState("");
  const [invoiceRef, setInvoiceRef] = useState("");
  const [notes, setNotes] = useState("");
  const [invoiceFile, setInvoiceFile] = useState<File | null>(null);

  const [errors, setErrors] = useState<Record<string, string>>({});
  // Set by the first refused submit: from then on a gap is marked as the
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
  const [focusModel, setFocusModel] = useState(0);

  const rootRef = useRef<HTMLFormElement>(null);
  const modelRef = useRef<HTMLInputElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  // The category is the first field, and its cards are buttons, not an
  // `aria-invalid` field: a refusal that names it focuses the first card.
  const categoryFirst = useRef(false);

  useEffect(() => {
    if (refusals === 0) return;
    const first = categoryFirst.current
      ? rootRef.current?.querySelector<HTMLElement>("[data-category-card]")
      : rootRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
    first?.focus();
    first?.scrollIntoView({ block: "center" });
  }, [refusals]);

  // After "add another" the next unit starts at Model.
  useEffect(() => {
    if (focusModel > 0) modelRef.current?.focus();
  }, [focusModel]);

  const category = catalog.find((c) => c.id === categoryId);
  // Before a category is picked, follow the first one offered — Purchasing
  // staff may see only one class, and the other's words would be wrong.
  const cls: AssetClass = category?.cls ?? catalog[0]?.cls ?? "IT";
  const example = CLASS_EXAMPLE[cls];
  const quantity = rows.length;
  const single = quantity === 1;
  const direct = directClasses.includes(cls);
  // Ruling R4: Lend only where the registrant applies it directly — the
  // approval path would lose the loan date and create a loan with none.
  const offered = (CREATABLE_BY_CLASS[cls] as readonly CreatableStatus[]).filter((s) => s !== "TEMPORARY" || direct);
  const status: CreatableStatus = offered.includes(requestedStatus) ? requestedStatus : DEFAULT_STATUS[cls];
  const holder = (HOLDER_STATUSES[cls] as readonly string[]).includes(status);
  const loan = status === "TEMPORARY";
  const types = category?.types ?? [];
  const models = category?.models ?? [];
  const newModelNeedsType = !!category && model.trim() !== "" && !resolveModelType(models, model).known && types.length > 1 && !typeId;

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

  const clearError = (key: string) =>
    setErrors((e) => {
      if (!(key in e)) return e;
      const next = { ...e };
      delete next[key];
      return next;
    });

  /** Spec §7.1: the tags' own prefix wins; a category with no tags yet falls back to its seeded `tagPrefix`. */
  const prefixFor = (id: string) =>
    preferredPrefix(prefixCountsByCategory[id] ?? []) ?? catalog.find((c) => c.id === id)?.tagPrefix ?? "";

  function chooseCategory(id: string) {
    if (id === categoryId) return;
    setCategoryId(id);
    setTypeId("");
    const p = prefixFor(id);
    setPrefix(p);
    setRows((rs) => retagRows(rs, p ? runFor(p, rs.length) : null));
    clearRowErrors("tags");
    clearError("categoryId");
  }

  function changePrefix(value: string) {
    const p = value.toUpperCase();
    setPrefix(p);
    const tags = p ? runFor(p, rows.length) : null;
    if (tags) setRows((rs) => retagRows(rs, tags));
    clearError("prefix");
  }

  // Review R11: the documents staged for one quantity carry across to the other.
  function carryTo(count: number) {
    const next = carryDocuments({ files, invoice: invoiceFile }, quantity, count);
    setFiles(next.files);
    setInvoiceFile(next.invoice);
  }

  function resize(count: number) {
    if (count === quantity) return;
    carryTo(count);
    setRows((rs) => resizeRows(rs, count, runFor(prefix, count)));
  }

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

  function setQuantity(n: number) {
    const next = Math.min(MAX_BATCH, Math.max(1, n));
    setQuantityText(String(next));
    resize(next);
  }

  const setRow = (i: number, patch: Partial<RegisterRow>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  function pasteColumn(at: number, values: string[]) {
    const out = pasteSerials(rows, at, values, (count) => runFor(prefix, count));
    carryTo(out.rows.length);
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
  const problems = serialProblems(rows.map((r) => r.serial), cls);
  const requiredRows = problems.flatMap((p, i) => (p === "required" ? [i] : []));
  const duplicateRows = problems.flatMap((p, i) => (p === "duplicate" ? [i] : []));
  const invalidSerials = new Set([...feedback.invalidSerials, ...duplicateRows, ...(attempted ? requiredRows : [])]);

  /** Focus the checked "Where does it go" choice — where Enter in the one-unit serial box moves on to. */
  function focusWhere() {
    rootRef.current?.querySelector<HTMLInputElement>('[role="radiogroup"][aria-label="Where does it go"] input:checked')?.focus();
  }

  // ── purchase (temporary, Task 7) ──────────────────────────────────────
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
      clearError("cost");
    } else setErrors((e) => ({ ...e, cost: MONEY_ERROR }));
  }

  // ── status line (spec §4.6) ───────────────────────────────────────────
  const still: string[] = [];
  if (!categoryId) still.push("a category");
  if (model.trim().length < 2) still.push("a model");
  if (newModelNeedsType) still.push("the type for this new model");
  if (requiredRows.length > 0) still.push(plural(requiredRows.length, "serial", "serials"));
  if (duplicateRows.length > 0) still.push(plural(duplicateRows.length, "duplicate to fix", "duplicates to fix"));
  if (single && holder && !assigneeId) still.push("who gets it");
  if (single && loan && !loanDueAt) still.push("the loan end date");

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
    setFocusModel((n) => n + 1);
  }

  function refuse(found: Record<string, string>) {
    categoryFirst.current = "categoryId" in found;
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
    if (newModelNeedsType) found.typeId = "Pick the type for this new model";
    if (prefix && run && !run.ok) found.prefix = RUN_REFUSAL[run.reason];
    // Spec §4.3: nothing is saved with a gap; the copy is the server's own (Task 3).
    if (single) {
      if (problems[0] === "required") found.serials = SERIAL_REQUIRED;
    } else {
      problems.forEach((p, i) => {
        if (p === "required") found[`serials.${i}`] = `Row ${i + 1} · ${rows[i].tag || "this row"} needs a serial`;
        else if (p === "duplicate") found[`serials.${i}`] = `Row ${i + 1} · serial ${rows[i].serial.trim()} appears twice in this batch`;
      });
    }
    if (!money.ok) found.cost = MONEY_ERROR;
    if (single && holder && !assigneeId) found.assigneeId = "Pick who gets it";
    if (single && loan && (!loanDueAt || loanDueAt < minLoanDue(new Date()))) found.loanDueAt = "Pick the date the loan ends";
    if (Object.keys(found).length > 0 || feedback.blocked) {
      refuse(found);
      return;
    }
    const costValue = money.ok ? money.value : "";
    const sentTags = rows.map((r) => r.tag);
    const sentCls = cls;

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

      // Plan P-5: every registration lands on the Labels tab with its purchase record ticked.
      const recordId = res.data.purchaseRecordId;
      const labels = (extra = "") => "/inventory/labels" + withClsQS(`?just=${encodeURIComponent(recordId)}${extra}`, sentCls);

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
        } else router.push(labels());
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
      if (invoiceFailed) router.push(labels("&docsFailed=1"));
      else if (intent === "register-add") {
        toast(`Registered ${ids.length} assets`, "settled");
        startAnother(sentTags);
      } else router.push(labels());
    });
  }

  const noun = category ? categoryNoun(category.name, quantity) : quantity === 1 ? "asset" : "assets";
  const where = cls === "IT" ? "spare stock" : "storage";

  return (
    <form
      ref={rootRef}
      onSubmit={submit}
      noValidate
      // The form submits only from its buttons. Enter in a field never submits
      // it (a scanner sends one after every scan); the serial and the rows move
      // focus on Enter themselves, Quantity and Cost settle their value.
      onKeyDown={(e) => {
        const t = e.target;
        if (e.key === "Enter" && t instanceof HTMLInputElement && !["button", "submit", "reset", "file"].includes(t.type)) {
          e.preventDefault();
        }
      }}
      className="flex max-w-[1040px] flex-col gap-4"
    >
      {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
      {banner && <Banner tone="fault" title={banner} />}

      <div className="flex flex-col gap-6 rounded-[14px] border border-border bg-surface p-[26px_28px] max-sm:p-4">
        <CategoryCards
          catalog={catalog}
          value={categoryId}
          onChange={chooseCategory}
          invalid={!!errors.categoryId}
          error={errors.categoryId}
        />

        <section aria-labelledby="register-model-title" className="flex flex-col gap-3 border-t border-border pt-6">
          <h2 id="register-model-title" className="sec">Model and quantity</h2>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] items-start gap-5">
            <FormField label="Model" required error={errors.model}>
              {(p) => (
                <ModelCombobox
                  id={p.id}
                  inputRef={modelRef}
                  describedBy={p["aria-describedby"]}
                  invalid={p.invalid}
                  models={models}
                  types={types}
                  value={model}
                  onValue={(v) => {
                    setModel(v);
                    clearError("model");
                  }}
                  typeId={typeId}
                  onType={(id) => {
                    setTypeId(id);
                    clearError("typeId");
                  }}
                  typeError={errors.typeId}
                  placeholder={example.model}
                />
              )}
            </FormField>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="register-quantity" className="text-xs font-medium text-fg">
                How many<span aria-hidden style={{ color: "var(--required-mark)" }}> *</span>
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex items-stretch overflow-hidden rounded-(--radius-card) border border-border-strong bg-surface">
                  <button
                    type="button"
                    aria-label="One fewer"
                    disabled={quantity <= 1}
                    onClick={() => setQuantity(quantity - 1)}
                    className="grid w-9 place-items-center text-[16px] text-fg-secondary hover:bg-surface-subtle disabled:opacity-40"
                  >
                    −
                  </button>
                  <input
                    id="register-quantity"
                    inputMode="numeric"
                    aria-describedby="register-quantity-hint"
                    autoComplete="off"
                    className="w-14 border-x border-border-strong bg-surface py-2 text-center text-[14px] tabular-nums text-fg focus:outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--accent)]"
                    value={quantityText}
                    onChange={(e) => changeQuantity(e.target.value)}
                    onBlur={commitQuantity}
                    onKeyDown={(e) => e.key === "Enter" && commitQuantity()}
                  />
                  <button
                    type="button"
                    aria-label="One more"
                    disabled={quantity >= MAX_BATCH}
                    onClick={() => setQuantity(quantity + 1)}
                    className="grid w-9 place-items-center text-[16px] text-fg-secondary hover:bg-surface-subtle disabled:opacity-40"
                  >
                    +
                  </button>
                </div>
                {[5, 10].map((n) => (
                  <button
                    key={n}
                    type="button"
                    aria-pressed={quantity === n}
                    onClick={() => setQuantity(n)}
                    className={cn(
                      "h-9 min-w-10 rounded-(--radius-btn) border px-3 text-[13px] font-medium tabular-nums",
                      quantity === n ? "border-accent bg-accent-soft text-accent-soft-text" : "border-border-strong bg-surface text-fg-secondary hover:bg-surface-subtle",
                    )}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <p id="register-quantity-hint" className="text-[11px] text-fg-muted">Between 1 and {MAX_BATCH}</p>
            </div>
          </div>
        </section>

        <SerialSection
          cls={cls}
          rows={rows}
          problems={problems}
          attempted={attempted}
          hits={hits}
          onSerial={(i, serial) => {
            setRow(i, { serial });
            clearRowErrors("serials");
          }}
          onPasteSerials={pasteColumn}
          onTag={(i, tag) => {
            setRow(i, { tag });
            clearRowErrors("tags");
          }}
          onLastEnter={single ? focusWhere : () => primaryRef.current?.focus()}
          invalidTags={feedback.invalidTags}
          invalidSerials={invalidSerials}
          lines={feedback.lines}
          tagPlaceholder={example.tag}
          pasteNote={pasteNote}
          onBlur={flush}
        />

        <section aria-labelledby="register-where-title" className="flex flex-col gap-3 border-t border-border pt-6">
          <h2 id="register-where-title" className="sec">Where does it go?</h2>
          <div className="flex flex-wrap items-start gap-x-8 gap-y-5">
            <div className="min-w-[260px] flex-1">
              {single ? (
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
              ) : (
                <p className="rounded-(--radius-card) bg-surface-subtle px-3 py-2.5 text-[12.5px] text-fg-muted">
                  All {quantity} go to {where}. To hand one out, register it on its own.
                </p>
              )}
            </div>
            {/* Spec §4.4: the label at actual size (ruling R2: no zoom — LabelCell carries its own mm box). */}
            <figure className="m-0 flex flex-col items-start gap-2">
              <div className={cn("relative", !single && "mr-[8px] mb-[8px]")}>
                {!single && (
                  <>
                    <div aria-hidden className="absolute inset-0 translate-x-[8px] translate-y-[8px] rounded-[6px] border border-border bg-surface" />
                    <div aria-hidden className="absolute inset-0 translate-x-[4px] translate-y-[4px] rounded-[6px] border border-border bg-surface" />
                  </>
                )}
                <div className="relative overflow-hidden rounded-[6px] border border-border-strong bg-white shadow-card">
                  <LabelCell
                    tag={rows[0].tag || example.tag}
                    model={model.trim() || category?.name || example.model}
                    category={category?.name ?? ""}
                    base={qrBase(baseUrl)}
                  />
                </div>
              </div>
              <figcaption className="text-[11px] text-fg-muted">
                {single ? "Your label, actual size" : `First of ${quantity} labels, actual size`}
              </figcaption>
            </figure>
          </div>
        </section>

        {/* Task 7 replaces this block with the Purchase and warranty section. */}
        <section aria-labelledby="register-purchase-title" className="flex flex-col gap-3 border-t border-border pt-6">
          <h2 id="register-purchase-title" className="sec">Purchase and warranty</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
          </div>
        </section>

        <div className="sticky bottom-0 z-10 flex flex-wrap items-center gap-3 border-t border-border bg-surface py-4">
          <p
            aria-live="polite"
            className={cn(
              "mr-auto text-[12.5px] font-medium",
              still.length > 0 ? "text-[var(--st-attention-text)]" : "text-[var(--st-settled-text)]",
            )}
          >
            {still.length > 0 ? `Still needed: ${still.join(", ")}` : "Ready to register"}
          </p>
          <Button type="button" variant="ghost" disabled={pending} onClick={cancel}>Cancel</Button>
          {/* Both submits disable while either is in flight (Phase 29 M-4); the one that fired keeps its spinner. */}
          <Button
            type="submit" name="intent" value="register-add" variant="secondary"
            disabled={pending} loading={pending && submitted === "register-add"}
          >
            Register and add another
          </Button>
          <Button
            ref={primaryRef} type="submit" name="intent" value="register" variant="primary"
            disabled={pending} loading={pending && submitted === "register"}
          >
            {`Register ${quantity} ${noun}`}
          </Button>
        </div>
      </div>
    </form>
  );
}
