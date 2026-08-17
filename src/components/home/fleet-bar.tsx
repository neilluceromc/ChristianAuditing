import { StatusDot } from "@/components/ui/status";
import { statusFamily } from "@/lib/status";
import type { Fleet } from "@/server/modules/home/queries";

/**
 * One 12px stacked bar over every status, a legend with counts and shares, and
 * then the line that matters — whether the spare pool covers the people
 * starting next week. Colours come from the six-family map; no screen picks a
 * status colour by hand.
 */
export function FleetBar({ fleet }: { fleet: Fleet }) {
  return (
    <div className="flex flex-col gap-3">
      <div
        className="flex h-3 w-full overflow-hidden rounded-full bg-border-faint"
        role="img"
        aria-label={`Fleet of ${fleet.total} assets by status`}
      >
        {fleet.slices.map((s) => (
          <span
            key={s.status}
            title={`${s.status} ${s.count}`}
            style={{
              width: `${s.share}%`,
              background: `var(--st-${statusFamily(s.status)}-dot)`,
              animation: "grow var(--dur-3) var(--ease-std)",
            }}
          />
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
        {fleet.slices.map((s) => (
          <li key={s.status} className="inline-flex items-center gap-1.5">
            <StatusDot value={s.status} />
            <span className="font-mono text-[10.5px] text-fg-secondary">{s.status}</span>
            <span className="font-mono text-[10.5px] font-semibold text-fg">{s.count}</span>
            <span className="font-mono text-[10px] text-fg-muted">{s.share}%</span>
          </li>
        ))}
      </ul>
      <p className="text-[12.5px] text-fg-secondary">{fleet.coverage}</p>
    </div>
  );
}
