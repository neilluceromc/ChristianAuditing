import Link from "next/link";
import { EmptyState } from "@/components/ui/empty-state";
import type { WorkGroup } from "@/lib/worklist";
import type { ComboOption } from "@/components/patterns/entity-combobox";
import { DismissButton } from "./dismiss-button";
import { WorkRowActions } from "./work-row-actions";

export function Worklist({
  groups,
  canAct,
  direct,
  employees,
  seeAllBase,
  headingLevel = "h3",
}: {
  groups: WorkGroup[];
  canAct: boolean;
  /** Spec §5.1: the Assign dialog applies at once (isDirectLifecycle) instead of opening an approval. */
  direct: boolean;
  /** the Assign dialog's people; empty when no row offers Assign… */
  employees: ComboOption[];
  seeAllBase?: string;
  /**
   * Home nests each group under SectionCard's `h2` ("Worklist"), so `h3` is
   * correct there (the default). The standalone /inventory/work page has no
   * such wrapper — its own PageHeader is the `h1`, so it passes `h2` itself
   * or heading-order skips a level (axe: heading-order).
   */
  headingLevel?: "h2" | "h3";
}) {
  if (groups.length === 0) {
    return <EmptyState title="Nothing is waiting on you" description="No devices to triage, no repairs to chase, no new starter without kit, nothing missing." />;
  }
  const Heading = headingLevel;
  return (
    <div className="flex flex-col gap-5">
      {groups.map((g) => (
        <section key={g.section.id} id={g.section.id} aria-labelledby={`work-${g.section.id}`}>
          <div className="flex items-baseline justify-between">
            <Heading id={`work-${g.section.id}`} className="text-[13px] font-semibold text-fg">
              {g.section.title} <span className="font-mono text-[10.5px] text-fg-muted">{g.capped ? `${g.total}+` : g.total}</span>
            </Heading>
            {seeAllBase && (g.total > g.rows.length || g.capped) && (
              <Link href={`${seeAllBase}#${g.section.id}`} className="text-[12px] text-accent hover:underline">
                See all {g.capped ? `${g.total}+` : g.total}
              </Link>
            )}
          </div>
          <p className="text-[11px] text-fg-muted">{g.section.blurb}</p>
          {!seeAllBase && g.capped && (
            <p className="text-[11px] text-fg-muted">Showing the first {g.rows.length} — the oldest first.</p>
          )}
          <ol className="flex flex-col">
            {g.rows.map((row) => (
              <li key={row.key} className="flex items-center gap-3 border-b border-border-faint py-2.5 last:border-b-0">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-medium text-fg">{row.title}</span>
                  <span className="block truncate font-mono text-[10.5px] text-fg-muted">{row.meta}</span>
                </span>
                <WorkRowActions row={row} canAct={canAct} direct={direct} employees={employees} />
                {canAct && <DismissButton shiftKey={row.key} title={row.title} />}
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}
