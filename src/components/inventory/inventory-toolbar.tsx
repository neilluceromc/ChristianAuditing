"use client";

import { useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { AssetClass } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { LIST } from "@/components/patterns/list-styles";
import { Menu, type MenuItem } from "@/components/ui/menu";
import { FacetDropdown } from "@/components/patterns/facet-dropdown";
import { PeopleFacet } from "@/components/patterns/people-facet";
import { searchAssignees } from "@/server/modules/employees/people-search";
import {
  INVENTORY_LIST_CONFIG, withPurchaseYearQS, type PurchaseYearValue, type YearChip,
} from "@/lib/inventory-list";
import { CLASS_LABEL, withViewClsQS } from "@/lib/asset-class";
import { REPAIRS_SAVED_VIEW, isRepairStage, isRepairView } from "@/lib/repairs";
import { serializeListState, withFilter, withSearch, type ListState } from "@/lib/url-state";
import type { FacetOption } from "@/server/modules/inventory/queries";
import { useListNavigation } from "@/components/patterns/list-navigation";
import { SearchBox } from "@/components/patterns/search-box";
import { inventorySearchSubmit } from "@/lib/inventory-search-submit";
import { findExactTag } from "@/server/modules/inventory/scan-actions";
import { MoreFilters } from "./more-filters";
import { PillLink } from "./pill-link";

/** This view's URL for a list state, a year and a class — the one builder every control below goes through. */
function useInventoryHref(cls: AssetClass, defaultCls: AssetClass, purchaseYear: PurchaseYearValue | null) {
  const pathname = usePathname();
  return (s: ListState, py: PurchaseYearValue | null = purchaseYear, c: AssetClass = cls) =>
    pathname + withViewClsQS(withPurchaseYearQS(serializeListState(s, INVENTORY_LIST_CONFIG), py), c, defaultCls);
}

/**
 * The view switches: the class pills (past one visible class), the Repairs saved-view pill (IT only) and, after them,
 * `children` — the page's "Sent back · N" chips (2026-10-23). Phase 45 (spec §2.2): they keep their own row, above the
 * count tiles; the filter row below them is `InventoryToolbar`.
 */
export function InventoryViewPills({
  state,
  purchaseYear,
  cls,
  defaultCls,
  classes,
  children,
}: {
  state: ListState;
  /** the currently active `?purchaseYear=`, or null */
  purchaseYear: PurchaseYearValue | null;
  /** the class this view is scoped to (`?cls=`) */
  cls: AssetClass;
  /** the viewer's own default class — a URL names its class only when it differs (plan P-7) */
  defaultCls: AssetClass;
  /** the classes this role may switch between; the switch renders only past one */
  classes: readonly AssetClass[];
  /** the Sent back chips (null when there are none) */
  children?: React.ReactNode;
}) {
  const pathname = usePathname();
  const hrefFor = useInventoryHref(cls, defaultCls, purchaseYear);

  // Every facet option belongs to one class, so no facet filter survives a
  // class switch: a status from the other class is silently dropped by the
  // where but still shown as a chip; a category/type/assignee id from the
  // other class matches nothing and renders as a raw id. Clear them; keep the
  // class-neutral parts (q, sort, columns). The active class keeps its state.
  const stateFor = (c: AssetClass): ListState => (c === cls ? state : { ...state, filters: {}, page: 1 });
  const repairsOn = isRepairView(state);

  if (classes.length <= 1 && cls !== "IT" && !children) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {classes.length > 1 && (
        <div className="flex items-center gap-1.5" role="navigation" aria-label="Asset class">
          {classes.map((c) => (
            <PillLink key={c} href={hrefFor(stateFor(c), purchaseYear, c)} on={c === cls}>
              {CLASS_LABEL[c]}
            </PillLink>
          ))}
        </div>
      )}
      {/* Saved views are named URLs (README): Repairs is one of them. It is an
          IT saved view — its URL pins status=DEFECTIVE, an IT status — so it is
          absent, not a link that ejects, on the Purchasing view (D-14). On, it
          turns back into the plain IT list. */}
      {cls === "IT" && (
        <PillLink
          href={repairsOn ? pathname + withViewClsQS("", "IT", defaultCls) : withViewClsQS(REPAIRS_SAVED_VIEW, "IT", defaultCls)}
          on={repairsOn}
        >
          Repairs
        </PillLink>
      )}
      {children}
    </div>
  );
}

/**
 * Phase 45 (spec §2.2): the list's filter row, meant for a StickyToolbar — Search (300 px), Category, More filters
 * (Status, Type, Assigned, Provenance, Registration and Purchased, each its own component and URL param as
 * before), the Columns chooser (`children`), and the count line on the right. Controls stand 36 px tall.
 */
