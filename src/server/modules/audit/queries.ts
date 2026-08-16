import { prisma } from "@/server/db/client";
import { buildAuditWhere } from "@/lib/audit-list";
import { fmtDateTime } from "@/lib/format";
import type { ListState } from "@/lib/url-state";

export const AUDIT_PAGE_SIZE = 50;

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
  const [assets, employees, approvals] = await Promise.all([
    byType.has("asset")
      ? prisma.asset.findMany({ where: { id: { in: [...byType.get("asset")!] } }, select: { id: true, tag: true } })
      : [],
    byType.has("employee")
      ? prisma.employee.findMany({ where: { id: { in: [...byType.get("employee")!] } }, select: { id: true, name: true } })
      : [],
    byType.has("approval")
      ? prisma.approval.findMany({ where: { id: { in: [...byType.get("approval")!] } }, select: { id: true, refNo: true } })
      : [],
  ]);
  for (const a of assets) map.set(`asset:${a.id}`, { label: a.tag, href: `/inventory/${a.id}` });
  for (const e of employees) map.set(`employee:${e.id}`, { label: e.name, href: `/employees/${e.id}` });
  for (const a of approvals) map.set(`approval:${a.id}`, { label: a.refNo, href: `/approvals/${a.id}` });
  for (const e of entries) {
    const key = `${e.entityType}:${e.entityId}`;
    if (!map.has(key)) map.set(key, { label: e.entityId.slice(0, 10) + "…", href: null });
  }
  return map;
}

export async function listAudit(state: ListState): Promise<{ rows: AuditRow[]; total: number; pageCount: number }> {
  const where = buildAuditWhere(state);
  const [total, entries] = await Promise.all([
    prisma.auditEntry.count({ where }),
    prisma.auditEntry.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (state.page - 1) * AUDIT_PAGE_SIZE,
      take: AUDIT_PAGE_SIZE,
    }),
  ]);
  const labels = await entityLabels(entries);
  return {
    total,
    pageCount: Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE)),
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
