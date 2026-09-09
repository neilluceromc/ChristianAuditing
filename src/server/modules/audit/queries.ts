import { prisma } from "@/server/db/client";
import { buildAuditWhere } from "@/lib/audit-list";
import { fmtDateTime } from "@/lib/format";
import type { ListState } from "@/lib/url-state";
import { LOG_PAGE_SIZE, pageOf } from "@/lib/paging";

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
  const [assets, employees, approvals, purchases, policies, users, flags, endpoints, vendors] = await Promise.all([
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
  for (const e of entries) {
    const key = `${e.entityType}:${e.entityId}`;
    if (!map.has(key)) map.set(key, { label: e.entityId.slice(0, 10) + "…", href: null });
  }
  return map;
}

export async function listAudit(
  state: ListState,
  hiddenAssetIds: string[] = [],
): Promise<{ rows: AuditRow[]; total: number; page: number; pageCount: number }> {
  const where = buildAuditWhere(state, hiddenAssetIds);
  const total = await prisma.auditEntry.count({ where });
  const pg = pageOf(total, state.page, LOG_PAGE_SIZE);
  const entries = await prisma.auditEntry.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: pg.skip,
    take: pg.take,
  });
  const labels = await entityLabels(entries);
  return {
    total,
    page: pg.page,
    pageCount: pg.pageCount,
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
