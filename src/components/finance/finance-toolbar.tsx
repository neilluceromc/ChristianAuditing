"use client";

import { useId } from "react";
import { Input } from "@/components/ui/input";
import { Icon } from "@/components/ui/icon";
import { Select } from "@/components/ui/select";
import { useListNavigation } from "@/components/patterns/list-navigation";
import { LIST } from "@/components/patterns/list-styles";
import { cn } from "@/lib/cn";
import { fmtMoneyExact } from "@/lib/format";
import {
  FINANCE_SORTS, LIFE_FILTERS, LIFE_LABEL, SORT_LABEL, financeListHref, parseLife, parseSort, withFinance,
  type FinanceListState,
} from "@/lib/finance-list";

export type ToolbarControl = "q" | "category" | "life" | "sort";

/**
 * The URL a toolbar control leads to, from the raw value it hands over (the search box's text, a select's option
 * value; "" is Any / All). Every control keeps the other filters and goes back to page 1.
 */
export function controlHref(state: FinanceListState, control: ToolbarControl, value: string): string {
  switch (control) {
    case "q": return financeListHref(withFinance(state, { q: value.trim().slice(0, 100) }));
    case "category": return financeListHref(withFinance(state, { category: value || null }));
    case "life": return financeListHref(withFinance(state, { life: parseLife(value) }));
    case "sort": return financeListHref(withFinance(state, { sort: parseSort(value) }));
  }
}

function LabelledSelect({
  label, value, onChange, children,
}: {
  label: string; value: string; onChange: (v: string) => void; children: React.ReactNode;
}) {
  const id = useId();
  return (
    <div className="flex items-center gap-1.5 text-[12.5px] text-fg-muted">
      <label htmlFor={id} className="whitespace-nowrap">{label}</label>
      <Select
        // Uncontrolled and keyed on the URL's value: the pick stays shown while its navigation is in flight, and the
        // select takes the URL's value again once the next view lands (or on Back).
        key={value}
        id={id}
        aria-label={label}
        defaultValue={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(LIST.control, "w-auto max-w-[220px] pl-2.5")}
      >
        {children}
      </Select>
    </div>
  );
}

/**
 * Phase 47 (spec §3 item 5): the table card's toolbar, meant for a StickyToolbar — search (tag, model, serial, holder),
 * then the Category (mirroring the tiles), Life and Sort selects, and on the right "N assets shown" with their
 * combined book value. `tiles` is the category tiles after All, in their order (Other last, when there is one); a
 * folded category in force is offered by its own name (`categoryLabel`), selected, after Other.
 */
export function FinanceToolbar({
  state,
  tiles,
  categoryLabel,
  shown,
}: {
  state: FinanceListState;
  tiles: Array<{ id: string; name: string }>;
  categoryLabel: string | null;
  shown: { count: number; bookC: number };
}) {
  const { navigate } = useListNavigation();
  const go = (control: ToolbarControl, value: string) => navigate(controlHref(state, control, value));
  const category = state.category ?? "";
  const folded = category !== "" && !tiles.some((t) => t.id === category);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative w-full max-w-[340px] flex-1 basis-[240px]">
        <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-faint">
          <Icon name="search" size={14} />
        </span>
        <Input
          // Keyed on the URL's q: a search is a soft navigation, and an uncontrolled input ignores a new defaultValue.
          key={state.q}
          type="search"
          data-page-search
          aria-label="Search assets"
          placeholder="Tag, model, serial or holder"
          defaultValue={state.q}
          className="h-9 py-0 pl-8 pr-7 text-[13px]"
          onKeyDown={(e) => {
            if (e.key === "Enter") go("q", e.currentTarget.value);
          }}
        />
        {state.q && (
          <button
            type="button"
            aria-label="Clear search"
            // Fitts / WCAG 2.5.8: a 24 × 24 px target, centred, inside the input's pr-7 gutter
            className="absolute right-0.5 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-(--radius-ctl) text-fg-muted hover:bg-surface-subtle hover:text-fg"
            onClick={() => go("q", "")}
          >
            ×
          </button>
        )}
      </div>
      <LabelledSelect label="Category" value={category} onChange={(v) => go("category", v)}>
        <option value="">All categories</option>
        {tiles.map((t) => (
          <option key={t.id} value={t.id}>{t.name}</option>
        ))}
        {folded && <option value={category}>{categoryLabel ?? "This category"}</option>}
      </LabelledSelect>
      <LabelledSelect label="Life" value={state.life ?? ""} onChange={(v) => go("life", v)}>
        <option value="">Any</option>
        {LIFE_FILTERS.map((l) => (
          <option key={l} value={l}>{LIFE_LABEL[l]}</option>
        ))}
      </LabelledSelect>
      <LabelledSelect label="Sort" value={state.sort} onChange={(v) => go("sort", v)}>
        {FINANCE_SORTS.map((s) => (
          <option key={s} value={s}>{SORT_LABEL[s]}</option>
        ))}
      </LabelledSelect>
      <p aria-live="polite" className="ml-auto whitespace-nowrap text-[12.5px] tabular-nums text-fg-muted">
        <span className="font-semibold text-fg">{shown.count.toLocaleString("en-US")}</span>{" "}
        {shown.count === 1 ? "asset" : "assets"} shown
        <span aria-hidden> · </span>
        <span className="sr-only">, </span>
        <span className="font-medium text-fg-secondary">{fmtMoneyExact(shown.bookC / 100)}</span> book value
      </p>
    </div>
  );
}
