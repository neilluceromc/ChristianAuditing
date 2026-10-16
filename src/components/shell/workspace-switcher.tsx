"use client";

import { Menu } from "@/components/ui/menu";
import { cn } from "@/lib/cn";
import { workspaceCountLabel } from "@/lib/shell";
import { switchWorkspace } from "@/server/auth/actions";
import type { WorkspaceId } from "@/lib/workspaces";

type WorkspaceMeta = Record<WorkspaceId, { label: string; landing: string }>;

function CurrentWorkspace({ label, count }: { label: string; count: number }) {
  return (
    <span className="flex min-w-0 flex-1 items-center gap-2">
      <span aria-hidden className="size-[6px] shrink-0 rounded-full bg-accent" />
      <span className="min-w-0 text-left">
        <span className="block truncate text-[12.5px] font-semibold text-fg">{label}</span>
        {/* Spec §3: "{n} workspaces" — never the cookie name. */}
        <span className="block font-mono text-[9.5px] text-fg-muted">{workspaceCountLabel(count)}</span>
      </span>
    </span>
  );
}

export function WorkspaceSwitcher({
  current,
  allowed,
  meta,
}: {
  current: WorkspaceId;
  allowed: WorkspaceId[];
  meta: WorkspaceMeta;
}) {
  const body = <CurrentWorkspace label={meta[current].label} count={allowed.length} />;

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

/**
 * Spec §3: the menu drawer's workspace switch — the same choice as the
 * sidebar's switcher, shown as a row of options (one tap, no nested menu
 * inside the drawer). A single-workspace role gets the static label.
 * `onSwitch` runs before the switch so the drawer can close itself (its focus
 * trap hands focus back to the menu button, never to body).
 */
export function WorkspaceOptions({
  current,
  allowed,
  meta,
  onSwitch,
}: {
  current: WorkspaceId;
  allowed: WorkspaceId[];
  meta: WorkspaceMeta;
  onSwitch?: () => void;
}) {
  if (allowed.length === 1) {
    return (
      <div className="flex items-center rounded-(--radius-btn) border border-border px-2.5 py-2">
        <CurrentWorkspace label={meta[current].label} count={1} />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1.5">
      <p className="font-mono text-[9.5px] font-medium uppercase tracking-[0.08em] text-fg-muted">
        {workspaceCountLabel(allowed.length)}
      </p>
      <div
        role="group"
        aria-label="Switch workspace"
        className="flex flex-wrap gap-0.5 rounded-(--radius-btn) border border-border-strong bg-surface-subtle p-0.5"
      >
        {allowed.map((ws) => (
          <button
            key={ws}
            type="button"
            aria-pressed={ws === current}
            onClick={() => {
              if (ws === current) return;
              onSwitch?.();
              void switchWorkspace(ws);
            }}
            className={cn(
              "flex-1 rounded-[5px] px-2.5 py-1.5 text-xs font-medium transition-colors duration-(--dur-1)",
              ws === current ? "bg-surface text-fg shadow-card" : "text-fg-muted hover:text-fg-secondary",
            )}
          >
            {meta[ws].label}
          </button>
        ))}
      </div>
    </div>
  );
}
