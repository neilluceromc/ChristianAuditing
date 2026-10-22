"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { AssetClass, PurchaseOrderState } from "@prisma/client";
import { Banner } from "@/components/ui/banner";
import { Menu } from "@/components/ui/menu";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { fmtMoneyExact } from "@/lib/format";
import type { PoDocumentSlot } from "@/lib/documents";
import type { PickerGroup } from "@/lib/groups";
import { PO_REASON_HINT, poFieldWords } from "@/lib/po-send-back";
import type { TotalKey } from "@/lib/po-totals";
import { savePurchaseOrder } from "@/server/modules/purchases/po-actions";
import { createCategoryFromPo } from "@/server/modules/purchases/category-actions";
import type { PolicyLoadout } from "@/server/modules/purchases/queries";
import { DocumentsCard, type OnFileDoc } from "./documents-card";
import { Field, SectionCard } from "./fields";
import { InvoiceCard } from "./invoice-card";
import { ItemCard, type CreateCategory, type PoCategoryChoice } from "./item-card";
import {
  blankLine, checklist, emptyTotals, filesTooBig, firstErrorTarget, invoiceAttached, lineErrors, saveLabel, sectionsDone, toFormData,
  toPayload, totalsReview, unitChips, unitCounts, whenYouSave, type DraftContext, type HeldFiles, type LineDraft, type PaidByValue,
  type PoDraft,
} from "./po-form-model";
import { SectionRail } from "./section-rail";
import { TotalsCard } from "./totals-card";
import { VendorCard, type PoVendor } from "./vendor-card";

/** An existing line as the edit page hands it over (strings, as the inputs hold them). */
export type InitialLine = Omit<LineDraft, "key">;

export interface PoFormInitial {
  id: string;
  refNo: string;
  state: PurchaseOrderState;
  vendorId: string | null;
  departmentId: string | null;
  poNumber: string | null;
  invoiceRef: string | null;
  receiptRef: string | null;
  purchasedAt: string | null;
  paidBy: PaidByValue | null;
  /** The seven totals as the inputs show them ("9,100.00"; "" for none). */
  totals: Record<TotalKey, string>;
  lines: InitialLine[];
  /** The newest document of each slot's kind already on the PO (the slots show it; the sales invoice check counts it). */
  onFile: Partial<Record<PoDocumentSlot, OnFileDoc>>;
  /** From the new form (spec §5b.3): its PO number, paid by, total amount due and sales invoice are required. False on a legacy PO. */
  formV2: boolean;
  /** IT has registered a unit from this PO: saving it doesn't send it back to IT. */
  itRegistered: boolean;
  /** The open send-back: who sent it (team and person), the fields they flagged and their note. The reply is required. */
  sentBack: { by: string | null; byName: string | null; note: string | null; fields: string[] } | null;
}

const TEAM_WORDS: Record<string, string> = { IT: "IT", FINANCE: "Finance", PURCHASING: "Purchasing" };

function initialDraft(initial: PoFormInitial | undefined): PoDraft {
  if (!initial) {
    return {
      vendorId: "", poNumber: "", invoiceRef: "", receiptRef: "", purchasedAt: "", paidBy: "", departmentId: "",
      lines: [blankLine("n0")], totals: emptyTotals(),
    };
  }
  return {
    vendorId: initial.vendorId ?? "",
    poNumber: initial.poNumber ?? "",
    invoiceRef: initial.invoiceRef ?? "",
    receiptRef: initial.receiptRef ?? "",
    purchasedAt: initial.purchasedAt ?? "",
    paidBy: initial.paidBy ?? "",
    departmentId: initial.departmentId ?? "",
    lines: initial.lines.length ? initial.lines.map((l, i) => ({ ...l, key: l.id ?? `n${i}` })) : [blankLine("n0")],
    totals: { ...emptyTotals(), ...initial.totals },
  };
}

