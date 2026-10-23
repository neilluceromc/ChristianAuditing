import type { Role } from "@prisma/client";
import type { CountKey } from "./workspaces";
import type { SentBackTeam } from "./inventory-list";
import { teamOfRole } from "./intake-rules";

/*
 * 2026-10-23 (owner: "A 'Sent back' chip"): the quiet chip that replaced Inventory's red "need correction" banner.
 * It sits in the view-switch row (IT / Purchasing / Repairs) and counts what Finance sent back to the viewer's own
 * team — by the team the asset was returned to, never by class — through the same nav count, and the same view, as
 * the sidebar's "Sent back" link. IT and Purchasing see their own; an admin sees each team's; Finance (who sends
 * them back) and a viewer (who can fix nothing) see none. Client-safe: no Prisma runtime.
 */

/** The nav count (and so the view: NAV_COUNT_HREF) behind each team's chip. */
export const SENT_BACK_COUNT_KEY = {
  IT: "itSentBack",
  PURCHASING: "assetsSentBackPurchasing",
} as const satisfies Record<SentBackTeam, CountKey>;

/** The teams whose chip this role sees: its own team's; an admin, both; anyone else, none. */
export function sentBackChipTeams(role: Role): SentBackTeam[] {
  if (role === "admin") return ["IT", "PURCHASING"];
  const team = teamOfRole(role);
  return team === "IT" || team === "PURCHASING" ? [team] : [];
}

/** One chip: a team with something sent back to it, and its view (the sidebar's "Sent back" link). */
export interface SentBackChip {
  team: SentBackTeam;
  count: number;
  href: string;
}

/** The chip's words. */
export function sentBackChipLabel(n: number): string {
  return `Sent back · ${n}`;
}
