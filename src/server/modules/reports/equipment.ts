import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { asOfMonth, toCentavos } from "@/lib/depreciation";
import { EXPORT_CAP, type EquipmentExportRow } from "@/lib/export-columns";
import { heldSinceByAsset } from "@/server/modules/employees/held-since";
import {
  bookValueC, groupHasBasePolicy, reportPeopleByGroup, reportTotals, summariseGroup,
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

/** The export's per-item fields, read for every role. The money fields are added only in the `withMoney` branch below. */
const EXPORT_ASSET = {
  id: true, tag: true, model: true, serial: true, status: true, loanDueAt: true, purchasedAt: true,
  type: { select: { name: true } },
  assignee: { select: { id: true, name: true, employeeNo: true, department: { select: { name: true, kind: true } } } },
} as const;
const EXPORT_ORDER: Prisma.AssetOrderByWithRelationInput[] = [
  { assignee: { department: { name: "asc" } } }, { assignee: { name: "asc" } }, { assigneeId: "asc" }, { tag: "asc" }, { id: "asc" },
];

export type EquipmentExport =
  | { rows: EquipmentExportRow[]; groupName: string | null }
  | { over: number }
  | { notFound: true };

/**
 * Phase 38 (spec §3.5): one row per IT-class asset of the counted people (the same set the page counts: not
 * OFFBOARDED, in an active group of `kind`), sorted by group, person, then tag. `groupId` narrows to one group of that
 * kind; an unknown, ended or other-kind id is `notFound`. The count is checked against EXPORT_CAP BEFORE any row is
 * read. Cost and book value are selected and computed only when `withMoney` (two typed branches, as in `loadPeople`),
 * so a non-money export has no cost to leak. "Held since" is one batched audit read for all the items.
 */
export async function equipmentExportRows(
  { kind, groupId, withMoney, now }: { kind: GroupKind; groupId?: string; withMoney: boolean; now: Date },
): Promise<EquipmentExport> {
  let groupName: string | null = null;
  if (groupId !== undefined) {
    const g = await prisma.department.findFirst({ where: { id: groupId, kind, archivedAt: null }, select: { name: true } });
    if (!g) return { notFound: true };
    groupName = g.name;
  }
  const where: Prisma.AssetWhereInput = {
    ...IT_ONLY,
    assignee: { ...countedPeople(kind), ...(groupId !== undefined ? { departmentId: groupId } : {}) },
  };
  const total = await prisma.asset.count({ where });
  if (total > EXPORT_CAP) return { over: total };

  type Held = { id: string; tag: string; model: string; serial: string | null; status: string; loanDueAt: Date | null; purchasedAt: Date | null;
    typeName: string | null; categoryName: string; person: { id: string; name: string; employeeNo: string }; worksFor: string; kind: GroupKind;
    costC?: number | null; bookC?: number };
  let items: Held[];
  if (withMoney) {
    const asOf = asOfMonth(now);
    const found = await prisma.asset.findMany({
      where, orderBy: EXPORT_ORDER,
      select: {
        ...EXPORT_ASSET, ...MONEY,
        category: { select: { name: true, depreciationLifeMonths: true, depreciationSalvagePercent: true } },
      },
    });
    items = found.flatMap((a) => {
      if (!a.assignee) return [];
      const costC = toCentavos(a.cost);
      const report: ReportAsset = {
        id: a.id, tag: a.tag, typeId: null, categoryName: a.category.name, status: a.status, loanDueAt: a.loanDueAt,
        costC, purchasedAt: a.purchasedAt, financeConfirmedAt: a.financeConfirmedAt,
        dep: {
          lifeMonths: a.depreciationLifeMonths,
          salvage: toCentavos(a.depreciationSalvage),
          catLifeMonths: a.category.depreciationLifeMonths,
          catSalvagePercent: a.category.depreciationSalvagePercent === null ? null : Number(a.category.depreciationSalvagePercent),
        },
      };
      return [{
        id: a.id, tag: a.tag, model: a.model, serial: a.serial, status: a.status, loanDueAt: a.loanDueAt, purchasedAt: a.purchasedAt,
        typeName: a.type?.name ?? null, categoryName: a.category.name, person: a.assignee,
        worksFor: a.assignee.department.name, kind: a.assignee.department.kind, costC, bookC: bookValueC(report, asOf),
      }];
    });
  } else {
    const found = await prisma.asset.findMany({
      where, orderBy: EXPORT_ORDER,
      select: { ...EXPORT_ASSET, category: { select: { name: true } } },
    });
    items = found.flatMap((a) =>
      a.assignee
        ? [{
            id: a.id, tag: a.tag, model: a.model, serial: a.serial, status: a.status, loanDueAt: a.loanDueAt, purchasedAt: a.purchasedAt,
            typeName: a.type?.name ?? null, categoryName: a.category.name, person: a.assignee,
            worksFor: a.assignee.department.name, kind: a.assignee.department.kind,
          }]
        : [],
    );
  }
  // between the count and the read more items could have arrived; the cap is still never exceeded
  if (items.length > EXPORT_CAP) return { over: items.length };

  const since = await heldSinceByAsset(items.map((i) => ({ assetId: i.id, employeeId: i.person.id, employeeNo: i.person.employeeNo })));
  const rows = items.map((i): EquipmentExportRow => {
    const row: EquipmentExportRow = {
      worksFor: i.worksFor, kind: i.kind, person: i.person.name, employeeNo: i.person.employeeNo,
      category: i.categoryName, type: i.typeName, tag: i.tag, model: i.model, serial: i.serial, status: i.status,
      purchasedAt: i.purchasedAt, heldSince: since.get(i.id) ?? null, loanDueAt: i.loanDueAt,
    };
    if (withMoney) { row.costC = i.costC ?? null; row.bookC = i.bookC ?? 0; }
    return row;
  });
  return { rows, groupName };
}
