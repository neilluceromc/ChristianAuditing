/**
 * Pure rules for the profile's tabbed side card (Phase 39 §2.1, §2.3): which tab
 * opens, what the tab badges say, and which status dot an IT-setup value gets.
 * No React, no DOM — the component calls these and the tests pin them.
 */

export type SideTab = "notes" | "setup" | "form" | "transfers";
export const SIDE_TABS: readonly SideTab[] = ["notes", "setup", "form", "transfers"];
export const SIDE_TAB_KEY = "br.profile-side-tab";

function asTab(v: string | null): SideTab | null {
  return v !== null && (SIDE_TABS as readonly string[]).includes(v) ? (v as SideTab) : null;
}

/** The link parameter wins, then the remembered tab, else Notes. Unknown values are ignored. */
export function pickSideTab(param: string | null, stored: string | null): SideTab {
  return asTab(param) ?? asTab(stored) ?? "notes";
}

/** Reads the remembered tab; a blocked or missing storage is just "nothing remembered". */
export function readStoredTab(storage: Pick<Storage, "getItem"> | null): string | null {
  if (!storage) return null;
  try {
    return storage.getItem(SIDE_TAB_KEY);
  } catch {
    return null;
  }
}

/** Remembers the tab; a blocked or full storage is silently ignored. */
export function writeStoredTab(storage: Pick<Storage, "setItem"> | null, tab: SideTab): void {
  if (!storage) return;
  try {
    storage.setItem(SIDE_TAB_KEY, tab);
  } catch {
    /* private window, blocked site data, quota — the tab simply isn't remembered */
  }
}

export type SideBadge = { text: string; tone: "neutral" | "warning" };

export function sideBadges(i: {
  notes: number;
  notYet: number;
  signed: boolean;
  transfers: number;
}): Record<SideTab, SideBadge | null> {
  return {
    notes: { text: String(i.notes), tone: "neutral" },
    setup: i.notYet > 0 ? { text: `${i.notYet} not yet`, tone: "warning" } : null,
    form: i.signed ? { text: "Signed", tone: "neutral" } : { text: "Not signed", tone: "warning" },
    transfers: { text: String(i.transfers), tone: "neutral" },
  };
}

export type SetupDot = "done" | "notyet" | "off" | "unrecorded";

/** The dot beside an IT-setup row: Entra/Autopilot/Argus values, or the VPN name (or "None"). */
export function setupDot(value: string | null): SetupDot {
  if (value === null) return "unrecorded";
  if (value === "NOT_YET") return "notyet";
  if (value === "NOT_NEEDED" || value === "None") return "off";
  return "done"; // DONE, or any VPN name
}
