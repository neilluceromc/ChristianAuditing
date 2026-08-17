import { requireRole } from "@/server/auth/guards";
import { DRAFT_ROLES } from "@/lib/purchase-flow";
import { policyLoadouts } from "@/server/modules/purchases/queries";
import { PageHeader } from "@/components/ui/page-header";
import { DraftForm } from "@/components/purchases/draft-form";

export default async function NewPurchasePage() {
  await requireRole(...DRAFT_ROLES);
  const loadouts = await policyLoadouts();

  return (
    <>
      <PageHeader
        title="Register purchase"
        breadcrumb={[{ label: "Purchase requests", href: "/purchases" }, { label: "New" }]}
      />
      <DraftForm loadouts={loadouts} />
    </>
  );
}
