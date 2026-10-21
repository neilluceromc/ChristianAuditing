import { ENTITY_PAGE_SIZE, PER_PAGE_OPTIONS } from "./paging";

/**
 * URL search params are the source of truth for list state (brief §3.2).
 * Contract: `q` free text · one comma-joined param per facet · `sort` like
 * `-purchasedAt,model` (max 2 keys, `-` = desc) · `page` 1-based · `per` rows per page (25/50/100, default 25).
 * Column visibility is per-user preference, NOT here.
 */
export interface SortKey {
  key: string;
  dir: "asc" | "desc";
}

export interface ListState {
  q: string;
  page: number;
  /** rows per page, one of PER_PAGE_OPTIONS (Phase 45); only Inventory and Employees read it */
  per: number;
  sort: SortKey[];
  filters: Record<string, string[]>;
}

export interface ListConfig {
  facets: string[];
  /** facets whose values are a closed set (e.g. a flag `attention=1`): any other value parses as absent */
  facetValues?: Record<string, readonly string[]>;
  sortable: string[];
  defaultSort: SortKey[];
}

export const MAX_SORT_KEYS = 2;

export function parseListState(params: URLSearchParams, config: ListConfig): ListState {
  const filters: Record<string, string[]> = {};
  for (const facet of config.facets) {
    const raw = params.get(facet);
    if (!raw) continue;
    const allowedValues = config.facetValues?.[facet];
    const values = raw.split(",").map((v) => v.trim()).filter(Boolean)
      .filter((v) => !allowedValues || allowedValues.includes(v));
    if (values.length) filters[facet] = values;
  }

  const sort: SortKey[] = (params.get("sort") ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part): SortKey => (part.startsWith("-")
      ? { key: part.slice(1), dir: "desc" }
      : { key: part, dir: "asc" }))
    .filter((s) => config.sortable.includes(s.key))
    .slice(0, MAX_SORT_KEYS);

  const page = Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1);

  const rawPer = Number(params.get("per"));
  const per = (PER_PAGE_OPTIONS as readonly number[]).includes(rawPer) ? rawPer : ENTITY_PAGE_SIZE;

  return {
    q: (params.get("q") ?? "").trim(),
    page,
    per,
    sort: sort.length ? sort : config.defaultSort,
    filters,
  };
}

function sameSort(a: SortKey[], b: SortKey[]): boolean {
  return a.length === b.length && a.every((s, i) => s.key === b[i].key && s.dir === b[i].dir);
}

/** Stable order: q, facets (config order), sort, page, per. Defaults are omitted. */
export function serializeListState(state: ListState, config: ListConfig): string {
  const params = new URLSearchParams();
  if (state.q) params.set("q", state.q);
  for (const facet of config.facets) {
    const values = state.filters[facet];
    if (values?.length) params.set(facet, values.join(","));
  }
  if (!sameSort(state.sort, config.defaultSort)) {
    params.set("sort", state.sort.map((s) => (s.dir === "desc" ? `-${s.key}` : s.key)).join(","));
  }
  if (state.page > 1) params.set("page", String(state.page));
  if (state.per !== ENTITY_PAGE_SIZE) params.set("per", String(state.per));
  const qs = params.toString();
  // URLSearchParams percent-encodes commas; keep them readable — they're safe in queries.
  return qs ? `?${qs.replaceAll("%2C", ",")}` : "";
}

/**
 * Header-click cycle: new key → primary asc (old primary demotes, max 2) ·
 * primary asc → desc · primary desc → removed (secondary promotes) ·
 * secondary → promoted keeping its direction.
 */
export function toggleSort(sort: SortKey[], key: string): SortKey[] {
  const [primary, secondary] = sort;
  if (primary?.key === key) {
    if (primary.dir === "asc") return [{ key, dir: "desc" }, ...(secondary ? [secondary] : [])];
    return secondary ? [secondary] : [];
  }
  if (secondary?.key === key) return [secondary, primary];
  return [{ key, dir: "asc" as const }, ...(primary ? [primary] : [])].slice(0, MAX_SORT_KEYS);
}

/**
 * A derived sort key (Loadout on people, Attention on inventory) is ordered in
 * memory, and only when it is the PRIMARY key: once a header click demotes it
 * to secondary, the clicked column must really order the rows (Phase 30 I-2,
 * Phase 31 for the Loadout twin). The SQL order builders drop it either way.
 */
export function primarySortOf(sort: SortKey[], key: string): SortKey | undefined {
  return sort[0]?.key === key ? sort[0] : undefined;
}

export function withFilter(state: ListState, facet: string, values: string[]): ListState {
  const filters = { ...state.filters };
  if (values.length) filters[facet] = values;
  else delete filters[facet];
  return { ...state, filters, page: 1 };
}

/** Picking a sort starts over at page 1; search and filters stay. */
export function withSort(state: ListState, sort: SortKey[]): ListState {
  return { ...state, sort, page: 1 };
}

export function withSearch(state: ListState, q: string): ListState {
  return { ...state, q: q.trim(), page: 1 };
}

/** Changing the page size starts over at page 1. */
export function withPer(state: ListState, per: number): ListState {
  return { ...state, per, page: 1 };
}

export function clearFilters(state: ListState): ListState {
  return { ...state, q: "", filters: {}, page: 1 };
}

/**
 * Phase 45 (spec §3.4): the `ids` param of a bulk action - comma-joined, trimmed, deduped (first position kept).
 * More than `max` distinct ids is "over": the caller refuses, it never slices.
 */
export function parseIdsParam(sp: URLSearchParams, max: number): string[] | "over" {
  const ids = [...new Set((sp.get("ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean))];
  return ids.length > max ? "over" : ids;
}

/** Next 15 gives pages a plain record; normalize to URLSearchParams. */
export function toSearchParams(sp: Record<string, string | string[] | undefined>): URLSearchParams {
  const out = new URLSearchParams();
  for (const [key, value] of Object.entries(sp)) {
    if (typeof value === "string") out.set(key, value);
    else if (Array.isArray(value) && value.length) out.set(key, value[value.length - 1]);
  }
  return out;
}
