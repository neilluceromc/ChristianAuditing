/**
 * Worklist split view (H4) Task 3: the page's view rules, pure so they are unit-tested — which queue is open, its
 * tab and header counts, the filters, the sort, the pager, the selection after a decision, and the toast copy.
 * The components in src/components/worklist/ only render what these return.
 */
import { fmtDate, fmtMoney } from "./format";
import { REPAIR_STAGE_LABEL } from "./repairs";
import { TRIAGE_LABEL, type TriageOutcome } from "./lifecycle";
import { WORK_SECTIONS, type WorkGroup, type WorkItem, type WorkSectionId } from "./worklist";

/** Plan call 9: ten rows a page, so the table fits one screen. */
export const PER_PAGE = 10;
/** "Over 90 days": bold, never red (Global Constraints). */
export const OVER_DAYS = 90;

/** The tab names (plan call 2's queue names); the section titles stay Home's. */
export const TAB_LABEL: Record<WorkSectionId, string> = {
  triage: "Triage", repairs: "Repairs", check: "IT check", purchases: "Purchase reviews",
  hires: "New hires", loans: "Loans", missing: "Missing & records", queue: "Approvals & leavers",
};

const SECTION_IDS = WORK_SECTIONS.map((s) => s.id);
const isSection = (q: unknown): q is WorkSectionId => typeof q === "string" && (SECTION_IDS as string[]).includes(q);

/** `?q=`: a known queue, else the first queue with work in it, else Triage. */
export function queueFrom(q: string | undefined, groups: WorkGroup[]): WorkSectionId {
  if (isSection(q)) return q;
  return groups.find((g) => g.total > 0)?.section.id ?? "triage";
}

/** `?page=`: a whole number from 1; anything else is page 1. */
export function pageFrom(p: string | undefined): number {
  const n = Number(p);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

/** The URL that holds the open queue, its page and the selected row (plan call 10). */
export function workHref(q: WorkSectionId, page: number, sel: string | null): string {
  const sp = new URLSearchParams({ q });
  if (page > 1) sp.set("page", String(page));
  if (sel) sp.set("sel", sel);
  return `/inventory/work?${sp.toString()}`;
}

/** A row that reads red: an overdue loan, a breached SLA or a leaver past their completion date. Nothing else. */
export function isRed(item: WorkItem): boolean {
  const c = item.columns;
  if (c.section === "loans") return c.late;
  if (c.section === "queue") return c.sla?.overdue === true;
  return false;
}

/** A section's count: its total, "+" when the read hit its cap ("50+"). */
export const countText = (g: WorkGroup | undefined): string => (g ? `${g.total}${g.capped ? "+" : ""}` : "0");

export interface QueueTab {
  id: WorkSectionId;
  label: string;
  count: string;
  on: boolean;
  /** the count reads red: the queue holds an overdue loan or a breached SLA */
  fault: boolean;
}

/** All eight queues, in the worklist's order; a queue with nothing in it still has its tab, counting 0. */
export function queueTabs(groups: WorkGroup<WorkItem>[], current: WorkSectionId): QueueTab[] {
  return WORK_SECTIONS.map((s) => {
    const g = groups.find((x) => x.section.id === s.id);
    return { id: s.id, label: TAB_LABEL[s.id], count: countText(g), on: s.id === current, fault: !!g?.rows.some(isRed) };
  });
}

/** The header's "{n} waiting on IT · {n} overdue": every queue's total ("+" when any is capped), and the red rows. */
export function headerCounts(groups: WorkGroup<WorkItem>[]): { waiting: string; overdue: number } {
  const total = groups.reduce((s, g) => s + g.total, 0);
  return {
    waiting: `${total}${groups.some((g) => g.capped) ? "+" : ""}`,
    overdue: groups.reduce((s, g) => s + g.rows.filter(isRed).length, 0),
  };
}

// ── filters ──

export interface WorkFilters {
  /** a category name ("Uncategorised" for none); null = all */
  category: string | null;
  over90: boolean;
  q: string;
}
export const NO_FILTERS: WorkFilters = { category: null, over90: false, q: "" };
export const filtersActive = (f: WorkFilters): boolean => f.category !== null || f.over90 || f.q.trim() !== "";

const UNCATEGORISED = "Uncategorised";

/** An asset row's category (the chips' key); null for a queue whose rows are not assets. */
export function categoryOf(item: WorkItem): string | null {
  const c = item.columns;
  return "item" in c ? (c.item.category ?? UNCATEGORISED) : null;
}

/** The days the "Over 90 days" filter reads; null for a queue it does not apply to (Loans, New hires). */
export function ageOf(item: WorkItem): number | null {
  const c = item.columns;
  switch (c.section) {
    case "triage": case "check": case "purchases": case "queue": return c.waitingDays;
    case "repairs": return c.downDays;
    case "missing": return c.sinceDays;
    default: return null;
  }
}

/** Which filters a queue offers: category chips for asset queues, Over 90 days where rows have an age. */
export function filtersFor(section: WorkSectionId): { category: boolean; over90: boolean } {
  const assets: WorkSectionId[] = ["triage", "repairs", "check", "loans", "missing"];
  return { category: assets.includes(section), over90: section !== "loans" && section !== "hires" };
}

/** "All" then each category with its count, most first. */
export function categoryChips(rows: WorkItem[]): Array<{ label: string; value: string | null; count: number }> {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const c = categoryOf(r);
    if (c !== null) counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  const each = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([label, count]) => ({ label, value: label, count }));
  return [{ label: "All", value: null, count: rows.length }, ...each];
}