export function InventoryToolbar({
  state,
  total,
  attentionCount,
  facets,
  yearChips,
  purchaseYear,
  cls,
  defaultCls,
  children,
}: {
  state: ListState;
  total: number;
  /** rows in this view (every filter, every page) carrying an attention reason */
  attentionCount: number;
  facets: Record<string, FacetOption[]>;
  /** split-by-year buckets (`purchaseYearChips`), sized to their counts — the Purchased menu's items */
  yearChips: YearChip[];
  /** the currently active `?purchaseYear=`, or null */
  purchaseYear: PurchaseYearValue | null;
  /** the class this view is scoped to (`?cls=`) */
  cls: AssetClass;
  /** the viewer's own default class — a URL names its class only when it differs (plan P-7) */
  defaultCls: AssetClass;
  /** the Columns chooser, after More filters */
  children?: React.ReactNode;
}) {
  const { navigate, replace } = useListNavigation();
  // the newest search the box sent: an Enter lookup that comes back after a newer search is dropped
  const searchSeq = useRef(0);
  const hrefFor = useInventoryHref(cls, defaultCls, purchaseYear);
  const fmt = (n: number) => n.toLocaleString("en-US");

  const stageActive = (state.filters.stage ?? []).some(isRepairStage);

  const yearLabel = purchaseYear === null ? null : purchaseYear === "none" ? "No date" : String(purchaseYear);
  const yearItems: MenuItem[] = [
    { label: "Any year", onSelect: () => navigate(hrefFor({ ...state, page: 1 }, null)) },
    ...yearChips.map((chip) => ({
      label: `${chip.label} · ${chip.count}`,
      onSelect: () => navigate(hrefFor({ ...state, page: 1 }, chip.year === null ? "none" : chip.year)),
    })),
  ];

  const facetLabel = (facet: string) =>
    facet === "provenance" ? "Provenance" : facet === "reg" ? "Registration" : facet[0].toUpperCase() + facet.slice(1);
  const facetControl = (facet: string) => facet === "assignee" ? (
    <PeopleFacet
      key={facet}
      label="Assigned"
      options={facets.assignee ?? []}
      selected={state.filters.assignee ?? []}
      // the list's own URL state scopes the counts: every other filter applies, this one's own does not
      search={(q) => searchAssignees({ q, cls, listQS: withPurchaseYearQS(serializeListState(state, INVENTORY_LIST_CONFIG), purchaseYear) })}
      onApply={(values) => navigate(hrefFor(withFilter(state, facet, values)))}
    />
  ) : (
    <FacetDropdown
      key={facet}
      label={facetLabel(facet)}
      options={facets[facet] ?? []}
      selected={state.filters[facet] ?? []}
      onApply={(values) => navigate(hrefFor(withFilter(state, facet, values)))}
    />
  );

  /*
    A stage already constrains status — `returned-ok` MEANS "not
    DEFECTIVE" — so offering the Status facet on top of one advertises
    combinations that can never return a row: from ?stage=returned-ok the
    dropdown counted "DEFECTIVE 6" (the candidate set) and applying it gave
    the empty state. The stage chips are the status control in repair mode.
  */
  const moreFacets: readonly string[] = stageActive
    ? ["type", "assignee", "provenance", "reg"]
    : ["status", "type", "assignee", "provenance", "reg"];
  const showPurchased = yearChips.length > 0 || purchaseYear !== null;
  // how many of the popover's filters are set: one per facet with a value, and one for a purchase year
  const moreSet = moreFacets.filter((f) => (state.filters[f]?.length ?? 0) > 0).length + (purchaseYear !== null ? 1 : 0);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* The house search (spec §7.2: as you type). Enter is the USB scanner contract: an exact tag opens the record
          (pushed, so Back returns here); typing or pasting a full tag just filters. See inventorySearchSubmit. */}
      <SearchBox
        value={state.q}
        ariaLabel="Search assets"
        placeholder="Search tag, model, serial, holder"
        onSubmit={(q, how) => {
          const seq = ++searchSeq.current;
          void inventorySearchSubmit(q, how, {
            listHref: hrefFor(withSearch(state, q)),
            find: findExactTag,
            push: navigate,
            replace,
            stillCurrent: () => seq === searchSeq.current,
          });
        }}
        className="w-[300px]"
        inputClassName="h-9 py-0 text-[13px]"
      />
      <div className={LIST.tall}>{facetControl("category")}</div>
      <MoreFilters count={moreSet}>
        {moreFacets.map(facetControl)}
        {/* Plan P-8: one Purchased facet over the existing ?purchaseYear= side-channel —
            a single value, so a menu rather than a multi-select. */}
        {showPurchased && (
          <Menu
            align="start"
            items={yearItems}
            trigger={(props) => (
              <Button size="sm" {...props}>
                {yearLabel === null ? "Purchased" : `Purchased: ${yearLabel}`}
                <span aria-hidden className="text-fg-faint">▾</span>
              </Button>
            )}
          />
        )}
      </MoreFilters>
      {children && <div className={LIST.tall}>{children}</div>}
      {/* the count line reads like Employees': 12.5 px, the number bold and with a thousands comma */}
      <p className="ml-auto whitespace-nowrap text-[12.5px] tabular-nums text-fg-muted" aria-live="polite">
        <span>
          <span className="font-semibold text-fg">{fmt(total)}</span> asset{total === 1 ? "" : "s"}
        </span>
        {attentionCount > 0 && (
          <>
            {" · "}
            <Link
              href={hrefFor({ ...state, sort: [{ key: "attention", dir: "asc" }], page: 1 })}
              className="underline underline-offset-2 hover:text-fg"
            >
              {fmt(attentionCount)} need{attentionCount === 1 ? "s" : ""} attention
            </Link>
          </>
        )}
      </p>
    </div>
  );
}
