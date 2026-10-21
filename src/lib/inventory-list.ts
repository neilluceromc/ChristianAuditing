import type { AssetClass, AssetStatus, Prisma } from "@prisma/client";
import type { ListConfig, ListState, SortKey } from "./url-state";
import { isRepairStage } from "./repairs";
import { ASSET_CLASSES, STATUSES_BY_CLASS, VISIBLE_CLASSES, isStatusOf } from "./asset-class";
import type { Role } from "@prisma/client";
import { teamOfRole } from "./intake-rules";
import { parseRegState, regWhere, type RegState } from "./registration";
import { parseProvenance, provenanceWhere, type Provenance } from "./provenance";
import { attentionWhere } from "./inventory-attention";

/**
 * EVERY status of BOTH classes (Phase 13) — the flat list for the places that
 * genuinely mean "any valid value": the zod enums on request payloads in
 * inventory/actions.ts, lifecycle/actions.ts and lifecycle/direct.ts. Those stay
 * at the full list on purpose — the class check on the action is the guard, not
 * the enum. A control that offers statuses to a person must use
 * `statusesFor(cls)` instead; offering DEPLOYED for a car is a bug.
 */
export const ASSET_STATUSES = [
  ...STATUSES_BY_CLASS.IT, ...STATUSES_BY_CLASS.PURCHASING,
] as const satisfies readonly AssetStatus[];

/** Bulk actions cap — shared by the server action and the selection bar UI. */
export const BULK_MAX = 200;

export const INVENTORY_LIST_CONFIG: ListConfig = {
  facets: ["status", "category", "type", "assignee", "stage", "provenance", "reg",
    // Phase 45 (spec §2.1): the Need attention tile, `?attention=1` - a filter, where `sort=attention` is only an order
    "attention",
    // Task 7 (purchase-orders spec §7): the Sent back views, `?reg=needs-correction&to=IT` - the team Finance sent
    // the asset back to (sentBackToWhere); it narrows only the needs-correction state
    "to"],
  facetValues: { attention: ["1"], to: ["IT", "PURCHASING"] },
  sortable: [
    "tag", "model", "category", "status", "purchasedAt", "warrantyUntil",
    // the repairs view's Down column
    "defectiveSince",
    // Phase 30 (spec §6.3, plan P-10): derived, not a column — buildAssetOrderBy never emits it.
    "attention",
  ],
  defaultSort: [{ key: "tag", dir: "asc" }],
};

/** The Need attention filter's chip and facet label (`?attention=1`). */
export const ATTENTION_FACET_LABEL = "Need attention";

/** The `attention` entry of `facetOptions`: one option, so the generic chip loop reads "Need attention", not "1". */
export function attentionFacetOption(count: number): { value: string; label: string; count: number } {
  return { value: "1", label: ATTENTION_FACET_LABEL, count };
}

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

/** The Assigned filter's value for "no holder" (`?assignee=none`). */
export const UNASSIGNED = "none";

/** Phase 36 (spec sec. 4.3): holder ids and/or Unassigned (`none` = assigneeId IS NULL); null when nothing is chosen. */
export function assigneeWhere(values: readonly string[]): Prisma.AssetWhereInput | null {
  const ids = values.filter((v) => v !== UNASSIGNED);
  const none = values.includes(UNASSIGNED);
  if (ids.length && none) return { OR: [{ assigneeId: { in: ids } }, { assigneeId: null }] };
  if (ids.length) return { assigneeId: { in: ids } };
  if (none) return { assigneeId: null };
  return null;
}

/** A team Finance sends assets back to (`?to=`). */
export type SentBackTeam = "IT" | "PURCHASING";

const isSentBackTeam = (t: string): t is SentBackTeam => t === "IT" || t === "PURCHASING";

