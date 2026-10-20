import type { Role } from "@prisma/client";
import { lifeYears, monthLabel, type DepResult, type MonthIndex } from "./depreciation";
import { lifeLabel } from "./depreciation-input";
import { fieldLabel } from "./activity";
import { CLASS_LABEL, statusLabel } from "./asset-class";
import { fmtDate, fmtMoneyExact } from "./format";
import { EMPLOYMENT_LABEL } from "./labels";

/*
 * Phase 47 (Task 4, spec §4.5): the Financial history tab, built from
 *   - the asset's audit entries for finance-relevant actions,
 *   - its PurchaseRecord's audit entries (entityType "purchase-record", where the purchase and its fees are recorded),
 *   - one derived System line per depreciation month counted (not stored).
 * Pure: the server reads the rows (src/server/modules/finance/asset-detail.ts) and the page filters and pages here.
 */

export type HistoryKind = "approval" | "review" | "cost" | "settings" | "docs" | "notes" | "dep";
export const HISTORY_KINDS: readonly HistoryKind[] = ["approval", "review", "cost", "settings", "docs", "notes", "dep"];
export const HISTORY_KIND_LABELS: Record<HistoryKind, string> = {
  approval: "Approvals", review: "Reviews", cost: "Cost", settings: "Settings", docs: "Documents", notes: "Notes", dep: "Depreciation",
};

export type HistorySource = "web" | "import" | "cris" | "system";
export const HISTORY_SOURCE_LABELS: Record<HistorySource, string> = {
  web: "Web app", import: "Import", cris: "Cris assistant", system: "Nightly job",
};

/** The short role words the history and notes show after a name: "Ana Cruz (Finance)". */
export const ROLE_SHORT: Record<Role, string> = {
  admin: "Admin", it_staff: "IT", purchasing_staff: "Purchasing", finance_staff: "Finance", viewer: "Viewer",
};

export const SYSTEM_ACTOR = "System";
/** The person filter's key for System (audit rows with no actor, and the derived depreciation lines). */
export const SYSTEM_KEY = "system";
export const HISTORY_PAGE_SIZE = 10;

/** One AuditEntry, with the actor's email and role joined from User by actorId (null for System or a deleted user). */
export interface AuditRow {
  id: string;
  actorId: string | null;
  actorLabel: string;
  actorEmail: string | null;
  actorRole: Role | null;
  entityType: string;
  entityId: string;
  action: string;
  diff: unknown;
  source: string | null;
  reason: string | null;
  createdAt: Date;
}

/** One derived "System counted <Month> depreciation" line. */
export interface DepLine {
  id: string;
  month: MonthIndex;
  label: string;
  at: Date;
  chargeC: number;
  accFromC: number;
  accToC: number;
  bookFromC: number;
  bookToC: number;
}

export interface HistoryChange { field: string; from: string; to: string }

export interface HistoryRow {
  id: string;
  /** `AUD-<yyyymmdd>-<last 6 of id, upper case>` (Manila date); a depreciation line is `DEP-<yyyymm>`. */
  ref: string;
  at: Date;
  /** The Manila calendar day, `YYYY-MM-DD`: the day-group key. */
  day: string;
  /** The day header's words, e.g. "Wed 21 Oct 2026". */
  dayLabel: string;
  /** Manila `HH:mm`. */
  time: string;
  /** Exact time with the time zone, for Details. */
  exact: string;
  actor: string;
  /** The person filter's key: the actor's user id, or "system". */
  actorKey: string;
  /** Short role ("Finance", "IT"), null for System or an unknown user. */
  role: string | null;
  kind: HistoryKind;
  verb: string;
  changes: HistoryChange[];
  reason: string | null;
  source: HistorySource;
  sourceLabel: string;
  /** The signed-in account (email), null for System. */
  account: string | null;
  /** What the entry relates to: "Asset IT-0042", "Purchase record (3 units)", "Laptops policy", "Depreciation schedule". */
  related: string;
}

export interface HistoryFilters {
  kind?: HistoryKind | "all";
  /** An actor key (user id, or "system"), or "all" / undefined for Everyone. */
  person?: string;
  /** 1-based; clamped to the last page. */
  page?: number;
  pageSize?: number;
}

export interface HistoryContext {
  assetTag: string;
  categoryName?: string | null;
  /** Units the purchase record covered, for "Purchase record (3 units)". */
  purchaseUnits?: number | null;
  /**
   * id → name for the ids a diff can carry (supplier, category, type, holder, department), resolved on the server.
   * An id missing here drops its chip: a chip never shows a raw id.
   */
  names?: Record<string, string>;
}

