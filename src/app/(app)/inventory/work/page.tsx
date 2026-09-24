import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/guards";
import { canManageClass, isDirectLifecycle } from "@/lib/asset-class";
import { ROLE_LANDING } from "@/lib/workspaces";
import { worklist } from "@/server/modules/home/queries";
import { activeEmployeeOptions } from "@/server/modules/employees/queries";
import { PageHeader } from "@/components/ui/page-header";
import { Worklist } from "@/components/home/worklist";
import { WorkSummary } from "@/components/home/work-summary";

export default async function WorklistPage() {
  const user = await requireUser();
  // Viewer reads the whole worklist (read-only, no row menu); every
  // other role needs to manage IT directly — same test spec-13's page-level
  // checks already use elsewhere in inventory/.
  if (!canManageClass(user.role, "IT") && user.role !== "viewer") redirect(ROLE_LANDING[user.role]);

  const groups = await worklist(user.id, user.role, {});
  // Only Assign… needs the people list (spec §5.1); skip the read otherwise.
  const employees = groups.some((g) => g.rows.some((r) => r.control?.kind === "assign")) ? await activeEmployeeOptions() : [];

  return (
    <>
      <PageHeader
        title="Worklist"
        breadcrumb={[{ label: "Inventory", href: "/inventory" }, { label: "Worklist" }]}
      />
      <div className="max-w-[980px]">
        <WorkSummary groups={groups} />
        <Worklist
          groups={groups}
          canAct={user.role !== "viewer"}
          direct={isDirectLifecycle(user.role, "IT")}
          employees={employees}
          headingLevel="h2"
        />
      </div>
    </>
  );
}
