"use client";

import { useId, useState } from "react";
import type { AssetClass } from "@prisma/client";
import { cn } from "@/lib/cn";
import { fmtMoneyExact } from "@/lib/format";
import { PO_UNITS } from "@/lib/po-units";
import { Input } from "@/components/ui/input";
import { FormError } from "@/components/ui/form-field";
import { EntityCombobox, type ComboOption } from "@/components/patterns/entity-combobox";
import { AffixInput, Badge, Eyebrow, RING } from "./fields";
import { initials, lineAmount, parseQty, type LineDraft } from "./po-form-model";

export interface PoCategoryChoice {
  id: string;
  name: string;
  cls: AssetClass;
  /** False for IT gear created from a PO that IT hasn't confirmed yet: tagged "New". */
  confirmed: boolean;
}

const GROUP: Record<AssetClass, string> = { IT: "IT gear", PURCHASING: "Office & facilities" };
const GROUP_HINT = { "IT gear": "→ IT checks", "Office & facilities": "→ ready to register" };
const ROUTE: Record<AssetClass, string> = { IT: "IT checks it", PURCHASING: "Ready to register" };
const TINT: Record<AssetClass, React.CSSProperties> = {
  IT: { background: "var(--accent-soft-bg)", color: "var(--accent-soft-text)" },
  PURCHASING: { background: "var(--st-settled-bg)", color: "var(--st-settled-text)" },
};
const isNew = (c: PoCategoryChoice) => c.cls === "IT" && !c.confirmed;

export type CreateCategory = (name: string, cls: AssetClass) => Promise<{ ok: true; id: string } | { ok: false; error: string }>;

const iconBtn = "inline-flex size-8 items-center justify-center rounded-(--radius-btn) text-fg-muted transition-colors duration-(--dur-1) hover:bg-row-hover hover:text-fg disabled:pointer-events-none disabled:opacity-40";
const stepBtn = "h-full w-8 shrink-0 text-base text-fg-secondary hover:bg-row-hover disabled:pointer-events-none disabled:opacity-40";
const pillBtn = "inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-(--radius-btn) border border-border-strong bg-surface text-[12.5px] font-medium text-fg-secondary hover:border-accent hover:bg-accent-tint hover:text-accent-soft-text disabled:opacity-55";

/**
 * A3's item card — one per invoice line: the description (as written) and specs; the category (grouped IT gear /
 * Office & facilities, with "Create “X” as…" when nothing matches); qty with − and +, the unit, the unit price and
 * the amount; Duplicate and Remove. A line with units registered or closed short keeps its category, and its qty
 * can't go below that many.
 */