export interface HistoryResult {
  rows: HistoryRow[];
  /** Per kind, under the person filter (not the kind filter); "All" is their sum. */
  counts: Record<HistoryKind, number>;
  /** Everyone who appears (key = user id, label = name), by name, then System last when it appears. */
  actors: Array<{ key: string; label: string }>;
  /** Entries after both filters: the N of "x–y of N". */
  total: number;
  page: number;
  pages: number;
  from: number;
  to: number;
}

// ---- time (Asia/Manila is UTC+8 all year, but Intl keeps it honest) -------------------------------------------------

const PARTS = new Intl.DateTimeFormat("en-CA", {
  year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  hour12: false, timeZone: "Asia/Manila",
});
const DAY_LABEL = new Intl.DateTimeFormat("en-GB", {
  weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Manila",
});

function manilaParts(d: Date) {
  const p = Object.fromEntries(PARTS.formatToParts(d).map((x) => [x.type, x.value]));
  const hour = p.hour === "24" ? "00" : p.hour;
  return { y: p.year, m: p.month, d: p.day, hh: hour, mm: p.minute, ss: p.second };
}

export function historyRef(id: string, at: Date): string {
  const p = manilaParts(at);
  return `AUD-${p.y}${p.m}${p.d}-${id.slice(-6).toUpperCase()}`;
}

/** The first instant of a Manila calendar month (Manila has no daylight saving: UTC+8). */
function manilaMonthStart(m: MonthIndex): Date {
  return new Date(Date.UTC(Math.floor(m / 12), m % 12, 1) - 8 * 3_600_000);
}

// ---- kinds and verbs ------------------------------------------------------------------------------------------------

type Diff = Record<string, { from?: unknown; to?: unknown }> | null;
type VerbFn = (diff: Diff) => string;

/** Fields a plain `update` / `import-*` must touch to be finance history (cost and the purchase details). */
const FINANCE_FIELDS = ["cost", "purchasedAt", "vendorId", "invoiceRef", "receiptRef", "warrantyUntil", "fees", "unitCost"];
const touchesFinance = (diff: unknown) =>
  diff !== null && typeof diff === "object" && FINANCE_FIELDS.some((f) => f in (diff as object));

const changedList = (diff: Diff, fallback: string) => {
  const keys = diff ? Object.keys(diff).filter((k) => !HIDDEN_FIELDS.has(k)).map(chipLabel).sort() : [];
  return keys.length ? keys.join(", ") : fallback;
};

/**
 * The verb sentence for each audit action the finance, registration, override, document and note code writes
 * (actor-less: the row shows the actor before it). An unknown action reads as its own words.
 */
export const HISTORY_VERBS: Record<string, { kind: HistoryKind; verb: string | VerbFn }> = {
  // registration and reviews
  create: { kind: "review", verb: "registered the asset" },
  register: { kind: "review", verb: "registered the asset" },
  "import-create": { kind: "review", verb: "registered the asset by import" },
  "it.verify": { kind: "review", verb: "completed the IT check" },
  "finance.return": { kind: "review", verb: "sent the asset back" },
  "finance.resubmit": { kind: "review", verb: "resubmitted the asset to Finance" },
  // approvals
  "finance.confirm": {
    kind: "approval",
    verb: (d) => (d?.notCapitalised?.to === true ? "approved the asset as not capitalised" : "approved the asset for depreciation"),
  },
  "finance.reopened": { kind: "approval", verb: "sent the asset back to Finance after a cost change" },
  // cost and purchase
  update: { kind: "cost", verb: (d) => `changed the ${changedList(d, "purchase details")}` },
  "import-update": { kind: "cost", verb: (d) => `changed the ${changedList(d, "purchase details")} by import` },
  "purchase.recorded": { kind: "cost", verb: "recorded the purchase" },
  // depreciation settings
  "depreciation.override": { kind: "settings", verb: "set a custom depreciation" },
  "depreciation.override.cleared": { kind: "settings", verb: "removed the custom depreciation" },
  "depreciation.policy": { kind: "settings", verb: "changed the category's depreciation policy" },
  // documents and attachments
  "document.uploaded": {
    kind: "docs", verb: (d) => (typeof d?.document?.to === "string" ? `uploaded ${d.document.to}` : "uploaded a document"),
  },
  // the writer keys the diff by the file name: { "<file>": { from: "unsigned", to: "SIGNED" } }
  "document.signed": {
    kind: "docs", verb: (d) => {
      const file = d ? Object.keys(d).find((k) => k !== "via") : undefined;
      return file ? `signed ${file}` : "signed a document";
    },
  },
  "attachment.uploaded": {
    kind: "docs", verb: (d) => (typeof d?.attachment?.to === "string" ? `attached ${d.attachment.to}` : "added an attachment"),
  },
  // notes (Task 6 writes these on the asset)
  "note.posted": { kind: "notes", verb: "added a note" },
  "note.added": { kind: "notes", verb: "added a note" },
  "note.replied": { kind: "notes", verb: "replied to a note" },
  "note.resolved": { kind: "notes", verb: "marked a note resolved" },
  "note.reopened": { kind: "notes", verb: "reopened a note" },
};

