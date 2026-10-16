/**
 * Phase 38 (spec §3.2): the Equipment by client report's pure rules. One group (a client or an internal
 * department) is summarised from its people — counts, loans, who is missing something (with the profile's numbered
 * labels), the equipped %, and, for Finance and Admin only, cost and book value. Money is never computed unless
 * `withMoney` is true, so a viewer or IT user's payload cannot carry a peso amount.
 */
import { depreciate, depStartMonth, resolvePolicy as resolveDepPolicy, type MonthIndex } from "./depreciation";
import { computeLoadout, numberSlotLabels, type SlotLike } from "./loadout";

export type MoneyRole = "admin" | "it_staff" | "purchasing_staff" | "finance_staff" | "viewer";

/** Only Admin and Finance see peso amounts on this report. */
export function canSeeMoney(role: string): boolean {
  return role === "admin" || role === "finance_staff";
}

export interface ReportAsset {
  id: string;
  tag: string;
  typeId: string | null;
  categoryName: string;
  status: string;
  loanDueAt: Date | null;
  costC: number | null;
  purchasedAt: Date | null;
  financeConfirmedAt: Date | null;
  dep: { lifeMonths: number | null; salvage: number | null; catLifeMonths: number | null; catSalvagePercent: number | null };
}

export interface ReportPerson {
  id: string;
  name: string;
  employeeNo: string;
  title: string;
  /** The person's effective slots in policy order; `name` is the label the profile shows (before numbering). */
  slots: SlotLike[];
  hasPolicy: boolean;
  assets: ReportAsset[];
}

export interface GroupSummary {
  id: string;
  name: string;
  kind: "INTERNAL" | "CLIENT";
  people: number;
  items: number;
  loans: number;
  nextLoanDue: Date | null;
  noPolicy: boolean;
  missing: Array<{ id: string; name: string; employeeNo: string; labels: string[] }>;
  equippedPct: number | null;
  byCategory: Array<{ name: string; count: number; bookC?: number }>;
  money?: { costC: number; bookC: number; perPersonC: number; withoutCost: number };
}

function bookValueC(a: ReportAsset, asOf: MonthIndex): number {
  const cost = a.costC ?? 0;
  const policy = resolveDepPolicy(
    { cost, lifeMonths: a.dep.lifeMonths, salvage: a.dep.salvage },
    { lifeMonths: a.dep.catLifeMonths, salvagePercent: a.dep.catSalvagePercent },
  );
  return depreciate(cost, depStartMonth(a), policy, asOf).bookValue;
}

