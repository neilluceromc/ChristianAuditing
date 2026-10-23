/**
 * Phase 15 (spec §5). IT's Home is a worklist: fixed sections in the order the
 * user chose, each row with the one action that clears it. Pure; the queries
 * live in home/queries.ts.
 */
import type { ApprovalType, AssetClass, Priority } from "@prisma/client";
import { auditSentence } from "./activity";
import { summarizeApproval } from "./approval-execution";
import { slaLabel } from "./approvals-list";
import { addDays, daysUntil, dueStatus } from "./deadlines";
import { fmtDate, fmtDayMonth, fmtMoney, localDateISO } from "./format";
import { PRIORITY_LABEL } from "./labels";
import { offboardingNext, type LeaverState } from "./offboarding";
import { since as waitingSince } from "./purchases-list";
import { REPAIR_STAGE_LABEL, beyondRepair, downDays as repairDownDays, repairStage, type RepairStage } from "./repairs";

export { DEFAULT_LOAN_DAYS } from "./lifecycle";
/** A loan due within this many days is already on the list. */
export const LOAN_DUE_SOON_DAYS = 7;

export type WorkSectionId = "triage" | "repairs" | "check" | "purchases" | "hires" | "loans" | "missing" | "queue";

export interface WorkSection {
  id: WorkSectionId;
  title: string;
  blurb: string;
  /** the list the whole group opens (Phase 40 §6: Purchase reviews); absent = the heading is not a link */
  href?: string;
}

export const WORK_SECTIONS: readonly WorkSection[] = [
  { id: "triage", title: "Triage", blurb: "Back from a person, not yet checked — decide before it is a spare again." },
  { id: "repairs", title: "Repairs to chase", blurb: "Defective devices, longest down first." },
  { id: "check", title: "Awaiting IT check", blurb: "Registered by Purchasing; Finance sees them after you." },
  {
    id: "purchases", title: "Purchase reviews", blurb: "Purchase orders waiting for IT's check, newest first.",
    href: "/purchases?state=WITH_IT",
  },
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
  /** past its due date (a loan or a leaver) — the Overview's bad tone; severity can't say so past 500 days late */
  overdue?: true;
  /** how long the row has waited, in days — Home's "oldest {d} d" (spec §5.4); absent = not an age */
  ageDays?: number;
}

export type WorkControl =
  | { kind: "triage"; asset: { id: string; tag: string; model: string } }
  | { kind: "it-check"; asset: { id: string; tag: string } }
  | { kind: "loan-due"; asset: { id: string; tag: string }; loanDueAt: Date | null }
  | { kind: "assign"; asset: { id: string; tag: string; model: string } };

/** `R` is WorkItem on the Worklist page (worklist()'s rows); Home reads the same groups as plain WorkRows. */
export interface WorkGroup<R extends WorkRow = WorkRow> {
  section: WorkSection;
  rows: R[];
  total: number;
  capped: boolean;
  hidden: R[];
  /** live SLA breaches (rank-0 queue rows) counted BEFORE Home's per-section limit; 0 for other sections */
  pastSla: number;
  /** final review I2: the oldest live row's age in days, taken BEFORE Home's per-section limit; 0 when none has an age */
  oldestDays: number;
}

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
  if (days < 0) return { ...base, title: `${a.tag} overdue by ${-days} d`, meta, severity: 500 - days, overdue: true };
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

export interface PurchaseReviewLike {
  id: string;
  refNo: string;
  /** when it reached IT; null on a request never stamped, which then counts from updatedAt (the /purchases list's rule) */
  submittedAt: Date | null;
  updatedAt: Date;
  requestedBy: string;
  department: string | null;
  /** the first line's description; null when the request has no lines */
  firstLine: string | null;
  lines: number;
}

/**
 * Phase 40 §6: a SUBMITTED request waiting for IT's review. Newest first, so
 * severity is the negative age in ms (groupWork sorts severity descending).
 * The age reads exactly as /purchases' dwell line does: `since()`'s whole days, "today" under one.
 */
