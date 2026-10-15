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

/** Spec §5.6: the year's Jan–Dec grid. Tag and Model stay put while the months scroll. */
export function ScheduleTable({ year, groups, total }: { year: number; groups: ScheduleGroup[]; total: YearRow | null }) {
  const projected = groups[0]?.subtotal.projected ?? Array<boolean>(12).fill(false);
  const stickyTag = "sticky left-0 z-[1] w-[110px] min-w-[110px]";
  const stickyModel = "sticky left-[110px] z-[1] w-[180px] min-w-[180px] max-w-[180px] truncate";
  return (
    <div role="region" aria-label="Schedule scroll area" tabIndex={0} className="overflow-x-auto rounded-(--radius-card) border border-border bg-surface shadow-card" style={{ overflowX: "auto" }}>
      <table aria-label={`Depreciation schedule ${year}`} className="w-full border-collapse text-[12.5px]">
        <thead>
          <tr>
            <th scope="col" className={cn(TH, "text-left", stickyTag, "z-[2]")}>Tag</th>
            <th scope="col" className={cn(TH, "text-left", stickyModel, "z-[2]")}>Model</th>
            <th scope="col" className={cn(TH, "text-left")}>Category</th>
            <th scope="col" className={cn(TH, "text-right")}>Cost</th>
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
        <tbody>
          {groups.map((g) => (
            <GroupRows key={g.category} group={g} stickyTag={stickyTag} stickyModel={stickyModel} />
          ))}
          {total && (
            <tr className="border-b border-border-faint bg-surface-subtle font-semibold" style={{ height: "var(--row-h)" }}>
              <td className={cn("px-3 bg-surface-subtle", stickyTag)} />
              <td className={cn("px-3 bg-surface-subtle", stickyModel)} />
              <td className="px-3 text-left text-fg">Total</td>
              <td className={TD} />
              <Grid grid={total} />
            </tr>
          )}
        </tbody>
      </table>
    </div>
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
