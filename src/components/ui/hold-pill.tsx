import { Pill } from "@/components/ui/pill";
import { fmtDate } from "@/lib/format";
import { holdStatus } from "@/lib/holds";

/** Phase 26 (spec §5): a live hold's expiry — the DuePill shape, with "expires…" words so it never reads like a deadline. */
export function HoldPill({ expiresAt, today, withDate = false }: { expiresAt: Date; today: string; withDate?: boolean }) {
  const s = holdStatus(expiresAt, today);
  return (
    <span className="inline-flex items-center gap-1.5">
      {withDate && <span className="font-mono text-[10.5px] text-fg-muted">{fmtDate(expiresAt)}</span>}
      <Pill tone={s.tone}>{s.text}</Pill>
    </span>
  );
}
