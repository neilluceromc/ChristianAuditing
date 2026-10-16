import { Card, CardBody } from "@/components/ui/card";
import { fmtMoneyExact } from "@/lib/format";
import type { OnHandReport } from "@/server/modules/stock/report-queries";

/**
 * Phase 39 (spec §4.2): the totals card, always over every item matching the filters and the search (never just the
 * page), with the category subtotals as a compact list — the top 8 by value, then "+{n} more".
 */
export function OnHandTotals({
  grandTotal,
  subtotals,
}: {
  grandTotal: OnHandReport["grandTotal"];
  subtotals: OnHandReport["subtotals"];
}) {
  const stat = (label: string, value: string) => (
    <div className="flex flex-col gap-0.5">
      <dt className="font-mono text-[10px] uppercase tracking-[0.06em] text-fg-muted">{label}</dt>
      <dd className="font-mono text-[15px] font-semibold text-fg">{value}</dd>
    </div>
  );
  return (
    <Card>
      <CardBody>
        <section aria-label="Totals" className="flex flex-col gap-3">
          <dl className="flex flex-wrap gap-x-8 gap-y-2">
            {stat("Value on hand", fmtMoneyExact(grandTotal.value))}
            {stat("Uncosted units", String(grandTotal.uncostedUnits))}
            {stat("Units", String(grandTotal.units))}
            {stat("Items", String(grandTotal.items))}
          </dl>
          {subtotals.top.length > 0 && (
            <ul aria-label="Subtotals by category" className="flex flex-wrap gap-x-5 gap-y-1 border-t border-border-faint pt-2">
              {subtotals.top.map((c) => (
                <li key={c.categoryId} className="flex items-baseline gap-1.5 text-[12px]">
                  <span className="text-fg-secondary">{c.categoryName}</span>
                  <span className="font-mono text-fg">{fmtMoneyExact(c.value)}</span>
                </li>
              ))}
              {subtotals.more > 0 && (
                <li className="font-mono text-[11px] text-fg-muted">+{subtotals.more} more</li>
              )}
            </ul>
          )}
        </section>
      </CardBody>
    </Card>
  );
}
