import Link from "next/link";
import { cn } from "@/lib/cn";
import { fmtMoneyExact } from "@/lib/format";
import { assetPageHref, type AssetPageState } from "@/lib/finance-asset-page";
import type { LedgerMonth, LedgerMonthState, LedgerYear, LedgerYearState } from "@/lib/finance-ledger";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { DescriptionList } from "@/components/ui/description-list";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TBody, THead, Td, Th, Tr } from "@/components/ui/table";

const peso = (c: number) => fmtMoneyExact(c / 100);
const NOW_CELL: React.CSSProperties = { backgroundColor: "var(--accent-tint)" };

const YEAR_STATE: Record<LedgerYearState, string> = { done: "Done", now: "In progress", upcoming: "Upcoming" };
const MONTH_STATE: Record<LedgerMonthState, string> = { counted: "Counted", now: "This month", projected: "Projected" };

/** The state words, coloured like the Phase 45 status families (settled, in flight, neutral). */
function StateText({ state, label }: { state: LedgerYearState | LedgerMonthState; label: string }) {
  const tone = state === "done" || state === "counted" ? "text-(--st-settled-text)" : state === "now" ? "text-(--st-inflight-text)" : "text-fg-muted";
  return <span className={cn("text-[12px] font-medium", tone)}>{label}</span>;
}

export interface LedgerTabProps {
  id: string;
  state: AssetPageState;
  /** `ledgerYears` (src/lib/finance-ledger.ts); empty when there is no schedule. */
  years: LedgerYear[];
  /** The year shown, or "all" for one summary row per year. */
  selected: number | "all";
  /** `ledgerMonths` of the selected year; null for All years. */
  months: LedgerMonth[] | null;
  /** Why there is no schedule (not capitalised, no cost, not approved, no policy); null when there is one. */
  emptyReason: string | null;
}

/**
 * Phase 47 (spec §4.2): the Depreciation ledger — year tabs (each with its months, total and state) plus All years;
 * one year is an opening / charged / closing strip over a month-by-month table; All years is one row per year whose
 * year opens it. Every figure is read from `ledgerYears` / `ledgerMonths`, which read the engine's `lifeYears`.
 */
