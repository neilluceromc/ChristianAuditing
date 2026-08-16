import type { User } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { Avatar } from "@/components/ui/avatar";
import {
  WORKSPACE_META,
  WORKSPACE_NAV,
  type NavSection,
  type WorkspaceId,
} from "@/lib/workspaces";
import { AccountMenu } from "./account-menu";
import { NavList, type ApprovalsBadge } from "./nav-list";
import { WorkspaceSwitcher } from "./workspace-switcher";

export async function getApprovalsBadge(): Promise<ApprovalsBadge> {
  const [open, overdue] = await Promise.all([
    prisma.approval.count({ where: { state: { in: ["PENDING", "CLAIMED"] } } }),
    prisma.approval.count({
      where: { state: { in: ["PENDING", "CLAIMED"] }, slaAt: { lt: new Date() } },
    }),
  ]);
  return { open, overdue };
}

export function filterSectionsForRole(
  sections: (typeof WORKSPACE_NAV)[WorkspaceId],
  role: User["role"],
): NavSection[] {
  return sections
    .map((s) => ({ ...s, items: s.items.filter((i) => !i.roles || i.roles.includes(role)) }))
    .filter((s) => s.items.length > 0);
}

export function Sidebar({
  user,
  ws,
  sections,
  badge,
  allowed,
}: {
  user: User;
  ws: WorkspaceId;
  sections: NavSection[];
  badge: ApprovalsBadge;
  allowed: WorkspaceId[];
}) {
  return (
    <aside
      aria-label="Primary"
      className="hidden w-[238px] shrink-0 flex-col border-r border-border bg-surface lg:flex"
    >
      <div className="flex items-center gap-2.5 px-4 pb-2 pt-4">
        <span className="grid size-6 place-items-center rounded-[5px] bg-fg font-mono text-[11px] font-bold text-canvas">
          BR
        </span>
        <span className="text-[13px] font-semibold text-fg">Backroom IT</span>
      </div>
      <WorkspaceSwitcher current={ws} allowed={allowed} meta={WORKSPACE_META} />
      <NavList sections={sections} badge={badge} />
      <div className="flex items-center gap-2.5 border-t border-border-faint px-4 py-3">
        <Avatar name={user.name} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium text-fg">{user.name}</p>
          <p className="font-mono text-[9.5px] uppercase text-fg-muted">{user.role}</p>
        </div>
        <AccountMenu />
      </div>
    </aside>
  );
}
