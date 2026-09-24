import Link from "next/link";
import { cn } from "@/lib/cn";
import { WIZARD_STEPS, type StepId } from "@/lib/offboarding";

/**
 * The 4-stop bar (README 3e). Every step is a link (Phase 32 T5): the
 * Collect step's own inline Continue button keeps the `canContinue` gate
 * (spec §4.3), so the bar no longer needs to lock steps to enforce it.
 */
export function WizardSteps({
  employeeId,
  current,
}: {
  employeeId: string;
  current: StepId;
}) {
  const currentIdx = WIZARD_STEPS.findIndex((s) => s.id === current);
  const shared = "inline-flex items-center gap-1.5 rounded-(--radius-ctl) border px-2.5 py-1 text-[12px]";

  return (
    <ol aria-label="Offboarding steps" className="flex flex-wrap items-center gap-1.5 pb-4">
      {WIZARD_STEPS.map((step, i) => {
        const isCurrent = i === currentIdx;
        const done = i < currentIdx;
        const inner = (
          <>
            <span
              aria-hidden
              className={cn(
                "grid size-[18px] place-items-center rounded-full border font-mono text-[9.5px]",
                isCurrent
                  ? "border-accent bg-accent text-accent-fg"
                  : done
                    ? "border-accent-soft-border bg-accent-soft text-accent-soft-text"
                    : "border-border-strong text-fg-faint",
              )}
            >
              {i + 1}
            </span>
            {step.label}
          </>
        );
        return (
          <li key={step.id} className="flex items-center gap-1.5">
            {i > 0 && <span aria-hidden className="h-px w-4 bg-border-strong" />}
            <Link
              href={`/offboarding/${employeeId}?step=${step.id}`}
              aria-current={isCurrent ? "step" : undefined}
              className={cn(
                shared,
                isCurrent
                  ? "border-accent-soft-border bg-accent-tint font-medium text-fg"
                  : "border-border bg-surface text-fg-secondary hover:bg-surface-subtle",
              )}
            >
              {inner}
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
