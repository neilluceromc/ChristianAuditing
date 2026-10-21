import type { Prisma } from "@prisma/client";

/**
 * Spec §7.2 (2026-10-21): while a list is searched, the matches that START WITH the text come first, then the ones
 * that only contain it, each group in the list's chosen sort. Inventory, Finance → Assets and Employees use these.
 *
 * The starts-with test is plain string work on values the search already read — never a LIKE pattern — so a `%` or
 * `_` in the text is taken literally and there is nothing to escape.
 */

/** True when any of `values` starts with `q` (trimmed, case-insensitive). An empty search ranks nothing first. */
export function startsWithAny(q: string, values: ReadonlyArray<string | null | undefined>): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return false;
  return values.some((v) => typeof v === "string" && v.toLowerCase().startsWith(needle));
}

/**
 * The asset fields a starts-with match is judged on (spec §7.2 table: Inventory and Finance → Assets alike): tag,
 * model, serial and holder name. One list, so the two lists cannot drift apart.
 */
export interface AssetStartsWithFields {
  tag: string;
  model: string;
  serial: string | null;
  holder: string | null | undefined;
}
export function assetStartsWith(q: string, a: AssetStartsWithFields): boolean {
  return startsWithAny(q, [a.tag, a.model, a.serial, a.holder]);
}

/** The search's narrow read of the matching assets: their id and the starts-with fields. */
export const ASSET_SEARCH_HIT_SELECT = {
  id: true, tag: true, model: true, serial: true, assignee: { select: { name: true } },
} as const satisfies Prisma.AssetSelect;
export type AssetSearchHit = Prisma.AssetGetPayload<{ select: typeof ASSET_SEARCH_HIT_SELECT }>;

/** `assetStartsWith` for a row read with ASSET_SEARCH_HIT_SELECT. */
export function assetHitStartsWith(q: string, h: AssetSearchHit): boolean {
  return assetStartsWith(q, { ...h, holder: h.assignee?.name });
}

/** A stable ranking: rows by `tierOf` (lowest first), each tier keeping the order given. */
export function rankFirst<T>(rows: readonly T[], tierOf: (row: T) => number): T[] {
  return rows.map((row, i) => ({ row, i, t: tierOf(row) })).sort((a, b) => a.t - b.t || a.i - b.i).map((x) => x.row);
}

/** A stable partition: the rows `isPrefix` picks, then the rest, each in the order given. */
export function prefixFirst<T>(rows: readonly T[], isPrefix: (row: T) => boolean): T[] {
  return rankFirst(rows, (r) => (isPrefix(r) ? 0 : 1));
}

/** The id filter one read of a group applies on top of the list's own where (null: no extra filter). */
export type GroupIds = { in: string[] } | { notIn: string[] } | null;

/**
 * One page of a list ranked starts-with first, read from the database in the list's own order. The list is the
 * ranked tiers in turn (`tiers`: disjoint id sets, already known from the search's narrow pass — usually one, the
 * starts-with matches) followed by the rest, so the page window [skip, skip + take) is cut across them and each part
 * is one ordinary ordered read (`read`: the list's where AND `id` in the tier / not in any tier, with its orderBy,
 * skip and take). A window inside one group is one read; one that straddles a boundary is one per group it touches.
 * With no ranked id at all it is the plain read.
 */
export async function prefixFirstPage<T>(
  tiers: string[][],
  total: number,
  window: { skip: number; take: number },
  read: (ids: GroupIds, w: { skip: number; take: number }) => Promise<T[]>,
): Promise<T[]> {
  const ranked = tiers.filter((t) => t.length > 0);
  if (ranked.length === 0) return read(null, window);
  const all = ranked.flat();
  const groups: Array<{ ids: GroupIds; size: number }> = [
    ...ranked.map((t) => ({ ids: { in: t }, size: t.length })),
    { ids: { notIn: all }, size: Math.max(0, total - all.length) },
  ];
  const from = window.skip;
  const to = window.skip + window.take;
  const out: T[] = [];
  let start = 0;
  // one after the other, not in parallel: the reads share one interactive transaction (pagedSnapshot's snapshot)
  for (const g of groups) {
    const lo = Math.max(from, start);
    const hi = Math.min(to, start + g.size);
    if (hi > lo) out.push(...(await read(g.ids, { skip: lo - start, take: hi - lo })));
    start += g.size;
  }
  return out;
}
