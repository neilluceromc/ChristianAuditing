"use client";

import { Menu } from "@/components/ui/menu";
import { switchWorkspace } from "@/server/auth/actions";
import type { WorkspaceId } from "@/lib/workspaces";

export function WorkspaceSwitcher({
  current,
  allowed,
  meta,
}: {
  current: WorkspaceId;
  allowed: WorkspaceId[];
  meta: Record<WorkspaceId, { label: string; landing: string }>;
}) {
  const body = (
    <span className="flex min-w-0 flex-1 items-center gap-2">
      <span aria-hidden className="size-[6px] shrink-0 rounded-full bg-accent" />
      <span className="min-w-0 text-left">
        <span className="block truncate text-[12.5px] font-semibold text-fg">
          {meta[current].label}
        </span>
        <span className="block font-mono text-[9.5px] text-fg-muted">
          br.dept · {allowed.length} available
        </span>
      </span>
    </span>
  );

  if (allowed.length === 1) {
    // Static label, not a disabled control (handover shell spec).
    return <div className="mx-3 mb-2 flex items-center rounded-(--radius-btn) border border-border px-2.5 py-2">{body}</div>;
  }

  return (
    <div className="mx-3 mb-2">
      <Menu
        align="start"
        trigger={(p) => (
          <button
            {...p}
            type="button"
            className="flex w-full items-center gap-2 rounded-(--radius-btn) border border-border px-2.5 py-2 hover:bg-surface-subtle"
          >
            {body}
            <span aria-hidden className="font-mono text-[9px] text-fg-muted">▲▼</span>
          </button>
        )}
        items={allowed.map((ws) => ({
          label: meta[ws].label + (ws === current ? " ✓" : ""),
          onSelect: () => void switchWorkspace(ws),
        }))}
      />
    </div>
  );
}
