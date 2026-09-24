"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/cn";
import { navIsActive, type NavSection } from "@/lib/workspaces";

export interface ApprovalsBadge {
  open: number;
  overdue: number;
}

/** Every nav count the shell carries (the Worklist count is 0 for roles without one). */
export interface NavBadges {
  approvals: ApprovalsBadge;
  worklist: number;
}

export function NavList({
  sections,
  badges,
  onNavigate,
}: {
  sections: NavSection[];
  badges: NavBadges;
  /** mobile drawer closes itself on navigation */
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const search = useSearchParams();
  const badge = badges.approvals;
  return (
    <nav aria-label="Workspace" className="flex flex-1 flex-col gap-4 overflow-y-auto px-3 py-4">
      {sections.map((section) => (
        <div key={section.heading} className="flex flex-col gap-0.5">
          <h3 className="px-2.5 pb-1 font-mono text-[9.5px] font-medium uppercase tracking-[0.08em] text-fg-muted">
            {section.heading}
          </h3>
          {section.items.map((item) => {
            const active = navIsActive(item.href, pathname, search);
            return (
              <Link
                key={item.href + item.label}
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center justify-between rounded-(--radius-btn) px-2.5 py-[7px] text-[12.5px]",
                  "transition-colors duration-(--dur-1)",
                  active
                    ? "bg-accent-tint text-accent shadow-[inset_2px_0_0_var(--accent)]"
                    : "text-fg-secondary hover:bg-surface-subtle hover:text-fg",
                )}
              >
                {item.label}
                {item.badge === "approvals" && badge.open > 0 && (
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
                {item.badge === "worklist" && badges.worklist > 0 && (
                  <span
                    className="inline-flex items-center rounded-(--radius-ctl) border border-border bg-border-faint px-1.5 font-mono text-[10px] text-fg-secondary"
                    aria-label={`${badges.worklist} waiting on the worklist`}
                  >
                    {badges.worklist}
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