export function LedgerTab({ id, state, years, selected, months, emptyReason }: LedgerTabProps) {
  if (years.length === 0) {
    return (
      <Card>
        <EmptyState
          title="No depreciation schedule"
          description={emptyReason ?? "This asset has no depreciation schedule."}
        />
      </Card>
    );
  }
  const yearHref = (year: number | "all") => assetPageHref(id, state, { tab: "ledger", year });
  const sel = selected === "all" ? null : years.find((y) => y.year === selected) ?? null;
  const rounding = months?.some((m) => m.roundingMark) ?? false;

  return (
    <div className="flex flex-col gap-3">
      <nav aria-label="Years of the life" className="flex gap-2 overflow-x-auto pb-1">
        {years.map((y) => {
          const on = selected === y.year;
          return (
            <Link
              key={y.year}
              href={yearHref(y.year)}
              scroll={false}
              prefetch={false}
              aria-current={on ? "true" : undefined}
              className={cn(
                "flex min-w-[118px] shrink-0 flex-col gap-0.5 rounded-(--radius-card) border px-3 py-2 text-left transition-colors duration-(--dur-1)",
                on ? "border-accent bg-accent-tint" : "border-border bg-surface hover:bg-surface-subtle",
              )}
            >
              <span className="font-mono text-[13px] font-semibold text-fg">{y.year}</span>
              <span className="text-[11.5px] tabular-nums text-fg-secondary">{y.months} mo · {peso(y.totalC)}</span>
              <StateText state={y.state} label={YEAR_STATE[y.state]} />
            </Link>
          );
        })}
        <Link
          href={yearHref("all")}
          scroll={false}
          prefetch={false}
          aria-current={selected === "all" ? "true" : undefined}
          className={cn(
            "flex min-w-[96px] shrink-0 flex-col justify-center rounded-(--radius-card) border px-3 py-2 text-left text-[13px] font-semibold transition-colors duration-(--dur-1)",
            selected === "all" ? "border-accent bg-accent-tint text-fg" : "border-border bg-surface text-fg-secondary hover:bg-surface-subtle",
          )}
        >
          All years
        </Link>
      </nav>

      {sel && months ? (
        <>
          <dl className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {[
              ["Opening book value", sel.openC],
              ["Charged this year", sel.totalC],
              ["Closing book value", sel.closeC],
            ].map(([label, c]) => (
              <div key={label} className="rounded-(--radius-card) border border-border bg-surface px-3 py-2 shadow-card">
                <dt className="text-[11px] text-fg-muted">{label}</dt>
                <dd className="font-mono text-[15px] font-semibold tabular-nums text-fg">{peso(c as number)}</dd>
              </div>
            ))}
          </dl>
          <Table striped>
            <caption className="sr-only">Depreciation by month, {sel.year}</caption>
            <THead>
              <tr>
                <Th>Month</Th>
                <Th align="right">Opening</Th>
                <Th align="right">Charge</Th>
                <Th align="right">Accumulated</Th>
                <Th align="right">Closing</Th>
                <Th>State</Th>
              </tr>
            </THead>
            <TBody>
              {months.map((m) => {
                // the striped table paints its cells (globals.css), so this month's tint goes on each cell
                const cell = m.state === "now" ? { style: NOW_CELL } : {};
                const muted = m.state === "projected" ? "text-fg-muted" : m.state === "now" ? "font-medium text-fg" : undefined;
                return (
                  <Tr
                    key={m.month}
                    data-state={m.state}
                    aria-current={m.state === "now" ? "date" : undefined}
                    className={cn(m.state === "now" && "bg-accent-tint", m.state === "projected" && "text-fg-muted")}
                  >
                    <Td {...cell} className={muted}>{m.label}</Td>
                    <Td {...cell} align="right" mono className={muted}>{peso(m.openC)}</Td>
                    <Td {...cell} align="right" mono className={muted}>{`${peso(m.chargeC)}${m.roundingMark ? "*" : ""}`}</Td>
                    <Td {...cell} align="right" mono className={muted}>{peso(m.accC)}</Td>
                    <Td {...cell} align="right" mono className={muted}>{peso(m.closeC)}</Td>
                    <Td {...cell}><StateText state={m.state} label={MONTH_STATE[m.state]} /></Td>
                  </Tr>
                );
              })}
            </TBody>
          </Table>
          {rounding && (
            <p className="text-xs text-fg-muted">
              * The last month absorbs the rounding, so the charges add up to the depreciable base exactly.
            </p>
          )}
        </>
      ) : (
        <Table striped>
          <caption className="sr-only">Depreciation by year</caption>
          <THead>
            <tr>
              <Th>Year</Th>
              <Th align="right">Opening</Th>
              <Th align="right">Charged in year</Th>
              <Th align="right">Accumulated</Th>
              <Th align="right">Closing</Th>
              <Th>State</Th>
            </tr>
          </THead>
          <TBody>
            {years.map((y) => (
              <Tr key={y.year} data-state={y.state}>
                <Td>
                  <Link
                    href={yearHref(y.year)}
                    scroll={false}
                    prefetch={false}
                    className="inline-flex items-center rounded-(--radius-ctl) border border-border px-2 py-0.5 font-mono text-xs font-medium text-accent hover:bg-surface-subtle"
                  >
                    {y.year}
                  </Link>
                  <span className="ml-2 text-[11.5px] text-fg-muted">{y.months} mo</span>
                </Td>
                <Td align="right" mono>{peso(y.openC)}</Td>
                <Td align="right" mono>{peso(y.totalC)}</Td>
                <Td align="right" mono>{peso(y.accC)}</Td>
                <Td align="right" mono>{peso(y.closeC)}</Td>
                <Td><StateText state={y.state} label={YEAR_STATE[y.state]} /></Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}
    </div>
  );
}

type Item = { label: string; value: React.ReactNode; mono?: boolean };

export interface LedgerCardsProps {
  purchase: Item[];
  cost: Item[];
  depreciation: Item[];
}

/** Spec §4.2: the Purchase, Cost breakdown and Depreciation cards under the ledger. */
export function LedgerCards({ purchase, cost, depreciation }: LedgerCardsProps) {
  const card = (title: string, items: Item[]) => (
    <Card>
      <CardHeader title={title} />
      <CardBody><DescriptionList items={items} /></CardBody>
    </Card>
  );
  return (
    <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
      {card("Purchase", purchase)}
      {card("Cost breakdown", cost)}
      {card("Depreciation", depreciation)}
    </div>
  );
}
