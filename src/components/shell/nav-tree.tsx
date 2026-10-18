import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/cn";
import { countBadge, itemBadge, type BadgeView, type NavBadges } from "@/lib/nav-badges";
import type { NavCurrent } from "@/lib/nav-match";
import type { NavView, VisibleItem, VisibleSection } from "@/lib/workspaces";

/** Spec §4.5: the chip highlight — the hover fill plus a 1 px inset strong ring. */
const CHIP = "bg-surface-subtle shadow-[inset_0_0_0_1px_var(--border-strong)]";

/** Spec §4.3: mono 11 px muted, right-aligned; red with a 6 px dot only for urgent counts. Zero never shows. */
function Count({ badge }: { badge: BadgeView | null }) {
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
  onNavigate,
}: {
  item: VisibleItem;
  current: NavCurrent;
  badges: NavBadges;
  onNavigate?: () => void;
}) {
  const isCurrent = current.item === item.label;
  const hasViews = item.views.length > 0;
  const open = isCurrent && hasViews;
  // Spec §4.2: a current link with no views is the page itself; one with views hands that role to its view.
  const page = isCurrent && !hasViews;
  // An open link's views carry the counts, so its own badge steps aside.
  const badge = open ? null : itemBadge(item, badges);
  return (
    <li>
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
        )}
      >
        <Icon name={item.icon} size={17} className={isCurrent ? "text-accent" : "text-fg-muted"} />
        <span className="min-w-0 truncate">{item.label}</span>
        <Count badge={badge} />
        {hasViews && (
          <Icon
            name="chevron"
            size={10}
            className={cn(
              "text-fg-muted motion-safe:transition-transform motion-safe:duration-200",
              badge ? "ml-1.5" : "ml-auto",
              open && "rotate-90",
            )}
          />
        )}
      </Link>
      {open && (
        <ul className="ml-[19px] mt-0.5 flex flex-col gap-0.5 border-l border-border-strong pl-3 motion-safe:animate-[nav-views-in_180ms_var(--ease-std)]">
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
 * Phase 42 spec §4.2 / §4.5: the workspace's links as lists, one per group (spacing, no headings). Only the
 * current link opens its views, so Tab never passes through hidden ones. Presentational: `current` comes from
 * `currentNav` in NavList.
 */
export function NavTree({
  sections,
  current,
  badges,
  onNavigate,
}: {
  sections: VisibleSection[];
  current: NavCurrent;
  badges: NavBadges;
  /** the mobile drawer closes itself on navigation */
  onNavigate?: () => void;
}) {
  return (
    <nav aria-label="Workspace" className="flex flex-col gap-3 px-2 py-2">
      {sections.map((section) => (
        <ul key={section.heading} className="flex flex-col gap-0.5">
          {section.items.map((item) => (
            <ItemRow key={item.label} item={item} current={current} badges={badges} onNavigate={onNavigate} />
          ))}
        </ul>
      ))}
    </nav>
  );
}
