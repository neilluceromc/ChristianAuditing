"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/cn";
import { countBadge, itemBadge, type BadgeView, type NavBadges } from "@/lib/nav-badges";
import type { NavCurrent } from "@/lib/nav-match";
import type { VisibleItem, VisibleSection } from "@/lib/workspaces";
import { CHIP, Count } from "./nav-tree";

/** The corner pill keeps to two digits; the link's accessible name carries the exact count. */
export const pillText = (n: number) => (n > 99 ? "99+" : String(n));

/** Spec §4.1: a link's badge as a small pill on the icon's corner, red for the urgent (dot) badges. */
function CornerPill({ badge }: { badge: BadgeView }) {
  return (
    <span
      aria-hidden
      data-rail-pill={badge.fault ? "fault" : "count"}
      className={cn(
        "absolute -right-1.5 -top-1 grid h-4 min-w-4 place-items-center rounded-full px-1",
        "font-mono text-[10px] font-semibold leading-none",
        badge.fault
          ? "bg-[var(--st-fault-dot)] text-surface"
          : "bg-[var(--st-neutral-bg)] text-[var(--st-neutral-text)] shadow-[inset_0_0_0_1px_var(--st-neutral-border)]",
      )}
    >
      {pillText(badge.n)}
    </span>
  );
}

/** The rail icon's description when its flyout lists views. */
export const viewsHint = (n: number) => `Has ${n} view${n === 1 ? "" : "s"}`;

function RailItem({ item, current, badges }: { item: VisibleItem; current: NavCurrent; badges: NavBadges }) {
  const isCurrent = current.item === item.label;
  const hasViews = item.views.length > 0;
  // As in the full tree: a current link with no views is the page; one with views hands that role to its view.
  const page = isCurrent && !hasViews;
  // The views are out of sight in the rail, so the link keeps its own badge even while current.
  const badge = itemBadge(item, badges);
  // Esc (or choosing a destination) hides the flyout until the pointer leaves or the focus moves on.
  const [dismissed, setDismissed] = useState(false);
  const [hovered, setHovered] = useState(false);
  const hintId = useId();
  const itemRef = useRef<HTMLLIElement>(null);
  const iconRef = useRef<HTMLAnchorElement>(null);
  const flyRef = useRef<HTMLDivElement>(null);

  // The flyout is position: fixed, so the nav's own scroll box cannot clip it: place it against the rail's edge,
  // level with the icon, and keep it on screen. Its 11 px left padding bridges the gap, so the pointer can cross
  // from the icon to the flyout without losing the hover.
  function place() {
    const li = itemRef.current;
    const fly = flyRef.current;
    if (!li || !fly) return;
    const r = li.getBoundingClientRect();
    fly.style.left = `${r.right}px`;
    fly.style.top = `${r.top - 4}px`;
    const h = fly.getBoundingClientRect().height; // 0 while still hidden
    const lowest = window.innerHeight - 8 - h;
    if (h > 0 && r.top - 4 > lowest) fly.style.top = `${Math.max(8, lowest)}px`;
  }

  const flyShown = () => !!flyRef.current && flyRef.current.getClientRects().length > 0;

  // WCAG 1.4.13: a flyout opened by hover alone (the focus elsewhere) is dismissible too. With the focus inside the
  // item, its own onKeyDown handles Esc and stops it before it reaches the document.
  useEffect(() => {
    if (!hovered || dismissed) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && flyShown()) setDismissed(true);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [hovered, dismissed]);

  return (
    <li
      ref={itemRef}
      data-rail-item=""
      className="group/fly relative flex justify-center"
      onMouseEnter={() => {
        place();
        setHovered(true);
      }}
      onFocus={place}
      onMouseLeave={() => {
        setHovered(false);
        setDismissed(false);
      }}
      onBlur={(e) => {
        if (!itemRef.current?.contains(e.relatedTarget as Node | null)) setDismissed(false);
      }}
      onClick={() => setDismissed(true)}
      onKeyDown={(e) => {
        if (e.key !== "Escape" || dismissed) return;
        if (!flyShown()) return;
        // This Esc is the flyout's: a page panel listening for Esc must not close too.
        e.preventDefault();
        e.stopPropagation();
        setDismissed(true);
        iconRef.current?.focus();
      }}
    >
      <Link
        ref={iconRef}
        href={item.href}
        aria-label={badge ? `${item.label}, ${badge.label}` : item.label}
        aria-current={page ? "page" : isCurrent ? "true" : undefined}
        aria-describedby={hasViews ? hintId : undefined}
        data-nav-current={isCurrent || undefined}
        className={cn(
          "relative grid size-10 place-items-center rounded-[9px]",
          "transition-colors duration-(--dur-1) hover:bg-surface-subtle",
          isCurrent && CHIP,
        )}
      >
        <Icon name={item.icon} size={18} className={isCurrent ? "text-accent" : "text-fg-muted"} />
        {badge && <CornerPill badge={badge} />}
      </Link>
      {/* Tells a screen-reader user that the next links are this link's views. */}
      {hasViews && (
        <span id={hintId} hidden>
          {viewsHint(item.views.length)}
        </span>
      )}
      <div
        ref={flyRef}
        data-rail-flyout=""
        className={cn(
          "fixed left-0 top-0 z-40 pl-[11px]",
          dismissed ? "hidden" : "hidden group-focus-within/fly:block group-hover/fly:block",
        )}
      >
        <div className="min-w-[208px] max-w-[280px] rounded-[10px] border border-border-strong bg-surface-raised p-1.5 shadow-pop">
          {/* The icon's accessible name already says this; the flyout's title is for the eye. */}
          <p aria-hidden className="truncate px-2 pb-1 pt-1 text-[13px] font-medium text-fg">
            {item.label}
          </p>
          {hasViews && (
            <ul aria-label={`${item.label} views`} className="flex flex-col gap-0.5">
              {item.views.map((view) => {
                const here = isCurrent && current.view === view.label;
                return (
                  <li key={view.label}>
                    <Link
                      href={view.href}
                      aria-current={here ? "page" : undefined}
                      className={cn(
                        "flex h-[30px] items-center rounded-[7px] px-2 text-[12.5px]",
                        "transition-colors duration-(--dur-1) hover:bg-surface-subtle hover:text-fg",
                        here ? cn(CHIP, "font-medium text-fg") : "text-fg-secondary",
                      )}
                    >
                      <span className="min-w-0 truncate">{view.label}</span>
                      <Count badge={view.count ? countBadge(view.count, badges.counts[view.count] ?? 0, badges) : null} />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </li>
  );
}

/**
 * Phase 46 spec §4.1: the workspace's links as the 72 px icon rail. Each icon is a link named by its label (and its
 * badge's words); hover or keyboard focus opens a flyout with the link's name and its views (with counts) as links,
 * so Tab walks from an icon into its views and on to the next icon. Esc closes the flyout and returns the focus to
 * the icon. Presentational: `current` comes from `currentNav` in NavList.
 */
export function NavRail({
  sections,
  current,
  badges,
}: {
  sections: VisibleSection[];
  current: NavCurrent;
  badges: NavBadges;
}) {
  return (
    <nav aria-label="Workspace" className="flex flex-col gap-3 py-2">
      {sections.map((section) => (
        <ul key={section.heading} className="flex flex-col gap-1">
          {section.items.map((item) => (
            <RailItem key={item.label} item={item} current={current} badges={badges} />
          ))}
        </ul>
      ))}
    </nav>
  );
}
