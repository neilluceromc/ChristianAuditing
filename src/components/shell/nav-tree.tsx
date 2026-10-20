"use client";

import { useEffect, useId, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/cn";
import { countBadge, itemBadge, type BadgeView, type NavBadges } from "@/lib/nav-badges";
import type { NavCurrent } from "@/lib/nav-match";
import { isOpen, navOpenKey, NO_TOGGLES, parseOpened, toggleOpen, type NavToggles } from "@/lib/nav-open";
import type { NavView, VisibleItem, VisibleSection, WorkspaceId } from "@/lib/workspaces";

/** Spec §4.5: the chip highlight — the hover fill plus a 1 px inset strong ring. */
export const CHIP = "bg-surface-subtle shadow-[inset_0_0_0_1px_var(--border-strong)]";

/** Spec §4.3: mono 11 px muted, right-aligned; red with a 6 px dot only for urgent counts. Zero never shows. */
export function Count({ badge }: { badge: BadgeView | null }) {
  if (!badge) return null;
  return (
    <span
      aria-label={badge.label}
      className={cn(
        "ml-auto inline-flex shrink-0 items-center gap-1.5 pl-2 font-mono text-[11px] leading-none",
        badge.fault ? "text-[var(--st-fault-text)]" : "text-fg-muted",
      )}
    >
      {badge.fault && <span aria-hidden className="size-1.5 rounded-full bg-current" />}
      {badge.n}
    </span>
  );
}

function ViewRow({
  view,
  current,
  badges,
  onNavigate,
}: {
  view: NavView;
  current: boolean;
  badges: NavBadges;
  onNavigate?: () => void;
}) {
  return (
    <li className="relative">
      {/* Spec §4.5: a 2 px accent mark over the 1 px guide line, beside the current view. */}
      {current && <span aria-hidden className="absolute bottom-1.5 left-[-13.5px] top-1.5 w-0.5 rounded-full bg-accent" />}
      <Link
        href={view.href}
        onClick={onNavigate}
        aria-current={current ? "page" : undefined}
        className={cn(
          "flex h-[30px] items-center rounded-[8px] px-2.5 text-[12.5px]",
          "transition-colors duration-(--dur-1) hover:bg-surface-subtle hover:text-fg",
          current ? cn(CHIP, "font-medium text-fg") : "text-fg-secondary",
        )}
      >
        <span className="min-w-0 truncate">{view.label}</span>
        <Count badge={view.count ? countBadge(view.count, badges.counts[view.count] ?? 0, badges) : null} />
      </Link>
    </li>
  );
}

function ItemRow({
  item,
  current,
  badges,
  toggles,
  onToggle,
  onNavigate,
}: {
  item: VisibleItem;
  current: NavCurrent;
  badges: NavBadges;
  toggles: NavToggles;
  onToggle: (label: string, isCurrent: boolean) => void;
  onNavigate?: () => void;
}) {
  const viewsId = useId();
  const isCurrent = current.item === item.label;
  const hasViews = item.views.length > 0;
  // Phase 46 spec §4.2: the current link opens by itself; its chevron toggle opens or closes any link's views.
  const open = hasViews && isOpen(item.label, isCurrent, toggles);
  // Spec §4.2: a current link with no views is the page itself; one with views hands that role to its view.
  const page = isCurrent && !hasViews;
  // An open link's views carry the counts, so its own badge steps aside.
  const badge = open ? null : itemBadge(item, badges);
  return (
    <li>
      <div className="relative">
        <Link
          href={item.href}
          onClick={onNavigate}
          aria-current={page ? "page" : undefined}
          data-nav-current={isCurrent || undefined}
          className={cn(
            "flex h-9 items-center gap-[11px] rounded-[9px] px-2.5 text-[13px]",
            "transition-colors duration-(--dur-1) hover:bg-surface-subtle hover:text-fg",
            isCurrent ? "font-medium text-fg" : "text-fg-secondary",
            page && CHIP,
            // room for the toggle, which sits over the row's right end
            hasViews && "pr-9",
          )}
        >
          <Icon name={item.icon} size={17} className={isCurrent ? "text-accent" : "text-fg-muted"} />
          <span className="min-w-0 truncate">{item.label}</span>
          <Count badge={badge} />
        </Link>
        {hasViews && (
          // A button of its own beside the link, never inside it: it opens or closes the views without navigating.
          <button
            type="button"
            aria-expanded={open}
            aria-controls={viewsId}
            aria-label={`${item.label} views`}
            onClick={() => onToggle(item.label, isCurrent)}
            className={cn(
              "absolute right-1 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-[7px] text-fg-muted",
              "transition-colors duration-(--dur-1) hover:bg-surface-subtle hover:text-fg",
            )}
          >
            <Icon
              name="chevron"
              size={10}
              className={cn("motion-safe:transition-transform motion-safe:duration-200", open && "rotate-90")}
            />
          </button>
        )}
      </div>
      {open && (
        <ul
          id={viewsId}
          className="ml-[19px] mt-0.5 flex flex-col gap-0.5 border-l border-border-strong pl-3 motion-safe:animate-[nav-views-in_180ms_var(--ease-std)]"
        >
          {item.views.map((view) => (
            <ViewRow
              key={view.label}
              view={view}
              current={current.view === view.label}
              badges={badges}
              onNavigate={onNavigate}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * The toggles' state for one workspace (Phase 46 spec §4.2). What the toggles opened is kept in sessionStorage, read
 * after mount so the first paint (the current link open, nothing else) matches the server's; a closed current link is
 * remembered only until another link is current. Storage that throws (blocked, private mode) is simply not used.
 */
function useNavToggles(workspace: WorkspaceId, currentItem: string | null) {
  const [toggles, setToggles] = useState<NavToggles>(NO_TOGGLES);
  const [seenCurrent, setSeenCurrent] = useState(currentItem);
  const [seenWorkspace, setSeenWorkspace] = useState(workspace);
  if (seenWorkspace !== workspace) {
    // Another workspace: drop this one's toggles during the render, so they never show under its links; the effect
    // below then reads the new workspace's stored ones.
    setSeenWorkspace(workspace);
    setSeenCurrent(currentItem);
    setToggles(NO_TOGGLES);
  } else if (seenCurrent !== currentItem) {
    setSeenCurrent(currentItem);
    if (toggles.closedCurrent !== null) setToggles({ ...toggles, closedCurrent: null });
  }

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = window.sessionStorage.getItem(navOpenKey(workspace));
    } catch {
      // unreadable storage: nothing is remembered
    }
    setToggles({ opened: parseOpened(stored), closedCurrent: null });
  }, [workspace]);

  function toggle(label: string, isCurrent: boolean) {
    const next = toggleOpen(toggles, label, isCurrent);
    setToggles(next);
    try {
      window.sessionStorage.setItem(navOpenKey(workspace), JSON.stringify(next.opened));
    } catch {
      // unwritable storage: the toggle still works on this page
    }
  }

  return { toggles, toggle };
}

/**
 * Phase 42 spec §4.2 / §4.5: the workspace's links as lists, one per group (spacing, no headings). The current link
 * opens its views by itself; Phase 46 (§4.2) gives every link with views a chevron toggle that opens or closes them
 * without navigating, remembered for the session per workspace. Closed views are not drawn, so Tab never passes
 * through hidden ones. `current` comes from `currentNav` in NavList.
 */
export function NavTree({
  workspace,
  sections,
  current,
  badges,
  onNavigate,
}: {
  /** whose opened links to remember (per workspace) */
  workspace: WorkspaceId;
  sections: VisibleSection[];
  current: NavCurrent;
  badges: NavBadges;
  /** the mobile drawer closes itself on navigation */
  onNavigate?: () => void;
}) {
  const { toggles, toggle } = useNavToggles(workspace, current.item);
  return (
    <nav aria-label="Workspace" className="flex flex-col gap-3 px-2 py-2">
      {sections.map((section) => (
        <ul key={section.heading} className="flex flex-col gap-0.5">
          {section.items.map((item) => (
            <ItemRow
              key={item.label}
              item={item}
              current={current}
              badges={badges}
              toggles={toggles}
              onToggle={toggle}
              onNavigate={onNavigate}
            />
          ))}
        </ul>
      ))}
    </nav>
  );
}
