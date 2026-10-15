import { fmtDate } from "@/lib/format";

/** Phase 34 (spec §5): labels waiting to print, grouped by registration batch. */
export interface QueueAsset { id: string; tag: string; model: string; purchaseRecordId: string | null; createdAt: Date }
export interface QueueGroup { key: string; recordId: string | null; title: string; range: string; tags: string[]; assetIds: string[]; createdAt: Date }

export function groupLabelQueue(rows: QueueAsset[]): QueueGroup[] {
  const groups = new Map<string, { recordId: string | null; model: string; items: QueueAsset[]; createdAt: Date }>();
  for (const r of rows) {
    const key = r.purchaseRecordId ?? `m:${r.model}:${Math.floor(r.createdAt.getTime() / 60_000)}`;
    const g = groups.get(key) ?? { recordId: r.purchaseRecordId, model: r.model, items: [], createdAt: r.createdAt };
    g.items.push(r);
    if (r.createdAt > g.createdAt) g.createdAt = r.createdAt;
    groups.set(key, g);
  }
  return [...groups.entries()]
    .map(([key, g]) => {
      const items = [...g.items].sort((a, b) => a.tag.localeCompare(b.tag));
      const tags = items.map((i) => i.tag);
      return {
        key, recordId: g.recordId, title: `${items.length} × ${g.model}`,
        range: tags.length === 1 ? tags[0] : `${tags[0]} → ${tags[tags.length - 1]}`,
        tags, assetIds: items.map((i) => i.id), createdAt: g.createdAt,
      };
    })
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

const MANILA = "Asia/Manila";
const dayOf = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: MANILA });

export function whenLabel(at: Date, now: Date): string {
  if (now.getTime() - at.getTime() < 10 * 60_000) return "Just now";
  const today = dayOf(now);
  if (dayOf(at) === today) return "Today";
  const y = new Date(now.getTime() - 86_400_000);
  if (dayOf(at) === dayOf(y)) return "Yesterday";
  return fmtDate(at);
}
