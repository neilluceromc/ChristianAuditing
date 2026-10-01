import Link from "next/link";
import type { ApprovalType } from "@prisma/client";
import { cn } from "@/lib/cn";
import { CLOSED_VIA, CLOSED_VIA_LABEL, approvalsHref, type ClosedVia } from "@/lib/approvals-list";

/**
 * Closed tab's `?via=` chip row (Phase 21) — mirrors `repair-chips.tsx`'s
 * chip markup/classes. Picking a chip resets to page 1 of that filter and keeps
 * the search and the Type facet (Phase 33, plan P-5: with neither set, the hrefs
 * are exactly today's, e.g. `/approvals?tab=closed&via=direct`).
 */
export function ClosedViaChips({
  via,
  counts,
  q,
  types,
}: {
  via: ClosedVia;
  counts: Record<ClosedVia, number>;
  q: string;
  types: ApprovalType[];
}) {
  const chipClass = (on: boolean) =>
    cn(
      "inline-flex items-center gap-1.5 rounded-(--radius-ctl) border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.06em]",
      on
        ? "border-accent-soft-border bg-accent-soft text-accent-soft-text"
        : "border-border bg-surface text-fg-secondary hover:bg-surface-subtle",
    );

  return (
    <div role="group" aria-label="Closed by route" className="flex flex-wrap items-center gap-1.5">
      {CLOSED_VIA.map((v) => (
        <Link
          key={v}
          href={approvalsHref({ tab: "closed", via: v, q, types })}
          aria-current={v === via ? "true" : undefined}
          className={chipClass(v === via)}
        >
          {CLOSED_VIA_LABEL[v]} <span className="font-mono">{counts[v]}</span>
        </Link>
      ))}
    </div>
  );
}
