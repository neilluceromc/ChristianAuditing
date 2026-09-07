/**
 * Phase 15 (spec §5). IT's Home is a worklist: fixed sections in the order the
 * user chose, each row with the one action that clears it. Pure; the queries
 * live in home/queries.ts.
 */
export type WorkSectionId = "triage" | "repairs" | "check" | "hires" | "loans" | "missing" | "queue";

export interface WorkSection { id: WorkSectionId; title: string; blurb: string }

/** Temporary devices out longer than this many days are flagged overdue. */
export const LOAN_DAYS = 30;

export const WORK_SECTIONS: readonly WorkSection[] = [
  { id: "triage", title: "Triage", blurb: "Back from a person, not yet checked — decide before it is a spare again." },
  { id: "repairs", title: "Repairs to chase", blurb: "Defective devices, longest down first." },
  { id: "check", title: "Awaiting IT check", blurb: "Registered by Purchasing; Finance sees them after you." },
  { id: "hires", title: "New hires", blurb: "Started within 30 days with required slots still empty." },
  { id: "loans", title: "Loans", blurb: `Temporary devices out longer than ${LOAN_DAYS} days.` },
  { id: "missing", title: "Missing & records", blurb: "Custody lost, or a record that does not add up." },
  { id: "queue", title: "Approvals & leavers", blurb: "What still goes through the queue, and who is leaving." },
];

export interface WorkRow {
  /** stable identity for dismissal: "<section>:<entityId>" */
  key: string;
  section: WorkSectionId;
  title: string;
  meta: string;
  href: string;
  action: string;
  /** higher = worse, compared within a section */
  severity: number;
}

export interface WorkGroup { section: WorkSection; rows: WorkRow[]; total: number }

export function groupWork(rows: WorkRow[], dismissed: Set<string>, opts: { limit?: number }): WorkGroup[] {
  const live = rows.filter((r) => !dismissed.has(r.key));
  return WORK_SECTIONS.flatMap((section) => {
    const mine = live.filter((r) => r.section === section.id).sort((a, b) => b.severity - a.severity);
    if (mine.length === 0) return [];
    return [{ section, rows: opts.limit ? mine.slice(0, opts.limit) : mine, total: mine.length }];
  });
}
