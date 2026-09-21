import Link from "next/link";
import { StatusDot } from "@/components/ui/status";
import { statusFamily } from "@/lib/status";
import type { Fleet } from "@/server/modules/home/queries";

/**
 * One 12px stacked bar over every status, a legend with counts and shares, and
 * the line that decides something: does the spare pool cover next week's hires?
 * Phase 25 (spec §4 row 7): every segment and legend status is a link to the
 * inventory filtered to that status. The bar wrapper lost its `role="img"` —
 * a group of real links is not an image — and each segment names itself with
 * visually hidden text (no aria-label needed).
 */
export function FleetBar({ fleet }: { fleet: Fleet }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-border-faint">
        {fleet.slices.map((s) => (
          <Link
            key={s.status}
            href={s.href}
            title={`${s.status} ${s.count}`}
            className="block h-full hover:opacity-80"
            style={{
              width: `${s.share}%`,
              background: `var(--st-${statusFamily(s.status)}-dot)`,
              animation: "grow var(--dur-3) var(--ease-std)",
            }}
          >
            <span className="sr-only">{`${s.status}: ${s.count} assets`}</span>
          </Link>
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
        {fleet.slices.map((s) => (
          <li key={s.status} className="inline-flex items-center gap-1.5">
            <StatusDot value={s.status} />
            <Link href={s.href} className="font-mono text-[10.5px] text-fg-secondary hover:underline">{s.status}</Link>
            <span className="font-mono text-[10.5px] font-semibold text-fg">{s.count}</span>
            <span className="font-mono text-[10px] text-fg-muted">{s.share}%</span>
          </li>
        ))}
      </ul>
      <p className="text-[12.5px] text-fg-secondary">{fleet.coverage}</p>
    </div>
  );
}
