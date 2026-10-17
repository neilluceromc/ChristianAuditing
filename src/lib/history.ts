import { actionLabel, auditSentence, fieldLabel, viaSuffix } from "./activity";
import { fmtDayMonthYear } from "./format";
import { statusLabel } from "./asset-class";
import { EMPLOYMENT_LABEL } from "./labels";

export interface AuditEntryLike {
  id: string;
  actorLabel: string;
  action: string;
  createdAt: Date;
  diff: unknown;
}

export interface HistoryRow {
  key: string;
  at: Date;
  actor: string;
  /** the action's words ("Assigned"), not its code */
  action: string;
  /** the field's words ("Category"), not its key */
  field: string;
  from: string;
  to: string;
  /** first row of its entry — later rows render with dimmed timestamp/actor */
  first: boolean;
}

/**
 * Phase 40 (spec §2.4): the names a page resolved for the ids its entries mention, one map per kind. The
 * `employee` map is keyed by employee id AND employee number: an edit records `assigneeId` (an id) and a lifecycle
 * change records `assignee` (the number, or the id when the number was unknown).
 */
export interface HistoryNames {
  category: Map<string, string>;
  type: Map<string, string>;
  vendor: Map<string, string>;
  employee: Map<string, string>;
}

export function emptyNames(): HistoryNames {
  return { category: new Map(), type: new Map(), vendor: new Map(), employee: new Map() };
}

const REMOVED = "(removed)";
const BLANK = "—";

/** Which name map each id-carrying diff key reads. `assignee` is the lifecycle's spelling of the holder. */
const ID_KIND: Record<string, keyof HistoryNames> = {
  categoryId: "category", typeId: "type", vendorId: "vendor", assigneeId: "employee", assignee: "employee",
  // a reservation audits `hold` as the employee number (reservations/actions.ts)
  hold: "employee",
};
/** Keys whose value is an employee number or a name already when it does not resolve: shown as written, not "(removed)". */
const KEEPS_UNRESOLVED = new Set(["assignee", "hold"]);

// Only these keys hold dates: a serial or a name that happens to look like one is left alone.
const DATE_KEY = /(?:At|Until|Since|Due|Date)$/;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

// A whole ISO date, or date-time with an optional zone; anything else (a serial, "2026-13-45") is just text.
const ISO = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
const timeFmt = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Manila" });

/** "5 Jan 2026" for a day (stored at UTC midnight), "16 Aug 2026 17:41" for a real time — both in Asia/Manila. */
function formatDate(d: Date): string | null {
  if (Number.isNaN(d.getTime())) return null;
  const day = fmtDayMonthYear(d);
  const midnight = d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0;
  return midnight ? day : `${day} ${timeFmt.format(d)}`;
}

/** The send-back's value: `{ fields: <checklist labels>, note }` (inventory/actions.ts, `finance.return`). */
function isSendBack(v: Record<string, unknown>): v is { fields: unknown[]; note?: unknown } {
  return Array.isArray(v.fields) && v.fields.every((x) => typeof x === "string") && Object.keys(v).every((k) => k === "fields" || k === "note");
}

/**
 * One diff value in words. Ids become names ("(removed)" when the id no longer exists), dates read in Asia/Manila,
 * booleans Yes/No, empties "—", and an object never prints as "[object Object]": the Finance send-back reads as its
 * checklist labels plus its note, anything else as a short `key: value` list.
 */
export function formatHistoryValue(key: string, value: unknown, names: HistoryNames): string {
  if (value === null || value === undefined || value === "") return BLANK;
  const kind = ID_KIND[key];
  if (kind && typeof value === "string") {
    const name = names[kind].get(value);
    if (name !== undefined) return name;
    return KEEPS_UNRESOLVED.has(key) ? value : REMOVED;
  }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (value instanceof Date) return formatDate(value) ?? String(value);
  if (typeof value === "string") {
    if (DATE_KEY.test(key) && ISO.test(value)) return formatDate(new Date(value)) ?? value;
    // Phase 40 §6: statuses and employment read as their words ("Loan", "Leaving"), never the enum.
    if (key === "status") return statusLabel(value);
    if (key === "employment") return Object.hasOwn(EMPLOYMENT_LABEL, value) ? EMPLOYMENT_LABEL[value as keyof typeof EMPLOYMENT_LABEL] : value;
    return value;
  }
  if (Array.isArray(value)) {
    const items = value.map((v) => formatHistoryValue(key, v, names)).filter((s) => s !== BLANK);
    return items.length ? items.join(", ") : BLANK;
  }
  if (isRecord(value)) {
    if (isSendBack(value)) {
      const items = value.fields.map(String).join(", ");
      const note = typeof value.note === "string" ? value.note : "";
      if (items && note) return `${items} — ${note}`;
      return items || note || BLANK;
    }
    const pairs = Object.entries(value).map(([k, v]) => `${k}: ${formatHistoryValue(k, v, names)}`);
    return pairs.length ? pairs.join("; ") : BLANK;
  }
  return String(value);
}