export function purchaseReviewRow(r: PurchaseReviewLike, now: Date): WorkRow {
  const from = r.submittedAt ?? r.updatedAt;
  const ageMs = Math.max(0, now.getTime() - from.getTime());
  const days = Math.floor(ageMs / 86_400_000);
  const what = r.firstLine ? ` · ${r.firstLine}${r.lines > 1 ? ` +${r.lines - 1} more` : ""}` : "";
  return {
    key: `purchases:${r.id}`,
    section: "purchases",
    title: `${r.refNo}${what}`,
    meta: `${r.department ?? "No department"} · from ${r.requestedBy} · waiting ${waitingSince(r.submittedAt, r.updatedAt, now)}`,
    href: `/purchases/${r.id}`,
    action: "Review",
    severity: -ageMs,
    ageDays: days,
  };
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
  return { ...base, title: `${e.name} is leaving`, meta: `${kit} · ${due.text}`, severity, ...(due.overdue ? { overdue: true as const } : {}) };
}

const CONTROL_LABEL: Record<WorkControl["kind"], string> = {
  triage: "Triage…", "it-check": "Mark checked", "loan-due": "Set loan date…", assign: "Assign…",
};

/** Spec §5.1: controls read their verb, links keep theirs, a viewer reads Open everywhere. */
export function workActionLabel(row: WorkRow, canAct: boolean): string {
  if (!canAct) return "Open";
  return row.control ? CONTROL_LABEL[row.control.kind] : row.action;
}

/**
 * A viewer's Open goes where a viewer may go: a leaver row's next step can be
 * /employees/{id}/edit (no completion date), which viewers are refused, so a
 * viewer's leaver row opens the leaver's wizard page instead.
 */
export function workRowHref(row: WorkRow, canAct: boolean): string {
  if (!canAct && row.section === "queue" && row.entity?.kind === "employee") return `/offboarding/${row.entity.id}`;
  return row.href;
}

