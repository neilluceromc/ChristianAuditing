import { Pill } from "@/components/ui/pill";
import { fmtDate } from "@/lib/format";
import { dueStatus } from "@/lib/deadlines";

/**
 * Spec §0 decision 9 (Phase 23): two tones only; the text carries the distinction.
 * Phase 25 (spec §3.4): `override` replaces both tone and text for a case that is
 * neither overdue nor on track — a completed offboarding reads "closed".
 */
export function DuePill({
  dueAt, today, withDate = false, override,
}: {
  dueAt: Date; today: string; withDate?: boolean; override?: { tone: "neutral" | "accent"; text: string };
}) {
  const s = dueStatus(dueAt, today);
  return (
    <span className="inline-flex items-center gap-1.5">
      {withDate && <span className="font-mono text-[10.5px] text-fg-muted">{fmtDate(dueAt)}</span>}
      <Pill tone={override?.tone ?? s.tone}>{override?.text ?? s.text}</Pill>
    </span>
  );
}
