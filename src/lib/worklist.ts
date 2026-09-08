/**
 * Phase 15 (spec §5). IT's Home is a worklist: fixed sections in the order the
 * user chose, each row with the one action that clears it. Pure; the queries
 * live in home/queries.ts.
 */
export { DEFAULT_LOAN_DAYS } from "./lifecycle";
/** A loan due within this many days is already on the list. */
export const LOAN_DUE_SOON_DAYS = 7;

export type WorkSectionId = "triage" | "repairs" | "check" | "hires" | "loans" | "missing" | "queue";

export interface WorkSection { id: WorkSectionId; title: string; blurb: string }

export const WORK_SECTIONS: readonly WorkSection[] = [
  { id: "triage", title: "Triage", blurb: "Back from a person, not yet checked — decide before it is a spare again." },
  { id: "repairs", title: "Repairs to chase", blurb: "Defective devices, longest down first." },
  { id: "check", title: "Awaiting IT check", blurb: "Registered by Purchasing; Finance sees them after you." },
  { id: "hires", title: "New hires", blurb: "Started within 30 days with required slots still empty." },
  { id: "loans", title: "Loans", blurb: "Loans overdue, due this week, or with no due date." },
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
  /**
   * Sub-rank within a section, lower first — for a section like "queue" that
   * mixes SLA breaches, execution failures and leavers and wants those kept
   * apart before severity breaks ties within each. Default 0 (all rows rank
   * together, unaffected) when a section has no such grouping.
   */
  rank?: number;
}

export interface WorkGroup { section: WorkSection; rows: WorkRow[]; total: number; capped: boolean }

export interface LoanLike { id: string; tag: string; model: string; loanDueAt: Date | null; holder: string | null }

const DAY_MS = 86_400_000;
const daysBetween = (a: Date, b: Date) => Math.floor((b.getTime() - a.getTime()) / DAY_MS);

/** Spec §4.3: the Loans section's one rule. Null when the loan is not due soon. */
export function loanRow(a: LoanLike, now: Date): WorkRow | null {
  const base = { key: `loans:${a.id}`, section: "loans" as const, href: `/inventory/${a.id}` };
  const holder = a.holder ?? "unassigned";
  if (a.loanDueAt === null) {
    return { ...base, title: `${a.tag} on loan with no due date`, meta: `${holder} · set a due date`, action: "Set date", severity: 1000 };
  }
  const due = a.loanDueAt.toISOString().slice(0, 10);
  const overdue = daysBetween(a.loanDueAt, now);
  if (overdue > 0) return { ...base, title: `${a.tag} overdue by ${overdue} d`, meta: `${holder} · due ${due}`, action: "Review", severity: 500 + overdue };
  const until = -overdue;
  if (until <= LOAN_DUE_SOON_DAYS) return { ...base, title: `${a.tag} due in ${until} d`, meta: `${holder} · due ${due}`, action: "Review", severity: LOAN_DUE_SOON_DAYS - until };
  return null;
}

export function groupWork(
  rows: WorkRow[],
  dismissed: Set<string>,
  opts: { limit?: number },
  saturated: ReadonlySet<WorkSectionId> = new Set(),
): WorkGroup[] {
  const live = rows.filter((r) => !dismissed.has(r.key));
  return WORK_SECTIONS.flatMap((section) => {
    const mine = live
      .filter((r) => r.section === section.id)
      .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0) || b.severity - a.severity);
    if (mine.length === 0) return [];
    return [{
      section,
      rows: opts.limit ? mine.slice(0, opts.limit) : mine,
      total: mine.length,
      capped: saturated.has(section.id),
    }];
  });
}