/**
 * Task 7 (purchase-orders spec §7, fix round 1 ruling): an asset sent back to `team`, from state — the one predicate
 * every Sent back view, nav count and Home card reads, so they cannot drift. Finance returned it and has not
 * approved it, to this team (a return from before teams were recorded went to the class's team: the class and the
 * team share names), and it is not on a PO that is itself sent back — those count once, through the PO. Both classes:
 * Finance sends a Purchasing chair's "Other" to IT, or an IT laptop's money to Purchasing. The PO branch keeps the
 * null case explicit (Task 6 fix round 1: a NOT on the nullable relation also drops every asset with no PO).
 */
export function sentBackToTeamWhere(team: SentBackTeam): Prisma.AssetWhereInput {
  return {
    AND: [
      { financeReturnedAt: { not: null }, financeConfirmedAt: null },
      { OR: [{ financeReturnedTo: team }, { financeReturnedTo: null, cls: team }] },
      { OR: [{ purchaseOrderId: null }, { purchaseOrder: { is: { state: { not: "SENT_BACK" } } } }] },
    ],
  };
}

/** The same predicate on one asset in memory (no PO clause: it decides who may open the asset, not what counts). */
export function isSentBackTo(
  a: { cls: AssetClass; financeReturnedAt: Date | null; financeConfirmedAt: Date | null; financeReturnedTo: string | null },
  team: SentBackTeam,
): boolean {
  return a.financeReturnedAt !== null && a.financeConfirmedAt === null && (a.financeReturnedTo ?? a.cls) === team;
}

/** One registration state's where; with `to`, the needs-correction state is only what went back to those teams. */
export function regFilterWhere(r: RegState, to: readonly string[]): Prisma.AssetWhereInput {
  const teams = to.filter(isSentBackTeam);
  if (r !== "needs-correction" || teams.length === 0) return regWhere(r);
  return { AND: [regWhere(r), { OR: teams.map(sentBackToTeamWhere) }] };
}

/**
 * A Sent back view — `reg=needs-correction` with one `to` team — spans both classes (the ruling): what Finance sent
 * back to a team is that team's to fix whatever its class. Null for every other list state, which keeps its class.
 */
export function sentBackView(state: ListState): SentBackTeam | null {
  const reg = state.filters.reg ?? [];
  const to = (state.filters.to ?? []).filter(isSentBackTeam);
  return reg.length === 1 && reg[0] === "needs-correction" && to.length === 1 ? to[0] : null;
}

/**
 * Who may open a Sent back view: a role that sees every class, or the team it is (IT sees the Purchasing-class assets
 * sent back to IT, and only those, read-only unless it manages the class).
 */
export function canSeeSentBackView(role: Role, team: SentBackTeam): boolean {
  return VISIBLE_CLASSES[role].length === ASSET_CLASSES.length || teamOfRole(role) === team;
}

