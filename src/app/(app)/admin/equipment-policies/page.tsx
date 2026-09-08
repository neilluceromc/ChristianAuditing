import { requireUser } from "@/server/auth/guards";
import { prisma } from "@/server/db/client";
import { headcountByPolicy } from "@/lib/loadout";
import { Banner } from "@/components/ui/banner";
import { PageHeader } from "@/components/ui/page-header";
import { Pill } from "@/components/ui/pill";
import {
  NewPolicyCard, PolicyEditor, type PolicyCard,
} from "@/components/admin/policy-editor";

export default async function EquipmentPoliciesPage() {
  const user = await requireUser();
  const canMutate = user.role === "admin" || user.role === "it_staff";

  const [policies, types, employeeGroups, departments] = await Promise.all([
    prisma.equipmentPolicy.findMany({
      include: {
        appliesToDepartment: true,
        slots: { include: { assetType: true }, orderBy: [{ name: "asc" }, { id: "asc" }] },
      },
      orderBy: [{ name: "asc" }],
    }),
    // Leaver kits are IT's; a policy never names a car.
    prisma.assetType.findMany({ where: { category: { cls: "IT" } }, include: { category: true }, orderBy: [{ name: "asc" }] }),
    // Phase 17: grouped, not one row per employee — a headcount, not a table.
    prisma.employee.groupBy({
      by: ["title", "departmentId"],
      where: { employment: { not: "OFFBOARDED" } },
      _count: { _all: true },
    }),
    prisma.department.findMany({ orderBy: { name: "asc" } }),
  ]);

  // Whose completeness each policy actually decides — headcountByPolicy shares
  // resolvePolicy with the loadout view and Home's HIRE rows, so the number
  // can't drift from either.
  const groups = employeeGroups.map((g) => ({ title: g.title, departmentId: g.departmentId, count: g._count._all }));
  const heads = headcountByPolicy(groups, policies);

  const cards: PolicyCard[] = policies.map((p) => ({
    id: p.id,
    name: p.name,
    appliesTo: p.appliesToTitle
      ? `role: ${p.appliesToTitle}`
      : p.appliesToDepartment
        ? `department: ${p.appliesToDepartment.name}`
        : "applies to nobody",
    employees: heads.get(p.id) ?? 0,
    slots: p.slots.map((s) => ({
      id: s.id,
      name: s.name,
      typeName: s.assetType?.name ?? "any type",
      required: s.required,
      loaner: s.loaner,
    })),
  }));

  return (
    <>
      <PageHeader
        title="Equipment policies"
        badge={canMutate ? undefined : <Pill>READ-ONLY · VIEWER</Pill>}
      />
      <div className="flex max-w-[820px] flex-col gap-3">
        <Banner tone="neutral" title="Editing a policy never touches existing assignments">
          It changes what counts as <em>complete</em> from this moment on — which is why every slot
          change writes an audit entry carrying both the before and after slot lists. Solid chips are
          required (an unfilled one is the policy gap that lights up on the loadout view and in Home&apos;s
          hire rows); grey chips are optional. A role policy beats a department policy.
        </Banner>

        {cards.length === 0 && (
          <p className="text-xs text-fg-muted">
            No policies yet — without one, an employee record has no slot grid and nothing can read as missing.
          </p>
        )}

        {cards.map((policy) => (
          <PolicyEditor
            key={policy.id}
            policy={policy}
            canMutate={canMutate}
            types={types.map((t) => ({ id: t.id, label: `${t.category.name} · ${t.name}` }))}
          />
        ))}

        {canMutate && <NewPolicyCard departments={departments.map((d) => ({ id: d.id, name: d.name }))} />}
      </div>
    </>
  );
}
