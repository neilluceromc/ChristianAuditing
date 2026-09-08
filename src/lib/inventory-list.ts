import type { AssetClass, AssetStatus, Prisma } from "@prisma/client";
import type { ListConfig, ListState, SortKey } from "./url-state";
import { isRepairStage } from "./repairs";
import { STATUSES_BY_CLASS, isStatusOf } from "./asset-class";
import { parseProvenance, provenanceWhere, type Provenance } from "./provenance";

/**
 * EVERY status of BOTH classes (Phase 13) — the flat list for the places that
 * genuinely mean "any valid value": the two zod enums on request payloads in
 * inventory/actions.ts. Those stay at fourteen on purpose — the class check on
 * the action is the guard, not the enum. A control that offers statuses to a
 * person must use `statusesFor(cls)` instead; offering DEPLOYED for a car is a bug.
 *
 * Every other reader is a known intermediate state, not a second legitimate
 * use: three pickers (request-status-change, bulk-drawer, finance/assets) that
 * Tasks 7-9 move to `statusesFor(cls)`; finance/queries.ts's `parseAssetStatus`, which
 * Task 9 makes class-aware; and the import wizard's status check and error
 * text (import-assets.ts, import-vocabulary.ts), which Task 10 narrows to IT.
 */
export const ASSET_STATUSES = [
  ...STATUSES_BY_CLASS.IT, ...STATUSES_BY_CLASS.PURCHASING,
] as const satisfies readonly AssetStatus[];

/** Bulk actions cap — shared by the server action and the selection bar UI. */
export const BULK_MAX = 200;

export const INVENTORY_LIST_CONFIG: ListConfig = {
  facets: ["status", "category", "type", "assignee", "stage", "provenance"],
  sortable: [
    "tag", "model", "category", "status", "purchasedAt", "warrantyUntil",
    // the repairs view's Down column
    "defectiveSince",
  ],
  defaultSort: [{ key: "tag", dir: "asc" }],
};

/** A single year, or the literal bucket for assets with no `purchasedAt` at all. */
export type PurchaseYearValue = number | "none";

/**
 * `?purchaseYear=` names a nav destination — one of the split-by-year chips
 * above `/inventory` — a single value, not a comma-joined multi-select. Same
 * shape as `?state=` on `/purchases` (see `purchases-list.ts`'s
 * `parsePurchaseState`): parsed on its own, and deliberately NOT registered
 * in `INVENTORY_LIST_CONFIG.facets` — a real multi-select there would let
 * `?purchaseYear=2024,2025` silently mean two years, which is not what a nav
 * chip is. Invalid input silently parses to `null` (no filter), matching how
 * every other facet parser in this module fails open rather than throwing.
 */
export function parsePurchaseYear(raw: string | null | undefined): PurchaseYearValue | null {
  if (raw === "none") return "none";
  if (raw != null && /^\d{4}$/.test(raw)) return Number(raw);
  return null;
}

/**
 * `purchaseYear` rides outside `serializeListState` on purpose (it is not a
 * config facet — see `parsePurchaseYear`), but the page's Export link, the
 * bulk drawer's "act on all matching" and the toolbar's own year chips all
 * need it appended onto an already-serialized list-state query string the
 * same way. One owner, so there is exactly one place that splices it in.
 */
export function withPurchaseYearQS(qs: string, purchaseYear: PurchaseYearValue | null): string {
  if (purchaseYear === null) return qs;
  const value = purchaseYear === "none" ? "none" : String(purchaseYear);
  return qs ? `${qs}&purchaseYear=${value}` : `?purchaseYear=${value}`;
}

export interface YearChip {
  year: number | null;
  count: number;
  label: string;
  href: string;
}

/**
 * Newest year first, `null` (no purchase date) last. The count rides on the
 * chip so the toolbar can size it — a chip that does not say how many rows
 * it would leave is not an answer to the export cap refusal that points at
 * it (`capRefusalText`, `src/lib/export-columns.ts`).
 *
 * `href` here is the bare nav destination, built from nothing but the year —
 * this function is pure and knows nothing about the page's other active
 * filters. The toolbar builds the real link with `withPurchaseYearQS` so a
 * click preserves whatever else is filtered; this field exists so the chip
 * has a sane destination even considered on its own.
 */
