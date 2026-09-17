import { Pill } from "@/components/ui/pill";
import { fmtDate } from "@/lib/format";
import { dueStatus } from "@/lib/deadlines";

/** Spec §0 decision 9: two tones only; the text carries the distinction. */
export function DuePill({ dueAt, today, withDate = false }: { dueAt: Date; today: string; withDate?: boolean }) {
  const s = dueStatus(dueAt, today);
  return (
    <span className="inline-flex items-center gap-1.5">
      {withDate && <span className="font-mono text-[10.5px] text-fg-muted">{fmtDate(dueAt)}</span>}
      <Pill tone={s.tone}>{s.text}</Pill>
    </span>
  );
}
