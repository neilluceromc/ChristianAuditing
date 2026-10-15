/** Phase 34 (spec §4.2): the models already registered in a category, each with its in-stock count (no type: Phase 36). */
export interface KnownModel { model: string; inStock: number }

const key = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

export function mergeKnownModels(
  rows: Array<{ model: string; createdAt: Date; inStock: boolean }>,
): KnownModel[] {
  const byKey = new Map<string, { model: string; at: number; inStock: number; first: number }>();
  rows.forEach((r, i) => {
    const k = key(r.model);
    if (!k) return;
    const cur = byKey.get(k);
    const at = r.createdAt.getTime();
    if (!cur) {
      byKey.set(k, { model: r.model.trim().replace(/\s+/g, " "), at, inStock: r.inStock ? 1 : 0, first: i });
      return;
    }
    if (at > cur.at) { cur.at = at; cur.model = r.model.trim().replace(/\s+/g, " "); }
    if (r.inStock) cur.inStock += 1;
  });
  return [...byKey.values()].sort((a, b) => a.first - b.first).map(({ model, inStock }) => ({ model, inStock }));
}

export function matchModels(list: KnownModel[], query: string, limit = 50): KnownModel[] {
  const q = key(query);
  return (q ? list.filter((m) => key(m.model).includes(q)) : list).slice(0, limit);
}
