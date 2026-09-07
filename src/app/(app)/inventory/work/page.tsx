import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/guards";
import { canManageClass } from "@/lib/asset-class";
import { ROLE_LANDING } from "@/lib/workspaces";
import { worklist } from "@/server/modules/home/queries";
import { PageHeader } from "@/components/ui/page-header";
import { Worklist } from "@/components/home/worklist";

export default async function WorklistPage() {
  const user = await requireUser();
  // Viewer reads the whole worklist (read-only, no Clear button); every
  // other role needs to manage IT directly — same test spec-13's page-level
  // checks already use elsewhere in inventory/.
  if (!canManageClass(user.role, "IT") && user.role !== "viewer") redirect(ROLE_LANDING[user.role]);

  const groups = await worklist(user.id, user.role, {});

  return (
    <>
      <PageHeader
        title="Worklist"
        breadcrumb={[{ label: "Inventory", href: "/inventory" }, { label: "Worklist" }]}
      />
      <div className="max-w-[980px]">
        <Worklist groups={groups} canAct={user.role !== "viewer"} />
      </div>
    </>
  );
}
