import { z } from "zod";

/** Phase 37 (spec §4.6): the three connected-or-not rows of the IT setup card, plus the free-text VPN row. */
export const SETUP_FIELDS = ["entra", "autopilot", "argus"] as const;
export type SetupField = (typeof SETUP_FIELDS)[number] | "vpn";

export const SETUP_LABELS: Record<SetupField, string> = {
  entra: "Entra / Intune", autopilot: "Autopilot", argus: "Argus", vpn: "VPN",
};

/** Which Employee column each of the three fields writes. */
export const SETUP_COLUMN: Record<(typeof SETUP_FIELDS)[number], "entraStatus" | "autopilotStatus" | "argusStatus"> = {
  entra: "entraStatus", autopilot: "autopilotStatus", argus: "argusStatus",
};

export const SETUP_STATE_LABELS = { DONE: "Done", NOT_YET: "Not yet", NOT_NEEDED: "Not needed", REMOVED: "Removed" } as const;

/** The VPN select's fixed choices; "Other…" (a free-text box) is the UI's own. */
export const VPN_CHOICES = ["None", "Cloudflare WARP", "OpenVPN"] as const;

/** Phase 40 (spec §7): the VPN value offboarding writes once the VPN is taken away. */
export const VPN_REMOVED = "Removed";
/** The profile's VPN select also offers Removed; Add employee does not (nobody starts with access already removed). */
export const VPN_PROFILE_CHOICES = [...VPN_CHOICES, VPN_REMOVED] as const;

export const vpnSchema = z.string().trim().min(1, "Name the VPN").max(40, "At most 40 characters");
export const setupStateSchema = z.enum(["DONE", "NOT_YET", "NOT_NEEDED", "REMOVED"]);
/** Add employee's three states: a new hire cannot start with access already Removed. */
export const newHireStateSchema = setupStateSchema.exclude(["REMOVED"]);

const NOT_RECORDED = "Not recorded";
const stateLabel = (v: string | null): string => (v === null ? NOT_RECORDED : (SETUP_STATE_LABELS as Record<string, string>)[v] ?? v);

/** "Entra / Intune: Not yet · Autopilot: Done · Argus: Not needed · VPN: Cloudflare WARP"; null reads "Not recorded". */
export function setupSummary(e: {
  entraStatus: string | null; autopilotStatus: string | null; argusStatus: string | null; vpn: string | null;
}): string {
  return [
    `${SETUP_LABELS.entra}: ${stateLabel(e.entraStatus)}`,
    `${SETUP_LABELS.autopilot}: ${stateLabel(e.autopilotStatus)}`,
    `${SETUP_LABELS.argus}: ${stateLabel(e.argusStatus)}`,
    `${SETUP_LABELS.vpn}: ${e.vpn ?? NOT_RECORDED}`,
  ].join(" · ");
}

/** The header chip's number: rows marked NOT_YET (null is "not recorded", not "not yet"). */
export function notYetCount(e: { entraStatus: string | null; autopilotStatus: string | null; argusStatus: string | null }): number {
  return [e.entraStatus, e.autopilotStatus, e.argusStatus].filter((v) => v === "NOT_YET").length;
}

/** A person's four IT-setup values as stored; null is "Not recorded". */
export interface SetupRecord {
  entraStatus: string | null; autopilotStatus: string | null; argusStatus: string | null; vpn: string | null;
}

const VPN_NOT_A_NAME = new Set(["", "none", "removed"]);

/**
 * Phase 40 (spec §7, ruling 2): which rows of a person's IT access are live, in the card's order. Entra / Intune,
 * Autopilot and Argus are live only when Done; the VPN when it names a VPN (not none, "None" or "Removed").
 * Not recorded, Not yet, Not needed and Removed are not live, so a person from before Phase 37 never blocks.
 */
export function liveAccessFields(e: SetupRecord): SetupField[] {
  const live: SetupField[] = [];
  if (e.entraStatus === "DONE") live.push("entra");
  if (e.autopilotStatus === "DONE") live.push("autopilot");
  if (e.argusStatus === "DONE") live.push("argus");
  if (e.vpn !== null && !VPN_NOT_A_NAME.has(e.vpn.trim().toLowerCase())) live.push("vpn");
  return live;
}

/** True while any IT access is live — offboarding cannot complete until it is removed. */
export function itAccessLive(e: SetupRecord): boolean {
  return liveAccessFields(e).length > 0;
}
