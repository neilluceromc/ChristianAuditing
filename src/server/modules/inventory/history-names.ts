import { prisma } from "@/server/db/client";
import { historyNameIds, type AuditEntryLike, type HistoryNames } from "@/lib/history";

/**
 * Phase 40 (spec §2.4): the names behind the ids a page of asset audit entries mentions. One query per kind, and
 * only for the ids that page actually names (none at all when it names none). An id that no longer exists simply
 * has no entry, which the formatter reads as "(removed)".
 *
 * Employees are looked up by id OR employee number and keyed by both: a plain edit audits `assigneeId` (the id)
 * while lifecycle audits `assignee` as the employee number.
 */
export async function resolveHistoryNames(entries: AuditEntryLike[]): Promise<HistoryNames> {
  const ids = historyNameIds(entries);
  const [categories, types, vendors, employees] = await Promise.all([
    ids.category.length
      ? prisma.assetCategory.findMany({ where: { id: { in: ids.category } }, select: { id: true, name: true } })
      : [],
    ids.type.length
      ? prisma.assetType.findMany({ where: { id: { in: ids.type } }, select: { id: true, name: true } })
      : [],
    ids.vendor.length
      ? prisma.vendor.findMany({ where: { id: { in: ids.vendor } }, select: { id: true, name: true } })
      : [],
    ids.employee.length
      ? prisma.employee.findMany({
          where: { OR: [{ id: { in: ids.employee } }, { employeeNo: { in: ids.employee } }] },
          select: { id: true, employeeNo: true, name: true },
        })
      : [],
  ]);
  const employee = new Map<string, string>();
  for (const e of employees) {
    employee.set(e.id, e.name);
    employee.set(e.employeeNo, e.name);
  }
  return {
    category: new Map(categories.map((c) => [c.id, c.name])),
    type: new Map(types.map((t) => [t.id, t.name])),
    vendor: new Map(vendors.map((v) => [v.id, v.name])),
    employee,
  };
}
