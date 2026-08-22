"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { blockSpec, type BlockFix, type CauseGroup, type ImportOption } from "@/lib/import-vocabulary";

/**
 * The one fix each group gets. `BlockFix["kind"]` is a three-member union —
 * `"link" | "option" | "reupload"` — and this switches on all three with no
 * `default:` case, so a fourth kind added to the union is a TYPE ERROR here
 * (the `never` assignment below fails to compile) rather than a group that
 * silently renders no affordance (§6a rule 10 — the defect that has hit
 * every rule-module/page pairing in this codebase).
 */
function Fix({
  fix,
  busy,
  onApplyOption,
  onReupload,
}: {
  fix: BlockFix;
  busy: boolean;
  /**
   * Both handlers are OPTIONAL, and their absence is the read-only signal
   * (R-2, Task 11 round two). The outcome panel renders the groups of a write
   * that already happened; once a newer plan is pending, a fix clicked there
   * would edit that newer plan instead — so the caller withholds the handlers
   * rather than passing a no-op, and the affordance disappears instead of
   * lying. A `link` fix stays live either way: navigating to
   * /admin/asset-categories is safe whatever plan is on screen.
   */
  onApplyOption?: (option: ImportOption) => void;
  onReupload?: () => void;
}) {
  switch (fix.kind) {
    case "link":
      return (
        <Link href={fix.href!} className="shrink-0 text-[12px] font-medium text-accent hover:underline">
          {fix.label} →
        </Link>
      );
    case "option":
      if (!onApplyOption) return null;
      return (
        <Button
          size="sm"
          variant="secondary"
          disabled={busy}
          className="shrink-0"
          onClick={() => onApplyOption(fix.option!)}
        >
          {fix.label}
        </Button>
      );
    case "reupload":
      // The wizard's own restart: there is no admin page to send the
      // operator to for a typo or a shape problem, and `/inventory/import`
      // is the page they're already standing on. This clears the current
      // file and verdict and returns to step 1 — a real action, not a dead
      // label or a link to nowhere.
      if (!onReupload) return null;
      return (
        <Button size="sm" variant="secondary" disabled={busy} className="shrink-0" onClick={onReupload}>
          {fix.label}
        </Button>
      );
    default: {
      const exhaustive: never = fix.kind;
      return exhaustive;
    }
  }
}

export function BlockedCauses({
  groups,
  busy,
  onApplyOption,
  onReupload,
}: {
  groups: CauseGroup[];
  busy: boolean;
  onApplyOption?: (option: ImportOption) => void;
  onReupload?: () => void;
}) {
  if (groups.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      {groups.map((g) => {
        const spec = blockSpec(g.cause);
        return (
          <div key={g.cause} className="rounded-(--radius-card) border border-border bg-surface px-3 py-2.5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 flex-col gap-1">
                <span className="flex items-center gap-2">
                  <span className="text-[13px] font-medium text-fg">{spec.label}</span>
                  <span className="font-mono text-[10.5px] text-fg-muted">
                    {g.count} {g.count === 1 ? "row" : "rows"}
                  </span>
                </span>
                <span className="text-[11.5px] leading-snug text-fg-secondary">{spec.explain}</span>
                {g.examples.length > 0 && (
                  <span className="truncate font-mono text-[10.5px] text-fg-muted">
                    e.g. {g.examples.join(", ")}
                  </span>
                )}
                {/* The row numbers are how an operator finds them in Excel.
                    Capped, so 400 blocked rows do not print 400 numbers. */}
                <span className="font-mono text-[10.5px] text-fg-muted">
                  {g.rows.length <= 12
                    ? `rows ${g.rows.join(", ")}`
                    : `rows ${g.rows.slice(0, 12).join(", ")} and ${g.rows.length - 12} more`}
                </span>
              </div>
              {spec.fix && (
                <Fix fix={spec.fix} busy={busy} onApplyOption={onApplyOption} onReupload={onReupload} />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
