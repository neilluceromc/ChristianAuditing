import Link from "next/link";
import { requireUser } from "@/server/auth/guards";
import { prisma } from "@/server/db/client";
import { resolveMissing } from "@/server/modules/employees/queries";
import { headcountByPolicy, numberSlotLabels, resolvePolicy, slotLabel } from "@/lib/loadout";
import type { GroupRow } from "@/lib/groups";
import { Banner } from "@/components/ui/banner";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Pill } from "@/components/ui/pill";
import { PolicyDirtyProvider } from "@/components/admin/policies/dirty-context";
import { GroupList, type PolicyTab } from "@/components/admin/policies/group-list";
import { LegacyTitlePolicies } from "@/components/admin/policies/legacy-title-policies";
import { PolicyLinesEditor, type CategoryOption, type PolicyLineInput } from "@/components/admin/policies/policy-lines-editor";
import { BasePolicyActions, StartPolicy, TitleRules } from "@/components/admin/policies/policy-detail";

const NOT_GONE = { employment: { not: "OFFBOARDED" as const } };

type SlotRow = { id: string; name: string; assetTypeId: string | null; required: boolean; loaner: boolean };

/** The editor's lines: typed slots only, in creation order (`id asc`). */
const linesOf = (slots: SlotRow[]): PolicyLineInput[] =>
  slots.flatMap((s) => (s.assetTypeId ? [{ slotId: s.id, assetTypeId: s.assetTypeId, required: s.required, loaner: s.loaner }] : []));
const untypedOf = (slots: SlotRow[]) => slots.filter((s) => !s.assetTypeId).map((s) => s.name);
/** Changes whenever the saved lines do, so a refreshed editor restarts from them. */
const editorKeyOf = (policyId: string, slots: SlotRow[]) =>
  `${policyId}:${slots.map((s) => `${s.id}.${s.assetTypeId}.${+s.required}${+s.loaner}`).join(",")}`;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Phase 37 (spec §3.3): one equipment policy per client and per internal department, master-detail. The list
 * holds the active groups of one kind; `?group=` picks the one whose policy, title rules and gap count load here.
 */
export default async function EquipmentPoliciesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; group?: string }>;
}) {
  const user = await requireUser();
  const canMutate = user.role === "admin" || user.role === "it_staff";
  const params = await searchParams;

  const [groups, basePolicies, categories, legacy] = await Promise.all([
    prisma.department.findMany({
      where: { archivedAt: null },
      select: {
        id: true, name: true, kind: true, locked: true,
        _count: { select: { employees: { where: NOT_GONE } } },
      },
    }),
    prisma.equipmentPolicy.findMany({
      where: { appliesToTitle: null, appliesToDepartmentId: { not: null } },
      include: { slots: { orderBy: { id: "asc" } } },
      orderBy: { name: "asc" },
    }),
    prisma.assetCategory.findMany({
      where: { cls: "IT", types: { some: {} } },
      include: { types: { orderBy: { name: "asc" }, select: { id: true, name: true } } },
      orderBy: { name: "asc" },
    }),
    prisma.equipmentPolicy.findMany({
      where: { appliesToDepartmentId: null, appliesToTitle: { not: null } },
      include: { slots: { orderBy: { id: "asc" }, include: { assetType: { include: { category: true } } } } },
      orderBy: { name: "asc" },
    }),
  ]);

  // Duplicates are not prevented in the data (spec §3.1): the first by name is the group's list.
  const baseByGroup = new Map<string, (typeof basePolicies)[number]>();
  for (const p of basePolicies) if (!baseByGroup.has(p.appliesToDepartmentId!)) baseByGroup.set(p.appliesToDepartmentId!, p);

  const rows: GroupRow[] = groups.map((g) => ({
    id: g.id, name: g.name, kind: g.kind, locked: g.locked, archivedAt: null,
    people: g._count.employees,
    policyItems: baseByGroup.get(g.id)?.slots.length ?? null,
  }));

  const wanted = rows.find((r) => r.id === params.group);
  const tab: PolicyTab =
    params.tab === "client" || params.tab === "internal" ? params.tab
    : wanted ? (wanted.kind === "CLIENT" ? "client" : "internal")
    : "client";
  const kind = tab === "client" ? "CLIENT" : "INTERNAL";
  const tabRows = rows
    .filter((r) => r.kind === kind)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
  const counts = { client: rows.filter((r) => r.kind === "CLIENT").length, internal: rows.filter((r) => r.kind === "INTERNAL").length };
  const selected = tabRows.find((r) => r.id === params.group) ?? tabRows[0] ?? null;

  const categoryOptions: CategoryOption[] = categories.map((c) => ({ id: c.id, name: c.name, types: c.types }));

  const legacyRules = legacy.map((p) => {
    const labels = numberSlotLabels(p.slots.map((s) => (s.assetType ? slotLabel(s.assetType.category.name, s.assetType.name) : s.name)));
    return {
      id: p.id,
      title: p.appliesToTitle!,
      lines: p.slots.map((s, i) => {
        const what = s.assetType ? `${s.assetType.category.name} / ${s.assetType.name}` : "any type";
        return `${labels[i]} · ${what} · ${s.required ? "required" : "optional"}${s.loaner ? " · loan" : ""}`;
      }),
    };
  });

  return (
    <>
      <PageHeader
        title="Equipment policies"
        badge={canMutate ? undefined : <Pill>READ-ONLY · {user.role.replace("_", " ").toUpperCase()}</Pill>}
      />
      <p className="-mt-2 pb-4 text-[12.5px] text-fg-muted">What each client&apos;s staff and each internal department should have.</p>
      <div className="flex flex-col gap-3">
        <Banner tone="neutral" title="Editing a policy never touches existing assignments">
          It changes what counts as <em>complete</em> from this moment on, and every save writes an audit entry with
          the lists before and after. A required line nobody fills is the gap that shows on the person&apos;s profile.
        </Banner>

        {legacyRules.length > 0 && <LegacyTitlePolicies rules={legacyRules} canMutate={canMutate} />}

        <PolicyDirtyProvider>
          <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,320px)_1fr]">
            <GroupList tab={tab} rows={tabRows} counts={counts} selectedId={selected?.id ?? null} />
            {selected ? (
              <GroupDetail
                group={selected}
                base={baseByGroup.get(selected.id) ?? null}
                categories={categoryOptions}
                canMutate={canMutate}
                targets={tabRows.filter((r) => r.id !== selected.id).map((r) => ({ id: r.id, name: r.name, policyItems: r.policyItems }))}
                sources={tabRows
                  .filter((r) => r.id !== selected.id && baseByGroup.has(r.id))
                  .map((r) => {
                    const p = baseByGroup.get(r.id)!;
                    return { policyId: p.id, groupName: r.name, lines: linesOf(p.slots) };
                  })
                  .filter((s) => s.lines.length > 0)}
              />
            ) : (
              <Card className="px-4 py-8 text-center text-xs text-fg-muted">
                {tab === "client" ? "No active clients yet." : "No active departments yet."}{" "}
                Add one on <Link href="/admin/departments" className="text-accent hover:underline">Departments &amp; clients</Link>.
              </Card>
            )}
          </div>
        </PolicyDirtyProvider>
      </div>
    </>
  );
}

