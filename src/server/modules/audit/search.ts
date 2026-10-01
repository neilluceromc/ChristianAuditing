import type { Role } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { visibleClassWhere } from "@/lib/asset-class";
import { approvalClassWhere } from "@/lib/approval-access";

/** How many ids each kind contributes — a short search term must not turn into a 10,000-id IN list. */
const MATCH_CAP = 100;

/**
 * Spec §6.1 (plan P-16): what the Entity column shows — an asset tag, a person's name or
 * employee no, an approval ref no — resolved to the ids this role may see. `/audit` and the
 * activity feeds OR `entityId in […]` with their own action / actor matching; the pure
 * where-builders take the result as `matchIds`, so they stay unit-testable.
 */
export async function resolveEntitySearch(q: string, role: Role): Promise<string[]> {
  const t = q.trim();
  if (!t) return [];
  const c = { contains: t, mode: "insensitive" as const };
  const [assets, employees, approvals] = await Promise.all([
    prisma.asset.findMany({ where: { AND: [{ tag: c }, visibleClassWhere(role)] }, select: { id: true }, take: MATCH_CAP }),
    prisma.employee.findMany({ where: { OR: [{ name: c }, { employeeNo: c }] }, select: { id: true }, take: MATCH_CAP }),
    prisma.approval.findMany({ where: { AND: [{ refNo: c }, approvalClassWhere(role)] }, select: { id: true }, take: MATCH_CAP }),
  ]);
  return [...assets, ...employees, ...approvals].map((r) => r.id);
}
