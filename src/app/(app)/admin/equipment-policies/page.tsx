import { requireUser } from "@/server/auth/guards";
import { PageHeader } from "@/components/ui/page-header";

// Phase 37 Task 4: temporary body — the per-group policies page is rebuilt in Task 5.
export default async function EquipmentPoliciesPage() {
  await requireUser();
  return (
    <>
      <PageHeader title="Equipment policies" />
      <p className="text-xs text-fg-muted">Loading…</p>
    </>
  );
}
