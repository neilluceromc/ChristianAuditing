/**
 * URL search params are the source of truth for list state (brief §3.2).
 * Contract: `q` free text · one comma-joined param per facet · `sort` like
 * `-purchasedAt,model` (max 2 keys, `-` = desc) · `page` 1-based.
 * Column visibility is per-user preference, NOT here.
 */
export interface SortKey {
  key: string;
  dir: "asc" | "desc";
}

export interface ListState {
  q: string;
  page: number;
  sort: SortKey[];
  filters: Record<string, string[]>;
}

export interface ListConfig {
  facets: string[];
  sortable: string[];
  defaultSort: SortKey[];
}

export const MAX_SORT_KEYS = 2;

export function parseListState(params: URLSearchParams, config: ListConfig): ListState {
  const filters: Record<string, string[]> = {};
  for (const facet of config.facets) {
    const raw = params.get(facet);
    if (!raw) continue;
    const values = raw.split(",").map((v) => v.trim()).filter(Boolean);
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

  return {
    q: (params.get("q") ?? "").trim(),
    page,
    sort: sort.length ? sort : config.defaultSort,
    filters,
  };
}

function sameSort(a: SortKey[], b: SortKey[]): boolean {
  return a.length === b.length && a.every((s, i) => s.key === b[i].key && s.dir === b[i].dir);
}

/** Stable order: q, facets (config order), sort, page. Defaults are omitted. */
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

export function withFilter(state: ListState, facet: string, values: string[]): ListState {
  const filters = { ...state.filters };
  if (values.length) filters[facet] = values;
  else delete filters[facet];
  return { ...state, filters, page: 1 };
}

export function withSearch(state: ListState, q: string): ListState {
  return { ...state, q: q.trim(), page: 1 };
}

export function clearFilters(state: ListState): ListState {
  return { ...state, q: "", filters: {}, page: 1 };
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