/** Kinds for actions not in the table, by prefix; anything else is a review. */
function kindFor(entityType: string, action: string): HistoryKind {
  const known = HISTORY_VERBS[action];
  if (entityType === "purchase-record") return "cost";
  if (known) return known.kind;
  if (action.startsWith("depreciation.")) return "settings";
  if (action.startsWith("document.") || action.startsWith("attachment.")) return "docs";
  if (action.startsWith("note.") || action.startsWith("asset-note.")) return "notes";
  if (action.startsWith("finance.")) return "approval";
  return "review";
}

const readable = (action: string) => action.replace(/[._-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().trim();

export function historyVerb(e: { entityType: string; action: string; diff: unknown }): string {
  const diff = (e.diff ?? null) as Diff;
  if (e.entityType === "purchase-record" && e.action !== "purchase.recorded") {
    return `changed the purchase's ${changedList(diff, "details")}`;
  }
  const known = HISTORY_VERBS[e.action];
  if (!known) return readable(e.action);
  return typeof known.verb === "function" ? known.verb(diff) : known.verb;
}

/** Whether an asset / purchase-record / category audit entry belongs in the Financial history (spec §4.5 sources). */
export function isFinanceRelevant(e: { entityType: string; action: string; diff: unknown }): boolean {
  if (e.entityType === "purchase-record") return true;
  if (e.entityType === "asset-category") return e.action === "depreciation.policy";
  if (e.action === "update" || e.action === "import-update") return touchesFinance(e.diff);
  if (HISTORY_VERBS[e.action]) return true;
  return ["finance.", "depreciation.", "document.", "attachment.", "note.", "asset-note."].some((p) => e.action.startsWith(p));
}

// ---- change chips ---------------------------------------------------------------------------------------------------

/** Diff keys that are not changes to show: the actor's own name, Cris's marker, the reason-bearing notes, objects. */
const HIDDEN_FIELDS = new Set(["via", "financeConfirmed", "itVerified", "financeReturn", "reply", "note", "document", "attachment"]);
const MONEY_FIELDS = new Set(["cost", "total", "fees", "salvage", "unitCost", "price", "repairQuote"]);
const CHIP_LABELS: Record<string, string> = {
  lifeMonths: "useful life", quantity: "units", fees: "delivery and fees", unitCost: "unit cost",
  notCapitalised: "not capitalised", salvagePercent: "salvage %", cls: "class", repairQuote: "repair quote",
};
/** Enum values a chip shows by their label, never the code. */
const ENUM_LABELS: Record<string, (v: string) => string> = {
  status: statusLabel,
  cls: (v) => (Object.hasOwn(CLASS_LABEL, v) ? CLASS_LABEL[v as keyof typeof CLASS_LABEL] : v),
  employment: (v) => (Object.hasOwn(EMPLOYMENT_LABEL, v) ? EMPLOYMENT_LABEL[v as keyof typeof EMPLOYMENT_LABEL] : v),
};
/** A diff key holding a database id (vendorId, categoryId, assigneeId, …). */
const isIdKey = (key: string) => /Id$/.test(key);
const chipLabel = (key: string) => CHIP_LABELS[key] ?? fieldLabel(key);

/** A chip's words for one side of a change; null drops the chip (an object, or an id with no resolved name). */
function chipValue(key: string, v: unknown, names: Record<string, string>): string | null {
  if (v === null || v === undefined || v === "") return "—";
  if (isIdKey(key)) return typeof v === "string" && Object.hasOwn(names, v) ? names[v] : null;
  if (typeof v === "string" && ENUM_LABELS[key]) return ENUM_LABELS[key](v);
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (MONEY_FIELDS.has(key) && (typeof v === "number" || typeof v === "string") && v !== "" && !Number.isNaN(Number(v))) {
    return fmtMoneyExact(v);
  }
  if (key === "lifeMonths" && typeof v === "number") return lifeLabel(v);
  if (v instanceof Date) return fmtDate(v);
  if (typeof v === "string" && /At$|Until$/.test(key) && !Number.isNaN(Date.parse(v))) return fmtDate(v);
  if (Array.isArray(v)) return v.map(String).join(", ");
  if (typeof v === "object") return null;
  return String(v);
}

function changesOf(e: AuditRow, names: Record<string, string>): HistoryChange[] {
  const diff = e.diff;
  if (diff === null || typeof diff !== "object") return [];
  if (e.action === "document.signed") return []; // its one key is the file name, and the verb says it
  const out: HistoryChange[] = [];
  // a send-back's checklist: which fields Finance flagged (the note is the reason)
  const ret = (diff as { financeReturn?: { to?: { fields?: unknown } | null } }).financeReturn?.to;
  if (ret && typeof ret === "object" && Array.isArray(ret.fields) && ret.fields.length) {
    out.push({ field: "flagged", from: "—", to: ret.fields.map(String).join(", ") });
  }
  for (const [key, c] of Object.entries(diff as Record<string, unknown>)) {
    if (HIDDEN_FIELDS.has(key) || c === null || typeof c !== "object") continue;
    const { from, to } = c as { from?: unknown; to?: unknown };
    const f = chipValue(key, from, names), t = chipValue(key, to, names);
    if (f === null || t === null) continue;
    out.push({ field: chipLabel(key), from: f, to: t });
  }
  return out.sort((a, b) => a.field.localeCompare(b.field));
}

/** The stored reason; rows written before Phase 47 carry it in the diff (send-back note, resubmit reply, override note). */
function reasonOf(e: AuditRow): string | null {
  if (e.reason) return e.reason;
  const d = (e.diff ?? null) as Record<string, { to?: unknown }> | null;
  if (!d) return null;
  const ret = d.financeReturn?.to as { note?: unknown } | null | undefined;
  const candidates = [ret && typeof ret === "object" ? ret.note : null, d.reply?.to, e.action.startsWith("depreciation.") ? d.note?.to : null];
  const hit = candidates.find((c) => typeof c === "string" && c.trim() !== "");
  return typeof hit === "string" ? hit : null;
}

function sourceOf(e: AuditRow): HistorySource {
  if (e.source === "web" || e.source === "import" || e.source === "cris" || e.source === "system") return e.source;
  // Rows written before Phase 47: an import action came from an import, a Cris change carries `via: Cris`.
  if (e.action.startsWith("import-")) return "import";
  const via = (e.diff as { via?: { to?: unknown } } | null)?.via;
  if (via && typeof via === "object" && via.to === "Cris") return "cris";
  return "web";
}

function relatedOf(e: AuditRow, ctx: HistoryContext): string {
  if (e.entityType === "purchase-record") {
    const n = ctx.purchaseUnits;
    return n && n > 1 ? `Purchase record (${n} units)` : "Purchase record";
  }
  if (e.entityType === "asset-category") return ctx.categoryName ? `${ctx.categoryName} policy` : "Category policy";
  return `Asset ${ctx.assetTag}`;
}

function timeFields(at: Date) {
  const p = manilaParts(at);
  return {
    day: `${p.y}-${p.m}-${p.d}`,
    dayLabel: DAY_LABEL.format(at),
    time: `${p.hh}:${p.mm}`,
    exact: `${p.y}-${p.m}-${p.d} ${p.hh}:${p.mm}:${p.ss} GMT+8 (Asia/Manila)`,
  };
}

function auditToRow(e: AuditRow, ctx: HistoryContext): HistoryRow {
  const source = sourceOf(e);
  const system = e.actorId === null;
  return {
    id: e.id,
    ref: historyRef(e.id, e.createdAt),
    at: e.createdAt,
    ...timeFields(e.createdAt),
    actor: system ? SYSTEM_ACTOR : e.actorLabel,
    actorKey: e.actorId ?? SYSTEM_KEY,
    role: e.actorRole ? ROLE_SHORT[e.actorRole] : null,
    kind: kindFor(e.entityType, e.action),
    verb: historyVerb(e),
    changes: changesOf(e, ctx.names ?? {}),
    reason: reasonOf(e),
    source,
    sourceLabel: HISTORY_SOURCE_LABELS[source],
    account: system ? null : e.actorEmail,
    related: relatedOf(e, ctx),
  };
}

function depToRow(l: DepLine): HistoryRow {
  const m = ((l.month % 12) + 12) % 12;
  return {
    id: l.id,
    ref: `DEP-${Math.floor(l.month / 12)}${String(m + 1).padStart(2, "0")}`,
    at: l.at,
    ...timeFields(l.at),
    actor: SYSTEM_ACTOR,
    actorKey: SYSTEM_KEY,
    role: null,
    kind: "dep",
    verb: `counted ${l.label} depreciation`,
    changes: [
      { field: "accumulated", from: fmtMoneyExact(l.accFromC / 100), to: fmtMoneyExact(l.accToC / 100) },
      { field: "book value", from: fmtMoneyExact(l.bookFromC / 100), to: fmtMoneyExact(l.bookToC / 100) },
    ],
    reason: null,
    source: "system",
    sourceLabel: HISTORY_SOURCE_LABELS.system,
    account: null,
    related: "Depreciation schedule",
  };
}

// ---- derived depreciation lines -------------------------------------------------------------------------------------

/**
 * When the catch-up months were counted: the latest `finance.confirm` audit entry. confirmFinance stamps
 * `Asset.financeConfirmedAt` before it writes that entry, so the entry is a few ms later — dating the lines at the
 * column would list them under the approval. Falls back to the column when no entry is at hand.
 */
export function countedFromOf(entries: ReadonlyArray<Pick<AuditRow, "entityType" | "action" | "createdAt">>, financeConfirmedAt: Date | null): Date | null {
  let latest: Date | null = null;
  for (const e of entries) {
    if (e.entityType === "asset" && e.action === "finance.confirm" && (!latest || e.createdAt > latest)) latest = e.createdAt;
  }
  return latest ?? financeConfirmedAt;
}

/**
 * One line per month counted so far (the start month through this month — Phase 38 counts the current month), read
 * from `lifeYears`. A month that began before Finance approved the asset was counted at the approval (`countedFrom`).
 */
export function depLines(result: DepResult | null, start: MonthIndex | null, asOf: MonthIndex, countedFrom?: Date | null): DepLine[] {
  if (!result || start === null || !result.policy) return [];
  const cost = result.cost;
  const out: DepLine[] = [];
  for (const y of lifeYears(cost, start, result.policy, asOf)) {
    for (const m of y.months) {
      if (m.month > asOf) continue;
      const monthStart = manilaMonthStart(m.month);
      const at = countedFrom && countedFrom.getTime() > monthStart.getTime() ? countedFrom : monthStart;
      out.push({
        id: `dep-${m.month}`, month: m.month, label: monthLabel(m.month), at,
        chargeC: m.charge, accFromC: cost - m.opening, accToC: cost - m.closing, bookFromC: m.opening, bookToC: m.closing,
      });
    }
  }
  return out;
}

// ---- the builder ----------------------------------------------------------------------------------------------------

export function buildHistory(
  entries: AuditRow[],
  lines: DepLine[],
  filters: HistoryFilters = {},
  ctx: HistoryContext = { assetTag: "" },
): HistoryResult {
  // Newest first. At the same instant a depreciation line lists above an audit entry: catch-up months are counted
  // at the approval, i.e. just after it. Then the later month (or id) first.
  const all = [...entries.map((e) => auditToRow(e, ctx)), ...lines.map(depToRow)].sort(
    (a, b) => b.at.getTime() - a.at.getTime()
      || Number(b.kind === "dep") - Number(a.kind === "dep")
      || b.id.localeCompare(a.id, "en", { numeric: true }),
  );

  const people = new Map<string, string>();
  let hasSystem = false;
  for (const r of all) {
    if (r.actorKey === SYSTEM_KEY) hasSystem = true;
    else if (!people.has(r.actorKey)) people.set(r.actorKey, r.actor);
  }
  const actors = [...people].map(([key, label]) => ({ key, label }))
    .sort((a, b) => a.label.localeCompare(b.label) || a.key.localeCompare(b.key));
  if (hasSystem) actors.push({ key: SYSTEM_KEY, label: SYSTEM_ACTOR });

  const person = filters.person && filters.person !== "all" ? filters.person : null;
  const byPerson = person ? all.filter((r) => r.actorKey === person) : all;
  const counts = Object.fromEntries(HISTORY_KINDS.map((k) => [k, 0])) as Record<HistoryKind, number>;
  for (const r of byPerson) counts[r.kind]++;

  const kind = filters.kind && filters.kind !== "all" ? filters.kind : null;
  const filtered = kind ? byPerson.filter((r) => r.kind === kind) : byPerson;

  const size = Math.max(1, filters.pageSize ?? HISTORY_PAGE_SIZE);
  const total = filtered.length;
  const pages = Math.max(1, Math.ceil(total / size));
  const page = Math.min(Math.max(1, Math.floor(filters.page ?? 1) || 1), pages);
  const rows = filtered.slice((page - 1) * size, page * size);
  return {
    rows, counts, actors, total, page, pages,
    from: total ? (page - 1) * size + 1 : 0,
    to: (page - 1) * size + rows.length,
  };
}