/** Phase 40: the shared FIELD_LABELS (an unknown key splits its camelCase), capitalised for a column cell. */
export function historyFieldLabel(key: string): string {
  const label = fieldLabel(key);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

type Diff = Record<string, { from: unknown; to: unknown }>;

/** The ids (and employee numbers) these entries mention, by kind — what a page resolves, one query per kind. */
export function historyNameIds(entries: AuditEntryLike[]): { category: string[]; type: string[]; vendor: string[]; employee: string[] } {
  const found: Record<keyof HistoryNames, Set<string>> = { category: new Set(), type: new Set(), vendor: new Set(), employee: new Set() };
  for (const entry of entries) {
    if (!isRecord(entry.diff)) continue;
    for (const [key, change] of Object.entries(entry.diff as Diff)) {
      const kind = ID_KIND[key];
      if (!kind || !isRecord(change)) continue;
      for (const v of [change.from, change.to]) if (typeof v === "string" && v !== "") found[kind].add(v);
    }
  }
  return {
    category: [...found.category], type: [...found.type], vendor: [...found.vendor], employee: [...found.employee],
  };
}

/** "One row per field, not per save. Two rows sharing a timestamp were one action." */
export function historyRows(entries: AuditEntryLike[], names: HistoryNames): HistoryRow[] {
  const rows: HistoryRow[] = [];
  for (const entry of entries) {
    const diff = (entry.diff ?? null) as Diff | null;
    const fields = diff ? Object.keys(diff) : [];
    const action = actionLabel(entry.action);
    if (fields.length === 0) {
      rows.push({
        key: entry.id, at: entry.createdAt, actor: entry.actorLabel, action,
        field: BLANK, from: BLANK, to: BLANK, first: true,
      });
      continue;
    }
    fields.forEach((field, i) => {
      rows.push({
        key: `${entry.id}:${field}`, at: entry.createdAt, actor: entry.actorLabel, action,
        field: historyFieldLabel(field),
        from: formatHistoryValue(field, diff![field]?.from, names),
        to: formatHistoryValue(field, diff![field]?.to, names),
        first: i === 0,
      });
    });
  }
  return rows;
}

export interface HistoryEntryGroup {
  key: string;
  at: Date;
  actor: string;
  action: string;
  /** one per changed field, in the diff's order; a diff-less entry has the single "—" row */
  fields: HistoryRow[];
}

/** Phase 39 (spec §5): the page's entries, each with its field rows together, so a long entry can fold. */
export function historyEntries(entries: AuditEntryLike[], names: HistoryNames): HistoryEntryGroup[] {
  return entries.map((entry) => {
    const fields = historyRows([entry], names);
    return { key: entry.id, at: entry.createdAt, actor: entry.actorLabel, action: actionLabel(entry.action), fields };
  });
}

/** A lifecycle `assignee` or a reservation `hold` is an employee number (or id); swap in the name when the page resolved it. */
function withHolderNamed(diff: unknown, employees: Map<string, string>): unknown {
  if (!isRecord(diff)) return diff;
  const named = (v: unknown) => (typeof v === "string" ? (employees.get(v) ?? v) : v);
  const out: Record<string, unknown> = { ...diff };
  for (const key of ["assignee", "hold"]) {
    const change = diff[key];
    if (isRecord(change)) out[key] = { from: named(change.from), to: named(change.to) };
  }
  return out;
}

/**
 * Phase 40 (spec §2.4): one asset-timeline row's words — the shared audit sentence minus its actor (the row
 * bolds the actor) and minus the tag (this is that tag's own page), with a holder named rather than numbered.
 * An action the sentence builder has no wording for falls back to the shared action label, never its raw code.
 */
export function timelinePhrase(
  entry: { actorLabel: string; action: string; diff: unknown },
  tag: string,
  employees: Map<string, string>,
): string {
  const phrase = auditSentence(
    { actorLabel: entry.actorLabel, action: entry.action, diff: withHolderNamed(entry.diff, employees), entityLabel: tag },
    { omitActor: true, omitEntity: true },
  );
  // Phase 41: the fallback compares without the "(via Cris)" ending auditSentence adds, then puts it back
  const via = viaSuffix(entry.diff);
  return phrase === entry.action + via ? actionLabel(entry.action) + via : phrase;
}
