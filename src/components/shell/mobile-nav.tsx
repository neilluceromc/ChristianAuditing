"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Role } from "@prisma/client";
import { Avatar } from "@/components/ui/avatar";
import { Drawer } from "@/components/ui/drawer";
import { Icon } from "@/components/ui/icon";
import { ROLE_LABELS } from "@/lib/admin-users";
import { hasCris } from "@/lib/cris-settings";
import { navLabelFor } from "@/lib/shell";
import type { NavSection, WorkspaceId } from "@/lib/workspaces";
import { signOutAction } from "@/server/auth/actions";
import { NavList, type NavBadges } from "./nav-list";
import { WorkspaceOptions } from "./workspace-switcher";

/** Only what the drawer's account block shows — never the whole User row (it carries the password hash). */
export interface ShellUser {
  name: string;
  role: Role;
}

/**
 * Spec §3: below `lg` (the sidebar hidden) the top bar opens this drawer. It
 * carries everything the sidebar does — the workspace switch at the top, the
 * nav, and the account block (initials, name, role, Sign out) at the bottom.
 */
export function MobileNav({
  sections,
  badges,
  workspaceLabel,
  user,
  ws,
  allowed,
  meta,
}: {
  sections: NavSection[];
  badges: NavBadges;
  workspaceLabel: string;
  user: ShellUser;
  ws: WorkspaceId;
  allowed: WorkspaceId[];
  meta: Record<WorkspaceId, { label: string; landing: string }>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="lg:hidden">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open menu"
        className="grid size-[34px] place-items-center rounded-(--radius-btn) text-fg-secondary hover:bg-surface-subtle"
      >
        <Icon name="menu" size={16} />
      </button>
      {open && (
        <Drawer open onClose={() => setOpen(false)} title={workspaceLabel} side="left" width={280}>
          <div className="flex min-h-full flex-col gap-3">
            <WorkspaceOptions current={ws} allowed={allowed} meta={meta} onSwitch={() => setOpen(false)} />
            <NavList sections={sections} badges={badges} onNavigate={() => setOpen(false)} />
            <div className="mt-auto flex flex-col gap-2 border-t border-border-faint pt-3">
              {/* Spec §9: Settings › Cris, for the roles that have Cris — the sidebar's account menu offers the same. */}
              {hasCris(user.role) && (
                <Link
                  href="/settings/cris"
                  onClick={() => setOpen(false)}
                  className="rounded-(--radius-btn) px-2 py-1.5 text-xs text-fg-secondary hover:bg-surface-subtle"
                >
                  Cris settings
                </Link>
              )}
              <div className="flex items-center gap-2.5">
                <Avatar name={user.name} size="lg" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-fg">{user.name}</p>
                  <p className="font-mono text-[9.5px] uppercase text-fg-muted">{ROLE_LABELS[user.role]}</p>
                </div>
                <button
                  type="button"
                  onClick={() => void signOutAction()}
                  className="rounded-(--radius-btn) border border-border-strong bg-surface px-2.5 py-1.5 text-xs text-fg-secondary hover:bg-surface-subtle"
                >
                  Sign out
                </button>
              </div>
            </div>
          </div>
        </Drawer>
      )}
    </div>
  );
}

/** Spec §3: the phone top bar's BR mark and page name (the sidebar carries both from `lg` up). */
export function PageName({ sections, workspaceLabel }: { sections: NavSection[]; workspaceLabel: string }) {
  const pathname = usePathname();
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2 lg:hidden">
      <span
        aria-hidden
        className="grid size-6 shrink-0 place-items-center rounded-[5px] bg-fg font-mono text-[11px] font-bold text-canvas"
      >
        BR
      </span>
      <span className="truncate text-[13px] font-semibold text-fg">
        {navLabelFor(pathname, sections) ?? workspaceLabel}
      </span>
    </div>
  );
}