export function buildAssetWhere(
  state: ListState,
  purchaseYear: PurchaseYearValue | null = null,
  cls: AssetClass = "IT",
  now: Date = new Date(),
): Prisma.AssetWhereInput {
  // Class first: it is applied to every list but one. IT by default
  // so that every consumer and every URL that predates Phase 13 behaves
  // identically — the Purchasing view is the one that has to ask for itself.
  // Task 7 (fix round 1): the one exception is a Sent back view, which spans both classes (its rows are already
  // narrowed to one team's returns); the page checks who may open one (canSeeSentBackView), and the bulk actions
  // refuse a mixed-class selection.
  const where: Prisma.AssetWhereInput = sentBackView(state) ? {} : { cls };
  if (state.q) {
    // contains-search with insensitive mode is the sanctioned use; the
    // ILIKE-wildcard hazard applies to identity/equals lookups only.
    where.OR = [
      { tag: { contains: state.q, mode: "insensitive" } },
      { model: { contains: state.q, mode: "insensitive" } },
      { serial: { contains: state.q, mode: "insensitive" } },
      { assignee: { name: { contains: state.q, mode: "insensitive" } } },
      { assignee: { employeeNo: { contains: state.q, mode: "insensitive" } } },
    ];
  }
  const f = state.filters;
  const statuses = (f.status ?? []).filter((s): s is AssetStatus => isStatusOf(cls, s));
  if (statuses.length) where.status = { in: statuses };
  if (f.category?.length) where.categoryId = { in: f.category };
  if (f.type?.length) where.typeId = { in: f.type };
  // Phase 36 (spec sec. 4.3): holder ids and/or the Unassigned sentinel, appended to AND like the derived facets.
  const holder = assigneeWhere(f.assignee ?? []);
  if (holder) {
    const and = Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : [];
    and.push(holder);
    where.AND = and;
  }
  // `stage` is DERIVED, and one of its four values (beyond-repair) compares
  // repairQuote against cost — something no Prisma filter can express. So the
  // facet narrows to the repair CANDIDATE set here and repairStageIds' SQL
  // CASE makes the final cut (Phase 24: listAssets pages that id set): one
  // source of truth, correct counts.
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
  // Phase 35 (spec §3.1): registration is derived the same way — an OR of where-shapes appended to AND. Task 7: `to`
  // narrows its needs-correction branch to the team Finance sent the asset back to.
  const regs = (f.reg ?? []).map(parseRegState).filter((r): r is RegState => r !== null);
  if (regs.length) {
    const and = Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : [];
    and.push({ OR: regs.map((r) => regFilterWhere(r, f.to ?? [])) });
    where.AND = and;
  }
  // Phase 45 (spec §2.1): the Need attention tile - attentionWhere agrees with attentionOf boundary for boundary,
  // appended to AND like the derived facets above.
  if (f.attention?.includes("1")) {
    const and = Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : [];
    and.push(attentionWhere(now));
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
  // "attention" is derived, not a column — listAssets orders it in memory (plan P-10). Filter first, then fall back.
  const kept = sort.filter((s) => s.key !== "attention");
  const order = kept.length ? kept : INVENTORY_LIST_CONFIG.defaultSort;
  return [
    ...order.map(({ key, dir }): Prisma.AssetOrderByWithRelationInput =>
      key === "category" ? { category: { name: dir } } : { [key]: dir }),
    { id: "asc" },
  ];
}

/**
 * Phase 20 (spec §6.2, plan P-4): `checkIdentifiers`' own where-builder,
 * scoped to one class — a tag or serial belonging to the OTHER class must
 * not leak before submit (that is what "no class information leaks before
 * submit" means); a genuine cross-class collision still surfaces, but only
 * at save time, as the existing neutral P2002 conflict copy. Pure so the
 * scoping rule has a unit test independent of the database the action
 * itself needs.
 */
export function identifierWhere(
  cls: AssetClass, tags: string[], serials: string[],
): { tags: Prisma.AssetWhereInput; serials: Prisma.AssetWhereInput } {
  return {
    tags: { cls, tag: { in: tags } },
    serials: { cls, serial: { in: serials } },
  };
}

/**
 * Spec §7.2 (2026-10-21): the USB scanner contract by URL. Since the search filters as you type, `?q=<exact tag>` on
 * its own only filters; `?q=<tag>&go=1` opens the record (direct links and e2e). The search box's Enter does not use
 * it: it asks the `findExactTag` action and pushes the record (`inventorySearchSubmit`). `stuck-nav.ts`'s
 * ONE_SHOT_PARAMS names the same param, so a navigation the page answers by stripping it counts as committed.
 */
export const SCANNER_GO_PARAM = "go";

/**
 * Where the list page must redirect for the scanner contract, or null to render the list. Without `go=1`: null, and
 * nothing is looked up (a typed or pasted exact tag only filters). With it: the record for an exact tag; otherwise the
 * same list without `go` (stripped after use, so a reload or a shared link never opens a record on its own).
 */
export async function scannerRedirect(
  sp: URLSearchParams,
  q: string,
  lookup: (q: string) => Promise<{ id: string } | null> | null,
  path = "/inventory",
): Promise<string | null> {
  if (sp.get(SCANNER_GO_PARAM) !== "1") return null;
  const hit = q ? await lookup(q) : null;
  if (hit) return `${path}/${hit.id}`;
  const rest = new URLSearchParams(sp);
  rest.delete(SCANNER_GO_PARAM);
  const qs = rest.toString();
  return qs ? `${path}?${qs}` : path;
}
