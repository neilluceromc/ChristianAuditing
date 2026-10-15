"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { AssetClass } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Banner } from "@/components/ui/banner";
import { FormField } from "@/components/ui/form-field";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { useBack } from "@/components/ui/back-link";
import type { ComboOption } from "@/components/patterns/entity-combobox";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { cn } from "@/lib/cn";
import { CLASS_EXAMPLE, CREATABLE_BY_CLASS, DEFAULT_STATUS, HOLDER_STATUSES, withClsQS } from "@/lib/asset-class";
import type { CreatableStatus } from "@/lib/asset-rules";
import { defaultLoanDue, minLoanDue } from "@/lib/lifecycle";
import { MONEY_ERROR } from "@/lib/register-input";
import {
  centavosToDecimalString, formatPeso, moneyToCentavos, warrantyOnDate, warrantyOnLength, warrantyOnTyped, type WarrantyState,
} from "@/lib/purchase-summary";
import {
  clampQuantity, liveQuantity, MAX_BATCH, pasteColumn as pasteRows, resizeRows, singleRowErrors, type RegisterRow,
} from "@/lib/register-rows";
import { categoryNoun } from "@/lib/register-catalog";
import { typeAfterCategoryChange, typeChoice, TYPE_REQUIRED } from "@/lib/register-type";
import { serialProblems } from "@/lib/serial-rules";
import { qrBase } from "@/lib/label-qr";
import { createAsset } from "@/server/modules/inventory/actions";
import { registerAssets } from "@/server/modules/purchases/receiving";
import { uploadBatchDocument, uploadDocument } from "@/server/modules/inventory/document-actions";
import type { CatalogCategory } from "@/server/modules/inventory/register-queries";
import { CategoryCards } from "./category-cards";
import { EMPTY_SLOTS, slotUploads, type SlotFiles } from "./document-slots";
import { LabelCell } from "./label-cell";
import { ModelCombobox } from "./model-combobox";
import { PURCHASE_KEYS, PurchaseSection } from "./purchase-section";
import { RegisterInitialState } from "./register-initial-state";
import { rowFeedback } from "./register-rows";
import { SERIAL_REQUIRED, SerialSection } from "./serial-section";
import { useIdentifierCheck } from "./use-identifier-check";

type Intent = "register" | "register-add";

