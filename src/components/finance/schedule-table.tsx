import Link from "next/link";
import { cn } from "@/lib/cn";
import { fmtMoneyExact } from "@/lib/format";
import type { YearRow } from "@/lib/depreciation";
import type { ScheduleGroup } from "@/server/modules/finance/depreciation-queries";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const money = (c: number) => fmtMoneyExact(c / 100);

const TH = "border-b border-border bg-surface-subtle px-3 py-2 font-mono text-[10px] font-medium uppercase tracking-[0.06em] text-fg-muted whitespace-nowrap";
const TD = "px-3 py-0 text-right font-mono text-xs whitespace-nowrap";

function Grid({ grid }: { grid: YearRow }) {
  return (
    <>
      <td className={cn(TD, "text-fg-secondary")}>{money(grid.opening)}</td>
      {grid.months.map((c, i) => (
        <td key={i} className={cn(TD, grid.projected[i] ? "text-fg-muted" : "text-fg-secondary")}>{money(c)}</td>
      ))}
      <td className={cn(TD, "text-fg")}>{money(grid.total)}</td>
      <td className={cn(TD, "text-fg")}>{money(grid.closing)}</td>
    </>
  );
}

const STICKY_TAG = "sticky left-0 z-[1] w-[110px] min-w-[110px]";
const STICKY_MODEL = "sticky left-[110px] z-[1] w-[180px] min-w-[180px] max-w-[180px] truncate";

function Shell({ year, projected, detail, children }: { year: number; projected: boolean[]; detail: boolean; children: React.ReactNode }) {
  return (
    <div role="region" aria-label="Schedule scroll area" tabIndex={0} className="overflow-x-auto rounded-(--radius-card) border border-border bg-surface shadow-card" style={{ overflowX: "auto" }}>
      <table aria-label={`Depreciation schedule ${year}`} className="w-full border-collapse text-[12.5px]">
        <thead>
          <tr>
            {detail ? (
              <>
                <th scope="col" className={cn(TH, "text-left", STICKY_TAG, "z-[2]")}>Tag</th>
                <th scope="col" className={cn(TH, "text-left", STICKY_MODEL, "z-[2]")}>Model</th>
                <th scope="col" className={cn(TH, "text-left")}>Category</th>
                <th scope="col" className={cn(TH, "text-right")}>Cost</th>
              </>
            ) : (
              <>
                <th scope="col" className={cn(TH, "text-left")}>Category</th>
                <th scope="col" className={cn(TH, "text-right")}>Cost</th>
              </>
            )}
            <th scope="col" className={cn(TH, "text-right")}>Book value 1 Jan</th>
            {MONTHS.map((m, i) => (
              <th
                key={m}
                scope="col"
                title={projected[i] ? "projected" : undefined}
                className={cn(TH, "text-right", projected[i] && "italic")}
              >
                {m}
              </th>
            ))}
            <th scope="col" className={cn(TH, "text-right")}>Year total</th>
            <th scope="col" className={cn(TH, "text-right")}>Book value 31 Dec</th>
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

/** Phase 36 (spec 5): the default Schedule view — one row per category, then the Total. Each name opens its paged drill-down. */
export function ScheduleSummaryTable({ year, categories, total, totalCostC, hrefFor }: {
  year: number;
  categories: Array<{ categoryId: string; category: string; assets: number; costC: number; row: YearRow }>;
  total: YearRow | null;
  totalCostC: number;
  hrefFor: (categoryId: string) => string;
}) {
  const projected = categories[0]?.row.projected ?? Array<boolean>(12).fill(false);
  return (
    <Shell year={year} projected={projected} detail={false}>
      {categories.map((c) => (
        <tr key={c.categoryId} className="border-b border-border-faint hover:bg-surface-subtle" style={{ height: "var(--row-h)" }}>
          <td className="whitespace-nowrap px-3 text-left">
            <Link href={hrefFor(c.categoryId)} className="font-medium text-accent hover:underline">{c.category}</Link>
            <span className="ml-2 text-xs text-fg-muted">{c.assets} {c.assets === 1 ? "asset" : "assets"}</span>
          </td>
          <td className={cn(TD, "text-fg-secondary")}>{money(c.costC)}</td>
          <Grid grid={c.row} />
        </tr>
      ))}
      {total && (
        <tr className="border-b border-border-faint bg-surface-subtle font-semibold" style={{ height: "var(--row-h)" }}>
          <td className="px-3 text-left text-fg">Total</td>
          <td className={TD}>{money(totalCostC)}</td>
          <Grid grid={total} />
        </tr>
      )}
    </Shell>
  );
}

/** The drill-down: one category's asset rows (one page), then the subtotal over every row of the category. */
export function ScheduleCategoryTable({ year, category, rows, subtotal }: {
  year: number; category: string; rows: ScheduleGroup["rows"]; subtotal: YearRow;
}) {
  return (
    <Shell year={year} projected={subtotal.projected} detail>
      <GroupRows group={{ category, rows, subtotal }} stickyTag={STICKY_TAG} stickyModel={STICKY_MODEL} />
    </Shell>
  );
}

function GroupRows({ group, stickyTag, stickyModel }: { group: ScheduleGroup; stickyTag: string; stickyModel: string }) {
  return (
    <>
      {group.rows.map((r) => (
        <tr key={r.id} className="group border-b border-border-faint hover:bg-surface-subtle" style={{ height: "var(--row-h)" }}>
          <td className={cn("px-3 bg-surface font-mono text-xs text-fg-muted group-hover:bg-surface-subtle", stickyTag)}>{r.tag}</td>
          <td className={cn("px-3 bg-surface text-fg-secondary group-hover:bg-surface-subtle", stickyModel)}>{r.model}</td>
          <td className="whitespace-nowrap px-3 text-left text-fg-secondary">{group.category}</td>
          <td className={cn(TD, "text-fg-secondary")}>{money(r.costC)}</td>
          <Grid grid={r.grid} />
        </tr>
      ))}
      <tr className="border-b border-border-faint bg-surface-subtle font-semibold" style={{ height: "var(--row-h)" }}>
        <td className={cn("px-3 bg-surface-subtle", stickyTag)} />
        <td className={cn("px-3 bg-surface-subtle", stickyModel)} />
        <td className="whitespace-nowrap px-3 text-left text-fg">Subtotal — {group.category}</td>
        <td className={TD} />
        <Grid grid={group.subtotal} />
      </tr>
    </>
  );
}