/** Every word a row shows — tag, model, people, groups, vendors, references — lower-cased, for the search box. */
export function searchText(item: WorkItem): string {
  const words: string[] = [item.title];
  const walk = (v: unknown) => {
    if (typeof v === "string") words.push(v);
    else if (v && typeof v === "object" && !(v instanceof Date)) Object.values(v).forEach(walk);
  };
  walk(item.columns);
  return words.join(" ").toLowerCase();
}

export function filterRows(rows: WorkItem[], f: WorkFilters): WorkItem[] {
  const q = f.q.trim().toLowerCase();
  return rows.filter((r) =>
    (f.category === null || categoryOf(r) === f.category) &&
    (!f.over90 || (ageOf(r) ?? 0) > OVER_DAYS) &&
    (!q || searchText(r).includes(q)),
  );
}

// ── columns and sort ──

export type SortDir = "asc" | "desc";
export interface WorkSort { key: string; dir: SortDir }

export interface WorkColumn { key: string; label: string; align?: "right"; width?: number }

/** Plan call 2: each queue's columns. Every one sorts. */
export const COLUMNS: Record<WorkSectionId, WorkColumn[]> = {
  triage: [
    { key: "item", label: "Item" }, { key: "lastHolder", label: "Last holder", width: 200 },
    { key: "returned", label: "Returned", width: 120 }, { key: "waiting", label: "Waiting", width: 100 },
  ],
  repairs: [
    { key: "item", label: "Item" }, { key: "vendor", label: "Vendor", width: 180 },
    { key: "stage", label: "Stage", width: 150 }, { key: "down", label: "Down", width: 100 },
  ],
  check: [
    { key: "item", label: "Item" }, { key: "registeredBy", label: "Registered by", width: 180 },
    { key: "fromPo", label: "From PO", width: 130 }, { key: "waiting", label: "Waiting", width: 100 },
  ],
  purchases: [
    { key: "po", label: "PO" }, { key: "vendor", label: "Vendor", width: 170 }, { key: "si", label: "SI number", width: 130 },
    { key: "total", label: "Total", align: "right", width: 120 }, { key: "waiting", label: "Waiting", width: 100 },
  ],
  hires: [
    { key: "person", label: "Person" }, { key: "group", label: "Department or client", width: 200 },
    { key: "started", label: "Started", width: 120 }, { key: "missing", label: "Missing slots", width: 120, align: "right" },
  ],
  loans: [
    { key: "item", label: "Item" }, { key: "borrower", label: "Borrower", width: 200 },
    { key: "due", label: "Due", width: 120 }, { key: "status", label: "Status", width: 130 },
  ],
  missing: [
    { key: "item", label: "Item" }, { key: "problem", label: "Problem", width: 170 },
    { key: "lastHolder", label: "Last holder", width: 190 }, { key: "since", label: "Since", width: 120 },
  ],
  queue: [
    { key: "what", label: "What" }, { key: "who", label: "Who", width: 180 },
    { key: "waiting", label: "Waiting", width: 100 }, { key: "sla", label: "SLA", width: 150 },
  ],
};

/** The order each queue opens in — the worklist's own ranking, named where one column states it (null = ranked). */
export const DEFAULT_SORT: Record<WorkSectionId, WorkSort | null> = {
  triage: { key: "waiting", dir: "desc" }, repairs: { key: "down", dir: "desc" }, check: { key: "waiting", dir: "desc" },
  purchases: { key: "waiting", dir: "asc" }, hires: { key: "started", dir: "asc" }, missing: { key: "since", dir: "asc" },
  loans: null, queue: null,
};

type SortValue = string | number | null;
const time = (d: Date | null) => (d ? new Date(d).getTime() : null);
const lower = (s: string | null | undefined) => (s ? s.toLowerCase() : null);

