import { fmtMoneyExact } from "@/lib/format";
import type { FinanceKpis } from "@/server/modules/finance/queries";

const count = (n: number) => n.toLocaleString("en-US");
const assets = (n: number) => `${count(n)} asset${n === 1 ? "" : "s"}`;
const money = (c: number) => fmtMoneyExact(c / 100);

/** "12 assets with a cost", or "13 assets · 11 with a cost" when some have none (or are expensed). */
export function atCostLine(k: Pick<FinanceKpis, "count" | "costedCount">): string {
  return k.count === k.costedCount ? `${assets(k.costedCount)} with a cost` : `${assets(k.count)} · ${count(k.costedCount)} with a cost`;
}

/** "25% of cost written off"; under 1% but not nothing reads "under 1%". */
function writtenOff(k: Pick<FinanceKpis, "costC" | "accC">): string {
  if (k.costC <= 0) return "Nothing at cost yet";
  const pct = (k.accC / k.costC) * 100;
  return `${pct > 0 && pct < 1 ? "under 1" : Math.round(pct)}% of cost written off`;
}

function Card({ label, value, line }: { label: string; value: string; line: string }) {
  return (
    <div className="@container flex min-w-0 flex-col gap-1.5 rounded-(--radius-card) border border-border bg-surface px-4 py-3.5 shadow-card">
      <span className="text-[11px] font-semibold uppercase leading-4 tracking-[0.06em] text-fg-muted">{label}</span>
      <span
        className="min-w-0 truncate text-[length:clamp(17px,9.5cqi,24px)] font-semibold leading-tight tracking-[-.01em] text-fg tabular-nums"
        title={value}
      >
        {value}
      </span>
      <span className="min-w-0 truncate text-[12px] leading-4 text-fg-muted" title={line}>{line}</span>
    </div>
  );
}

/**
 * Phase 47 (spec §3 item 2): the four money cards, scoped to the class, category and status in force — At cost,
 * Accumulated depreciation (% of cost written off), Book value and Depreciation this month — every figure from the
 * engine's results as of today (the old totals footer's rule: capitalised rows only). Exact amounts: Finance reads
 * centavos.
 */
export function MoneyTotals({ kpis, asOfLabel }: { kpis: FinanceKpis; asOfLabel: string }) {
  return (
    <section aria-label="Money totals" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Card label="At cost" value={money(kpis.costC)} line={atCostLine(kpis)} />
      <Card label="Accumulated depreciation" value={money(kpis.accC)} line={writtenOff(kpis)} />
      <Card label="Book value" value={money(kpis.bookC)} line={`As of today (${asOfLabel} counted)`} />
      <Card
        label="Depreciation this month"
        value={money(kpis.monthC)}
        line={`${assets(kpis.depreciatingCount)} depreciating in ${asOfLabel}`}
      />
    </section>
  );
}
