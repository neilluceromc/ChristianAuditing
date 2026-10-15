/** Phase 34 (spec §4.2): the models already registered in a category, each with the type it sets. */
export interface KnownModel { model: string; typeId: string | null; inStock: number }

const key = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

export function mergeKnownModels(
  rows: Array<{ model: string; typeId: string | null; createdAt: Date; inStock: boolean }>,
): KnownModel[] {
  const byKey = new Map<string, { model: string; typeId: string | null; at: number; inStock: number; first: number }>();
  rows.forEach((r, i) => {
    const k = key(r.model);
    if (!k) return;
    const cur = byKey.get(k);
    const at = r.createdAt.getTime();
    if (!cur) {
      byKey.set(k, { model: r.model.trim().replace(/\s+/g, " "), typeId: r.typeId, at, inStock: r.inStock ? 1 : 0, first: i });
      return;
    }
    if (at > cur.at) { cur.at = at; cur.typeId = r.typeId; cur.model = r.model.trim().replace(/\s+/g, " "); }
    if (r.inStock) cur.inStock += 1;
  });
  return [...byKey.values()].sort((a, b) => a.first - b.first).map(({ model, typeId, inStock }) => ({ model, typeId, inStock }));
}

export function matchModels(list: KnownModel[], query: string, limit = 50): KnownModel[] {
  const q = key(query);
  return (q ? list.filter((m) => key(m.model).includes(q)) : list).slice(0, limit);
}

export function resolveModelType(list: KnownModel[], model: string): { known: true; typeId: string | null } | { known: false } {
  const k = key(model);
  const hit = k ? list.find((m) => key(m.model) === k) : undefined;
  return hit ? { known: true, typeId: hit.typeId } : { known: false };
}
