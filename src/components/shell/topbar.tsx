import type { AssetClass } from "@prisma/client";
import { DensityToggle } from "@/components/ui/density-toggle";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import type { VisibleSection, WorkspaceId } from "@/lib/workspaces";
import { CommandPaletteTrigger, ScanTagButton } from "./command-palette";
import { KeyboardShortcutsButton } from "./keyboard-shortcuts-dialog";
import { MobileNav, PageName, type ShellUser } from "./mobile-nav";
import type { NavBadges } from "@/lib/nav-badges";

/**
 * Spec §3 — below `lg` the top bar reads, left to right: the menu button, the
 * BR mark and page name, Search, and Scan a tag. From `lg` up the sidebar
 * carries the mark and the nav, and the bar shows the wide search trigger.
 * Density and Keyboard shortcuts are desktop aids and step aside below `sm`
 * so a 375 px bar keeps room for the page name.
 */
export function Topbar({
  sections,
  badges,
  workspaceLabel,
  user,
  ws,
  allowed,
  meta,
  defaultCls,
}: {
  sections: VisibleSection[];
  badges: NavBadges;
  workspaceLabel: string;
  user: ShellUser;
  ws: WorkspaceId;
  allowed: WorkspaceId[];
  meta: Record<WorkspaceId, { label: string; landing: string }>;
  defaultCls: AssetClass;
}) {
  return (
    <header className="flex h-[52px] shrink-0 items-center gap-2 border-b border-border bg-surface px-4 sm:gap-3">
      <MobileNav
        sections={sections}
        badges={badges}
        workspaceLabel={workspaceLabel}
        user={user}
        ws={ws}
        allowed={allowed}
        meta={meta}
        defaultCls={defaultCls}
      />
      <PageName sections={sections} workspaceLabel={workspaceLabel} />
      <CommandPaletteTrigger />
      <ScanTagButton />
      <div className="flex shrink-0 items-center gap-2 lg:ml-auto">
        <span className="hidden sm:contents">
          <DensityToggle />
        </span>
        <ThemeToggle />
        <span className="hidden sm:contents">
          <KeyboardShortcutsButton />
        </span>
      </div>
    </header>
  );
}
