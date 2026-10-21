import type { Metadata } from "next";
import { pageTitle } from "@/lib/page-title";
import { requireRole } from "@/server/auth/guards";
import { prisma } from "@/server/db/client";
import { PO_WRITE_ROLES } from "@/lib/po-flow";
import { policyLoadouts } from "@/server/modules/purchases/queries";
import { PageHeader } from "@/components/ui/page-header";
import { PoForm } from "@/components/purchases/po-form";

export const metadata: Metadata = { title: pageTitle("New purchase order") };

export default async function NewPurchasePage() {
  await requireRole(...PO_WRITE_ROLES);
  const [loadouts, departments, vendors, categories] = await Promise.all([
    policyLoadouts(),
    prisma.department.findMany({ select: { id: true, name: true, kind: true, archivedAt: true }, orderBy: { name: "asc" } }),
    prisma.vendor.findMany({ where: { archivedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.assetCategory.findMany({ select: { id: true, name: true, cls: true }, orderBy: { name: "asc" } }),
  ]);

  return (
    <>
      <PageHeader
        title="New purchase order"
        breadcrumb={[{ label: "Purchase orders", href: "/purchases" }, { label: "New" }]}
      />
      <PoForm loadouts={loadouts} departments={departments} vendors={vendors} categories={categories} />
    </>
  );
}
