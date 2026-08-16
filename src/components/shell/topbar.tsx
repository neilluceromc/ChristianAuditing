import Link from "next/link";
import { DensityToggle } from "@/components/ui/density-toggle";
import { Icon } from "@/components/ui/icon";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import type { NavSection } from "@/lib/workspaces";
import { CommandPaletteTrigger } from "./command-palette";
import { MobileNav } from "./mobile-nav";
import type { ApprovalsBadge } from "./nav-list";

export function Topbar({
  sections,
  badge,
  workspaceLabel,
}: {
  sections: NavSection[];
  badge: ApprovalsBadge;
  workspaceLabel: string;
}) {
  return (
    <header className="flex h-[52px] shrink-0 items-center gap-3 border-b border-border bg-surface px-4">
      <MobileNav sections={sections} badge={badge} workspaceLabel={workspaceLabel} />
      <CommandPaletteTrigger />
      <div className="ml-auto flex items-center gap-2">
        <DensityToggle />
        <ThemeToggle />
        <Link
          href="/dev/kitchen-sink"
          aria-label="Help"
          className="grid size-[34px] place-items-center rounded-(--radius-btn) text-fg-secondary hover:bg-surface-subtle"
        >
          <Icon name="alert" size={16} />
        </Link>
      </div>
    </header>
  );
}
