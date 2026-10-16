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

export const SETUP_STATE_LABELS = { DONE: "Done", NOT_YET: "Not yet", NOT_NEEDED: "Not needed" } as const;

/** The VPN select's fixed choices; "Other…" (a free-text box) is the UI's own. */
export const VPN_CHOICES = ["None", "Cloudflare WARP", "OpenVPN"] as const;

export const vpnSchema = z.string().trim().min(1, "Name the VPN").max(40, "At most 40 characters");
export const setupStateSchema = z.enum(["DONE", "NOT_YET", "NOT_NEEDED"]);

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