/** The right-hand detail for one group: header, its base list (or the start box), and its title rules. */
async function GroupDetail({
  group, base, categories, canMutate, targets, sources,
}: {
  group: GroupRow;
  base: { id: string; slots: SlotRow[] } | null;
  categories: CategoryOption[];
  canMutate: boolean;
  targets: Array<{ id: string; name: string; policyItems: number | null }>;
  sources: Array<{ policyId: string; groupName: string; lines: PolicyLineInput[] }>;
}) {
  const [employees, titleRules, policies] = await Promise.all([
    prisma.employee.findMany({
      where: { departmentId: group.id, ...NOT_GONE },
      select: { id: true, title: true, departmentId: true, assets: { select: { id: true, tag: true, model: true, typeId: true, status: true } } },
    }),
    prisma.equipmentPolicy.findMany({
      where: { appliesToDepartmentId: group.id, appliesToTitle: { not: null } },
      include: { slots: { orderBy: { id: "asc" } } },
      orderBy: { name: "asc" },
    }),
    prisma.equipmentPolicy.findMany({
      select: { id: true, name: true, appliesToTitle: true, appliesToDepartmentId: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const missing = await resolveMissing(employees);
  const short = employees.filter((e) => (missing.get(e.id) ?? 0) > 0).length;

  const byTitle = new Map<string, { title: string; count: number }>();
  for (const e of employees) {
    const entry = byTitle.get(e.title) ?? { title: e.title, count: 0 };
    entry.count += 1;
    byTitle.set(e.title, entry);
  }
  const titleCounts = [...byTitle.values()];
  const heads = headcountByPolicy(titleCounts.map((t) => ({ ...t, departmentId: group.id })), policies);
  // a new base list would decide for everyone no title rule (the group's or an older global one) already covers
  const uncovered = titleCounts
    .filter((t) => !resolvePolicy({ title: t.title, departmentId: group.id }, policies))
    .reduce((n, t) => n + t.count, 0);

  const isClient = group.kind === "CLIENT";
  const status = !base
    ? "no policy"
    : short > 0
      ? `${plural(short, "person", "people")} missing something`
      : "everyone fully equipped";

  return (
    <Card className="flex min-w-0 flex-col gap-4 p-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-fg-muted">
            {isClient ? "Client" : "Internal department"}
          </span>
          <h2 className="text-[17px] font-semibold leading-tight text-fg">{group.name}</h2>
          <p className="text-xs text-fg-secondary">{plural(group.people, "person", "people")} · {status}</p>
        </div>
        <Link href={`/employees?department=${group.id}`} className="text-xs text-accent hover:underline">
          See their staff →
        </Link>
      </header>

      {base ? (
        <PolicyLinesEditor
          key={editorKeyOf(base.id, base.slots)}
          departmentId={group.id} groupName={group.name} kind={group.kind} policyId={base.id} title={null}
          initialLines={linesOf(base.slots)} categories={categories} people={heads.get(base.id) ?? 0}
          canMutate={canMutate} untypedNames={untypedOf(base.slots)}
          actions={canMutate ? <BasePolicyActions policyId={base.id} groupName={group.name} kind={group.kind} targets={targets} /> : undefined}
        />
      ) : (
        <StartPolicy
          departmentId={group.id} groupName={group.name} kind={group.kind}
          staff={group.people} people={uncovered} sources={sources} categories={categories} canMutate={canMutate}
        />
      )}

      {base && (
        <TitleRules
          departmentId={group.id} groupName={group.name} kind={group.kind}
          rules={titleRules.map((p) => ({
            policyId: p.id,
            title: p.appliesToTitle!,
            lines: linesOf(p.slots),
            people: heads.get(p.id) ?? 0,
            editorKey: editorKeyOf(p.id, p.slots),
            untypedNames: untypedOf(p.slots),
          }))}
          baseLines={linesOf(base.slots)} categories={categories} canMutate={canMutate} titleCounts={titleCounts}
        />
      )}
    </Card>
  );
}
