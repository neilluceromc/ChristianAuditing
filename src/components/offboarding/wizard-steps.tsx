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
        // A step can be BEHIND the operator and locked again at the same time:
        // reject one return in Approvals while they stand on Accounts and the
        // item re-opens, `unlocked` flips false, and step 3 becomes an
        // unreachable current step. Painting it "done" would claim they had
        // finished a step they can no longer enter.
        const done = i < currentIdx && reachable;
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
                // the current step can be locked (see `done` above), so
                // aria-current belongs on this branch too — otherwise the bar
                // tells a screen reader the operator is nowhere at all
                aria-current={isCurrent ? "step" : undefined}
                className={cn(shared, "border-dashed border-border-strong text-fg-faint")}
              >
                {inner}
                {/* `title` on a non-focusable span never reaches a keyboard
                    user and is exposed inconsistently, so the reason the step
                    is locked is real text instead */}
                <span className="sr-only">
                  — locked until every item is decided; undecided is not the same as returned.
                </span>
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