export function ItemCard({
  index, line, categories, errors, flaggedCost, canRemove, onChange, onDuplicate, onRemove, onCreateCategory, onPriceEnter,
}: {
  index: number;
  line: LineDraft;
  categories: PoCategoryChoice[];
  errors: Record<string, string>;
  flaggedCost: boolean;
  canRemove: boolean;
  onChange: (patch: Partial<LineDraft>) => void;
  onDuplicate: () => void;
  onRemove: () => void;
  onCreateCategory: CreateCategory;
  /** Enter in the unit price (the old form's quick entry): the shell adds a card when this is the last one. */
  onPriceEnter: () => void;
}) {
  const n = index + 1;
  const ids = { cat: useId(), unit: useId(), qty: useId(), price: useId() };
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<{ name: string; message: string } | null>(null);

  const locked = line.locked ?? 0;
  const minQty = Math.max(1, locked);
  const qty = parseQty(line.qty);
  const category = categories.find((c) => c.id === line.categoryId) ?? null;
  const categoryLocked = locked > 0 && line.categoryId !== "";
  const amount = lineAmount(line);

  const catOptions: ComboOption[] = [...categories]
    .sort((a, b) => (a.cls === b.cls ? a.name.localeCompare(b.name) : a.cls === "IT" ? -1 : 1))
    .map((c) => ({
      value: c.id, label: c.name, group: GROUP[c.cls], ...(isNew(c) ? { tag: "New" } : {}),
      icon: <Badge text={initials(c.name)} style={TINT[c.cls]} />,
    }));
  const unitOptions: ComboOption[] = [...PO_UNITS, ...(PO_UNITS.includes(line.unit as never) || !line.unit ? [] : [line.unit])]
    .map((u) => ({ value: u, label: u }));

  async function create(name: string, cls: AssetClass, close: () => void) {
    setCreating(true);
    setCreateError(null);
    const res = await onCreateCategory(name, cls);
    setCreating(false);
    if (!res.ok) return setCreateError({ name, message: res.error });
    onChange({ categoryId: res.id });
    close();
  }

  function categoryFooter(query: string, close: () => void) {
    const name = query.trim();
    if (name.length < 2) return null;
    const q = name.toLowerCase();
    if (categories.some((c) => c.name.toLowerCase() === q)) return null;
    const noMatch = !categories.some((c) => c.name.toLowerCase().includes(q));
    return (
      <div className="flex flex-col gap-2 px-1.5 pb-1 pt-1.5">
        <p className="text-xs text-fg-secondary">
          {noMatch && <span className="text-fg-muted">No match. </span>}Create <strong className="font-semibold text-fg">“{name}”</strong> as…
        </p>
        <div className="flex gap-2">
          <button type="button" className={pillBtn} disabled={creating} onClick={() => create(name, "IT", close)}>IT gear</button>
          <button type="button" className={pillBtn} disabled={creating} onClick={() => create(name, "PURCHASING", close)}>Office item</button>
        </div>
        {createError?.name === name && (
          <p role="alert" className="text-[11px] font-medium" style={{ color: "var(--error-text)" }}>{createError.message}</p>
        )}
        <p className="text-[11px] text-fg-muted">IT gear goes to IT, who confirms the new category when registering.</p>
      </div>
    );
  }

  const setQty = (v: number) => onChange({ qty: String(Math.max(minQty, v)) });

  return (
    <article
      aria-label={`Item ${n}${line.description.trim() ? `: ${line.description.trim()}` : ""}`}
      className="@container rounded-(--radius-card) border border-border bg-surface transition-[border-color,box-shadow] duration-(--dur-1) focus-within:border-accent-soft-border focus-within:shadow-[0_0_0_3px_var(--focus-shadow)]"
    >
      {/* row 1: what it is */}
      <div className="flex items-start gap-2.5 px-3 pb-2.5 pt-3 sm:gap-3 sm:px-3.5">
        <span aria-hidden="true" className="mt-1.5 inline-flex size-7 shrink-0 items-center justify-center rounded-(--radius-btn) bg-border-faint font-mono text-xs text-fg-secondary">
          {n}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <input
            data-po-desc={index}
            aria-label={`Item ${n} description`}
            aria-invalid={!!errors.description || undefined}
            className="h-10 w-full min-w-0 rounded-[6px] bg-transparent px-1 text-[15.5px] font-medium text-fg placeholder:font-normal placeholder:text-fg-faint focus:outline-none"
            maxLength={200} value={line.description} onChange={(e) => onChange({ description: e.target.value })}
            placeholder="Item description, as written on the invoice"
          />
          <input
            aria-label={`Item ${n} specs`}
            className="h-6 w-full min-w-0 bg-transparent px-1 text-[12.5px] text-fg-muted placeholder:text-fg-faint focus:outline-none"
            maxLength={500} value={line.specs} onChange={(e) => onChange({ specs: e.target.value })}
            placeholder="Add specs or size — e.g. 305 m, i5 / 16 GB"
          />
          <FormError>{errors.description}</FormError>
        </div>
        <div className="mt-1 flex shrink-0 gap-0.5">
          <button type="button" className={iconBtn} aria-label={`Duplicate item ${n}`} title="Duplicate" onClick={onDuplicate}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="8" y="8" width="13" height="13" rx="2" /><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" />
            </svg>
          </button>
          <button
            type="button" className={cn(iconBtn, "hover:bg-[var(--st-fault-bg)] hover:text-[var(--st-fault-text)]")}
            aria-label={`Remove item ${n}`} title={locked > 0 ? "Units are registered from this item, so it can't be removed" : "Remove"}
            disabled={!canRemove || locked > 0} onClick={onRemove}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
            </svg>
          </button>
        </div>
      </div>

      {/* row 2: category, qty, unit, price, amount */}
      <div className="grid grid-cols-2 items-start gap-3 rounded-b-(--radius-card) border-t border-dashed border-border bg-surface-subtle px-3 pb-3.5 pt-3 sm:px-3.5 @min-[640px]:grid-cols-[minmax(190px,1.6fr)_118px_104px_minmax(130px,1fr)_minmax(100px,auto)]">
        <div className="col-span-2 flex min-w-0 flex-col gap-1.5 @min-[640px]:col-span-1">
          <label htmlFor={ids.cat}><Eyebrow>Category</Eyebrow><span className="sr-only"> for item {n}</span></label>
          {categoryLocked ? (
            <Input id={ids.cat} value={category?.name ?? "—"} disabled readOnly aria-describedby={`${ids.cat}-locked`} />
          ) : (
            <div className="flex items-center gap-2">
              {category && <Badge text={initials(category.name)} style={TINT[category.cls]} className="size-7" />}
              <div className="min-w-0 flex-1">
                <EntityCombobox
                  id={ids.cat} invalid={!!errors.categoryId}
                  aria-describedby={errors.categoryId ? `${ids.cat}-error` : category ? `${ids.cat}-route` : undefined}
                  options={catOptions} value={line.categoryId || null}
                  onChange={(v) => onChange({ categoryId: v ?? "" })}
                  placeholder="Choose a category" emptyText="No category matches."
                  groupHint={GROUP_HINT} footer={categoryFooter} maxLength={60}
                />
              </div>
            </div>
          )}
          {categoryLocked ? (
            <p id={`${ids.cat}-locked`} className="text-[11px] text-fg-muted">Units are registered from this item, so its category can&apos;t change.</p>
          ) : category ? (
            <p id={`${ids.cat}-route`} className="flex flex-wrap items-center gap-1.5 text-[11.5px]" style={{ color: TINT[category.cls].color }}>
              {`→ ${ROUTE[category.cls]}`}
              {isNew(category) && (
                <span className="rounded-full border px-1.5 text-[10.5px]" style={{ background: "var(--st-attention-bg)", borderColor: "var(--st-attention-border)", color: "var(--st-attention-text)" }}>
                  New · IT confirms
                </span>
              )}
            </p>
          ) : null}
          <FormError id={`${ids.cat}-error`}>{errors.categoryId}</FormError>
        </div>

        <div className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor={ids.qty}><Eyebrow>Qty</Eyebrow></label>
          <div className={cn("flex h-[38px] items-stretch overflow-hidden rounded-(--radius-card) border bg-surface focus-within:border-accent focus-within:shadow-[0_0_0_3px_var(--focus-shadow)]", errors.qty ? "border-[var(--error-border)]" : "border-border-strong")}>
            <button type="button" className={stepBtn} aria-label={`One fewer of item ${n}`} disabled={qty !== null && qty <= minQty} onClick={() => setQty((qty ?? minQty) - 1)}>−</button>
            <input
              id={ids.qty} aria-label={`Item ${n} quantity`} aria-invalid={!!errors.qty || undefined}
              aria-describedby={locked > 0 ? `${ids.qty}-min` : undefined}
              inputMode="numeric" enterKeyHint="next" maxLength={3}
              className="w-full min-w-0 bg-transparent text-center text-[13px] tabular-nums text-fg focus:outline-none"
              value={line.qty} onChange={(e) => onChange({ qty: e.target.value.replace(/[^0-9]/g, "") })}
            />
            <button type="button" className={stepBtn} aria-label={`One more of item ${n}`} disabled={qty !== null && qty >= 999} onClick={() => setQty((qty ?? 0) + 1)}>+</button>
          </div>
          {locked > 0 && <p id={`${ids.qty}-min`} className="text-[11px] text-fg-muted">At least {locked}: registered or closed short</p>}
          <FormError>{errors.qty}</FormError>
        </div>

        <div className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor={ids.unit}><Eyebrow>Unit</Eyebrow><span className="sr-only"> for item {n}</span></label>
          <EntityCombobox
            id={ids.unit} invalid={!!errors.unit} options={unitOptions} value={line.unit || null}
            onChange={(v) => { if (v) onChange({ unit: v }); }} maxLength={12}
          />
          <FormError>{errors.unit}</FormError>
        </div>

        <div className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor={ids.price}><Eyebrow>Unit price</Eyebrow></label>
          <AffixInput
            prefix="₱" id={ids.price} aria-label={`Item ${n} unit price in pesos`} invalid={!!errors.unitPrice}
            boxClassName={cn("h-[38px]", flaggedCost && RING)} className="text-right tabular-nums"
            inputMode="decimal" placeholder="0.00" value={line.unitPrice}
            onChange={(e) => onChange({ unitPrice: e.target.value.replace(/[^0-9.,]/g, "") })}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault(); // Enter never saves: saving sends the PO on
              onPriceEnter();
            }}
          />
          <FormError>{errors.unitPrice}</FormError>
        </div>

        <div className="col-span-2 flex min-w-0 items-baseline justify-between gap-1.5 @min-[640px]:col-span-1 @min-[640px]:flex-col @min-[640px]:items-end">
          <Eyebrow>Amount</Eyebrow>
          <span className="text-[15px] font-semibold tabular-nums text-fg @min-[640px]:flex @min-[640px]:h-[38px] @min-[640px]:items-center">
            {fmtMoneyExact(amount ?? 0)}
          </span>
        </div>
      </div>
    </article>
  );
}
