/**
 * Phase 15 (spec §5). IT's Home is a worklist: fixed sections in the order the
 * user chose, each row with the one action that clears it. Pure; the queries
 * live in home/queries.ts.
 */
import { addDays, daysUntil, dueStatus } from "./deadlines";
import { fmtDate, localDateISO } from "./format";
import { offboardingNext, type LeaverState } from "./offboarding";

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
  /** a shared record control that clears the row in place (spec §5.1); absent = the action is a link */
  control?: WorkControl;
  /** what the row menu's Open record / Open profile opens */
  entity?: { kind: "asset" | "employee"; id: string; label: string };
  /** how long the row has waited, in days — Home's "oldest {d} d" (spec §5.4); absent = not an age */
  ageDays?: number;
}

export type WorkControl =
  | { kind: "triage"; asset: { id: string; tag: string; model: string } }
  | { kind: "it-check"; asset: { id: string; tag: string } }
  | { kind: "loan-due"; asset: { id: string; tag: string }; loanDueAt: Date | null }
  | { kind: "assign"; asset: { id: string; tag: string; model: string } };

export interface WorkGroup { section: WorkSection; rows: WorkRow[]; total: number; capped: boolean; hidden: WorkRow[] }

export interface LoanLike { id: string; tag: string; model: string; loanDueAt: Date | null; holder: string | null }

/** Spec §4.3: the Loans section's one rule. Null when the loan is not due soon. */
export function loanRow(a: LoanLike, now: Date): WorkRow | null {
  const base = {
    key: `loans:${a.id}`, section: "loans" as const, href: `/inventory/${a.id}`, action: "Set loan date…",
    control: { kind: "loan-due" as const, asset: { id: a.id, tag: a.tag }, loanDueAt: a.loanDueAt },
    entity: { kind: "asset" as const, id: a.id, label: a.tag },
  };
  const holder = a.holder ?? "unassigned";
  if (a.loanDueAt === null) {
    return { ...base, title: `${a.tag} on loan with no due date`, meta: `${holder} · set a due date`, severity: 1000 };
  }
  const days = daysUntil(a.loanDueAt, localDateISO(now));
  const meta = `${holder} · due ${fmtDate(a.loanDueAt)}`;
  if (days < 0) return { ...base, title: `${a.tag} overdue by ${-days} d`, meta, severity: 500 - days };
  if (days > LOAN_DUE_SOON_DAYS) return null;
  const when = days === 0 ? "due today" : days === 1 ? "due tomorrow" : `due in ${days} d`;
  return { ...base, title: `${a.tag} ${when}`, meta, severity: LOAN_DUE_SOON_DAYS - days };
}

/**
 * The Worklist badge's loan edge (spec §5.3): a loan is on the list exactly
 * when loanRow returns a row — due on or before the Manila day
 * LOAN_DUE_SOON_DAYS from today — i.e. due before Manila midnight starting the
 * day after that. `dayFromISO` is UTC midnight, so the +08:00 is spelled out.
 */
export function loanSoonEdge(now: Date): Date {
  return new Date(`${addDays(localDateISO(now), LOAN_DUE_SOON_DAYS + 1)}T00:00:00+08:00`);
}

export interface LeaverLike extends LeaverState { name: string; employeeNo: string; itemsOut: number }

/** Spec §3: the leaver row's label and href come from offboardingNext. Key stays `queue:<id>` so existing dismissals hold. */
export function leaverRow(e: LeaverLike, todayISO: string): WorkRow {
  const next = offboardingNext(e);
  const base = {
    key: `queue:${e.id}`, section: "queue" as const, rank: 2,
    href: next?.href ?? `/offboarding/${e.id}`, action: next?.label ?? "Open",
    entity: { kind: "employee" as const, id: e.id, label: e.name },
  };
  const kit = e.itemsOut > 0
    ? `${e.employeeNo} · ${e.itemsOut} item${e.itemsOut === 1 ? "" : "s"} still out`
    : `${e.employeeNo} · equipment returned · accounts still to close`;
  if (e.dueAt === null) {
    return { ...base, title: `${e.name} is leaving — no completion date`, meta: `${kit} · set a completion date`, severity: 1000 };
  }
  const due = dueStatus(e.dueAt, todayISO);
  const severity = due.overdue ? 500 - due.days : due.days === 0 ? 2 : due.days === 1 ? 1 : 0;
  return { ...base, title: `${e.name} is leaving`, meta: `${kit} · ${due.text}`, severity };
}

