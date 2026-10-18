import type { AssetClass, User } from "@prisma/client";
import { hasCris } from "@/lib/cris-settings";
import { Avatar } from "@/components/ui/avatar";
import { WORKSPACE_META, type VisibleSection, type WorkspaceId } from "@/lib/workspaces";
import { AccountMenu } from "./account-menu";
import type { NavBadges } from "@/lib/nav-badges";
import { NavList } from "./nav-list";
import { WorkspaceTag } from "./workspace-switcher";

/**
 * Phase 42 spec §4.1 / §4.5: a sticky column (`top: 0`, `100dvh`) holding an inset panel — brand row with the
 * workspace tag, the nav (scrolling by itself only when it doesn't fit, with soft edge shadows), and the account
 * row, always visible. The window keeps scrolling; the column stays put.
 */
export function Sidebar({
  user,
  ws,
  sections,
  badges,
  allowed,
  defaultCls,
}: {
  user: User;
  ws: WorkspaceId;
  sections: VisibleSection[];
  badges: NavBadges;
  allowed: WorkspaceId[];
  defaultCls: AssetClass;
}) {
  return (
    <aside aria-label="Primary" className="sticky top-0 hidden h-dvh shrink-0 self-start p-2 pr-0 lg:flex">
      <div className="flex w-[236px] flex-col rounded-[14px] border border-border bg-surface">
        <div className="flex items-center gap-2 px-3 pb-2 pt-4">
          <span className="grid size-6 shrink-0 place-items-center rounded-[5px] bg-fg font-mono text-[11px] font-bold text-canvas">
            BR
          </span>
          <span className="shrink-0 text-[13px] font-semibold text-fg">Backroom IT</span>
          <span className="ml-auto flex min-w-0 justify-end">
            <WorkspaceTag current={ws} allowed={allowed} meta={WORKSPACE_META} />
          </span>
        </div>
        <div className="nav-scroll-shadows min-h-0 flex-1 overflow-y-auto">
          <NavList sections={sections} badges={badges} defaultCls={defaultCls} />
        </div>
        <div className="flex items-center gap-2.5 border-t border-border-faint px-4 py-3">
          <Avatar name={user.name} size="lg" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium text-fg">{user.name}</p>
            <p className="font-mono text-[9.5px] uppercase text-fg-muted">{user.role}</p>
          </div>
          <AccountMenu crisSettings={hasCris(user.role)} />
        </div>
      </div>
    </aside>
  );
}
