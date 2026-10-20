/**
 * Phase 45 (spec §4.1): the Inventory and Employees lists' one type and spacing scale, as class strings,
 * so both tables are the same design rather than two look-alikes. Row and header heights are not here: they
 * come from the `--list-row-h` / `--list-head-h` variables in globals.css, which follow the row size.
 *
 * Dense (spec §4.5), the one mechanism both lists use: the `dense:` variant (`@custom-variant dense` in
 * globals.css, i.e. `[data-density="dense"] &`). Every visual change of the Dense row size is a `dense:` class,
 * so the server-rendered first paint is already right (the layout writes `data-density` on <html> from the
 * cookie) and nothing re-renders when the size changes. The cell and header padding below carry their Dense
 * values; a cell collapses its second line with `dense:` classes of its own (e.g. `flex-col dense:flex-row`,
 * `dense:hidden`). Only what CSS cannot express — an attribute that must exist in Dense alone, such as the
 * row `title` / `aria-describedby` carrying the Status reason — reads `useDensity()`; that never changes a pixel.
 */
export const LIST = {
  /**
   * A body cell: 16 px sides (20 px at the table's edges), 13.5 px primary text; two lines fit at 1.25.
   * Dense: 12 px sides (16 px at the edges) and 13 px text.
   */
  td: "px-4 first:pl-5 last:pr-5 text-[13.5px] leading-[1.25] text-fg dense:px-3 dense:first:pl-4 dense:last:pr-4 dense:text-[13px]",
  /** A plain (not sortable) header cell's padding, lined up with `td` in every row size. */
  th: "px-4 first:pl-5 last:pr-5 dense:px-3 dense:first:pl-4 dense:last:pr-4",
  /**
   * A sortable header cell: the kit `Th` puts the padding on the button that fills it, so this pads that
   * button, lined up with `td` in every row size.
   */
  thSort:
    "[&>button]:px-4 first:[&>button]:pl-5 last:[&>button]:pr-5 dense:[&>button]:px-3 dense:first:[&>button]:pl-4 dense:last:[&>button]:pr-4",
  /** The checkbox column: 20 px from the edge (16 px in Dense), the 16 px box, and the next cell's own padding. */
  check: "w-[36px] pl-5 pr-0 dense:w-[32px] dense:pl-4 dense:pr-0",
  /** A second line under the primary text: 12 px muted sans. */
  sub: "block text-[12px] leading-[1.25] text-fg-muted",
  /** Real codes only: asset tags and serial numbers, 12.5 px mono (in Dense too, when it shares a cell with `td`). */
  code: "font-mono text-[12.5px] dense:text-[12.5px]",
  /** EMP numbers: 12 px mono. */
  empNo: "font-mono text-[12px]",
  /**
   * A header cell's type: 11 px uppercase sans with letter-spacing, muted. Typography only (it overrides the
   * kit `Th`'s 10 px mono through `cn`), so it is safe on sortable headers, whose padding lives on the button.
   */
  head: "font-sans text-[11px] font-medium uppercase tracking-[0.06em] text-fg-muted",
  /** A toolbar control: 36 px tall with 13 px text (a kit Button, a pill link, a select). */
  control: "h-9 px-3 py-0 text-[13px]",
  /**
   * Wraps a kit control whose trigger is a 28 px button inside a `relative inline-flex` root (FacetDropdown,
   * PeopleFacet, the Columns chooser), so it stands 36 px tall with 13 px text like `control`.
   */
  tall: "inline-flex [&>div>button]:h-9 [&>div>button]:px-3 [&>div>button]:py-0 [&>div>button]:text-[13px]",
} as const;
