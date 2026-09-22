import type { Role } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { NO_HIDDEN_REFS, buildAuditWhere, type HiddenAuditRefs } from "@/lib/audit-list";
import { buildActivityWhere, type ActivityFeed } from "@/lib/activity-list";
import { actionLabel, auditSentence } from "@/lib/activity";
import { ASSET_CLASSES, canSeeClass } from "@/lib/asset-class";
import { fmtDateTime } from "@/lib/format";
import type { ListState } from "@/lib/url-state";
import { LOG_PAGE_SIZE } from "@/lib/paging";
import { pagedSnapshot } from "@/server/paged";
import { invisibleAssetIds } from "@/server/modules/inventory/queries";
import { actionDot, type ActivityItem } from "@/components/patterns/activity-feed";
import type { FacetOptionLike } from "@/components/patterns/facet-dropdown";

export interface AuditRow {
  id: string;
  when: string;
  actor: string;
  entityType: string;
  entityLabel: string;
  entityHref: string | null;
  action: string;
  fields: string;
}

/** Batch-resolve entity ids into human labels + links. Unknown types stay as truncated ids. */
export async function entityLabels(
  entries: Array<{ entityType: string; entityId: string }>,
): Promise<Map<string, { label: string; href: string | null }>> {
  const byType = new Map<string, Set<string>>();
  for (const e of entries) {
    if (!byType.has(e.entityType)) byType.set(e.entityType, new Set());
    byType.get(e.entityType)!.add(e.entityId);
  }
  const map = new Map<string, { label: string; href: string | null }>();
  const [assets, employees, approvals, purchases, policies, users, flags, endpoints, vendors, stockItems, stocktakes, stockCategories, departments] = await Promise.all([
    byType.has("asset")
      ? prisma.asset.findMany({ where: { id: { in: [...byType.get("asset")!] } }, select: { id: true, tag: true } })
      : [],
    byType.has("employee")
      ? prisma.employee.findMany({ where: { id: { in: [...byType.get("employee")!] } }, select: { id: true, name: true } })
      : [],
    byType.has("approval")
      ? prisma.approval.findMany({ where: { id: { in: [...byType.get("approval")!] } }, select: { id: true, refNo: true } })
      : [],
    byType.has("purchase-request")
      ? prisma.purchaseRequest.findMany({
          where: { id: { in: [...byType.get("purchase-request")!] } },
          select: { id: true, refNo: true },
        })
      : [],
    byType.has("equipment-policy")
      ? prisma.equipmentPolicy.findMany({
          where: { id: { in: [...byType.get("equipment-policy")!] } },
          select: { id: true, name: true },
        })
      : [],
    byType.has("user")
      ? prisma.user.findMany({
          where: { id: { in: [...byType.get("user")!] } },
          select: { id: true, name: true, email: true },
        })
      : [],
    byType.has("feature-flag")
      ? prisma.featureFlag.findMany({
          where: { id: { in: [...byType.get("feature-flag")!] } },
          select: { id: true, key: true },
        })
      : [],
    byType.has("webhook-endpoint")
      ? prisma.webhookEndpoint.findMany({
          where: { id: { in: [...byType.get("webhook-endpoint")!] } },
          select: { id: true, url: true },
        })
      : [],
    byType.has("vendor")
      ? prisma.vendor.findMany({ where: { id: { in: [...byType.get("vendor")!] } }, select: { id: true, name: true } })
      : [],
    byType.has("stock-item")
      ? prisma.stockItem.findMany({ where: { id: { in: [...byType.get("stock-item")!] } }, select: { id: true, code: true, name: true } })
      : [],
    byType.has("stocktake")
      ? prisma.stocktake.findMany({ where: { id: { in: [...byType.get("stocktake")!] } }, select: { id: true, refNo: true } })
      : [],
    byType.has("stock-category")
      ? prisma.stockCategory.findMany({ where: { id: { in: [...byType.get("stock-category")!] } }, select: { id: true, name: true } })
      : [],
    byType.has("department")
      ? prisma.department.findMany({ where: { id: { in: [...byType.get("department")!] } }, select: { id: true, name: true } })
      : [],
  ]);
  for (const a of assets) map.set(`asset:${a.id}`, { label: a.tag, href: `/inventory/${a.id}` });
  for (const e of employees) map.set(`employee:${e.id}`, { label: e.name, href: `/employees/${e.id}` });
  for (const a of approvals) map.set(`approval:${a.id}`, { label: a.refNo, href: `/approvals/${a.id}` });
  for (const p of purchases) map.set(`purchase-request:${p.id}`, { label: p.refNo, href: `/purchases/${p.id}` });
  // A deleted policy has no row to resolve — it correctly keeps the truncated-id
  // fallback below; auditSentence's "delete" case reads the name from the diff instead.
  for (const p of policies) map.set(`equipment-policy:${p.id}`, { label: p.name, href: "/admin/equipment-policies" });
  // `User.name` isn't unique (only `email` is) — the label carries both so it
  // reads as an identity, not just a display name two people might share.
  for (const u of users) map.set(`user:${u.id}`, { label: `${u.name} · ${u.email}`, href: "/admin/users" });
  for (const f of flags) map.set(`feature-flag:${f.id}`, { label: f.key, href: "/admin/flags" });
  // A deleted endpoint has no row to resolve — it correctly keeps the
  // truncated-id fallback below; deleteEndpoint's diff carries the URL instead.
  for (const e of endpoints) map.set(`webhook-endpoint:${e.id}`, { label: e.url, href: "/admin/webhooks" });
  for (const v of vendors) map.set(`vendor:${v.id}`, { label: v.name, href: `/purchases/suppliers/${v.id}` });
  for (const s of stockItems) map.set(`stock-item:${s.id}`, { label: `${s.code} · ${s.name}`, href: `/stock/items/${s.id}` });
  for (const s of stocktakes) map.set(`stocktake:${s.id}`, { label: s.refNo, href: `/stock/stocktakes/${s.id}` });
  for (const c of stockCategories) map.set(`stock-category:${c.id}`, { label: c.name, href: "/stock/categories" });
  // Departments have no detail page — reference-actions.ts writes entityType
  // "department" on create/rename/delete.
  for (const d of departments) map.set(`department:${d.id}`, { label: d.name, href: null });
  for (const e of entries) {
    const key = `${e.entityType}:${e.entityId}`;
    if (!map.has(key)) map.set(key, { label: e.entityId.slice(0, 10) + "…", href: null });
  }
  return map;
}

