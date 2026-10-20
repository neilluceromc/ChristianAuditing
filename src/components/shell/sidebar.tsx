import type { AssetClass, User } from "@prisma/client";
import { cn } from "@/lib/cn";
import { hasCris } from "@/lib/cris-settings";
import { Avatar } from "@/components/ui/avatar";
import { WORKSPACE_META, type VisibleSection, type WorkspaceId } from "@/lib/workspaces";
import { AccountMenu } from "./account-menu";
import type { NavBadges } from "@/lib/nav-badges";
import { NavList } from "./nav-list";
import { SidebarCollapseButton, SidebarVariant } from "./sidebar-collapse";
import { WorkspaceTag } from "./workspace-switcher";

/**
 * Phase 42 spec §4.1 / §4.5: a sticky column (`top: 0`, `100dvh`) holding an inset panel — brand row with the
 * workspace tag, the nav (scrolling by itself only when it doesn't fit, with soft edge shadows), and the account
 * row, always visible. The window keeps scrolling; the column stays put.
 *
 * Phase 46 spec §4.1: the panel collapses to a 72 px icon rail. Its width keys off the shell's `data-sidebar`
 * (SidebarShell, set from the `br.sidebar` cookie on the server); the brand row and the nav swap to their rail
 * forms, the account row keeps only the avatar and its menu, and "Collapse sidebar" sits above the account row.
 * The column (sticky, so its own stacking context) keeps Phase 45's z-scale, under the Cris dock (z-30) and the
 * floating bulk bar (z-20), and is raised to z-40 only while a rail item is hovered or holds the focus, i.e. while
 * its flyout shows, so the flyout paints over the page's sticky list chrome (z-30).
 */
/** No unconditional z-index: only the flyout-time raise (see above). */
const ASIDE = cn(
  "sticky top-0 hidden h-dvh shrink-0 self-start p-2 pr-0 lg:flex",
  "has-[[data-rail-item]:focus-within]:z-40 has-[[data-rail-item]:hover]:z-40",
);

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
    <aside aria-label="Primary" className={ASIDE}>
      <div className="flex w-[236px] flex-col rounded-[14px] border border-border bg-surface group-data-[sidebar=rail]/shell:w-[72px]">
        <SidebarVariant
          full={
            <div className="flex items-center gap-2 px-3 pb-2 pt-4">
              <span className="grid size-6 shrink-0 place-items-center rounded-[5px] bg-fg font-mono text-[11px] font-bold text-canvas">
                BR
              </span>
              <span className="shrink-0 text-[13px] font-semibold text-fg">Backroom IT</span>
              <span className="ml-auto flex min-w-0 justify-end">
                <WorkspaceTag current={ws} allowed={allowed} meta={WORKSPACE_META} />
              </span>
            </div>
          }
          rail={
            <div className="flex justify-center pb-2 pt-3">
              <WorkspaceTag current={ws} allowed={allowed} meta={WORKSPACE_META} variant="logo" />
            </div>
          }
        />
        <div className="nav-scroll-shadows min-h-0 flex-1 overflow-y-auto group-data-[sidebar=rail]/shell:[scrollbar-width:none]">
          <NavList workspace={ws} sections={sections} badges={badges} defaultCls={defaultCls} followRail />
        </div>
        <div className="px-2 py-1.5">
          <SidebarCollapseButton />
        </div>
        <div className="flex items-center gap-2.5 border-t border-border-faint px-4 py-3 group-data-[sidebar=rail]/shell:flex-col group-data-[sidebar=rail]/shell:gap-1 group-data-[sidebar=rail]/shell:px-0">
          <Avatar name={user.name} size="lg" />
          <div className="min-w-0 flex-1 group-data-[sidebar=rail]/shell:sr-only">
            <p className="truncate text-xs font-medium text-fg">{user.name}</p>
            <p className="font-mono text-[9.5px] uppercase text-fg-muted">{user.role}</p>
          </div>
          <AccountMenu crisSettings={hasCris(user.role)} />
        </div>
      </div>
    </aside>
  );
}
