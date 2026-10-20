import type { WorkspaceId } from "./workspaces";

/*
 * Phase 46 spec §4.2, click to open: the current link opens its views by itself; each link's chevron toggle opens or
 * closes its views without navigating. What the toggles opened lasts for the session, per workspace.
 */

/** The sessionStorage key holding one workspace's opened links (their labels, unique within a workspace). */
export const navOpenKey = (ws: WorkspaceId) => `br.nav.open.${ws}`;

export interface NavToggles {
  /** links the toggle opened (kept for the session) */
  opened: string[];
  /** the current link, when its toggle closed it (in memory only: the next current link opens by itself again) */
  closedCurrent: string | null;
}

export const NO_TOGGLES: NavToggles = { opened: [], closedCurrent: null };

/** The stored labels; anything unreadable (another shape, bad JSON, nothing) reads as none. */
export function parseOpened(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

/** Whether a link's views show: the current link unless its toggle closed it, any other link while toggled open. */
export function isOpen(label: string, isCurrent: boolean, t: NavToggles): boolean {
  return isCurrent ? t.closedCurrent !== label : t.opened.includes(label);
}

/**
 * One press of a link's toggle. Closing the current link also forgets it was opened, so it stays closed once another
 * link is current; opening it again just lifts the close.
 */
export function toggleOpen(t: NavToggles, label: string, isCurrent: boolean): NavToggles {
  const without = t.opened.filter((l) => l !== label);
  if (isCurrent) {
    return isOpen(label, true, t) ? { opened: without, closedCurrent: label } : { ...t, closedCurrent: null };
  }
  return { ...t, opened: t.opened.includes(label) ? without : [...t.opened, label] };
}
