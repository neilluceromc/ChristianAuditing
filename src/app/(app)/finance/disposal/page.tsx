import type { Metadata } from "next";
import { pageTitle } from "@/lib/page-title";
import { requireRole } from "@/server/auth/guards";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Card } from "@/components/ui/card";

export const metadata: Metadata = { title: pageTitle("Disposal") };

/** Phase 47 spec §5.2: a placeholder, guarded like the other Finance pages, until disposals are built. */
export default async function DisposalPage() {
  await requireRole("admin", "finance_staff");
  return (
    <>
      <PageHeader title="Disposal" />
      <Card>
        <EmptyState title="Still in development" description="Recording disposals and their value will come here." />
      </Card>
    </>
  );
}
