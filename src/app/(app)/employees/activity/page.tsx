import { requireUser } from "@/server/auth/guards";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Pill } from "@/components/ui/pill";

export default async function EmployeeActivityPage() {
  await requireUser();
  return (
    <>
      <PageHeader title="Employee activity" badge={<Pill>PLANNED</Pill>} />
      <EmptyState
        title="This screen arrives in Phase 4"
        description="/employees/activity is on the roadmap — the navigation is real, the page isn't built yet."
      />
    </>
  );
}
