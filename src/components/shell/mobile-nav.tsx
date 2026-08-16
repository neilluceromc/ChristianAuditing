"use client";

import { useState } from "react";
import { Drawer } from "@/components/ui/drawer";
import { Icon } from "@/components/ui/icon";
import type { NavSection } from "@/lib/workspaces";
import { NavList, type ApprovalsBadge } from "./nav-list";

export function MobileNav({
  sections,
  badge,
  workspaceLabel,
}: {
  sections: NavSection[];
  badge: ApprovalsBadge;
  workspaceLabel: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="lg:hidden">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open navigation"
        className="grid size-[34px] place-items-center rounded-(--radius-btn) text-fg-secondary hover:bg-surface-subtle"
      >
        <Icon name="filter" size={16} />
      </button>
      {open && (
        <Drawer open onClose={() => setOpen(false)} title={workspaceLabel} side="left" width={280}>
          <NavList sections={sections} badge={badge} onNavigate={() => setOpen(false)} />
        </Drawer>
      )}
    </div>
  );
}
