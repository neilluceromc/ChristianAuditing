/**
 * Phase 45 (spec §4.1): the Inventory and Employees lists' one type and spacing scale, as class strings,
 * so both tables are the same design rather than two look-alikes. Row and header heights are not here: they
 * come from the `--list-row-h` / `--list-head-h` variables in globals.css, which follow the row size.
 */
export const LIST = {
  /** A body cell: 16 px sides (20 px at the table's edges), 13.5 px primary text; two lines fit at 1.25. */
  td: "px-4 first:pl-5 last:pr-5 text-[13.5px] leading-[1.25] text-fg",
  /** A second line under the primary text: 12 px muted sans. */
  sub: "block text-[12px] leading-[1.25] text-fg-muted",
  /** Real codes only: asset tags and serial numbers, 12.5 px mono. */
  code: "font-mono text-[12.5px]",
  /** EMP numbers: 12 px mono. */
  empNo: "font-mono text-[12px]",
  /**
   * A header cell's type: 11 px uppercase sans with letter-spacing, muted. Typography only (it overrides the
   * kit `Th`'s 10 px mono through `cn`), so it is safe on sortable headers, whose padding lives on the button.
   */
  head: "font-sans text-[11px] font-medium uppercase tracking-[0.06em] text-fg-muted",
  /** A toolbar control: 36 px tall with 13 px text (a kit Button, a pill link, a select). */
  control: "h-9 px-3 py-0 text-[13px]",
} as const;
