import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { asOfMonth, toCentavos } from "@/lib/depreciation";
import { effectiveSlots, groupExceptionsByEmployee, resolvePolicy } from "@/lib/loadout";
import { summariseGroup, type GroupSummary, type ReportAsset, type ReportPerson } from "@/lib/equipment-report";

export type GroupKind = "INTERNAL" | "CLIENT";

export interface EquipmentTotals {
  people: number;
  items: number;
  /** people missing something, summed across the groups */
  missing: number;
  /** round(100 × (people − missing) ÷ max(people, 1)) */
  fullyPct: number;
  /** Finance and Admin only — absent, not zero, for everyone else. */
  money?: { costC: number; bookC: number; withoutCost: number };
}

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

/**
 * Phase 38 (spec §3.4): the Equipment by client page's one query set. Every active group of `kind`, its
 * non-offboarded people and their IT-class assets, the policies (slots in `id` order, as the profile reads them)
 * and those people's slot exceptions — a fixed number of queries whatever the group count, reduced in memory by
 * `summariseGroup`. Cost, purchase date, approval date and depreciation fields are read by a separate query that
 * only runs when `withMoney`, so a viewer's or IT user's request never selects them.
 */
export async function equipmentByGroup({ kind, withMoney, now }: { kind: GroupKind; withMoney: boolean; now: Date }): Promise<EquipmentByGroup> {
  const people = countedPeople(kind);
  const [groups, kindCounts, employees, policies, exceptions, moneyRows] = await Promise.all([
    prisma.department.findMany({ where: { kind, archivedAt: null }, select: { id: true, name: true, kind: true } }),
    prisma.department.groupBy({ by: ["kind"], where: { archivedAt: null }, _count: true }),
    prisma.employee.findMany({
      where: people,
      select: {
        id: true, name: true, employeeNo: true, title: true, departmentId: true,
        assets: {
          where: { cls: "IT" },
          select: { id: true, tag: true, typeId: true, status: true, loanDueAt: true, category: { select: { name: true } } },
        },
      },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    }),
    prisma.equipmentPolicy.findMany({
      select: {
        id: true, name: true, appliesToTitle: true, appliesToDepartmentId: true,
        slots: { select: { id: true, name: true, assetTypeId: true, required: true, loaner: true }, orderBy: { id: "asc" } },
      },
      orderBy: [{ name: "asc" }],
    }),
    prisma.employeeSlotException.findMany({
      where: { employee: people },
      select: { id: true, employeeId: true, kind: true, slotId: true, name: true, assetTypeId: true, required: true, loaner: true },
      orderBy: [{ employeeId: "asc" }, { id: "asc" }],
    }),
    withMoney
      ? prisma.asset.findMany({
          where: { cls: "IT", assignee: people },
          select: {
            id: true, cost: true, purchasedAt: true, financeConfirmedAt: true,
            depreciationLifeMonths: true, depreciationSalvage: true,
            category: { select: { depreciationLifeMonths: true, depreciationSalvagePercent: true } },
          },
        })
      : Promise.resolve([]),
  ]);

  const moneyById = new Map(moneyRows.map((m) => [m.id, m]));
  const exceptionsByEmployee = groupExceptionsByEmployee(exceptions);

  const toAsset = (a: (typeof employees)[number]["assets"][number]): ReportAsset => {
    const m = moneyById.get(a.id);
    return {
      id: a.id, tag: a.tag, typeId: a.typeId, categoryName: a.category.name, status: a.status, loanDueAt: a.loanDueAt,
      costC: m ? toCentavos(m.cost) : null,
      purchasedAt: m?.purchasedAt ?? null,
      financeConfirmedAt: m?.financeConfirmedAt ?? null,
      dep: {
        lifeMonths: m?.depreciationLifeMonths ?? null,
        salvage: m ? toCentavos(m.depreciationSalvage) : null,
        catLifeMonths: m?.category.depreciationLifeMonths ?? null,
        catSalvagePercent: m?.category.depreciationSalvagePercent == null ? null : Number(m.category.depreciationSalvagePercent),
      },
    };
  };

  const byGroup = new Map<string, ReportPerson[]>();
  for (const e of employees) {
    const policy = resolvePolicy(e, policies);
    const ex = exceptionsByEmployee.get(e.id) ?? [];
    const person: ReportPerson = {
      id: e.id, name: e.name, employeeNo: e.employeeNo, title: e.title,
      // the profile's slot list: its resolved policy's slots (stored names are the profile labels) plus exceptions
      slots: effectiveSlots(policy?.slots ?? [], ex),
      // as on the employees list: no policy and no added slot means gaps are not tracked for them
      hasPolicy: policy !== null || ex.some((x) => x.kind === "ADD"),
      assets: e.assets.map(toAsset),
    };
    const list = byGroup.get(e.departmentId);
    if (list) list.push(person);
    else byGroup.set(e.departmentId, [person]);
  }

  const asOf = asOfMonth(now);
  const summaries = groups.map((g) =>
    summariseGroup(
      // the same base-policy test resolvePolicy uses: the group's own policy with no title
      { id: g.id, name: g.name, kind: g.kind, hasBasePolicy: policies.some((p) => p.appliesToDepartmentId === g.id && !p.appliesToTitle) },
      byGroup.get(g.id) ?? [],
      { withMoney, asOf },
    ),
  );

  const sum = (f: (s: GroupSummary) => number) => summaries.reduce((n, s) => n + f(s), 0);
  const totalPeople = sum((s) => s.people);
  const missing = sum((s) => s.missing.length);
  const totals: EquipmentTotals = {
    people: totalPeople,
    items: sum((s) => s.items),
    missing,
    fullyPct: Math.round((100 * (totalPeople - missing)) / Math.max(totalPeople, 1)),
  };
  if (withMoney) {
    totals.money = {
      costC: sum((s) => s.money?.costC ?? 0),
      bookC: sum((s) => s.money?.bookC ?? 0),
      withoutCost: sum((s) => s.money?.withoutCost ?? 0),
    };
  }

  const countOf = (k: GroupKind) => kindCounts.find((c) => c.kind === k)?._count ?? 0;
  return { groups: summaries, counts: { client: countOf("CLIENT"), internal: countOf("INTERNAL") }, totals };
}
