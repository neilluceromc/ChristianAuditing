import { requireRole } from "@/server/auth/guards";
import { equipmentByGroup } from "@/server/modules/reports/equipment";
import { canSeeMoney } from "@/lib/equipment-report";
import { pathAllowedForRole } from "@/lib/workspaces";
import { fmtMoney } from "@/lib/format";
import { toSearchParams } from "@/lib/url-state";
import { cn } from "@/lib/cn";
import { ButtonLink } from "@/components/ui/button-link";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs } from "@/components/ui/tabs";
import { EquipmentTable, type ReportTab } from "@/components/reports/equipment-table";
import { GroupDetail } from "@/components/reports/group-detail";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function StatCard({ label, value, hint, color }: { label: string; value: React.ReactNode; hint?: string; color?: string }) {
  return (
    <Card className="flex flex-col gap-0.5 px-4 py-3">
      <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.09em] text-fg-muted">{label}</span>
      <span className={cn("font-mono text-lg font-semibold leading-tight", !color && "text-fg")} style={color ? { color } : undefined}>
        {value}
      </span>
      {hint && <span className="text-[10.5px] text-fg-muted">{hint}</span>}
    </Card>
  );
}

/**
 * Phase 38 (spec §3): what each client's team (or internal department) holds, what it is worth, and who is still
 * missing something. Every value is computed on request. Peso amounts are computed and sent only for Finance and
 * Admin (`canSeeMoney`): for anyone else the query never selects a cost and no money prop is passed below.
 */
export default async function EquipmentByClientPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireRole("admin", "it_staff", "finance_staff", "viewer");
  const withMoney = canSeeMoney(user.role);
  // Links are drawn only where the middleware would let this role through (admin, it_staff, viewer for staff;
  // admin, it_staff for Departments & clients) — only these booleans reach the client.
  const canOpenStaff = pathAllowedForRole("/employees", user.role);
  const canManageGroups = pathAllowedForRole("/admin/departments", user.role);
  const params = toSearchParams(await searchParams);
  const tab: ReportTab = params.get("tab") === "internal" ? "internal" : "client";

  const { groups, counts, totals } = await equipmentByGroup({ kind: tab === "client" ? "CLIENT" : "INTERNAL", withMoney, now: new Date() });
  // a missing or unknown group (or one of the other tab) shows no panel
  const selected = groups.find((g) => g.id === params.get("group")) ?? null;
  const perPerson = (totals.items / Math.max(totals.people, 1)).toFixed(1);

  return (
    <>
      <PageHeader
        title="Equipment by client"
        actions={<ButtonLink href={`/equipment-by-client/export?tab=${tab}`} size="sm" native>Export all (.xlsx)</ButtonLink>}
      />
      <p className="-mt-2 pb-4 text-[12.5px] text-fg-muted">
        What each client&apos;s team holds, what it is worth, and who is still missing something.
      </p>
      <div className="flex flex-col gap-3">
        <Tabs
          label="Kind of staff group"
          items={[
            {
              label: <>Clients <span className="font-mono text-[11px] text-fg-muted">{counts.client}</span></>,
              href: "/equipment-by-client",
              active: tab === "client",
            },
            {
              label: <>Internal departments <span className="font-mono text-[11px] text-fg-muted">{counts.internal}</span></>,
              href: "/equipment-by-client?tab=internal",
              active: tab === "internal",
            },
          ]}
        />

        <div className={cn("grid gap-3 sm:grid-cols-2", totals.money ? "lg:grid-cols-4" : "lg:grid-cols-3")}>
          <StatCard
            label={tab === "client" ? "Client staff" : "Internal staff"}
            value={totals.people}
            hint={tab === "client" ? plural(groups.length, "client", "clients") : plural(groups.length, "department", "departments")}
          />
          <StatCard label="Items held" value={totals.items} hint={`${perPerson} per person`} />
          {totals.money && (
            <StatCard label="Book value today" value={fmtMoney(totals.money.bookC / 100)} hint={`cost ${fmtMoney(totals.money.costC / 100)}`} />
          )}
          <StatCard
            label="People missing something"
            value={totals.missing}
            hint={`${totals.fullyPct}% fully equipped`}
            color={totals.missing > 0 ? "var(--st-fault-text)" : "var(--st-settled-text)"}
          />
        </div>

        <div className={cn("grid items-start gap-4", selected && "lg:grid-cols-[minmax(0,1fr)_340px]")}>
          {/* keyed by tab: a tab switch starts the search, filter and sort afresh */}
          <EquipmentTable
            key={tab} tab={tab} rows={groups} withMoney={withMoney} selectedId={selected?.id ?? null} canManageGroups={canManageGroups}
          />
          {selected && <GroupDetail key={selected.id} group={selected} tab={tab} withMoney={withMoney} canOpenStaff={canOpenStaff} />}
        </div>
      </div>
    </>
  );
}