/** One cell's sort key; null always sorts last, whichever way. */
export function sortValue(item: WorkItem, key: string): SortValue {
  const c = item.columns;
  switch (c.section) {
    case "triage":
      return key === "item" ? lower(c.item.model) : key === "lastHolder" ? lower(c.lastHolder?.name)
        : key === "returned" ? time(c.returnedAt) : key === "waiting" ? c.waitingDays : null;
    case "repairs":
      return key === "item" ? lower(c.item.model) : key === "vendor" ? lower(c.vendor)
        : key === "stage" ? REPAIR_STAGE_LABEL[c.stage].toLowerCase() : key === "down" ? c.downDays : null;
    case "check":
      return key === "item" ? lower(c.item.model) : key === "registeredBy" ? lower(c.registeredBy)
        : key === "fromPo" ? lower(c.fromPo?.refNo) : key === "waiting" ? c.waitingDays : null;
    case "purchases":
      return key === "po" ? lower(c.po.refNo) : key === "vendor" ? lower(c.vendor) : key === "si" ? lower(c.siNumber)
        : key === "total" ? c.total : key === "waiting" ? c.waitingDays : null;
    case "hires":
      return key === "person" ? lower(c.person.name) : key === "group" ? lower(c.group?.name)
        : key === "started" ? time(c.startedAt) : key === "missing" ? c.missingSlots : null;
    case "loans":
      return key === "item" ? lower(c.item.model) : key === "borrower" ? lower(c.borrower?.name)
        : key === "due" ? time(c.dueAt) : key === "status" ? c.dueDays : null;
    case "missing":
      return key === "item" ? lower(c.item.model) : key === "problem" ? lower(c.problem)
        : key === "lastHolder" ? lower(c.lastHolder?.name) : key === "since" ? time(c.since) : null;
    case "queue":
      return key === "what" ? lower(c.what) : key === "who" ? lower(c.who) : key === "waiting" ? c.waitingDays
        // red first, then the rest; a row with no SLA last
        : key === "sla" ? (c.sla ? (c.sla.overdue ? 0 : 1) : null) : null;
  }
}

/** Sorted by one column; ties (and a null sort) keep the worklist's own order. */
export function sortRows(rows: WorkItem[], sort: WorkSort | null): WorkItem[] {
  if (!sort) return rows;
  const sign = sort.dir === "asc" ? 1 : -1;
  return rows
    .map((r, i) => ({ r, i, v: sortValue(r, sort.key) }))
    .sort((a, b) => {
      if (a.v === b.v) return a.i - b.i;
      if (a.v === null) return 1;
      if (b.v === null) return -1;
      const cmp = typeof a.v === "number" && typeof b.v === "number" ? a.v - b.v : String(a.v).localeCompare(String(b.v));
      return cmp * sign || a.i - b.i;
    })
    .map((x) => x.r);
}

/** A header click: the same column flips; a new one starts descending for numbers and dates, ascending for words. */
export function nextSort(current: WorkSort | null, key: string, numeric: boolean): WorkSort {
  if (current?.key === key) return { key, dir: current.dir === "asc" ? "desc" : "asc" };
  return { key, dir: numeric ? "desc" : "asc" };
}

/** Columns whose values are numbers or dates (a new sort on them starts with the largest). */
export const NUMERIC_KEYS = new Set(["returned", "waiting", "down", "total", "started", "missing", "due", "status", "since", "sla"]);

// ── pager ──

export interface PageSlice { rows: WorkItem[]; page: number; pageCount: number; start: number; end: number; total: number }

/** One page of the filtered rows; a page past the end shows the last one. */
export function paginate(rows: WorkItem[], page: number): PageSlice {
  const pageCount = Math.max(1, Math.ceil(rows.length / PER_PAGE));
  const p = Math.min(Math.max(1, page), pageCount);
  const start = (p - 1) * PER_PAGE;
  const slice = rows.slice(start, start + PER_PAGE);
  return { rows: slice, page: p, pageCount, start: slice.length ? start + 1 : 0, end: start + slice.length, total: rows.length };
}

/** "1–10 of 16", or "0 items". */
export function pageLabel(s: Pick<PageSlice, "start" | "end" | "total">): string {
  return s.total ? `${s.start}–${s.end} of ${s.total}` : "0 items";
}

/** Plan call 11: a capped queue's last page says the list stops at what was read. */
export function capNote(g: WorkGroup | undefined, s: Pick<PageSlice, "page" | "pageCount">): string | null {
  if (!g?.capped || s.page !== s.pageCount) return null;
  return `Showing the first ${g.rows.length} — clear some to see more`;
}

/** The page a row sits on in the list, or null when the filters hide it. */
export function pageOfKey(rows: WorkItem[], key: string | null): number | null {
  if (!key) return null;
  const i = rows.findIndex((r) => r.key === key);
  return i < 0 ? null : Math.floor(i / PER_PAGE) + 1;
}

