"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { AssetClass } from "@prisma/client";
import { cn } from "@/lib/cn";
import { Input } from "@/components/ui/input";
import { Icon } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { Menu, type MenuItem } from "@/components/ui/menu";
import { FacetDropdown } from "@/components/patterns/facet-dropdown";
import {
  INVENTORY_LIST_CONFIG, withPurchaseYearQS, type PurchaseYearValue, type YearChip,
} from "@/lib/inventory-list";
import { CLASS_LABEL, withViewClsQS } from "@/lib/asset-class";
import { REPAIRS_SAVED_VIEW, isRepairStage, isRepairView } from "@/lib/repairs";
import { serializeListState, withFilter, withSearch, type ListState } from "@/lib/url-state";
import type { FacetOption } from "@/server/modules/inventory/queries";
import { useListNavigation } from "./list-navigation";

/** Phase 30 (spec §6.2): the view switches are pill toggles — links, so e2e and a middle-click reach them. */
function PillLink({ href, on, children }: { href: string; on: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={on ? "page" : undefined}
      className={cn(
        "inline-flex min-h-7 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition-colors duration-(--dur-1)",
        on
          ? "border-accent-soft-border bg-accent-soft text-accent-soft-text"
          : "border-border-strong bg-surface text-fg-secondary hover:bg-surface-subtle",
      )}
    >
      {on && <span aria-hidden>✓</span>}
      {children}
    </Link>
  );
}

export function InventoryToolbar({
  state,
  total,
  attentionCount,
  facets,
  yearChips,
  purchaseYear,
  cls,
  defaultCls,
  classes,
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
  /** the classes this role may switch between; the switch renders only past one */
  classes: readonly AssetClass[];
  /** the Columns chooser, rendered at the right of the controls */
  children?: React.ReactNode;
}) {
  const pathname = usePathname();
  const { navigate } = useListNavigation();

  /** This view's URL for a list state and a year — the one builder every control below goes through. */
  const hrefFor = (s: ListState, py: PurchaseYearValue | null = purchaseYear, c: AssetClass = cls) =>
    pathname + withViewClsQS(withPurchaseYearQS(serializeListState(s, INVENTORY_LIST_CONFIG), py), c, defaultCls);

  // Every facet option belongs to one class, so no facet filter survives a
  // class switch: a status from the other class is silently dropped by the
  // where but still shown as a chip; a category/type/assignee id from the
  // other class matches nothing and renders as a raw id. Clear them; keep the
  // class-neutral parts (q, sort, columns). The active class keeps its state.
  const stateFor = (c: AssetClass): ListState => (c === cls ? state : { ...state, filters: {}, page: 1 });

  const stageActive = (state.filters.stage ?? []).some(isRepairStage);
  const repairsOn = isRepairView(state);

  const yearLabel = purchaseYear === null ? null : purchaseYear === "none" ? "No date" : String(purchaseYear);
  const yearItems: MenuItem[] = [
    { label: "Any year", onSelect: () => navigate(hrefFor({ ...state, page: 1 }, null)) },
    ...yearChips.map((chip) => ({
      label: `${chip.label} · ${chip.count}`,
      onSelect: () => navigate(hrefFor({ ...state, page: 1 }, chip.year === null ? "none" : chip.year)),
    })),
  ];

  return (
    <div className="flex flex-col gap-1.5">
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
        <div className="relative w-[280px]">
          <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-faint">
            <Icon name="search" size={14} />
          </span>
          <Input
            // Keyed on the URL's q (the Phase 29 employees fix): a search change is a soft
            // navigation, and an uncontrolled input ignores a new defaultValue once typed in.
            key={state.q}
            type="search"
            aria-label="Search assets"
            placeholder="Search tag, model, serial, holder · Enter"
            defaultValue={state.q}
            className="pl-8 pr-7"
            onKeyDown={(e) => {
              if (e.key === "Enter") navigate(hrefFor(withSearch(state, e.currentTarget.value)));
            }}
          />
          {state.q && (
            <button
              type="button"
              aria-label="Clear search"
              // Fitts / WCAG 2.5.8: a 24 × 24 px target, centred, inside the input's pr-7 gutter
              className="absolute right-0.5 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-(--radius-ctl) text-fg-muted hover:bg-surface-subtle hover:text-fg"
              onClick={() => navigate(hrefFor(withSearch(state, "")))}
            >
              ×
            </button>
          )}
        </div>
        {/*
          A stage already constrains status — `returned-ok` MEANS "not
          DEFECTIVE" — so offering the Status facet on top of one advertises
          combinations that can never return a row: from ?stage=returned-ok the
          dropdown counted "DEFECTIVE 6" (the candidate set) and applying it gave
          the empty state. The stage chips are the status control in repair mode.
        */}
        {(stageActive
          ? (["category", "type", "assignee", "provenance"] as const)
          : (["status", "category", "type", "assignee", "provenance"] as const)
        ).map((facet) => (
          <FacetDropdown
            key={facet}
            label={facet === "assignee" ? "Assigned" : facet === "provenance" ? "Provenance" : facet[0].toUpperCase() + facet.slice(1)}
            options={facets[facet] ?? []}
            selected={state.filters[facet] ?? []}
            onApply={(values) => navigate(hrefFor(withFilter(state, facet, values)))}
          />
        ))}
        {/* Plan P-8: one Purchased facet over the existing ?purchaseYear= side-channel —
            a single value, so a menu rather than a multi-select. */}
        {(yearChips.length > 0 || purchaseYear !== null) && (
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
        {children && <div className="ml-auto flex items-center">{children}</div>}
      </div>
      <p className="font-mono text-[11px] text-fg-muted" aria-live="polite">
        <span>{total} asset{total === 1 ? "" : "s"}</span>
        {attentionCount > 0 && (
          <>
            {" · "}
            <Link
              href={hrefFor({ ...state, sort: [{ key: "attention", dir: "asc" }], page: 1 })}
              className="underline underline-offset-2 hover:text-fg"
            >
              {attentionCount} need{attentionCount === 1 ? "s" : ""} attention
            </Link>
          </>
        )}
      </p>
    </div>
  );
}
