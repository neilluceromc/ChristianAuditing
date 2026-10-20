import { prisma } from "@/server/db/client";
import { addDays, dayFromISO } from "@/lib/deadlines";
import { HISTORY_SPAN_DAYS, historyFromRows, manilaDay, type SnapshotKey } from "@/lib/snapshot";

/**
 * Spec §2.4: per key, the 8 weekly points (today-7·k, k = 7…0, oldest first) from MetricSnapshot, one read for every
 * key. A key with no rows gets 8 nulls ("collecting history"), never zeros.
 */
export async function metricHistory<K extends SnapshotKey>(keys: K[], now: Date): Promise<Record<K, (number | null)[]>> {
  const today = manilaDay(now);
  const wanted = [...new Set(keys)];
  const rows = wanted.length
    ? await prisma.metricSnapshot.findMany({
        where: { key: { in: wanted }, day: { gte: dayFromISO(addDays(today, -HISTORY_SPAN_DAYS)), lte: dayFromISO(today) } },
        select: { day: true, key: true, value: true },
      })
    : [];
  const byKey = new Map<string, { day: string; value: bigint }[]>();
  for (const r of rows) {
    const list = byKey.get(r.key) ?? [];
    list.push({ day: r.day.toISOString().slice(0, 10), value: r.value });
    byKey.set(r.key, list);
  }
  return Object.fromEntries(wanted.map((k) => [k, historyFromRows(byKey.get(k) ?? [], today)])) as Record<K, (number | null)[]>;
}
