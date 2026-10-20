"use client";

import { useRef } from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { fmtMoneyExact } from "@/lib/format";
import { statusLabel } from "@/lib/asset-class";
import { lifeLabel } from "@/lib/depreciation-input";
import { financeDateLine, type FinanceSort } from "@/lib/finance-list";
import { REG_LABEL_FINANCE } from "@/lib/registration";
import type { FinanceRow } from "@/server/modules/finance/queries";
import { Table, TBody, THead, Th, Td, Tr } from "@/components/ui/table";
import { StatusPill } from "@/components/ui/status";
import { Pill } from "@/components/ui/pill";
import { LIST } from "@/components/patterns/list-styles";
import { useFitsCard } from "@/components/patterns/use-fits-card";
import { AssetRowMenu } from "./asset-row-menu";
import { LifeCell } from "./life-cell";

function categoryText(life: number | null, pct: number | null): string {
  if (life === null) return "Category: no policy";
  return `Category: ${lifeLabel(life)}, ${pct ?? 0}% salvage`;
}

const money = (c: number | null | undefined) => (c === null || c === undefined ? "—" : fmtMoneyExact(c / 100));

/** Column widths; Asset takes the rest, from `ASSET_MIN`. */
const COLS = { category: 116, status: 108, finance: 132, cost: 124, acc: 124, book: 132, life: 168, actions: 48 };
const ASSET_MIN = 200;
const TABLE_MIN = ASSET_MIN + Object.values(COLS).reduce((a, b) => a + b, 0);

/**
 * Phase 47 (spec §3 item 6): Finance → Assets' table — Asset (tag link, then model · holder), Category, Status,
 * Finance, Cost, Accum. dep., Book value and Life used, with the row menu (override and settings) kept. Zebra rows and a
 * sticky head (the Phase 45 `Table striped stickyHeader`, scrolling inside its card when too wide: `useFitsCard`), and
 * a totals row for every row shown (all pages: the toolbar's "N assets shown"), cost and depreciation counting the
 * capitalised rows as the money cards do. It sits inside the page's table card, so its own card chrome is dropped.
 */
