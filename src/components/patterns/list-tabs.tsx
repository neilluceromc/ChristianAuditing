"use client";

import { cn } from "@/lib/cn";
import { NavLink } from "@/components/patterns/list-navigation";

/** One underlined tab: a filter the list can switch on, with how many rows it shows. */
export interface TabDef {
  key: string;
  label: string;
  count: number;
  /** where a click goes: this tab's filter on (and every other tab's off) */
  href: string;
  /** selected: this tab's filter is the one applied */
  on: boolean;
  /** colours the count badge: "attention" (amber, e.g. Missing kit), "inflight" (e.g. Leaving) or "fault" (red, e.g. Sent back) */
  tone?: "attention" | "inflight" | "fault";
}

const BADGE_TONE: Record<NonNullable<TabDef["tone"]> | "neutral", string> = {
  attention: "bg-(--st-attention-bg) text-(--st-attention-text)",
  inflight: "bg-(--st-inflight-bg) text-(--st-inflight-text)",
  fault: "bg-(--st-fault-bg) text-(--st-fault-text)",
  neutral: "bg-(--st-neutral-bg) text-(--st-neutral-text)",
};

/**
 * Phase 45 (spec §3.1): underlined tabs, each with a count badge. They are links, not ARIA tabs, because each
 * one is a URL; the selected one carries `aria-current="page"`. The row has a bottom border and scrolls
 * sideways in its own box when it does not fit.
 */
export function ListTabs({ tabs, label }: { tabs: TabDef[]; label: string }) {
  return (
    <nav aria-label={label} className="flex gap-[22px] overflow-x-auto border-b border-border">
      {tabs.map((t) => (
        <NavLink
          key={t.key}
          href={t.href}
          aria-current={t.on ? "page" : undefined}
          className={cn(
            "relative inline-flex h-10 shrink-0 items-center gap-2 whitespace-nowrap text-[13.5px] font-medium transition-colors duration-(--dur-1)",
            // the row is a scroll box, which would clip the usual outset ring: draw it inside instead
            "focus-visible:outline-offset-[-2px]",
            t.on ? "text-fg" : "text-fg-muted hover:text-fg-secondary",
          )}
        >
          {t.label}
          <span
            className={cn(
              "inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11.5px] font-medium tabular-nums",
              t.on ? "bg-accent-soft text-accent-soft-text" : BADGE_TONE[t.tone ?? "neutral"],
            )}
          >
            {t.count.toLocaleString("en-US")}
          </span>
          {t.on && (
            <span
              aria-hidden
              className="absolute inset-x-0 bottom-0 h-[2px] rounded-full bg-accent"
              style={{ animation: "grow var(--dur-3) var(--ease-std)" }}
            />
          )}
        </NavLink>
      ))}
    </nav>
  );
}
