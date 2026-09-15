import Link from "next/link";
import { Stat } from "@/components/ui/stat";
import { DIRECT_WINDOW_DAYS } from "@/lib/approvals-list";
import type { DirectChanges } from "@/server/modules/home/queries";

/**
 * Admin Home's "Applied directly · last {DIRECT_WINDOW_DAYS} days" (Phase 21
 * spec §4.1) — rows that were never queued, in the `AdminHomeBody` "Who can
 * get in" caption/list style.
 */
export function DirectChangesBody({ data }: { data: DirectChanges }) {
  if (data.total === 0) {
    return (
      <p className="text-xs text-fg-muted">
        Nothing was applied directly in the last {DIRECT_WINDOW_DAYS} days.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Stat label="Applied directly" value={data.total} />

      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-fg-muted">
          By kind
        </span>
        <ul className="flex flex-col">
          {data.byKind.map((k) => (
            <li
              key={k.type}
              className="flex items-center justify-between border-b border-border-faint py-1.5 last:border-b-0"
            >
              <span className="text-[12.5px] text-fg">{k.label}</span>
              <span className="font-mono text-[11px] text-fg-muted">{k.count}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-fg-muted">
          By whom
        </span>
        <ul className="flex flex-col">
          {data.byActor.map((a) => (
            <li
              key={a.name}
              className="flex items-center justify-between border-b border-border-faint py-1.5 last:border-b-0"
            >
              <span className="text-[12.5px] text-fg">{a.name}</span>
              <span className="font-mono text-[11px] text-fg-muted">{a.count}</span>
            </li>
          ))}
        </ul>
      </div>

      <Link href="/approvals?tab=closed&via=direct" className="text-[12px] font-medium text-accent hover:underline">
        See them in Closed →
      </Link>
    </div>
  );
}
