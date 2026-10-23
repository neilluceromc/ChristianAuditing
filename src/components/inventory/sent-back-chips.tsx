import type { SentBackTeam } from "@/lib/inventory-list";
import { TEAM_LABEL } from "@/lib/notifications";
import { sentBackChipLabel, type SentBackChip } from "@/lib/sent-back-chip";
import { PillLink } from "./pill-link";

/**
 * 2026-10-23 (owner: "A 'Sent back' chip"): what Finance sent back to the viewer's team, as a quiet chip in the
 * view-switch row — the row's neutral pill and the small attention dot, nothing red. It links to the team's Sent back
 * view (the sidebar's own link); while that view is open it shows selected and a click clears it. An admin sees one
 * per team, each naming its team. No chips (nothing sent back, or Finance and viewers): nothing at all.
 */
export function SentBackChips({
  chips,
  active,
  clearHref,
  showTeam,
}: {
  chips: readonly SentBackChip[];
  /** the team whose Sent back view is open, or null */
  active: SentBackTeam | null;
  /** where a click on the open view's chip goes: the plain list */
  clearHref: string;
  /** an admin's chips name their team */
  showTeam: boolean;
}) {
  if (chips.length === 0) return null;
  return (
    <div className="flex items-center gap-1.5" role="navigation" aria-label="Sent back">
      {chips.map((c) => {
        const on = c.team === active;
        return (
          <PillLink key={c.team} href={on ? clearHref : c.href} on={on}>
            <span aria-hidden className="size-1.5 shrink-0 rounded-full" style={{ background: "var(--st-attention-dot)" }} />
            <span>{sentBackChipLabel(c.count)}</span>
            {showTeam && <span className="text-fg-muted">· {TEAM_LABEL[c.team]}</span>}
          </PillLink>
        );
      })}
    </div>
  );
}