/**
 * Purchase orders (spec §2, A3 · section rail with progress): one form for a new PO and an edit. A PO records
 * something already bought; saving sends it on (no drafts, no autosave — an autosave would push half-typed orders
 * into IT's queue), so only the Save button calls savePurchaseOrder. The cards follow the sales invoice top to bottom:
 * vendor, invoice & payment, items, documents; the totals, checklist and Save sit on the right. On a sent-back PO the
 * flagged fields are ringed, the sender's note sits in a banner, and a reply ("What did you fix?") is required.
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
  vendors: PoVendor[];
  categories: PoCategoryChoice[];
  initial?: PoFormInitial;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState<PoDraft>(() => initialDraft(initial));
  /** The document slots' files, held here until Save sends them with the PO (spec §5b.1). */
  const [files, setFiles] = useState<HeldFiles>({});
  const [created, setCreated] = useState<PoCategoryChoice[]>([]);
  const [reply, setReply] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [cardOf, setCardOf] = useState<number[]>([]);
  const [retryAfter, setRetryAfter] = useState<number | null>(null);
  /** Bumped on each failed save: the effect below then takes the user to what went wrong. */
  const [failures, setFailures] = useState(0);
  const bannerRef = useRef<HTMLDivElement>(null);
  const rateRef = useRef<HTMLDivElement>(null);
  const nextKey = useRef(draft.lines.length);
  /** Set when "Add a new vendor" or "Edit vendor" opened a new tab. */
  const vendorTabOpen = useRef(false);

  // Coming back from the vendor tab refreshes the vendor and category lists once, while everything typed here stays.
  // Only then: a refresh on every focus would re-run the edit page's guard, which navigates away (losing what was
  // typed) once the PO has moved on.
  useEffect(() => {
    const refresh = () => {
      if (!vendorTabOpen.current) return;
      vendorTabOpen.current = false;
      router.refresh();
    };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [router]);

  // A fresh category list from the server already holds every category made here; one missing from it was deleted
  // since (IT replaced it at Register), so it is dropped. A line still holding it hears so from the save.
  const [categoriesSeen, setCategoriesSeen] = useState(categories);
  if (categoriesSeen !== categories) {
    setCategoriesSeen(categories);
    setCreated([]);
  }

  // After a failed save the error is wherever the field is, often far above the Save button: focus the first field
  // with an error (centred on screen), or else the banner, or else (rate-limited) the notice. Inside a field's box the
  // input comes first — a qty's box starts with its "−" button — then a button (a picker's trigger).
  useEffect(() => {
    if (failures === 0) return;
    const target = firstErrorTarget(fieldErrors, cardOf);
    const box = target ? document.querySelector<HTMLElement>(`[data-po-field="${target}"]`) : null;
    // A box can name its own target (a filled document slot: Replace, not Preview).
    const field = box?.matches("input, textarea, button, [tabindex]")
      ? box
      : box?.querySelector<HTMLElement>("[data-po-focus]:not([disabled])")
        ?? box?.querySelector<HTMLElement>('input:not([disabled]):not([tabindex="-1"]), textarea:not([disabled])')
        ?? box?.querySelector<HTMLElement>("button:not([disabled])");
    const el = field ?? bannerRef.current ?? rateRef.current;
    if (!el) return;
    el.scrollIntoView({ block: "center" });
    el.focus({ preventScroll: true });
    // Only a new failure moves focus; typing into the fields afterwards doesn't.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [failures]);

  // A legacy draft (sent back, never sent) has no sender: its first save is a plain save, and no reply is asked.
  const sentBack = initial?.state === "SENT_BACK" && initial.sentBack?.by ? initial.sentBack : null;
  const flaggedSet = new Set(sentBack?.fields ?? []);
  const flagged = (key: string) => flaggedSet.has(key);
  const flaggedWords = poFieldWords(sentBack?.fields ?? []);
  // A legacy PO (spec §5b.3): PO number, paid by, total amount due and the sales invoice stay optional.
  const strict = !initial || initial.formV2;

  const allCategories = useMemo(
    () => [...categories, ...created.filter((c) => !categories.some((x) => x.id === c.id))],
    [categories, created],
  );
  const vendor = vendors.find((v) => v.id === draft.vendorId) ?? null;
  const onFile = initial?.onFile ?? {};
  const ctx: DraftContext = {
    vendorTin: vendor?.registrationNo ?? null,
    classes: Object.fromEntries(allCategories.map((c) => [c.id, c.cls])) as Record<string, AssetClass>,
    invoiceAttached: invoiceAttached(files, onFile),
    itRegistered: initial?.itRegistered ?? false,
    legacy: !strict,
  };
  const done = sectionsDone(draft, ctx);
  const review = totalsReview(draft);
  const counts = unitCounts(draft, ctx);
  const chips = unitChips(counts);
  const errorsByCard = lineErrors(fieldErrors, cardOf);

  const set = <K extends keyof PoDraft>(key: K, value: PoDraft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const setLines = (fn: (lines: LineDraft[]) => LineDraft[]) => setDraft((d) => ({ ...d, lines: fn(d.lines) }));
  /** Cards added, removed or reordered: the last save's line errors no longer point at the right cards. */
  const reshape = (fn: (lines: LineDraft[]) => LineDraft[]) => {
    setCardOf([]);
    setLines(fn);
  };
  const newKey = () => `n${nextKey.current++}`;
  const patchLine = (i: number) => (patch: Partial<LineDraft>) =>
    setLines((lines) => lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  function focusDescription(i: number) {
    requestAnimationFrame(() => document.querySelector<HTMLInputElement>(`[data-po-desc="${i}"]`)?.focus());
  }

  function addLine() {
    const at = draft.lines.length;
    reshape((lines) => [...lines, blankLine(newKey())]);
    focusDescription(at);
  }

  function duplicate(i: number) {
    reshape((lines) => {
      // a copy is a new line: no id, nothing registered from it
      const copy: LineDraft = { ...lines[i], key: newKey(), id: undefined, locked: undefined };
      return [...lines.slice(0, i + 1), copy, ...lines.slice(i + 1)];
    });
  }

  function addLoadout(policy: PolicyLoadout) {
    reshape((lines) => [
      ...lines.filter((l) => l.id || l.description.trim() || l.unitPrice.trim() || l.categoryId),
      ...policy.slots.map((s) => ({
        ...blankLine(newKey()),
        description: `${s.name}${s.type ? ` (${s.type})` : ""}`,
        specs: s.required ? "Required by policy" : "Optional",
      })),
    ]);
  }

  const createCategory: CreateCategory = async (name, cls) => {
    const res = await createCategoryFromPo({ name, cls });
    if (res.ok) {
      setCreated((list) => [...list.filter((c) => c.id !== res.data.id), { id: res.data.id, name: res.data.name, cls: res.data.cls, confirmed: res.data.confirmed }]);
      return { ok: true, id: res.data.id };
    }
    if (res.kind === "rate_limited") return { ok: false, error: `Too many changes at once — try again in ${res.retryAfterSec ?? 60} seconds.` };
    return { ok: false, error: (res.fieldErrors && Object.values(res.fieldErrors)[0]) ?? res.message };
  };

  /** A slot's file picked, replaced or taken back: the last save's error on that slot (and on the total size) goes. */
  function changeFiles(next: HeldFiles, slot: PoDocumentSlot) {
    setFiles(next);
    setFieldErrors((errors) => {
      if (!errors[`doc:${slot}`] && !errors.docs) return errors;
      const rest = { ...errors };
      delete rest[`doc:${slot}`];
      delete rest.docs;
      return rest;
    });
  }

  function save() {
    const { payload, cardOf: map } = toPayload(draft, { id: initial?.id, reply });
    setError(null);
    setCardOf(map);
    // Too big for one request: say so here, before the request fails without a word.
    const tooBig = filesTooBig(files);
    if (tooBig) {
      setFieldErrors({ docs: tooBig });
      setError(tooBig);
      setFailures((n) => n + 1);
      return;
    }
    setFieldErrors({});
    const fd = toFormData(payload, files);
    startTransition(async () => {
      const res = await savePurchaseOrder(fd);
      if (res.ok) {
        toast(`${res.data.refNo} saved`, "settled");
        router.push(`/purchases/${res.data.id}`);
        return;
      }
      if (res.kind === "rate_limited") {
        setRetryAfter(res.retryAfterSec ?? 60);
        setFailures((n) => n + 1);
        return;
      }
      setFieldErrors(res.fieldErrors ?? {});
      setError(res.fieldErrors ? Object.values(res.fieldErrors)[0] ?? res.message : res.message);
      setFailures((n) => n + 1);
    });
  }

  const replyField = initial ? (
    <div className="border-t border-border-faint pt-3" data-po-field="reply">
      {/* Required on a sent-back PO (Purchasing's reply), and for an admin's edit while it is with IT. */}
      <Field
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
      </Field>
    </div>
  ) : undefined;

  const chip = "rounded-full border px-2.5 py-0.5 text-xs font-medium";

  return (
    <div className="flex flex-col gap-4">
      <p className="-mt-2 text-[13.5px] text-fg-secondary">
        Copy it from the sales invoice, top to bottom. Saving sends it on — nothing waits as a draft.
      </p>
      {retryAfter !== null && (
        <div ref={rateRef} tabIndex={-1} className="scroll-mt-5 rounded-(--radius-card) focus:outline-none focus-visible:shadow-[0_0_0_3px_var(--focus-shadow)]">
          <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />
        </div>
      )}
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
      {error && (
        <div ref={bannerRef} tabIndex={-1} className="scroll-mt-5 rounded-(--radius-card) focus:outline-none focus-visible:shadow-[0_0_0_3px_var(--focus-shadow)]">
          <Banner tone="fault" title={error} />
        </div>
      )}

      <div className="flex flex-col gap-5 min-[900px]:flex-row min-[900px]:items-start">
        <SectionRail done={done} className="shrink-0 min-[900px]:sticky min-[900px]:top-5 min-[900px]:w-[210px]" />

        {/* The cards' basis (420px) keeps the totals column beside them from a 1280px laptop with the app sidebar and
            the rail open (420 + 20 + 300 fits the 758px left there); narrower, the totals wrap under the cards. The row
            is a container: the totals card is sticky and capped only at @min-[740px], where it sits beside them. */}
        <div className="@container flex min-w-0 flex-1 flex-wrap items-start gap-5">
          <div className="flex min-w-0 flex-[999_1_420px] flex-col gap-4">
            <VendorCard
              vendors={vendors} vendorId={draft.vendorId} onChange={(id) => set("vendorId", id)}
              error={fieldErrors.vendorId} flagged={flagged("vendorId")}
              onOpenVendorTab={() => { vendorTabOpen.current = true; }}
            />

            <InvoiceCard
              draft={draft} set={(k, v) => set(k, v as never)} errors={fieldErrors} flagged={flagged}
              departments={departments} keepDepartmentId={initial?.departmentId} strict={strict}
            />

            <SectionCard
              id="po-items" icon="inventory" title="Items" sub="One per line on the invoice. The category decides where it goes."
              aside={(
                <div className="flex flex-wrap gap-2">
                  <span className={chip} style={{ background: "var(--accent-soft-bg)", borderColor: "var(--accent-soft-border)", color: "var(--accent-soft-text)" }}>{chips[0]}</span>
                  <span className={chip} style={{ background: "var(--st-settled-bg)", borderColor: "var(--st-settled-border)", color: "var(--st-settled-text)" }}>{chips[1]}</span>
                </div>
              )}
            >
              <div className="flex flex-col gap-3 px-3 pb-1.5 pt-4 sm:px-[18px]">
                {flagged("cost") && <p className="text-[11.5px] text-fg-muted">Flagged — check this one: the unit prices.</p>}
                {fieldErrors.lines && <p data-po-field="lines" role="alert" className="text-[11.5px] font-medium" style={{ color: "var(--error-text)" }}>{fieldErrors.lines}</p>}
                {draft.lines.map((l, i) => (
                  <ItemCard
                    key={l.key} index={i} line={l} categories={allCategories} errors={errorsByCard[i] ?? {}}
                    flaggedCost={flagged("cost")} canRemove={draft.lines.length > 1}
                    onChange={patchLine(i)} onDuplicate={() => duplicate(i)}
                    onRemove={() => reshape((lines) => (lines.length > 1 ? lines.filter((_, idx) => idx !== i) : lines))}
                    onCreateCategory={createCategory}
                    // Phase 23 (quick forms): Enter in the last item's price adds an item when that item has a
                    // description, and moves to it; it never saves (saving sends the PO on).
                    onPriceEnter={() => { if (i === draft.lines.length - 1 && l.description.trim()) addLine(); }}
                  />
                ))}
                <button
                  type="button" onClick={addLine}
                  className="flex h-[52px] items-center justify-center gap-2 rounded-(--radius-card) border-[1.5px] border-dashed border-border-strong bg-surface-subtle text-[13.5px] font-medium text-accent-soft-text transition-colors duration-(--dur-1) hover:border-accent hover:bg-accent-tint"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
                  Add another item
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-3 px-4 pb-4 pt-3 sm:px-5">
                {loadouts.length > 0 && (
                  <Menu
                    align="start"
                    items={loadouts.map((l) => ({ label: l.name, onSelect: () => addLoadout(l) }))}
                    trigger={(t) => (
                      <button
                        type="button" {...t}
                        className="inline-flex h-9 items-center gap-2 rounded-(--radius-btn) px-2 text-[13px] font-medium text-accent-soft-text hover:bg-accent-tint"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h10" /></svg>
                        Add a policy loadout
                      </button>
                    )}
                  />
                )}
                <span className="flex-1" />
                <span className="text-[13px] text-fg-secondary">Items total</span>
                <span className="text-[17px] font-semibold tabular-nums text-fg">{fmtMoneyExact(review.items)}</span>
              </div>
            </SectionCard>

            <DocumentsCard
              files={files} onFiles={changeFiles} onFile={onFile} si={draft.invoiceRef} strict={strict}
              errors={fieldErrors} flagged={flagged}
            />
          </div>

          <TotalsCard
            className="min-w-0 max-w-full flex-[1_1_300px] @min-[740px]:sticky @min-[740px]:top-5"
            totals={draft.totals}
            setTotal={(k, v) => setDraft((d) => ({ ...d, totals: { ...d.totals, [k]: v } }))}
            problems={review.problems} status={review.status} statusText={review.text}
            errors={fieldErrors} flaggedTotals={flagged("totals")}
            whenYouSave={whenYouSave(counts)} checklist={checklist(draft, ctx)} saveLabel={saveLabel(draft, ctx)}
            pending={pending} onSave={save} cancelHref={initial ? `/purchases/${initial.id}` : "/purchases"}
            reply={replyField} strict={strict}
          />
        </div>
      </div>
    </div>
  );
}