/**
 * Phase 27 (spec §3.3/§4.1): every class-bearing row this role may NOT see — assets, the approvals
 * on them, categories of the class, types under those categories. Built from the SEE map
 * (`canSeeClass`), never the manage map: Purchasing and Finance staff see both classes but manage
 * one. Four empty lists and no query for an all-class role. An approval with no asset has no class
 * and is never hidden (the approvals queue's own rule).
 */
export async function invisibleAuditRefs(role: Role): Promise<HiddenAuditRefs> {
  const hidden = ASSET_CLASSES.filter((c) => !canSeeClass(role, c));
  if (hidden.length === 0) return NO_HIDDEN_REFS;
  const cls = { in: [...hidden] };
  const ids = (rows: Array<{ id: string }>) => rows.map((r) => r.id);
  const [assetIds, approvals, categories, types] = await Promise.all([
    invisibleAssetIds(role),
    prisma.approval.findMany({ where: { asset: { cls } }, select: { id: true } }),
    prisma.assetCategory.findMany({ where: { cls }, select: { id: true } }),
    prisma.assetType.findMany({ where: { category: { cls } }, select: { id: true } }),
  ]);
  return { assetIds, approvalIds: ids(approvals), categoryIds: ids(categories), typeIds: ids(types) };
}

export async function listAudit(
  state: ListState,
  hidden: HiddenAuditRefs = NO_HIDDEN_REFS,
): Promise<{ rows: AuditRow[]; total: number; page: number; pageCount: number }> {
  const where = buildAuditWhere(state, hidden);
  const { rows: entries, total, page, pageCount } = await pagedSnapshot(
    LOG_PAGE_SIZE,
    state.page,
    (tx) => tx.auditEntry.count({ where }),
    (tx, pg) =>
      tx.auditEntry.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: pg.skip,
        take: pg.take,
      }),
  );
  const labels = await entityLabels(entries);
  return {
    total,
    page,
    pageCount,
    rows: entries.map((e) => {
      const l = labels.get(`${e.entityType}:${e.entityId}`)!;
      return {
        id: e.id,
        when: fmtDateTime(e.createdAt),
        actor: e.actorLabel,
        entityType: e.entityType,
        entityLabel: l.label,
        entityHref: l.href,
        action: e.action,
        fields: e.diff ? Object.keys(e.diff as object).join(", ") : "—",
      };
    }),
  };
}

/**
 * Phase 27 (spec §4.1): one query for the four activity feeds. Rows, the total and the Action facet's
 * counts come from ONE RepeatableRead snapshot (the count closure runs the groupBy first — the
 * listReservations pattern); the facet counts drop the facet's own selection so unchecking one
 * option never zeroes the others (/audit's rule). Items carry the entity chip on the inventory and
 * employees feeds and the domain pill on finance, exactly as the four pages did by hand.
 */
export async function listActivity(
  feed: ActivityFeed,
  state: ListState,
  hidden: HiddenAuditRefs,
): Promise<{ items: ActivityItem[]; total: number; page: number; pageCount: number; actionOptions: FacetOptionLike[] }> {
  const where = buildActivityWhere(feed, state, hidden);
  const withoutAction = buildActivityWhere(feed, { ...state, filters: { ...state.filters, action: [] } }, hidden);
  let grouped: Array<{ action: string; _count: number }> = [];
  const { rows: entries, total, page, pageCount } = await pagedSnapshot(
    LOG_PAGE_SIZE,
    state.page,
    async (tx) => {
      const groupByResult = await tx.auditEntry.groupBy({ by: ["action"], where: withoutAction, _count: true });
      grouped = groupByResult;
      return tx.auditEntry.count({ where });
    },
    (tx, pg) => tx.auditEntry.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: pg.skip, take: pg.take }),
  );
  const labels = await entityLabels(entries);
  const DOMAIN: Record<string, string> = { "purchase-request": "PURCHASE", asset: "ASSET" };
  const withEntityChip = feed === "inventory" || feed === "employees";
  const items: ActivityItem[] = entries.map((e) => {
    const entity = labels.get(`${e.entityType}:${e.entityId}`)!;
    return {
      id: e.id,
      sentence: auditSentence({ actorLabel: e.actorLabel, action: e.action, diff: e.diff, entityLabel: entity.label }),
      when: fmtDateTime(e.createdAt),
      actor: e.actorLabel,
      dotValue: actionDot(e.action),
      ...(withEntityChip ? { entity } : {}),
      // the pill renders ONLY on cross-domain feeds — finance is the one
      ...(feed === "finance" ? { domain: DOMAIN[e.entityType] } : {}),
    };
  });
  const actionOptions: FacetOptionLike[] = grouped
    .map((g) => ({ value: g.action, label: actionLabel(g.action), count: g._count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  return { items, total, page, pageCount, actionOptions };
}