export function groupWork<R extends WorkRow>(
  rows: R[],
  dismissed: Set<string>,
  opts: { limit?: number },
  saturated: ReadonlySet<WorkSectionId> = new Set(),
): WorkGroup<R>[] {
  const order = (a: WorkRow, b: WorkRow) => (a.rank ?? 0) - (b.rank ?? 0) || b.severity - a.severity;
  return WORK_SECTIONS.flatMap((section): WorkGroup<R>[] => {
    const mine = rows.filter((r) => r.section === section.id);
    const live = mine.filter((r) => !dismissed.has(r.key)).sort(order);
    const hidden = mine.filter((r) => dismissed.has(r.key)).sort(order);
    if (live.length === 0 && hidden.length === 0) return [];
    return [{
      section,
      rows: opts.limit ? live.slice(0, opts.limit) : live,
      total: live.length,
      pastSla: section.id === "queue" ? live.filter((r) => (r.rank ?? 0) === 0).length : 0,
      oldestDays: Math.max(0, ...live.map((r) => r.ageDays ?? 0)),
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
  purchases: "/purchases?state=WITH_IT",
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

/** Rank-0 queue rows are SLA breaches (worklist()'s own ranking), counted before any row limit. */
export function pastSlaCount(groups: WorkGroup[]): number {
  return groups.reduce((s, g) => s + g.pastSla, 0);
}

// ── Worklist split view (H4, plan calls 2, 3 and 13): every row carries its table columns and a details panel ──
//
// Each builder below returns the SAME WorkRow the worklist always built (Home reads it unchanged), plus `columns`
// (that section's table cells, typed per section) and `detail` (the panel's facts, an optional note, and a short
// history). Facts use real fields only; a key field with no value says "Not recorded" rather than vanishing.

export type WorkGroupKind = "INTERNAL" | "CLIENT";
/** A department (INTERNAL) or a client (CLIENT): the offshoring firm's two kinds of staff. */
export interface WorkGroupRef { name: string; kind: WorkGroupKind }
export interface WorkParty { name: string; group: WorkGroupRef | null }
/** An asset's Item cell: model on top; category · tag under it. */
export interface WorkItemCell { model: string; category: string | null; tag: string }
/** `good` = still in force (a running warranty); `muted` = absent or over; `fault` = only an overdue loan or a breached SLA. */
export interface WorkFact { label: string; value: string; tone?: "good" | "muted" | "fault"; mono?: true }
/**
 * The note typed when an item came back (a return's reason, label "Note when returned") or a request's note;
 * `by` = who RECORDED it (the IT user), never the holder — the panel reads "recorded by {by}". Absent when blank
 * or when the text is one of the app's own default reasons (SYSTEM_REASONS).
 */
export interface WorkNote { label: string; text: string; by: string | null }

/** The ruling's label for a return's reason; the UI follows it with "recorded by {name}", never "{holder} said". */
export const RETURN_NOTE_LABEL = "Note when returned";
export interface WorkHistoryEntry { at: Date; text: string }
export interface WorkDetail { facts: WorkFact[]; note?: WorkNote; history: WorkHistoryEntry[] }
export interface WorkSla { text: string; overdue: boolean }

/** Plan call 2: each queue's table columns. Days are whole days; dates are the raw Date (the UI formats). */
export interface WorkColumnsBySection {
  /** `cost` is not a column: it feeds the summary's "Value at cost". */
  triage: { item: WorkItemCell; lastHolder: WorkParty | null; returnedAt: Date; waitingDays: number; cost: number | null };
  /** `vendor` null reads "Not sent". */
  repairs: { item: WorkItemCell; vendor: string | null; stage: RepairStage; downDays: number };
  check: { item: WorkItemCell; registeredBy: string | null; fromPo: { id: string; refNo: string } | null; waitingDays: number };
  /** `summary` = the first line and "+N more"; `total` in pesos (Σ qty × unit price, the /purchases list's value). */
  purchases: { po: { refNo: string; summary: string | null }; vendor: string | null; siNumber: string | null; total: number; waitingDays: number };
  hires: { person: { name: string; employeeNo: string }; group: WorkGroupRef | null; startedAt: Date; missingSlots: number };
  /** `dueDays` < 0 is late (the row is red); `status` is "8 days late", "due Fri", "no due date". */
  loans: { item: WorkItemCell; borrower: WorkParty | null; dueAt: Date | null; dueDays: number | null; status: string; late: boolean };
  missing: { item: WorkItemCell; problem: string; lastHolder: WorkParty | null; since: Date; sinceDays: number };
  /** `sla.overdue` = breached (the row is red). */
  queue: { what: string; who: string; waitingDays: number; sla: WorkSla | null };
}
export type WorkColumns = { [S in WorkSectionId]: { section: S } & WorkColumnsBySection[S] }[WorkSectionId];
/** One section's columns, narrowed: `ColumnsOf<"triage">`. */
export type ColumnsOf<S extends WorkSectionId> = Extract<WorkColumns, { section: S }>;

/** A worklist row with its table cells and its details panel. Every WorkRow field is kept, so Home is unaffected. */
export interface WorkItem extends WorkRow { columns: WorkColumns; detail: WorkDetail }

/** The asset fields every asset section's facts read. `history` = the asset's last 3 lifecycle events, newest first. */
export interface WorkAssetLike {
  id: string;
  tag: string;
  model: string;
  serial: string | null;
  category: string | null;
  purchasedAt: Date | null;
  cost: number | null;
  warrantyUntil: Date | null;
  history: WorkHistoryEntry[];
}

/** The latest executed `lifecycle_return` approval on an asset: who handed it back, and the reason typed then. */
export interface WorkReturnLike { holder: WorkParty | null; reason: string | null; recordedBy: string | null; at: Date }

const DAY = 86_400_000;
const NOT_RECORDED = "Not recorded";
/** queries.ts's own rounding, so the new cells agree with the meta lines Home already shows. */
const daysSince = (d: Date, now: Date) => Math.max(0, Math.round((now.getTime() - d.getTime()) / DAY));
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export const daysAgoText = (n: number): string => (n <= 0 ? "today" : `${plural(n, "day")} ago`);
export const groupText = (g: WorkGroupRef): string => (g.kind === "CLIENT" ? `Client: ${g.name}` : g.name);
export const partyText = (p: WorkParty): string => (p.group ? `${p.name} · ${groupText(p.group)}` : p.name);

function fact(label: string, value: string | null, opts: { mono?: boolean; tone?: WorkFact["tone"] } = {}): WorkFact {
  if (value === null) return { label, value: NOT_RECORDED, tone: "muted" };
  return { label, value, ...(opts.tone ? { tone: opts.tone } : {}), ...(opts.mono ? { mono: true as const } : {}) };
}

/** Plan call 3: "until …" while the warranty runs (through its last Manila day), "ended …" after. */
export function warrantyFact(until: Date | null, now: Date): WorkFact {
  if (!until) return fact("Warranty", null);
  return localDateISO(until) >= localDateISO(now)
    ? { label: "Warranty", value: `until ${fmtDate(until)}`, tone: "good" }
    : { label: "Warranty", value: `ended ${fmtDate(until)}`, tone: "muted" };
}

function boughtFact(a: Pick<WorkAssetLike, "purchasedAt" | "cost">): WorkFact {
  const parts = [a.purchasedAt ? fmtDate(a.purchasedAt) : null, a.cost === null ? null : fmtMoney(a.cost)].filter((p) => p !== null);
  return fact("Bought", parts.length ? parts.join(" · ") : null);
}

const itemCell = (a: Pick<WorkAssetLike, "model" | "category" | "tag">): WorkItemCell => ({ model: a.model, category: a.category, tag: a.tag });

/** The detail, with `note` present only when its text is not blank. */
function detailOf(facts: WorkFact[], history: WorkHistoryEntry[], note?: { label: string; text: string | null | undefined; by: string | null }): WorkDetail {
  const text = note?.text?.trim();
  return note && text ? { facts, note: { label: note.label, text, by: note.by }, history } : { facts, history };
}

const assetEntity = (a: { id: string; tag: string }) => ({ kind: "asset" as const, id: a.id, label: a.tag });

/**
 * The reasons the app writes itself when nobody typed one (lifecycle/direct.ts, lifecycle/actions.ts,
 * offboarding/actions.ts, employees/actions.ts, cris/pending-core.ts). They are not notes, so they never show as one.
 */
const SYSTEM_REASONS: readonly RegExp[] = [
  /^offboarding · returned$/, /^assigned$/, /^bulk assigned$/, /^triage$/, /^reserved — day-one setup$/,
  /^replaced by \S+$/, /^replaces \S+$/,
];

/** A typed reason, or null when blank or one of SYSTEM_REASONS. */
export function noteText(reason: unknown): string | null {
  if (typeof reason !== "string") return null;
  const t = reason.trim();
  return t && !SYSTEM_REASONS.some((re) => re.test(t)) ? t : null;
}

const reasonOf = (payload: unknown): string | null =>
  noteText(payload && typeof payload === "object" ? (payload as { reason?: unknown }).reason : undefined);

export interface WorkReturnRow {
  assetId: string | null;
  createdAt: Date;
  payload: unknown;
  requestedBy: { name: string } | null;
  employee: { name: string; department: { name: string; kind: WorkGroupKind } | null } | null;
}

/** The latest return per asset from one batched read (any order in; the newest createdAt wins). */
export function lastReturnByAsset(rows: WorkReturnRow[]): Map<string, WorkReturnLike> {
  const out = new Map<string, WorkReturnLike>();
  for (const r of rows) {
    if (!r.assetId) continue;
    const seen = out.get(r.assetId);
    if (seen && seen.at.getTime() >= r.createdAt.getTime()) continue;
    out.set(r.assetId, {
      holder: r.employee
        ? { name: r.employee.name, group: r.employee.department ? { name: r.employee.department.name, kind: r.employee.department.kind } : null }
        : null,
      reason: reasonOf(r.payload),
      recordedBy: r.requestedBy?.name ?? null,
      at: r.createdAt,
    });
  }
  return out;
}

export interface WorkAuditRow { entityId: string; action: string; diff: unknown; actorLabel: string; createdAt: Date }

/**
 * The last `per` lifecycle events per asset, newest first, from one batched audit read — each the same sentence
 * every activity feed builds (`auditSentence`), without the tag the panel already shows.
 */
export function historyByAsset(rows: WorkAuditRow[], tags: ReadonlyMap<string, string>, per = 3): Map<string, WorkHistoryEntry[]> {
  const grouped = new Map<string, WorkAuditRow[]>();
  for (const r of rows) grouped.set(r.entityId, [...(grouped.get(r.entityId) ?? []), r]);
  const out = new Map<string, WorkHistoryEntry[]>();
  for (const [id, list] of grouped) {
    // newest first; equal timestamps keep the read's order (the SQL's createdAt DESC, id DESC) — sort is stable
    out.set(id, list
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, per)
      .map((r) => ({
        at: r.createdAt,
        text: auditSentence({ actorLabel: r.actorLabel, action: r.action, diff: r.diff, entityLabel: tags.get(id) ?? "" }, { omitEntity: true }),
      })));
  }
  return out;
}

// ── the per-section builders ──

export function triageItem(a: WorkAssetLike & { returnedAt: Date; lastReturn: WorkReturnLike | null }, now: Date): WorkItem {
  const n = daysSince(a.returnedAt, now);
  const holder = a.lastReturn?.holder ?? null;
  return {
    key: `triage:${a.id}`,
    section: "triage",
    title: `${a.tag} · ${a.model}`,
    meta: `back ${n} d · triage it`,
    href: `/inventory/${a.id}`,
    action: "Triage",
    severity: n,
    ageDays: n,
    control: { kind: "triage", asset: { id: a.id, tag: a.tag, model: a.model } },
    entity: assetEntity(a),
    columns: { section: "triage", item: itemCell(a), lastHolder: holder, returnedAt: a.returnedAt, waitingDays: n, cost: a.cost },
    detail: detailOf([
      fact("Serial", a.serial, { mono: true }),
      fact("Last holder", holder ? partyText(holder) : null),
      fact("Returned", `${fmtDate(a.returnedAt)} · ${daysAgoText(n)}`),
      boughtFact(a),
      warrantyFact(a.warrantyUntil, now),
    ], a.history, { label: RETURN_NOTE_LABEL, text: a.lastReturn?.reason, by: a.lastReturn?.recordedBy ?? null }),
  };
}

export interface WorkRepairLike extends WorkAssetLike {
  status: string;
  vendorId: string | null;
  vendor: string | null;
  rmaRef: string | null;
  repairQuote: number | null;
  defectiveSince: Date | null;
  repairEndedAt: Date | null;
}

export function repairItem(a: WorkRepairLike, now: Date): WorkItem {
  const stage = repairStage({
    status: a.status, vendorId: a.vendorId, rmaRef: a.rmaRef,
    repairQuote: a.repairQuote, cost: a.cost, defectiveSince: a.defectiveSince, repairEndedAt: a.repairEndedAt,
  }) ?? "to-assess";
  const down = repairDownDays({ status: a.status, defectiveSince: a.defectiveSince, repairEndedAt: a.repairEndedAt }, now) ?? 0;
  const beyond = beyondRepair(a.repairQuote, a.cost);
  const facts: WorkFact[] = [
    fact("Serial", a.serial, { mono: true }),
    a.vendor ? fact("Vendor", a.vendor) : { label: "Vendor", value: "Not sent", tone: "muted" },
  ];
  if (a.rmaRef) facts.push(fact("RMA", a.rmaRef, { mono: true }));
  if (a.repairQuote !== null) facts.push(fact("Quote", `${fmtMoney(a.repairQuote)}${beyond ? " · beyond repair" : ""}`));
  if (a.defectiveSince) facts.push(fact("Down since", `${fmtDate(a.defectiveSince)} · ${plural(down, "day")}`));
  facts.push(boughtFact(a), warrantyFact(a.warrantyUntil, now));
  return {
    key: `repairs:${a.id}`,
    section: "repairs",
    title: `${a.tag} · ${a.model}`,
    meta: `${REPAIR_STAGE_LABEL[stage]} · ${a.vendor ?? "no vendor"}${a.rmaRef ? ` · ${a.rmaRef}` : ""} · down ${down} d${beyond ? " · beyond repair" : ""}`,
    href: `/inventory/${a.id}`,
    action: "Chase",
    severity: down,
    ageDays: down,
    entity: assetEntity(a),
    columns: { section: "repairs", item: itemCell(a), vendor: a.vendor, stage, downDays: down },
    detail: detailOf(facts, a.history),
  };
}

export function checkItem(
  a: WorkAssetLike & { createdAt: Date; registeredBy: string | null; fromPo: { id: string; refNo: string } | null },
  now: Date,
): WorkItem {
  const n = daysSince(a.createdAt, now);
  return {
    key: `check:${a.id}`,
    section: "check",
    title: `${a.tag} · ${a.model}`,
    meta: `registered by Purchasing · ${n} d waiting`,
    href: `/inventory/${a.id}`,
    action: "Check",
    severity: n,
    ageDays: n,
    control: { kind: "it-check", asset: { id: a.id, tag: a.tag } },
    entity: assetEntity(a),
    columns: { section: "check", item: itemCell(a), registeredBy: a.registeredBy, fromPo: a.fromPo, waitingDays: n },
    detail: detailOf([
      fact("Serial", a.serial, { mono: true }),
      fact("Registered by", a.registeredBy),
      a.fromPo ? fact("From PO", a.fromPo.refNo, { mono: true }) : { label: "From PO", value: "No PO", tone: "muted" },
      fact("Registered", `${fmtDate(a.createdAt)} · ${daysAgoText(n)}`),
      boughtFact(a),
      warrantyFact(a.warrantyUntil, now),
    ], a.history),
  };
}

export interface PurchaseReviewItemLike extends PurchaseReviewLike {
  vendor: string | null;
  siNumber: string | null;
  /** Σ qty × unit price over the lines (the /purchases list's value) */
  total: number;
  /** the "Total amount due" Purchasing typed off the sales invoice; null when not typed */
  amountDue: number | null;
}

export function purchaseReviewItem(r: PurchaseReviewItemLike, now: Date): WorkItem {
  const row = purchaseReviewRow(r, now);
  const waiting = row.ageDays ?? 0;
  const summary = r.firstLine ? `${r.firstLine}${r.lines > 1 ? ` +${r.lines - 1} more` : ""}` : null;
  return {
    ...row,
    columns: { section: "purchases", po: { refNo: r.refNo, summary }, vendor: r.vendor, siNumber: r.siNumber, total: r.total, waitingDays: waiting },
    detail: detailOf([
      fact("Requested by", r.requestedBy),
      fact("Department", r.department),
      fact("Vendor", r.vendor),
      fact("SI number", r.siNumber, { mono: true }),
      fact("Total", fmtMoney(r.total)),
      ...(r.amountDue === null ? [] : [fact("Amount due", fmtMoney(r.amountDue))]),
      fact("Lines", plural(r.lines, "line")),
      fact("With IT since", `${fmtDate(r.submittedAt ?? r.updatedAt)} · ${daysAgoText(waiting)}`),
    ], []),
  };
}

export interface WorkHireLike {
  id: string;
  name: string;
  employeeNo: string;
  title: string;
  joinedAt: Date;
  group: WorkGroupRef | null;
  /** the equipment list that applies; null = a personal loadout (exceptions only) */
  policyName: string | null;
  /** the required slots still empty, by slot name */
  missingSlots: string[];
}

export function hireItem(e: WorkHireLike, now: Date): WorkItem {
  const d = daysSince(e.joinedAt, now);
  const m = e.missingSlots.length;
  return {
    key: `hires:${e.id}`,
    section: "hires",
    title: `${e.name} started ${d} d ago`,
    meta: `${e.employeeNo} · ${m} required slot${m === 1 ? "" : "s"} empty · ${e.policyName ?? "personal loadout"}`,
    href: `/employees/${e.id}#loadout`,
    action: "Fill loadout",
    severity: d,
    ageDays: d,
    entity: { kind: "employee", id: e.id, label: e.name },
    columns: { section: "hires", person: { name: e.name, employeeNo: e.employeeNo }, group: e.group, startedAt: e.joinedAt, missingSlots: m },
    detail: detailOf([
      fact("Employee no.", e.employeeNo, { mono: true }),
      e.group ? fact(e.group.kind === "CLIENT" ? "Client" : "Department", e.group.name) : fact("Department", null),
      fact("Title", e.title),
      fact("Started", `${fmtDate(e.joinedAt)} · ${daysAgoText(d)}`),
      fact("Equipment list", e.policyName ?? "Personal loadout"),
      fact("Missing", e.missingSlots.join(", ")),
    ], []),
  };
}

const weekdayFmt = new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "Asia/Manila" });

/** Plan call 2: the Loans Status cell, on the Manila calendar — "8 days late", "due today", "due Fri", "no due date". */
export function loanStatus(dueAt: Date | null, now: Date): { text: string; late: boolean; days: number | null } {
  if (dueAt === null) return { text: "no due date", late: false, days: null };
  const days = daysUntil(dueAt, localDateISO(now));
  if (days < 0) return { text: `${plural(-days, "day")} late`, late: true, days };
  const text = days === 0 ? "due today" : days === 1 ? "due tomorrow" : days < 7 ? `due ${weekdayFmt.format(dueAt)}` : `due ${fmtDayMonth(dueAt)}`;
  return { text, late: false, days };
}

/** loanRow's rule decides whether it is a row at all; null when the loan is not due soon. */
export function loanItem(a: WorkAssetLike & { loanDueAt: Date | null; borrower: WorkParty | null }, now: Date): WorkItem | null {
  const row = loanRow({ id: a.id, tag: a.tag, model: a.model, loanDueAt: a.loanDueAt, holder: a.borrower?.name ?? null }, now);
  if (!row) return null;
  const s = loanStatus(a.loanDueAt, now);
  return {
    ...row,
    columns: { section: "loans", item: itemCell(a), borrower: a.borrower, dueAt: a.loanDueAt, dueDays: s.days, status: s.text, late: s.late },
    detail: detailOf([
      fact("Serial", a.serial, { mono: true }),
      fact("Borrower", a.borrower ? partyText(a.borrower) : null),
      a.loanDueAt ? fact("Due", fmtDate(a.loanDueAt)) : { label: "Due", value: "No due date", tone: "muted" },
      fact("Status", s.text, s.late ? { tone: "fault" } : {}),
      boughtFact(a),
      warrantyFact(a.warrantyUntil, now),
    ], a.history),
  };
}

export interface WorkMissingLike extends WorkAssetLike {
  /** missing = status MISSING; orphaned = DEPLOYED with nobody holding it */
  problem: "missing" | "orphaned";
  updatedAt: Date;
  /** the current assignee, if the record still names one */
  holder: WorkParty | null;
  lastReturn: WorkReturnLike | null;
}

const PROBLEM_LABEL = { missing: "Missing", orphaned: "Deployed, no holder" } as const;

export function missingItem(a: WorkMissingLike, now: Date): WorkItem {
  const n = daysSince(a.updatedAt, now);
  const lastHolder = a.holder ?? a.lastReturn?.holder ?? null;
  const row = a.problem === "missing"
    ? { title: `${a.tag} is missing`, meta: `${a.model} · custody lost ${n} d ago`, action: "Investigate" }
    : { title: `${a.tag} reads Deployed with no holder`, meta: `${a.model} · assign it or return it to the pool`, action: "Fix record" };
  return {
    key: `missing:${a.id}`,
    section: "missing",
    ...row,
    href: `/inventory/${a.id}`,
    severity: n,
    ageDays: n,
    // Ruling R6: no in-place control — assignAsset refuses anything but SPARE, so the fix lives on the record.
    entity: assetEntity(a),
    columns: { section: "missing", item: itemCell(a), problem: PROBLEM_LABEL[a.problem], lastHolder, since: a.updatedAt, sinceDays: n },
    detail: detailOf([
      fact("Serial", a.serial, { mono: true }),
      fact("Problem", PROBLEM_LABEL[a.problem]),
      fact("Last holder", lastHolder ? partyText(lastHolder) : null),
      fact("Since", `${fmtDate(a.updatedAt)} · ${plural(n, "day")}`),
      boughtFact(a),
      warrantyFact(a.warrantyUntil, now),
    ], a.history,
    // a Missing return's reason is the investigation's first lead; an orphaned record's last return says nothing about now
    a.problem === "missing" ? { label: RETURN_NOTE_LABEL, text: a.lastReturn?.reason, by: a.lastReturn?.recordedBy ?? null } : undefined),
  };
}

export interface WorkApprovalLike {
  id: string;
  refNo: string;
  type: ApprovalType;
  payload: unknown;
  priority: Priority;
  slaAt: Date;
  createdAt: Date;
  updatedAt: Date;
  workerError: string | null;
  requestedBy: string;
  asset: { tag: string; cls: AssetClass } | null;
  employee: { name: string } | null;
  history: WorkHistoryEntry[];
}

/** A queue row: an SLA breach (rank 0) or an execution failure (rank 1), as the worklist always ranked them. */
export function approvalItem(a: WorkApprovalLike, kind: "breached" | "failed", now: Date): WorkItem {
  const s = summarizeApproval(a.type, a.payload, { assetTag: a.asset?.tag, employeeName: a.employee?.name, cls: a.asset?.cls });
  // a failed approval was decided — its SLA is over, not breached: never overdue, never red (Global Constraints), and
  // it says it failed rather than a grey "3 d overdue" (controller ruling)
  const sla: WorkSla = kind === "breached" ? slaLabel(a.slaAt, now) : { text: "Execution failed", overdue: false };
  const title = `${a.refNo} · ${s.line1}`;
  const row = kind === "breached"
    ? { meta: `${sla.text} · ${a.priority.toLowerCase()}`, rank: 0, age: daysSince(a.slaAt, now) }
    : { meta: `execution failed ${daysSince(a.updatedAt, now)} d ago`, rank: 1, age: daysSince(a.updatedAt, now) };
  const waiting = daysSince(a.createdAt, now);
  const facts: WorkFact[] = [
    fact("Requested by", a.requestedBy),
    fact("Raised", `${fmtDate(a.createdAt)} · ${daysAgoText(waiting)}`),
    fact("SLA", sla.text, sla.overdue ? { tone: "fault" } : {}),
    fact("Priority", PRIORITY_LABEL[a.priority]),
  ];
  if (a.asset) facts.push(fact("Asset", a.asset.tag, { mono: true }));
  if (a.employee) facts.push(fact("Employee", a.employee.name));
  if (kind === "failed") facts.push(fact("Error", a.workerError));
  return {
    key: `queue:${a.id}`,
    section: "queue",
    title,
    meta: row.meta,
    href: `/approvals/${a.id}`,
    action: "Open",
    severity: row.age,
    rank: row.rank,
    ageDays: row.age,
    columns: { section: "queue", what: title, who: a.requestedBy, waitingDays: waiting, sla },
    detail: detailOf(facts, a.history, { label: "Request note", text: reasonOf(a.payload), by: a.requestedBy }),
  };
}

export interface LeaverItemLike extends LeaverLike { department: WorkGroupRef; started: Date | null }

export function leaverItem(e: LeaverItemLike, now: Date): WorkItem {
  const todayISO = localDateISO(now);
  const row = leaverRow(e, todayISO);
  const due = e.dueAt ? dueStatus(e.dueAt, todayISO) : null;
  return {
    ...row,
    columns: {
      section: "queue",
      what: e.itemsOut > 0 ? `Leaving · ${plural(e.itemsOut, "item")} still out` : "Leaving · accounts still to close",
      who: e.name,
      waitingDays: e.started ? daysSince(e.started, now) : 0,
      sla: due ? { text: due.text, overdue: due.overdue } : { text: "no completion date", overdue: false },
    },
    detail: detailOf([
      fact("Employee no.", e.employeeNo, { mono: true }),
      fact(e.department.kind === "CLIENT" ? "Client" : "Department", e.department.name),
      fact("Items still out", String(e.itemsOut)),
      e.dueAt && due
        ? fact("Completion due", `${fmtDate(e.dueAt)} · ${due.text}`, due.overdue ? { tone: "fault" } : {})
        : { label: "Completion due", value: "No completion date", tone: "muted" },
      fact("Leaving since", e.started ? fmtDate(e.started) : null),
      fact("Next step", row.action),
    ], []),
  };
}

// ── the summary line (plan call 13) ──

/** `strong` = bold, never red (Over 90 days); `fault` = red (overdue loans, past SLA). */
export interface WorkStat { label: string; value: string; tone?: "strong" | "fault" }

const OVER_DAYS = 90;

const colsOf = <S extends WorkSectionId>(rows: WorkItem[], s: S): Array<ColumnsOf<S>> =>
  rows.map((r) => r.columns).filter((c): c is ColumnsOf<S> => c.section === s);

/** Σ cost, saying how many have no cost recorded rather than counting them as ₱0 silently. */
function valueAtCost(costs: Array<number | null>): WorkStat {
  const missing = costs.filter((c) => c === null).length;
  const sum = fmtMoney(costs.reduce<number>((s, c) => s + (c ?? 0), 0));
  return { label: "Value at cost", value: missing ? `${sum} · ${missing} without cost` : sum };
}

const countStat = (label: string, n: number, tone?: WorkStat["tone"]): WorkStat =>
  ({ label, value: String(n), ...(tone && n > 0 ? { tone } : {}) });

/**
 * The open queue's summary: Items (the section total, "+" when capped), then the queue's own figures, over the
 * live rows read (today's hidden rows excluded).
 */
export function sectionStats(g: WorkGroup<WorkItem>): WorkStat[] {
  const items: WorkStat = { label: "Items", value: `${g.total}${g.capped ? "+" : ""}` };
  const oldest: WorkStat = { label: "Oldest", value: g.rows.length ? `${g.oldestDays} d` : "—" };
  switch (g.section.id) {
    case "triage": {
      const c = colsOf(g.rows, "triage");
      return [
        items, oldest,
        countStat("Over 90 days", c.filter((x) => x.waitingDays > OVER_DAYS).length, "strong"),
        valueAtCost(c.map((x) => x.cost)),
      ];
    }
    case "repairs": {
      const c = colsOf(g.rows, "repairs");
      return [
        items,
        { label: "Longest down", value: c.length ? `${Math.max(...c.map((x) => x.downDays))} d` : "—" },
        countStat("With a vendor", c.filter((x) => x.vendor !== null).length),
      ];
    }
    case "loans": {
      const c = colsOf(g.rows, "loans");
      return [
        items,
        countStat("Overdue", c.filter((x) => x.late).length, "fault"),
        countStat("Due this week", c.filter((x) => x.dueDays !== null && x.dueDays >= 0 && x.dueDays <= LOAN_DUE_SOON_DAYS).length),
      ];
    }
    case "queue":
      // every live row that reads red — breached approvals and leavers past their completion date — so the stat
      // and the table agree (g.pastSla stays Home's rank-0 count)
      return [items, countStat("Past SLA", colsOf(g.rows, "queue").filter((x) => x.sla?.overdue).length, "fault")];
    default:
      return [items, oldest];
  }
}
