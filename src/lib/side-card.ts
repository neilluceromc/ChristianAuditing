/**
 * Pure rules for the profile's tabbed side card (Phase 39 §2.1, §2.3): which tab
 * opens, what the tab badges say, and which status dot an IT-setup value gets.
 * No React, no DOM — the component calls these and the tests pin them.
 */
import { fmtDayMonthYear } from "./format";

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

/** Roving focus on the tab row: ←/→ move to the neighbour (wrapping), Home/End jump to the ends; anything else is null. */
export function tabAfterKey(current: SideTab, key: string): SideTab | null {
  const i = SIDE_TABS.indexOf(current);
  const n = SIDE_TABS.length;
  if (key === "ArrowRight") return SIDE_TABS[(i + 1) % n];
  if (key === "ArrowLeft") return SIDE_TABS[(i - 1 + n) % n];
  if (key === "Home") return SIDE_TABS[0];
  if (key === "End") return SIDE_TABS[n - 1];
  return null;
}

/** The Form tab's muted line under "{k} issued since": the tags, five at most, then "+{n} more". */
export function tagLine(tags: string[], max = 5): string {
  const shown = tags.slice(0, max).join(", ");
  return tags.length > max ? `${shown} +${tags.length - max} more` : shown;
}

/**
 * The Form tab's status line (§2.4): amber "No signed form on file", or green "Signed {d MMM yyyy} · covers {n}
 * items", plus "{k} issued since" when held items are not on the latest signed form.
 */
export function formStatus(
  latest: { signedAt: Date; items: number } | null,
  uncovered: number,
): { dot: "done" | "notyet"; text: string; since: string | null } {
  if (!latest) return { dot: "notyet", text: "No signed form on file", since: null };
  const items = `${latest.items} item${latest.items === 1 ? "" : "s"}`;
  return {
    dot: "done",
    text: `Signed ${fmtDayMonthYear(latest.signedAt)} · covers ${items}`,
    since: uncovered > 0 ? `${uncovered} issued since` : null,
  };
}
