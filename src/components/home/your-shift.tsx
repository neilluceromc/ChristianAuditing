import Link from "next/link";
import { StatusDot } from "@/components/ui/status";
import { EmptyState } from "@/components/ui/empty-state";
import type { ShiftKind, ShiftRow } from "@/lib/home";
import { DismissButton } from "./dismiss-button";

/** The 52px kind chip (README). The dot family says how bad, the chip says what kind. */
const KIND_DOT: Record<ShiftKind, string> = {
  SLA: "DEFECTIVE",   // fault — it is already late
  EXEC: "EXECUTION_FAILED", // the dashed diamond: a system failure, not a decision
  LEAVE: "SUBMITTED", // in flight
  HIRE: "PENDING",    // attention
  DATA: "TEMPORARY",  // attention, quieter
};

export function YourShift({ rows, canAct }: { rows: ShiftRow[]; canAct: boolean }) {
  if (rows.length === 0) {
    return (
      <EmptyState
        title="Nothing is on fire"
        description="No breached approvals, no failed executions, no leaver or new starter waiting on you."
      />
    );
  }
  return (
    <ol className="flex flex-col">
      {rows.map((row) => (
        <li
          key={row.key}
          className="flex items-center gap-3 border-b border-border-faint py-2.5 last:border-b-0"
        >
          <StatusDot value={KIND_DOT[row.kind]} />
          <span className="inline-flex w-[52px] shrink-0 justify-center rounded-(--radius-ctl) border border-border bg-border-faint py-0.5 font-mono text-[9.5px] font-medium uppercase tracking-[0.06em] text-fg-secondary">
            {row.kind}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12.5px] font-medium text-fg">{row.title}</span>
            <span className="block truncate font-mono text-[10.5px] text-fg-muted">{row.meta}</span>
          </span>
          <Link
            href={row.href}
            className="shrink-0 text-[12px] font-medium text-accent hover:underline"
          >
            {row.action}
          </Link>
          {canAct && <DismissButton shiftKey={row.key} title={row.title} />}
        </li>
      ))}
    </ol>
  );
}