const CONTROL_LABEL: Record<WorkControl["kind"], string> = {
  triage: "Triage…", "it-check": "Mark checked", "loan-due": "Set loan date…", assign: "Assign…",
};

/** Spec §5.1: controls read their verb, links keep theirs, a viewer reads Open everywhere. */
export function workActionLabel(row: WorkRow, canAct: boolean): string {
  if (!canAct) return "Open";
  return row.control ? CONTROL_LABEL[row.control.kind] : row.action;
}

export function groupWork(
  rows: WorkRow[],
  dismissed: Set<string>,
  opts: { limit?: number },
  saturated: ReadonlySet<WorkSectionId> = new Set(),
): WorkGroup[] {
  const order = (a: WorkRow, b: WorkRow) => (a.rank ?? 0) - (b.rank ?? 0) || b.severity - a.severity;
  return WORK_SECTIONS.flatMap((section) => {
    const mine = rows.filter((r) => r.section === section.id);
    const live = mine.filter((r) => !dismissed.has(r.key)).sort(order);
    const hidden = mine.filter((r) => dismissed.has(r.key)).sort(order);
    if (live.length === 0 && hidden.length === 0) return [];
    return [{
      section,
      rows: opts.limit ? live.slice(0, opts.limit) : live,
      total: live.length,
      capped: saturated.has(section.id),
      hidden,
    }];
  });
}

/** Plan P-8: where the rest of a capped section lives. */
export const SEE_ALL_HREF: Record<WorkSectionId, string> = {
  triage: "/inventory?sort=attention", check: "/inventory?sort=attention",
  repairs: "/inventory?status=DEFECTIVE", loans: "/inventory?status=TEMPORARY&sort=attention",
  missing: "/inventory?status=MISSING", hires: "/employees?gaps=1", queue: "/approvals",
};

/** The standalone page's cap line (spec §5.2); null when every row is shown. */
export function capLine(g: WorkGroup): string | null {
  if (!g.capped && g.total <= g.rows.length) return null;
  return `Showing ${g.rows.length} of ${g.total}${g.capped ? "+" : ""} · See all`;
}

/** One chip per section with live rows, in section order (spec §5.2). */
export function summaryChips(groups: WorkGroup[]): { id: WorkSectionId; label: string; href: string }[] {
  return groups
    .filter((g) => g.total > 0)
    .map((g) => ({ id: g.section.id, label: `${g.section.title} ${g.capped ? `${g.total}+` : g.total}`, href: `#${g.section.id}` }));
}

/** Rank-0 queue rows are SLA breaches (worklist()'s own ranking). */
export function pastSlaCount(groups: WorkGroup[]): number {
  return groups.find((g) => g.section.id === "queue")?.rows.filter((r) => (r.rank ?? 0) === 0).length ?? 0;
}

/** Home's Worklist headline (spec §5.4): parts omitted when zero. */
export function workHeadline(groups: WorkGroup[]): string {
  const n = groups.reduce((s, g) => s + g.total, 0);
  if (n === 0) return "";
  const oldest = Math.max(0, ...groups.flatMap((g) => g.rows.map((r) => r.ageDays ?? 0)));
  const late = pastSlaCount(groups);
  return [`${n} waiting`, oldest > 0 ? `oldest ${oldest} d` : null, late > 0 ? `${late} past SLA` : null].filter(Boolean).join(" · ");
}
