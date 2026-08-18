import Link from "next/link";
import { cn } from "@/lib/cn";
import { WIZARD_STEPS, type StepId } from "@/lib/offboarding";

/**
 * The 4-stop bar (README 3e). Steps 3 and 4 are NOT links while any item is
 * undecided — Continue is blocked, so the bar must not offer a way around it.
 */
export function WizardSteps({
  employeeId,
  current,
  unlocked,
}: {
  employeeId: string;
  current: StepId;
  unlocked: boolean;
}) {
  const currentIdx = WIZARD_STEPS.findIndex((s) => s.id === current);
  const shared = "inline-flex items-center gap-1.5 rounded-(--radius-ctl) border px-2.5 py-1 text-[12px]";

  return (
    <ol aria-label="Offboarding steps" className="flex flex-wrap items-center gap-1.5 pb-4">
      {WIZARD_STEPS.map((step, i) => {
        const reachable = i <= 1 || unlocked;
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
            {reachable ? (
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
            ) : (
              <span
                className={cn(shared, "border-dashed border-border-strong text-fg-faint")}
                title="Decide every item first — undecided is not the same as returned."
              >
                {inner}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
