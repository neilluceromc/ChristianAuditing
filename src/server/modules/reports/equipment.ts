import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { asOfMonth, toCentavos } from "@/lib/depreciation";
import {
  groupHasBasePolicy, reportPeopleByGroup, reportTotals, summariseGroup,
  type EquipmentTotals, type GroupSummary, type LoadedPerson, type ReportAsset,
} from "@/lib/equipment-report";

export type { EquipmentTotals } from "@/lib/equipment-report";
export type GroupKind = "INTERNAL" | "CLIENT";

export interface EquipmentByGroup {
  groups: GroupSummary[];
  /** active groups of each kind, for the tabs */
  counts: { client: number; internal: number };
  totals: EquipmentTotals;
}

/** Spec §3.2: counted people — not OFFBOARDED, in an active group of this kind. */
const countedPeople = (kind: GroupKind): Prisma.EmployeeWhereInput => ({
  employment: { not: "OFFBOARDED" },
  department: { kind, archivedAt: null },
});

const PERSON = { id: true, name: true, employeeNo: true, title: true, departmentId: true } as const;
const ASSET = { id: true, tag: true, typeId: true, status: true, loanDueAt: true } as const;
/** Read only for Finance and Admin: the cost, the dates depreciation starts from, and both depreciation policies. */
const MONEY = {
  cost: true, purchasedAt: true, financeConfirmedAt: true, depreciationLifeMonths: true, depreciationSalvage: true,
} as const;
const IT_ONLY = { cls: "IT" } as const;

const NO_DEP: ReportAsset["dep"] = { lifeMonths: null, salvage: null, catLifeMonths: null, catSalvagePercent: null };

/**
 * The counted people with their IT-class assets, in one read. With `withMoney` the money fields are selected inside
 * the same nested asset select (one scan, one snapshot, so no asset can lose its cost to a race); without it they are
 * never selected, and every ReportAsset carries null cost, dates and depreciation fields.
 */
async function loadPeople(where: Prisma.EmployeeWhereInput, withMoney: boolean): Promise<LoadedPerson[]> {
  const orderBy: Prisma.EmployeeOrderByWithRelationInput[] = [{ name: "asc" }, { id: "asc" }];
  if (withMoney) {
    const rows = await prisma.employee.findMany({
      where, orderBy,
      select: {
        ...PERSON,
        assets: {
          where: IT_ONLY,
          select: {
            ...ASSET, ...MONEY,
            category: { select: { name: true, depreciationLifeMonths: true, depreciationSalvagePercent: true } },
          },
        },
      },
    });
    return rows.map(({ assets, ...p }) => ({
      ...p,
      assets: assets.map((a): ReportAsset => ({
        id: a.id, tag: a.tag, typeId: a.typeId, categoryName: a.category.name, status: a.status, loanDueAt: a.loanDueAt,
        costC: toCentavos(a.cost), purchasedAt: a.purchasedAt, financeConfirmedAt: a.financeConfirmedAt,
        dep: {
          lifeMonths: a.depreciationLifeMonths,
          salvage: toCentavos(a.depreciationSalvage),
          catLifeMonths: a.category.depreciationLifeMonths,
          catSalvagePercent: a.category.depreciationSalvagePercent === null ? null : Number(a.category.depreciationSalvagePercent),
        },
      })),
    }));
  }
  const rows = await prisma.employee.findMany({
    where, orderBy,
    select: { ...PERSON, assets: { where: IT_ONLY, select: { ...ASSET, category: { select: { name: true } } } } },
  });
  return rows.map(({ assets, ...p }) => ({
    ...p,
    assets: assets.map((a): ReportAsset => ({
      id: a.id, tag: a.tag, typeId: a.typeId, categoryName: a.category.name, status: a.status, loanDueAt: a.loanDueAt,
      costC: null, purchasedAt: null, financeConfirmedAt: null, dep: NO_DEP,
    })),
  }));
}

/**
 * Phase 38 (spec §3.4): the Equipment by client page's one query set — every active group of `kind`, its
 * non-offboarded people and their IT-class assets, the policies (slots in `id` order, as the profile reads them) and
 * those people's slot exceptions. A fixed number of queries whatever the group count; the pure assembly and
 * reduction live in `src/lib/equipment-report.ts`.
 */
export async function equipmentByGroup({ kind, withMoney, now }: { kind: GroupKind; withMoney: boolean; now: Date }): Promise<EquipmentByGroup> {
  const where = countedPeople(kind);
  const [groups, kindCounts, people, policies, exceptions] = await Promise.all([
    prisma.department.findMany({ where: { kind, archivedAt: null }, select: { id: true, name: true, kind: true } }),
    prisma.department.groupBy({ by: ["kind"], where: { archivedAt: null }, _count: true }),
    loadPeople(where, withMoney),
    prisma.equipmentPolicy.findMany({
      select: {
        id: true, name: true, appliesToTitle: true, appliesToDepartmentId: true,
        slots: { select: { id: true, name: true, assetTypeId: true, required: true, loaner: true }, orderBy: { id: "asc" } },
      },
      orderBy: [{ name: "asc" }],
    }),
    prisma.employeeSlotException.findMany({
      where: { employee: where },
      select: { id: true, employeeId: true, kind: true, slotId: true, name: true, assetTypeId: true, required: true, loaner: true },
      orderBy: [{ employeeId: "asc" }, { id: "asc" }],
    }),
  ]);

  const byGroup = reportPeopleByGroup(people, policies, exceptions);
  const asOf = asOfMonth(now);
  const summaries = groups.map((g) =>
    summariseGroup(
      { id: g.id, name: g.name, kind: g.kind, hasBasePolicy: groupHasBasePolicy(g.id, policies) },
      byGroup.get(g.id) ?? [],
      { withMoney, asOf },
    ),
  );

  const countOf = (k: GroupKind) => kindCounts.find((c) => c.kind === k)?._count ?? 0;
  return {
    groups: summaries,
    counts: { client: countOf("CLIENT"), internal: countOf("INTERNAL") },
    totals: reportTotals(summaries, withMoney),
  };
}
