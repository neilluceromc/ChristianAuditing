import { requireUser } from "@/server/auth/guards";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Pill } from "@/components/ui/pill";

export default async function InventoryActivityPage() {
  await requireUser();
  return (
    <>
      <PageHeader title="Inventory activity" badge={<Pill>PLANNED</Pill>} />
      <EmptyState
        title="This screen arrives in Phase 4"
        description="/inventory/activity is on the roadmap — the navigation is real, the page isn't built yet."
      />
    </>
  );
}