/**
 * Decide → next (plan call 5): after `removed` leave the list, the row that followed the first of them, else the
 * one before it, else nothing.
 */
export function selectAfter(rows: WorkItem[], removed: ReadonlySet<string>, current: string | null): string | null {
  const anchor = rows.findIndex((r) => r.key === current || removed.has(r.key));
  const rest = rows.filter((r) => !removed.has(r.key));
  if (rest.length === 0) return null;
  if (current && !removed.has(current) && rest.some((r) => r.key === current)) return current;
  if (anchor < 0) return rest[0].key;
  const after = rows.slice(anchor).find((r) => !removed.has(r.key));
  return (after ?? rest[rest.length - 1]).key;
}

// ── cells ──

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
export const daysText = (n: number): string => plural(n, "day");
export const dateText = (d: Date | null): string => (d ? fmtDate(d) : "—");
export const moneyText = (n: number): string => fmtMoney(n);

// ── copy ──

/** The panel's empty state and the table's (Global Constraints, verbatim). */
export const emptyQueue = (s: WorkSectionId) => ({ title: "All clear", text: `Nothing left in ${TAB_LABEL[s]}.` });
export const FILTERED_EMPTY = "Nothing matches these filters.";

const TRIAGE_DONE: Record<TriageOutcome, string> = {
  SPARE: "kept as a spare", DEFECTIVE: "sent to repair", DISPOSE: "marked for disposal", DONATED: "marked for donation",
};

/** "{model} · kept as a spare" / "{model} · sent to repair" (verbatim), and Dispose's and Donate's. */
export const decisionToast = (outcome: TriageOutcome, model: string): string => `${model} · ${TRIAGE_DONE[outcome]}`;

/** "{n} items · kept as spares" / "{n} items · sent to repair" (verbatim). */
export function bulkTriageToast(outcome: "SPARE" | "DEFECTIVE", n: number): string {
  return `${plural(n, "item")} · ${outcome === "SPARE" ? "kept as spares" : "sent to repair"}`;
}

export const checkedToast = (model: string): string => `${model} · checked`;
export const bulkCheckedToast = (n: number): string => `${plural(n, "item")} · checked`;
export const undoneToast = (what: string): string => `${what} · back in Triage`;
/** A single decision refused because the row moved on meanwhile (Review Focus 1); the server's words go under it. */
export const CHANGED_ELSEWHERE = "Changed by someone else since";

/**
 * A bulk decision's toast: one item reads like a single decision; several read "{n} items · …"; any that failed add
 * the report "{done} done, {failed} couldn't (changed by someone else)" as the detail. None done is an error.
 */
export function bulkToast(
  kind: "SPARE" | "DEFECTIVE" | "CHECK",
  done: ReadonlyArray<{ model: string }>,
  failed: number,
): { message: string; tone: "settled" | "fault"; detail?: string } {
  const report = failed > 0 ? { detail: `${done.length} done, ${failed} couldn't (changed by someone else)` } : {};
  if (done.length === 0) return { message: "Nothing changed", tone: "fault", ...report };
  const message = done.length === 1
    ? (kind === "CHECK" ? checkedToast(done[0].model) : decisionToast(kind, done[0].model))
    : (kind === "CHECK" ? bulkCheckedToast(done.length) : bulkTriageToast(kind, done.length));
  return { message, tone: "settled", ...report };
}

/** The asset a row is about, for the server calls; null for a person, an order or an approval. */
export const assetIdOf = (item: WorkItem): string | null => (item.entity?.kind === "asset" ? item.entity.id : null);

/** The model (asset rows) or title a toast names. */
export const modelOf = (item: WorkItem): string => ("item" in item.columns ? item.columns.item.model : item.title);

/** The triage buttons, in the panel's order: Keep as spare is the primary. */
export const TRIAGE_BUTTONS: readonly TriageOutcome[] = ["SPARE", "DEFECTIVE", "DISPOSE", "DONATED"];
export const triageButtonLabel = (o: TriageOutcome): string => TRIAGE_LABEL[o];

/** Which queues take ticks, and their bulk buttons (plan call 7). Others show no checkboxes. */
export const BULK: Partial<Record<WorkSectionId, ReadonlyArray<{ id: "SPARE" | "DEFECTIVE" | "CHECK"; label: string }>>> = {
  triage: [{ id: "SPARE", label: "Keep as spares" }, { id: "DEFECTIVE", label: "Send to repair" }],
  check: [{ id: "CHECK", label: "Mark checked" }],
};

/** The panel's record link: an asset's record, a person's profile, else where the row goes. */
export function recordHref(item: WorkItem): string {
  if (item.entity?.kind === "asset") return `/inventory/${item.entity.id}`;
  if (item.entity?.kind === "employee") return `/employees/${item.entity.id}`;
  return item.href;
}
