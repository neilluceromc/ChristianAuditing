import { requireUser } from "@/server/auth/guards";
import { prisma } from "@/server/db/client";
import { resolvePolicy } from "@/lib/loadout";
import { Banner } from "@/components/ui/banner";
import { PageHeader } from "@/components/ui/page-header";
import { Pill } from "@/components/ui/pill";
import {
  NewPolicyCard, PolicyEditor, type PolicyCard,
} from "@/components/admin/policy-editor";

export default async function EquipmentPoliciesPage() {
  const user = await requireUser();
  const canMutate = user.role === "admin" || user.role === "it_staff";

  const [policies, types, employees, departments] = await Promise.all([
    prisma.equipmentPolicy.findMany({
      include: {
        appliesToDepartment: true,
        slots: { include: { assetType: true }, orderBy: [{ name: "asc" }, { id: "asc" }] },
      },
      orderBy: [{ name: "asc" }],
    }),
    prisma.assetType.findMany({ include: { category: true }, orderBy: [{ name: "asc" }] }),
    prisma.employee.findMany({
      where: { employment: { not: "OFFBOARDED" } },
      select: { title: true, departmentId: true },
    }),
    prisma.department.findMany({ orderBy: { name: "asc" } }),
  ]);

  // Whose completeness each policy actually decides — resolvePolicy is the same
  // brain the loadout view and Home's HIRE rows use, so the number can't drift.
  const resolved = employees.map((e) => resolvePolicy(e, policies)?.id ?? null);

  const cards: PolicyCard[] = policies.map((p) => ({
    id: p.id,
    name: p.name,
    appliesTo: p.appliesToTitle
      ? `role: ${p.appliesToTitle}`
      : p.appliesToDepartment
        ? `department: ${p.appliesToDepartment.name}`
        : "applies to nobody",
    employees: resolved.filter((id) => id === p.id).length,
    slots: p.slots.map((s) => ({
      id: s.id,
      name: s.name,
      typeName: s.assetType?.name ?? "any type",
      required: s.required,
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
