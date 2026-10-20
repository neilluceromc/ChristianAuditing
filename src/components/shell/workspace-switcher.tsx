"use client";

import { Icon } from "@/components/ui/icon";
import { Menu } from "@/components/ui/menu";
import { cn } from "@/lib/cn";
import { workspaceCountLabel } from "@/lib/shell";
import { switchWorkspace } from "@/server/auth/actions";
import type { WorkspaceId } from "@/lib/workspaces";

export type WorkspaceMeta = Record<WorkspaceId, { label: string; landing: string }>;

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

/** The workspace menu: every allowed workspace, ✓ on the current one. */
const menuItems = (current: WorkspaceId, allowed: WorkspaceId[], meta: WorkspaceMeta) =>
  allowed.map((ws) => ({
    label: meta[ws].label + (ws === current ? " ✓" : ""),
    onSelect: () => void switchWorkspace(ws),
  }));

/**
 * Phase 42 spec §4.4: the workspace's name as a small tag at the right end of the sidebar's brand row — a 6 px
 * accent dot and the label. One workspace: plain text, not a control. Several: a button opening the workspace
 * menu (✓ on the current one); its name keeps "{n} workspaces" for `auth-shell.spec`.
 *
 * Phase 46 spec §4.1: in the icon rail there is no room for the tag, so `variant="logo"` makes the BR mark itself
 * the switch (same name, same menu), with the accent dot on its corner; for one workspace it is the plain mark.
 */
export function WorkspaceTag({
  current,
  allowed,
  meta,
  variant = "tag",
}: {
  current: WorkspaceId;
  allowed: WorkspaceId[];
  meta: WorkspaceMeta;
  variant?: "tag" | "logo";
}) {
  const label = meta[current].label;
  if (variant === "logo") return <LogoSwitch current={current} allowed={allowed} meta={meta} />;
  const tag = (
    <>
      <span aria-hidden className="size-[6px] shrink-0 rounded-full bg-accent" />
      <span className="truncate">{label}</span>
    </>
  );
  // Narrow on purpose: "Purchasing" has to fit beside the logo and "Backroom IT" in a 236 px panel.
  const shape = "flex min-w-0 items-center gap-1 rounded-(--radius-ctl) px-1 py-0.5 text-[11px] font-medium";

  if (allowed.length === 1) return <span className={cn(shape, "text-fg-secondary")}>{tag}</span>;

  return (
    <Menu
      align="end"
      trigger={(p) => (
        <button
          {...p}
          type="button"
          aria-label={`Switch workspace — ${label}, ${workspaceCountLabel(allowed.length)}`}
          className={cn(shape, "text-fg-secondary hover:bg-surface-subtle hover:text-fg")}
        >
          {tag}
          <Icon name="chevron" size={9} className="rotate-90 text-fg-muted" />
        </button>
      )}
      items={menuItems(current, allowed, meta)}
    />
  );
}

/** The BR mark, as the sidebar's brand row draws it. */
const MARK = "grid size-6 shrink-0 place-items-center rounded-[5px] bg-fg font-mono text-[11px] font-bold text-canvas";

function LogoSwitch({ current, allowed, meta }: { current: WorkspaceId; allowed: WorkspaceId[]; meta: WorkspaceMeta }) {
  const label = meta[current].label;
  if (allowed.length === 1) return <span className={MARK}>BR</span>;
  return (
    <Menu
      align="start"
      trigger={(p) => (
        <button
          {...p}
          type="button"
          aria-label={`Switch workspace — ${label}, ${workspaceCountLabel(allowed.length)}`}
          title={`${label} workspace`}
          className="relative grid size-9 place-items-center rounded-(--radius-ctl) hover:bg-surface-subtle"
        >
          <span aria-hidden className={MARK}>BR</span>
          <span aria-hidden className="absolute bottom-1 right-1 size-[6px] rounded-full bg-accent ring-2 ring-surface" />
        </button>
      )}
      items={menuItems(current, allowed, meta)}
    />
  );
}

/**
 * Spec §3: the menu drawer's workspace switch — the same choice as the
 * sidebar's workspace tag, shown as a row of options (one tap, no nested menu
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
