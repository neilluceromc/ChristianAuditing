import { parseDensity, type Density } from "./density";
import { SIDEBAR_COOKIE, type SidebarState } from "./sidebar-state";
import type { WorkspaceId } from "./workspaces";

/**
 * Phase 47 spec §5.4: settings follow the person, not the browser. The person's theme, density, sidebar, Home focus
 * and workspace live in UserPreference `ui:prefs`; the cookies the layouts read (`br.theme`, `br.density`,
 * `br.sidebar`, `br.focus`, `br.dept`) are only this browser's copy for the next paint, and `br.uid` records whose
 * copy it is. When someone else signs in here, their first page rewrites all six (UiPrefsSync → restoreUiPrefs).
 */
export const UI_PREFS_KEY = "ui:prefs";

/** The browser's record of whose settings its cookies hold. */
export const UI_UID_COOKIE = "br.uid";

export type UiPrefs = {
  theme: "light" | "dark";
  density: Density;
  sidebar: SidebarState;
  focus: boolean;
  /** null: the role's first workspace (no `br.dept`) */
  workspace: WorkspaceId | null;
};

export const UI_PREFS_DEFAULTS: UiPrefs = {
  theme: "light",
  density: "comfortable",
  sidebar: "full",
  focus: false,
  workspace: null,
};

// Kept here rather than read from workspaces.ts' tables, so the client toggles' bundle never pulls the nav in.
const WORKSPACES: readonly WorkspaceId[] = ["it", "purchasing", "finance", "admin"];

/** The fields of `v` that are valid, and only those: a toggle's patch, or a stored value read field by field. */
export function cleanUiPatch(v: unknown): Partial<UiPrefs> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return {};
  const o = v as Record<string, unknown>;
  const out: Partial<UiPrefs> = {};
  if (o.theme === "light" || o.theme === "dark") out.theme = o.theme;
  if (typeof o.density === "string" && parseDensity(o.density) === o.density) out.density = o.density;
  if (o.sidebar === "rail" || o.sidebar === "full") out.sidebar = o.sidebar;
  if (typeof o.focus === "boolean") out.focus = o.focus;
  if (typeof o.workspace === "string" && (WORKSPACES as readonly string[]).includes(o.workspace)) {
    out.workspace = o.workspace as WorkspaceId;
  }
  return out;
}

/** A stored `ui:prefs` value; each missing or bad field falls back to its default on its own. */
export function parseUiPrefs(v: unknown): UiPrefs {
  return { ...UI_PREFS_DEFAULTS, ...cleanUiPatch(v) };
}

/**
 * The six cookies for this person's prefs, in the shapes the layouts read: `br.focus` is on/off, and an empty
 * `br.dept` (no saved workspace) means the role's first one.
 */
export function uiPrefCookies(p: UiPrefs, userId: string): Array<{ name: string; value: string }> {
  return [
    { name: "br.theme", value: p.theme },
    { name: "br.density", value: p.density },
    { name: SIDEBAR_COOKIE, value: p.sidebar },
    { name: "br.focus", value: p.focus ? "on" : "off" },
    { name: "br.dept", value: p.workspace ?? "" },
    { name: UI_UID_COOKIE, value: userId },
  ];
}

/** The cookies' options: one year, site-wide, lax, and readable by the client toggles that also write them. */
export const UI_PREF_COOKIE_OPTIONS = { path: "/", maxAge: 31536000, sameSite: "lax", httpOnly: false } as const;

/** True when this browser's settings cookies are not the signed-in person's (nobody's yet, or someone else's). */
export function needsUiRestore(userId: string, cookieUid: string | undefined): boolean {
  return cookieUid !== userId;
}
