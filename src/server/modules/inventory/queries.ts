import { cache } from "react";
import { prisma } from "@/server/db/client";
import { fmtDate } from "@/lib/format";
import {
  ASSET_STATUSES, buildAssetOrderBy, buildAssetWhere,
} from "@/lib/inventory-list";
import type { ListState } from "@/lib/url-state";
import { COLUMN_PREF_KEYS } from "@/lib/column-prefs";

export const PAGE_SIZE = 25;

/** Serializable DTO for the client table island — strings only, preformatted. */
export interface AssetRow {
  id: string;
  tag: string;
  model: string;
  category: string;
  status: string;
  assignee: string | null;
  purchased: string;
  warranty: string;
}

export async function listAssets(state: ListState): Promise<{
  rows: AssetRow[];
  total: number;
  pageCount: number;
}> {
  const where = buildAssetWhere(state);
  const [total, assets] = await Promise.all([
    prisma.asset.count({ where }),
    prisma.asset.findMany({
      where,
      orderBy: buildAssetOrderBy(state.sort),
      skip: (state.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { category: true, assignee: true },
    }),
  ]);
  return {
    total,
    pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    rows: assets.map((a): AssetRow => ({
      id: a.id,
      tag: a.tag,
      model: a.model,
      category: a.category.name,
      status: a.status,
      assignee: a.assignee?.name ?? null,
      purchased: fmtDate(a.purchasedAt),
      warranty: fmtDate(a.warrantyUntil),
    })),
  };
}

/** Visible hideable columns for this user; default = all. */
export async function getInventoryColumns(userId: string): Promise<string[]> {
  const allowed = COLUMN_PREF_KEYS["columns:inventory"] as readonly string[];
  const pref = await prisma.userPreference.findUnique({
    where: { userId_key: { userId, key: "columns:inventory" } },
  });
  if (!pref || !Array.isArray(pref.value)) return [...allowed];
  return (pref.value as string[]).filter((c) => allowed.includes(c));
}

export interface FacetOption {
  value: string;
  label: string;
  count: number;
}

/**
 * Standard faceting: each facet's counts apply every OTHER facet (and q) but
 * not its own selection — options stay visible (dimmed at zero) instead of
 * vanishing once a sibling is picked. URL updates only on Apply, so these
 * recompute per navigation, not per click.
 */
export async function facetOptions(state: ListState): Promise<Record<string, FacetOption[]>> {
  const without = (facet: string): ListState => ({
    ...state,
    filters: { ...state.filters, [facet]: [] },
  });

  const [statusG, categoryG, typeG, assigneeG, categories, types, assignees] = await Promise.all([
    prisma.asset.groupBy({ by: ["status"], where: buildAssetWhere(without("status")), _count: true }),
    prisma.asset.groupBy({ by: ["categoryId"], where: buildAssetWhere(without("category")), _count: true }),
    prisma.asset.groupBy({ by: ["typeId"], where: buildAssetWhere(without("type")), _count: true }),
    prisma.asset.groupBy({ by: ["assigneeId"], where: buildAssetWhere(without("assignee")), _count: true }),
    prisma.assetCategory.findMany({ orderBy: { name: "asc" } }),
    prisma.assetType.findMany({ orderBy: { name: "asc" }, include: { category: true } }),
    prisma.employee.findMany({ where: { assets: { some: {} } }, orderBy: { name: "asc" } }),
  ]);

  return {
    status: ASSET_STATUSES.map((s) => ({
      value: s, label: s, count: statusG.find((g) => g.status === s)?._count ?? 0,
    })),
    category: categories.map((c) => ({
      value: c.id, label: c.name, count: categoryG.find((g) => g.categoryId === c.id)?._count ?? 0,
    })),
    type: types.map((t) => ({
      value: t.id, label: `${t.category.name} · ${t.name}`,
      count: typeG.find((g) => g.typeId === t.id)?._count ?? 0,
    })),
    assignee: assignees.map((e) => ({
      value: e.id, label: e.name, count: assigneeG.find((g) => g.assigneeId === e.id)?._count ?? 0,
    })),
  };
}

/**
 * A USB scanner is just a keyboard: an exact tag match opens the record
 * instead of listing it. findUnique on the uppercased tag — NEVER an
 * insensitive equals (ILIKE wildcard hazard).
 */
export function exactTagMatch(q: string) {
  const tag = q.trim().toUpperCase();
  if (!/^BR-[A-Z]{2}-\d{4}$/.test(tag)) return null;
  return prisma.asset.findUnique({ where: { tag }, select: { id: true } });
}

export const getAsset = cache((id: string) =>
  prisma.asset.findUnique({
    where: { id },
    include: {
      category: true,
      type: true,
      assignee: true,
      vendor: true,
      approvals: {
        where: { state: { in: ["PENDING", "CLAIMED", "APPROVED"] } },
        orderBy: { createdAt: "desc" },
      },
    },
  }),
);
