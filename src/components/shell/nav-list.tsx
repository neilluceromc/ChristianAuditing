"use client";

import Link from "next/link";
import { cn } from "@/lib/cn";
import type { VisibleSection } from "@/lib/workspaces";

export interface ApprovalsBadge {
  open: number;
  overdue: number;
}

/** Every nav count the shell carries (the Worklist count is 0 for roles without one). */
export interface NavBadges {
  approvals: ApprovalsBadge;
  worklist: number;
  /** Phase 40 §6: purchase requests waiting for IT's review (0 for roles without the item) */
  purchaseReviews: number;
}

/**
 * Phase 42 Task 1 stopgap: the links render flat (groups by spacing, no headings, no views, no current-link state)
 * until Task 4 replaces this with the nav tree and the matcher.
 */
export function NavList({
  sections,
  badges,
  onNavigate,
}: {
  sections: VisibleSection[];
  badges: NavBadges;
  /** mobile drawer closes itself on navigation */
  onNavigate?: () => void;
}) {
  const badge = badges.approvals;
  return (
    <nav aria-label="Workspace" className="flex flex-1 flex-col gap-4 overflow-y-auto px-3 py-4">
      {sections.map((section) => (
        <div key={section.heading} className="flex flex-col gap-0.5">
          {section.items.map((item) => {
            return (
              <Link
                key={item.href + item.label}
                href={item.href}
                onClick={onNavigate}
                className={cn(
                  "flex items-center justify-between rounded-(--radius-btn) px-2.5 py-[7px] text-[12.5px]",
                  "transition-colors duration-(--dur-1) text-fg-secondary hover:bg-surface-subtle hover:text-fg",
                )}
              >
                {item.label}
                {item.badge.includes("approvals") && badge.open > 0 && (
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded-(--radius-ctl) border px-1.5 font-mono text-[10px]",
                      badge.overdue > 0
                        ? "border-[var(--st-fault-border)] bg-[var(--st-fault-bg)] text-[var(--st-fault-text)]"
                        : "border-border bg-border-faint text-fg-secondary",
                    )}
                    aria-label={`${badge.open} open approvals${badge.overdue > 0 ? ", some past SLA" : ""}`}
                  >
                    {badge.overdue > 0 && (
                      <span
                        aria-hidden
                        className="size-[5px] rounded-full bg-[var(--st-fault-dot)]"
                        style={{ animation: "pulse 1.9s ease-in-out infinite" }}
                      />
                    )}
                    {badge.open}
                  </span>
                )}
                {item.badge.includes("worklist") && badges.worklist > 0 && (
                  <span
                    className="inline-flex items-center rounded-(--radius-ctl) border border-border bg-border-faint px-1.5 font-mono text-[10px] text-fg-secondary"
                    aria-label={`${badges.worklist} waiting on the worklist`}
                  >
                    {badges.worklist}
                  </span>
                )}
                {item.badge.includes("purchaseReviews") && badges.purchaseReviews > 0 && (
                  <span
                    className="inline-flex items-center rounded-(--radius-ctl) border border-border bg-border-faint px-1.5 font-mono text-[10px] text-fg-secondary"
                    aria-label={`${badges.purchaseReviews} waiting for IT`}
                  >
                    {badges.purchaseReviews}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
