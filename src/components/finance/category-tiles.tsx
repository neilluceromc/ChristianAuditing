import type { AssetStatus } from "@prisma/client";
import { cn } from "@/lib/cn";
import { fmtMoney, fmtMoneyExact } from "@/lib/format";
import { TILE_SPECS } from "@/lib/inventory-tiles";
import { financeListHref, withFinance, type CategoryTile, type FinanceListState } from "@/lib/finance-list";
import { NavLink } from "@/components/patterns/list-navigation";
import { CountTiles, type TileDef } from "@/components/patterns/count-tiles";

/*
 * Phase 47 (spec §3 items 3 and 4): Finance → Assets' two rows of tiles. Not Client Components: each tile's href is
 * built here, on the server, and only strings reach the client links (NavLink, CountTiles).
 */

/**
 * The category grid's columns as whole class names (so Tailwind sees each): 6 on desktop, 4 on screens up to
 * 1000 px, 2 at phone width — the fold keeps the 6-column rows full. A class with 5 or fewer tiles is one row of
 * exactly that many columns (2 at phone width). Always a grid that wraps: never a horizontal scroll.
 */
export function categoryGridClass(n: number): string {
  switch (true) {
    case n <= 1: return "grid-cols-1";
    case n === 2: return "grid-cols-2";
    case n === 3: return "grid-cols-2 sm:grid-cols-3";
    case n === 4: return "grid-cols-2 sm:grid-cols-4";
    case n === 5: return "grid-cols-2 sm:grid-cols-5";
    default: return "grid-cols-2 sm:grid-cols-4 min-[1001px]:grid-cols-6";
  }
}

/**
 * "All categories" plus one small tile per category of the class (the smallest folded into Other): name, asset count
 * and book value, the cost on hover. One at a time: a tile sets `?category=`, the lit tile (Other included, lit for
 * any folded category) clears it; the other filters stay, back to page 1.
 */
export function CategoryTiles({ tiles, state }: { tiles: CategoryTile[]; state: FinanceListState }) {
  return (
    <nav aria-label="Filter by category" className={cn("grid auto-rows-fr gap-2", categoryGridClass(tiles.length))}>
      {tiles.map((t) => (
        <NavLink
          key={t.id}
          href={financeListHref(withFinance(state, { category: t.on || t.id === "all" ? null : t.id }))}
          aria-current={t.on ? "true" : undefined}
          title={`${t.name} · cost ${fmtMoneyExact(t.costC / 100)} · book value ${fmtMoneyExact(t.bookC / 100)}`}
          className={cn(
            "flex h-full min-w-0 flex-col gap-0.5 rounded-(--radius-card) border px-3 py-2.5 text-left shadow-card transition-colors duration-(--dur-1)",
            t.on ? "border-accent bg-accent-soft ring-1 ring-accent" : "border-border bg-surface hover:border-border-strong",
          )}
        >
          <span className={cn("truncate text-[12.5px] font-medium leading-4", t.on ? "text-accent-soft-text" : "text-fg-secondary")}>
            {t.name}
          </span>
          <span className="flex min-w-0 items-baseline justify-between gap-2">
            <span className={cn("font-mono text-[17px] font-semibold leading-6 tabular-nums", t.on ? "text-accent-soft-text" : "text-fg")}>
              {t.count.toLocaleString("en-US")}
            </span>
            <span className={cn("min-w-0 truncate text-[11.5px] tabular-nums", t.on ? "text-accent-soft-text" : "text-fg-muted")}>
              {fmtMoney(t.bookC / 100)}
            </span>
          </span>
        </NavLink>
      ))}
    </nav>
  );
}

/**
 * The Phase 45 inventory status tiles for the class (no Need attention tile: Finance has no such filter), each with
 * count, caption and the book value of its assets, all within the selected category. The pressed tile clears the
 * status; the others set it, keeping every other filter.
 */
export function StatusTiles({
  tiles,
  state,
}: {
  tiles: Array<{ status: AssetStatus; count: number; bookC: number }>;
  state: FinanceListState;
}) {
  const specs = new Map(TILE_SPECS[state.cls].flatMap((s) => (s.status ? [[s.status, s] as const] : [])));
  const defs: TileDef[] = tiles.flatMap((t) => {
    const spec = specs.get(t.status);
    if (!spec) return [];
    const on = state.status === t.status;
    return [{
      key: spec.key,
      label: spec.label,
      caption: spec.caption,
      family: spec.family,
      count: t.count,
      href: financeListHref(withFinance(state, { status: on ? null : t.status })),
      on,
      detail: fmtMoney(t.bookC / 100),
      detailTitle: `Book value ${fmtMoneyExact(t.bookC / 100)}`,
    }];
  });
  return <CountTiles tiles={defs} label="Filter by status" />;
}