export function FinanceTable({
  rows,
  shown,
  sort,
}: {
  rows: FinanceRow[];
  shown: { count: number; costedCount: number; costC: number; accC: number; bookC: number };
  /** the list's sort: it decides which date shows under the Finance pill */
  sort: FinanceSort;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const fitsCard = useFitsCard(boxRef, TABLE_MIN);
  const head = cn(LIST.head, LIST.th, "whitespace-nowrap");
  const num = cn(LIST.td, "text-right tabular-nums text-fg-secondary");
  return (
    <div ref={boxRef} className="flex flex-col" style={{ "--finance-table-min": `${TABLE_MIN}px` } as React.CSSProperties}>
      <Table
        striped
        stickyHeader
        fitsCard={fitsCard}
        className="rounded-none border-0 border-t border-border shadow-none [&>table]:min-w-(--finance-table-min) [&>table]:table-fixed"
      >
        <THead>
          <Tr style={{ height: "var(--list-head-h)" }}>
            <Th className={head}>Asset</Th>
            <Th width={COLS.category} className={head}>Category</Th>
            <Th width={COLS.status} className={head}>Status</Th>
            <Th width={COLS.finance} className={head}>Finance</Th>
            <Th width={COLS.cost} align="right" className={head}>Cost</Th>
            <Th width={COLS.acc} align="right" className={head}>Accum. dep.</Th>
            <Th width={COLS.book} align="right" className={head}>Book value</Th>
            <Th width={COLS.life} className={head}>Life used</Th>
            <Th width={COLS.actions} className={cn(LIST.head, LIST.th)} aria-label="Row actions" />
          </Tr>
        </THead>
        <TBody>
          {rows.map((a) => {
            const sub = `${a.model} · ${a.holder ?? "not assigned"}`;
            const dateLine = financeDateLine(a, sort);
            return (
              <Tr key={a.id} style={{ height: "var(--list-row-h)" }}>
                <Td className={LIST.td}>
                  <span className="flex min-w-0 flex-col dense:flex-row dense:items-baseline dense:gap-2">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <Link href={`/finance/assets/${a.id}`} className={cn(LIST.code, "font-medium text-accent hover:underline")}>
                        {a.tag}
                      </Link>
                      {a.custom && <Pill>custom</Pill>}
                    </span>
                    <span className={cn(LIST.sub, "min-w-0 truncate")} title={sub}>{sub}</span>
                  </span>
                </Td>
                <Td className={cn(LIST.td, "text-fg-secondary")}>
                  <span className="block truncate" title={a.category}>{a.category}</span>
                </Td>
                <Td className={LIST.td}><StatusPill value={a.status} label={statusLabel(a.status)} /></Td>
                <Td className={LIST.td}>
                  {a.reg === "registered" && a.notCapitalised ? (
                    <span className="text-[12.5px] text-fg-secondary">Not capitalised</span>
                  ) : (
                    <StatusPill ns="registration" value={a.reg} label={REG_LABEL_FINANCE[a.reg]} />
                  )}
                  {/* the date that matters for the current sort: Approved, Added or Bought (Manila) */}
                  {dateLine && (
                    <span className={cn(LIST.sub, "block truncate font-normal tabular-nums")} data-date-line="">
                      {dateLine.label} {dateLine.date}
                    </span>
                  )}
                </Td>
                <Td className={num}>{money(a.costC)}</Td>
                <Td className={num}>{money(a.result?.accumulated)}</Td>
                <Td className={cn(num, "font-medium text-fg")}>
                  <span className="block">{money(a.result?.bookValue)}</span>
                  {/* the state note, as the old page showed it: "No policy for Docks", "Fully depreciated", … */}
                  {a.note && (
                    <span className={cn(LIST.sub, "truncate font-normal")} title={a.note} data-note="">
                      {a.note}
                    </span>
                  )}
                </Td>
                <Td className={LIST.td}><LifeCell stage={a.lifeStage} /></Td>
                <Td className={cn(LIST.td, "pl-1 text-right last:pr-3 dense:pl-1 dense:last:pr-3")}>
                  {a.result && a.costC !== null && (
                    <AssetRowMenu
                      id={a.id}
                      tag={a.tag}
                      costC={a.costC}
                      startMonth={a.startMonth}
                      custom={a.custom}
                      lifeMonths={a.lifeMonths}
                      salvageC={a.salvageC}
                      note={a.overrideNote}
                      categoryText={categoryText(a.categoryLife, a.categorySalvagePercent)}
                      categoryLife={a.categoryLife}
                      categorySalvagePercent={a.categorySalvagePercent}
                    />
                  )}
                </Td>
              </Tr>
            );
          })}
        </TBody>
        <tfoot>
          <tr className="border-t border-border font-medium [&>*]:bg-surface-subtle" style={{ height: "var(--list-row-h)" }}>
            {/* the card's rounded bottom corners: this row's fill would otherwise square them off */}
            <th scope="row" colSpan={4} className={cn(LIST.td, "rounded-bl-(--radius-card) text-left font-medium")}>
              Total · {shown.count.toLocaleString("en-US")} asset{shown.count === 1 ? "" : "s"} shown
              {shown.costedCount !== shown.count && (
                <span className="ml-1.5 text-[12px] font-normal text-fg-muted">({shown.costedCount.toLocaleString("en-US")} with a cost)</span>
              )}
            </th>
            <td className={cn(num, "font-medium")}>{money(shown.costC)}</td>
            <td className={cn(num, "font-medium")}>{money(shown.accC)}</td>
            <td className={cn(num, "font-semibold text-fg")}>{money(shown.bookC)}</td>
            <td colSpan={2} className={cn(LIST.td, "rounded-br-(--radius-card)")} />
          </tr>
        </tfoot>
      </Table>
    </div>
  );
}