/** Every error key a field on this form shows; anything else reaches the banner rather than dead-ending. */
const CLAIMED = new Set([
  "categoryId", "typeId", "model", "brand", "tags", "serials", "requestedStatus", "assigneeId", "loanDueAt",
  "requestId", "vendorId", "purchasedAt", "warrantyUntil", "cost", "invoiceRef", "notes",
  "receiptRef", "warrantyCoveredBy", "warrantyContact", "fees",
]);
const isRowKey = (key: string) => /^(tags|serials)[.][0-9]+$/.test(key);

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Phase 34 (spec §4), Phase 36: the Register tab — one screen, top to bottom: what
 * (category cards), the model, the type (asked, never taken from the model) and how many,
 * the tag and serial staff type, where it goes beside the live actual-size label,
 * purchase details, and the footer that says what is still missing. Quantity 1 submits through
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
  const [rows, setRows] = useState<RegisterRow[]>([{ tag: "", serial: "" }]);
  const [pasteNote, setPasteNote] = useState<string | null>(null);
  // Quantity 1 only (spec §4.4). The status is a sentinel until normalised
  // below against what this class offers, so a class switch never submits a
  // state the new class does not have.
  const [requestedStatus, setRequestedStatus] = useState<CreatableStatus>(DEFAULT_STATUS.IT);
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [loanDueAt, setLoanDueAt] = useState(() => defaultLoanDue(new Date()));

  // Purchase and warranty (spec §4.5) — closed until opened.
  const [purchaseOpen, setPurchaseOpen] = useState(false);
  const [requestId, setRequestId] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [purchasedAt, setPurchasedAt] = useState("");
  const [invoiceRef, setInvoiceRef] = useState("");
  const [receiptRef, setReceiptRef] = useState("");
  const [cost, setCost] = useState("");
  const [fees, setFees] = useState("");
  // Review Focus 4: the length, the date and whether it was typed by hand move together.
  const [warranty, setWarranty] = useState<WarrantyState>({ months: null, until: "", manual: false });
  const [coveredBy, setCoveredBy] = useState("");
  const [contact, setContact] = useState("");
  const [notes, setNotes] = useState("");
  const [slots, setSlots] = useState<SlotFiles>(EMPTY_SLOTS);

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

  // After "add another" the next unit starts at its serial — the category, model and type carry over
  // (spec §3, ruling R7). Model when there is no serial box to go to.
  useEffect(() => {
    if (focusModel === 0) return;
    const serial = rootRef.current?.querySelector<HTMLInputElement>("#register-serial");
    (serial ?? modelRef.current)?.focus();
  }, [focusModel]);

  const vendorOptions: ComboOption[] = vendors.map((v) => ({ value: v.id, label: v.name }));
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
  // Phase 36 (spec §3.1): a category with several types asks for one; one type is set silently; none leaves it empty.
  const typeAsk = typeChoice(types);

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

  function chooseCategory(id: string) {
    if (id === categoryId) return;
    setCategoryId(id);
    // The type never survives a category change: a 1-type category sets its only type, any other starts empty.
    setTypeId(typeChoice(catalog.find((c) => c.id === id)?.types ?? []).auto ?? typeAfterCategoryChange());
    clearError("typeId");
    clearError("categoryId");
  }

  function resize(count: number) {
    if (count === quantity) return;
    setRows((rs) => resizeRows(rs, count));
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

  function pasteColumn(field: "tag" | "serial", at: number, values: string[]) {
    const out = pasteRows(rows, at, values, field);
    const word = field === "tag" ? "tags" : "serials";
    setRows(out.rows);
    setQuantityText(String(out.rows.length));
    setPasteNote(
      out.pasted < values.length
        ? `Pasted ${out.pasted} of ${values.length} ${word} — the rest were not added.`
        : `Pasted ${out.pasted} ${word}`,
    );
    clearRowErrors(field === "tag" ? "tags" : "serials");
  }

  const feedback = rowFeedback({ rows, hits, errors, attempted });
  const problems = serialProblems(rows.map((r) => r.serial), cls);
  const requiredRows = problems.flatMap((p, i) => (p === "required" ? [i] : []));
  const duplicateRows = problems.flatMap((p, i) => (p === "duplicate" ? [i] : []));
  const invalidSerials = new Set([...feedback.invalidSerials, ...duplicateRows, ...(attempted ? requiredRows : [])]);

  /** Focus the checked "Where does it go" choice — where Enter in the one-unit serial box moves on to. */
  function focusWhere() {
    rootRef.current?.querySelector<HTMLInputElement>('[role="radiogroup"][aria-label="Where does it go"] input:checked')?.focus();
  }

  // ── purchase and warranty (spec §4.5) ─────────────────────────────────
  // Review Focus 4 and ruling R12: the date follows the length from the purchase
  // date. A hand-typed date survives a later purchase-date change; pressing a
  // length button is an explicit choice that re-derives it and drops the typed date.
  function choosePurchased(value: string) {
    setPurchasedAt(value);
    setWarranty((w) => warrantyOnDate(w, value));
    clearError("purchasedAt");
    clearError("warrantyUntil");
  }

  function chooseLength(months: number) {
    setWarranty((w) => warrantyOnLength(w, purchasedAt, months));
    clearError("warrantyUntil");
  }

  function typeWarrantyUntil(value: string) {
    setWarranty((w) => warrantyOnTyped(w, value));
    clearError("warrantyUntil");
  }

  function chooseRequest(id: string) {
    setRequestId(id);
    const r = requests.find((x) => x.id === id);
    // Fill an EMPTY vendor from the request's supplier, never overwrite a chosen
    // one, and only with a supplier the picker can show (an archived one is gone).
    if (r?.vendorId && !vendorId && vendors.some((v) => v.id === r.vendorId)) setVendorId(r.vendorId);
  }

  /** Money settles on blur: `68,500` → `68,500.00`; anything unreadable says so and keeps what was typed. */
  function normaliseMoney(key: "cost" | "fees") {
    const text = key === "cost" ? cost : fees;
    const set = key === "cost" ? setCost : setFees;
    const c = moneyToCentavos(text);
    if (c === "bad") {
      setErrors((e) => ({ ...e, [key]: MONEY_ERROR }));
      return;
    }
    set(c === null ? "" : formatPeso(c).slice(1));
    clearError(key);
  }

  // ── status line (spec §4.6) ───────────────────────────────────────────
  const still: string[] = [];
  if (!categoryId) still.push("a category");
  if (model.trim().length < 2) still.push("a model");
  if (typeAsk.required && !typeId) still.push("the type");
  const emptyTags = rows.filter((r) => !r.tag.trim()).length;
  if (emptyTags > 0) still.push(plural(emptyTags, "tag", "tags"));
  if (requiredRows.length > 0) still.push(plural(requiredRows.length, "serial", "serials"));
  if (duplicateRows.length > 0) still.push(plural(duplicateRows.length, "duplicate to fix", "duplicates to fix"));
  if (single && holder && !assigneeId) still.push("who gets it");
  if (single && loan && !loanDueAt) still.push("the loan end date");

  // ── submit ────────────────────────────────────────────────────────────
  /**
   * Keeps what the next unit of the same delivery shares — the category, the model and its type
   * (spec §3, ruling R7), the vendor, dates, request, invoice no. and warranty (length, until,
   * covered by) — and clears the tags and serials (one empty row), holder, loan date, brand, cost, fees,
   * OR no., the repair contact, notes and the documents.
   */
  function startAnother() {
    setRows([{ tag: "", serial: "" }]);
    setQuantityText("1");
    setBrand("");
    setCost("");
    setFees("");
    setReceiptRef("");
    setContact("");
    setNotes("");
    setSlots(EMPTY_SLOTS);
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
    // A refusal inside the closed Purchase section opens it, so the field it names can take focus.
    if (PURCHASE_KEYS.some((k) => k in found)) setPurchaseOpen(true);
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

    const unit = moneyToCentavos(cost);
    const fee = moneyToCentavos(fees);
    const found: Record<string, string> = {};
    if (!categoryId) found.categoryId = "Pick a category";
    if (model.trim().length < 2) found.model = "Name the model";
    if (typeAsk.required && !typeId) found.typeId = TYPE_REQUIRED;
    // Spec §4.3: nothing is saved with a gap; the copy is the server's own (Task 3).
    if (single) {
      if (problems[0] === "required") found.serials = SERIAL_REQUIRED;
    } else {
      problems.forEach((p, i) => {
        if (p === "required") found[`serials.${i}`] = `Row ${i + 1} · ${rows[i].tag || "this row"} needs a serial`;
        else if (p === "duplicate") found[`serials.${i}`] = `Row ${i + 1} · serial ${rows[i].serial.trim()} appears twice in this batch`;
      });
    }
    if (unit === "bad") found.cost = MONEY_ERROR;
    if (fee === "bad") found.fees = MONEY_ERROR;
    if (single && holder && !assigneeId) found.assigneeId = "Pick who gets it";
    if (single && loan && (!loanDueAt || loanDueAt < minLoanDue(new Date()))) found.loanDueAt = "Pick the date the loan ends";
    if (Object.keys(found).length > 0 || feedback.blocked || unit === "bad" || fee === "bad") {
      refuse(found);
      return;
    }
    const costValue = unit === null ? "" : centavosToDecimalString(unit);
    const feesValue = fee === null ? "" : centavosToDecimalString(fee);
    const warrantyUntil = warranty.until;
    const sentTags = rows.map((r) => r.tag);
    const sentCls = cls;
    const uploads = slotUploads(slots);

    startTransition(async () => {
      const res = single
        ? await createAsset({
            tag: rows[0].tag, serial: rows[0].serial, model, brand, categoryId, typeId, purchasedAt, cost: costValue,
            warrantyUntil, vendorId, invoiceRef, notes, requestId,
            receiptRef, fees: feesValue, warrantyCoveredBy: coveredBy, warrantyContact: contact,
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
            fees: feesValue || undefined,
            vendorId: vendorId || undefined,
            requestId: requestId || undefined,
            warrantyUntil: warrantyUntil || undefined,
            brand: brand || undefined,
            notes: notes || undefined,
            invoiceRef: invoiceRef || undefined,
            receiptRef: receiptRef || undefined,
            warrantyCoveredBy: coveredBy || undefined,
            warrantyContact: contact || undefined,
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
        const results = await Promise.all(uploads.map(async ({ file, kind }) => {
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
        if (failed > 0) router.push(`/inventory/${id}/documents?failed=${failed}&of=${uploads.length}`);
        else if (intent === "register-add") {
          toast("Registered 1 asset", "settled");
          startAnother();
        } else router.push(labels());
        return;
      }

      // A batch: each file is saved on every unit. The assets are committed; a
      // file failing to attach must read as that, never as the registration having failed.
      const ids = res.data.ids;
      const results = await Promise.all(uploads.map(async ({ file, kind }) => {
        const fd = new FormData();
        for (const id of ids) fd.append("assetIds", id);
        fd.set("kind", kind);
        fd.set("file", file);
        try {
          return (await uploadBatchDocument(fd)).ok;
        } catch {
          return false;
        }
      }));
      const failed = results.filter((ok) => !ok).length;
      if (failed > 0) router.push(labels(`&docsFailed=${failed}`));
      else if (intent === "register-add") {
        toast(`Registered ${ids.length} assets`, "settled");
        startAnother();
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
                  value={model}
                  onValue={(v) => {
                    setModel(v);
                    clearError("model");
                  }}
                  placeholder={example.model}
                />
              )}
            </FormField>

            {typeAsk.show && (
              <FormField label="Type" required error={errors.typeId}>
                {(p) => (
                  <Select
                    id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                    required
                    value={typeId}
                    onChange={(e) => {
                      setTypeId(e.target.value);
                      clearError("typeId");
                    }}
                  >
                    <option value="">Pick a type…</option>
                    {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </Select>
                )}
              </FormField>
            )}

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
          onPasteSerials={(i, values) => pasteColumn("serial", i, values)}
          onPasteTags={(i, values) => pasteColumn("tag", i, values)}
          onTag={(i, tag) => {
            setRow(i, { tag });
            clearRowErrors("tags");
          }}
          onLastEnter={single ? focusWhere : () => primaryRef.current?.focus()}
          invalidTags={feedback.invalidTags}
          invalidSerials={invalidSerials}
          lines={feedback.lines}
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

        <PurchaseSection
          open={purchaseOpen}
          onOpen={setPurchaseOpen}
          single={single}
          quantity={quantity}
          requests={requests}
          requestId={requestId}
          onRequest={(id) => {
            chooseRequest(id);
            clearError("requestId");
          }}
          vendors={vendorOptions}
          recentVendors={recentVendors}
          vendorId={vendorId}
          onVendor={(id) => {
            setVendorId(id ?? "");
            clearError("vendorId");
          }}
          purchasedAt={purchasedAt}
          onPurchased={choosePurchased}
          invoiceRef={invoiceRef}
          onInvoice={setInvoiceRef}
          receiptRef={receiptRef}
          onReceipt={setReceiptRef}
          cost={cost}
          onCost={setCost}
          fees={fees}
          onFees={setFees}
          onMoneyBlur={normaliseMoney}
          warrantyMonths={warranty.months}
          onWarrantyMonths={chooseLength}
          warrantyUntil={warranty.until}
          onWarrantyUntil={typeWarrantyUntil}
          warrantyManual={warranty.manual}
          coveredBy={coveredBy}
          onCoveredBy={(v) => {
            setCoveredBy(v);
            clearError("warrantyCoveredBy");
          }}
          contact={contact}
          onContact={setContact}
          brand={brand}
          onBrand={setBrand}
          notes={notes}
          onNotes={setNotes}
          slots={slots}
          onSlots={setSlots}
          errors={errors}
          disabled={pending}
        />

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