export function summariseGroup(
  group: { id: string; name: string; kind: "INTERNAL" | "CLIENT"; hasBasePolicy: boolean },
  people: ReportPerson[],
  opts: { withMoney: boolean; asOf: MonthIndex },
): GroupSummary {
  const assets = people.flatMap((p) => p.assets);
  const lent = assets.filter((a) => a.status === "TEMPORARY");
  const dues = lent.flatMap((a) => (a.loanDueAt ? [a.loanDueAt] : []));
  const nextLoanDue = dues.length ? dues.reduce((a, b) => (b.getTime() < a.getTime() ? b : a)) : null;

  const missing: GroupSummary["missing"] = [];
  for (const p of people) {
    const loadout = computeLoadout(p.slots, p.assets.map((a) => ({ id: a.id, tag: a.tag, model: "", typeId: a.typeId, status: a.status })));
    // Someone no policy applies to is never "missing something", whatever slots were passed.
    if (!p.hasPolicy || loadout.missingRequired === 0) continue;
    // Numbered over every slot in policy order, exactly as the profile does, then only the empty required gaps are kept.
    const labels = numberSlotLabels(loadout.slots.map((s) => s.slot.name));
    missing.push({
      id: p.id, name: p.name, employeeNo: p.employeeNo,
      labels: loadout.slots.flatMap((s, i) => (!s.asset && s.slot.required && !s.coveredByLoan ? [labels[i]] : [])),
    });
  }

  // Spec §3.2: no policy means no base policy for the group and no rule matching anyone in it.
  const noPolicy = !group.hasBasePolicy && !people.some((p) => p.hasPolicy);
  const equippedPct = noPolicy ? null : people.length === 0 ? 100 : Math.round((100 * (people.length - missing.length)) / people.length);

  const books = new Map<string, { count: number; bookC: number }>();
  let costC = 0;
  let bookC = 0;
  let withoutCost = 0;
  for (const a of assets) {
    const row = books.get(a.categoryName) ?? { count: 0, bookC: 0 };
    row.count += 1;
    if (opts.withMoney) {
      const book = bookValueC(a, opts.asOf);
      row.bookC += book;
      bookC += book;
      costC += a.costC ?? 0;
      if (a.costC === null) withoutCost += 1;
    }
    books.set(a.categoryName, row);
  }
  const byCategory = [...books.entries()]
    .map(([name, v]) => (opts.withMoney ? { name, count: v.count, bookC: v.bookC } : { name, count: v.count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  const summary: GroupSummary = {
    id: group.id, name: group.name, kind: group.kind,
    people: people.length, items: assets.length, loans: lent.length, nextLoanDue,
    noPolicy, missing, equippedPct, byCategory,
  };
  if (opts.withMoney) {
    summary.money = { costC, bookC, perPersonC: Math.round(bookC / Math.max(people.length, 1)), withoutCost };
  }
  return summary;
}

// ── The table's rules (spec §3.3): filters with counts, search and sort, run in the browser over one tab's rows ──

export type ReportFilter = "all" | "gaps" | "nopol";
export type ReportSort = "name" | "people" | "items" | "book" | "equipped";

const matchesFilter = (g: GroupSummary, f: ReportFilter): boolean =>
  f === "gaps" ? g.missing.length > 0 : f === "nopol" ? g.noPolicy : true;

export function reportFilterCounts(rows: GroupSummary[]): Record<ReportFilter, number> {
  return { all: rows.length, gaps: rows.filter((g) => matchesFilter(g, "gaps")).length, nopol: rows.filter((g) => matchesFilter(g, "nopol")).length };
}

/** A case-insensitive substring of the name, then the filter button's cut. */
export function filterReportGroups(rows: GroupSummary[], f: { q: string; filter: ReportFilter }): GroupSummary[] {
  const q = f.q.trim().toLowerCase();
  return rows.filter((g) => matchesFilter(g, f.filter) && (!q || g.name.toLowerCase().includes(q)));
}

const byName = (a: GroupSummary, b: GroupSummary) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });

/** Name in natural order; numbers with the name breaking ties; a no-policy row has no Equipped value and sorts last either way. */
export function sortReportGroups(rows: GroupSummary[], sort: ReportSort, dir: 1 | -1): GroupSummary[] {
  const num = (g: GroupSummary): number =>
    sort === "people" ? g.people : sort === "items" ? g.items : sort === "book" ? (g.money?.bookC ?? 0) : (g.equippedPct ?? 0);
  return [...rows].sort((a, b) => {
    if (sort === "name") return byName(a, b) * dir;
    if (sort === "equipped" && (a.equippedPct === null) !== (b.equippedPct === null)) return a.equippedPct === null ? 1 : -1;
    return (num(a) - num(b)) * dir || byName(a, b);
  });
}

/** Book value descending for money roles, People descending otherwise. */
export function defaultReportSort(withMoney: boolean): { sort: ReportSort; dir: 1 | -1 } {
  return { sort: withMoney ? "book" : "people", dir: -1 };
}

/** Equipped: green at 100%, amber at 80% or more, red below that; no colour (shown as "—") for no policy. */
export function equippedTone(pct: number | null): "settled" | "attention" | "fault" | null {
  if (pct === null) return null;
  return pct >= 100 ? "settled" : pct >= 80 ? "attention" : "fault";
}
