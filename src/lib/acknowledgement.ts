export interface AckItem { assetId: string; tag: string; model: string; serial: string | null }

/** Held items the last signed form does not cover. With no form on file, all of them. */
export function uncoveredItems<A extends { assetId: string; tag: string }>(held: A[], last: Array<{ assetId: string }> | null): A[] {
  if (!last) return held;
  const covered = new Set(last.map((i) => i.assetId));
  return held.filter((h) => !covered.has(h.assetId));
}
