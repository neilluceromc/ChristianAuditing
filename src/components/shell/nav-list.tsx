"use client";

import Link from "next/link";
import { cn } from "@/lib/cn";
import type { VisibleSection } from "@/lib/workspaces";
import { itemBadge, type NavBadges } from "@/lib/nav-badges";

/**
 * Phase 42 Task 1 stopgap: the links render flat (groups by spacing, no headings, no views, no current-link state),
 * each with its own summed badge (Task 3), until Task 4 replaces this with the nav tree and the matcher.
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
  return (
    <nav aria-label="Workspace" className="flex flex-1 flex-col gap-4 overflow-y-auto px-3 py-4">
      {sections.map((section) => (
        <div key={section.heading} className="flex flex-col gap-0.5">
          {section.items.map((item) => {
            const badge = itemBadge(item, badges);
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
                {badge && (
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded-(--radius-ctl) border px-1.5 font-mono text-[10px]",
                      badge.fault
                        ? "border-[var(--st-fault-border)] bg-[var(--st-fault-bg)] text-[var(--st-fault-text)]"
                        : "border-border bg-border-faint text-fg-secondary",
                    )}
                    aria-label={badge.label}
                  >
                    {badge.fault && (
                      <span
                        aria-hidden
                        className="size-[5px] rounded-full bg-[var(--st-fault-dot)]"
                        style={{ animation: "pulse 1.9s ease-in-out infinite" }}
                      />
                    )}
                    {badge.n}
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
