import type { Metadata } from "next";
import { pageTitle } from "@/lib/page-title";
import { requireRole } from "@/server/auth/guards";
import { prisma } from "@/server/db/client";
import { PO_WRITE_ROLES } from "@/lib/po-flow";
import { policyLoadouts } from "@/server/modules/purchases/queries";
import { PageHeader } from "@/components/ui/page-header";
import { DraftForm } from "@/components/purchases/draft-form";

export const metadata: Metadata = { title: pageTitle("Register purchase") };

export default async function NewPurchasePage() {
  await requireRole(...PO_WRITE_ROLES);
  const [loadouts, departments] = await Promise.all([
    policyLoadouts(),
    prisma.department.findMany({ select: { id: true, name: true, kind: true, archivedAt: true }, orderBy: { name: "asc" } }),
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
