import { requireRole } from "@/server/auth/guards";
import { prisma } from "@/server/db/client";
import { DRAFT_ROLES } from "@/lib/purchase-flow";
import { policyLoadouts } from "@/server/modules/purchases/queries";
import { PageHeader } from "@/components/ui/page-header";
import { DraftForm } from "@/components/purchases/draft-form";

export default async function NewPurchasePage() {
  await requireRole(...DRAFT_ROLES);
  const [loadouts, departments] = await Promise.all([
    policyLoadouts(),
    prisma.department.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  return (
    <>
      <PageHeader
        title="Register purchase"
        breadcrumb={[{ label: "Purchase requests", href: "/purchases" }, { label: "New" }]}
      />
      <DraftForm loadouts={loadouts} departments={departments} />
    </>
  );
}