export function purchaseYearChips(buckets: Array<{ year: number | null; count: number }>): YearChip[] {
  const dated = buckets.filter((b) => b.year !== null).sort((a, b) => b.year! - a.year!);
  const undated = buckets.filter((b) => b.year === null);
  return [...dated, ...undated].map((b) => ({
    year: b.year,
    count: b.count,
    label: b.year === null ? "No date" : String(b.year),
    href: `/inventory?purchaseYear=${b.year === null ? "none" : b.year}`,
  }));
}

export function buildAssetWhere(
  state: ListState,
  purchaseYear: PurchaseYearValue | null = null,
  cls: AssetClass = "IT",
): Prisma.AssetWhereInput {
  // Class first: it is the one filter that is ALWAYS applied. IT by default
  // so that every consumer and every URL that predates Phase 13 behaves
  // identically — the Purchasing view is the one that has to ask for itself.
  const where: Prisma.AssetWhereInput = { cls };
  if (state.q) {
    // contains-search with insensitive mode is the sanctioned use; the
    // ILIKE-wildcard hazard applies to identity/equals lookups only.
    where.OR = [
      { tag: { contains: state.q, mode: "insensitive" } },
      { model: { contains: state.q, mode: "insensitive" } },
      { serial: { contains: state.q, mode: "insensitive" } },
    ];
  }
  const f = state.filters;
  const statuses = (f.status ?? []).filter((s): s is AssetStatus => isStatusOf(cls, s));
  if (statuses.length) where.status = { in: statuses };
  if (f.category?.length) where.categoryId = { in: f.category };
  if (f.type?.length) where.typeId = { in: f.type };
  if (f.assignee?.length) where.assigneeId = { in: f.assignee };
  // `stage` is DERIVED, and one of its four values (beyond-repair) compares
  // repairQuote against cost — something no Prisma filter can express. So the
  // facet narrows to the repair CANDIDATE set here and repairStage() makes the
  // final cut in listAssets: one source of truth, correct counts.
  // AND coexists with the q-driven OR above; Prisma ands them together.
  if ((f.stage ?? []).some(isRepairStage)) {
    // append, not assign: nothing else sets AND today, but an assignment here
    // is one new facet away from silently dropping someone else's clause.
    // Prisma types AND as object-or-array, so normalise before appending.
    const and = Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : [];
    and.push({ OR: [{ status: "DEFECTIVE" }, { defectiveSince: { not: null } }] });
    where.AND = and;
  }
  // Phase 18 spec §6: provenance is DERIVED (request link, importedAt), so the
  // facet is an OR of where-shapes, appended to AND exactly as the stage facet
  // does — never assigned, so neither clause can drop the other.
  const provenances = (f.provenance ?? []).map(parseProvenance).filter((p): p is Provenance => p !== null);
  if (provenances.length) {
    const and = Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : [];
    and.push({ OR: provenances.map(provenanceWhere) });
    where.AND = and;
  }
  // purchaseYear is fully expressible in SQL — a straight range on
  // purchasedAt, or an is-null check for "none" — so unlike the stage facet
  // above it needs NO in-memory candidate-set cut. `repairStageIds` exists
  // because beyond-repair compares repairQuote against cost, which no Prisma
  // filter can express; nothing about a year range has that problem, so
  // there is no analogous "purchaseYearIds" and none is needed for any of
  // this where's consumers (list, facet counts, export, bulk) to stay
  // correct — putting the cut here is enough for all of them at once.
  if (purchaseYear === "none") {
    where.purchasedAt = null;
  } else if (typeof purchaseYear === "number") {
    where.purchasedAt = {
      gte: new Date(Date.UTC(purchaseYear, 0, 1)),
      lt: new Date(Date.UTC(purchaseYear + 1, 0, 1)),
    };
  }
  return where;
}

export function buildAssetOrderBy(sort: SortKey[]): Prisma.AssetOrderByWithRelationInput[] {
  const order = sort.length ? sort : INVENTORY_LIST_CONFIG.defaultSort;
  return [
    ...order.map(({ key, dir }): Prisma.AssetOrderByWithRelationInput =>
      key === "category" ? { category: { name: dir } } : { [key]: dir }),
    { id: "asc" },
  ];
}
