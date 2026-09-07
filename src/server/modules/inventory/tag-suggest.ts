import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";

export interface CategorySuggestion { prefixes: Array<{ prefix: string; n: number }>; highest: Record<string, number> }

/**
 * Spec §2.1. Counts are per (category, prefix) — the form picks the category's
 * most-used prefix; the highest number is per PREFIX across the whole fleet,
 * because a tag is unique fleet-wide and one prefix may live in two categories.
 */
export async function tagSuggestions(categoryIds: string[]): Promise<Record<string, CategorySuggestion>> {
  if (categoryIds.length === 0) return {};
  const counts = await prisma.$queryRaw<Array<{ categoryId: string; prefix: string; n: bigint }>>`
    SELECT "categoryId", substring("tag", 4, 2) AS prefix, count(*) AS n
    FROM "Asset" WHERE "categoryId" IN (${Prisma.join(categoryIds)})
    GROUP BY 1, 2 ORDER BY 1, 3 DESC, 2 ASC`;
  const prefixes = [...new Set(counts.map((c) => c.prefix))];
  const highs = prefixes.length
    ? await prisma.$queryRaw<Array<{ prefix: string; max: string | null }>>`
        SELECT substring("tag", 4, 2) AS prefix, max(substring("tag", 7, 4)) AS max
        FROM "Asset" WHERE substring("tag", 4, 2) IN (${Prisma.join(prefixes)}) GROUP BY 1`
    : [];
  const highest: Record<string, number> = Object.fromEntries(highs.filter((h) => h.max != null).map((h) => [h.prefix, Number(h.max)]));
  const out: Record<string, CategorySuggestion> = {};
  for (const id of categoryIds) out[id] = { prefixes: [], highest };
  for (const c of counts) out[c.categoryId].prefixes.push({ prefix: c.prefix, n: Number(c.n) });
  return out;
}
