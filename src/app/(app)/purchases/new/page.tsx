import type { Metadata } from "next";
import { pageTitle } from "@/lib/page-title";
import { requireRole } from "@/server/auth/guards";
import { prisma } from "@/server/db/client";
import { PO_WRITE_ROLES } from "@/lib/po-flow";
import { policyLoadouts } from "@/server/modules/purchases/queries";
import { poCategories } from "@/server/modules/purchases/po-categories";
import { PageHeader } from "@/components/ui/page-header";
import { Pill } from "@/components/ui/pill";
import { PoForm } from "@/components/purchases/po-form/po-form";

/** What the PO form's vendor card shows: the seller block (spec §2.4). */
const VENDOR_SELECT = { id: true, name: true, registeredName: true, registrationNo: true, address: true } as const;

export const metadata: Metadata = { title: pageTitle("New purchase order") };

export default async function NewPurchasePage() {
  await requireRole(...PO_WRITE_ROLES);
  const [loadouts, departments, vendors, categories] = await Promise.all([
    policyLoadouts(),
    prisma.department.findMany({ select: { id: true, name: true, kind: true, archivedAt: true }, orderBy: { name: "asc" } }),
    prisma.vendor.findMany({ where: { archivedAt: null }, select: VENDOR_SELECT, orderBy: { name: "asc" } }),
    poCategories(),
  ]);

  return (
    <>
      <PageHeader
        title="New purchase order"
        breadcrumb={[{ label: "Purchase orders", href: "/purchases" }, { label: "New" }]}
        badge={<Pill>Not saved</Pill>}
      />
      <PoForm loadouts={loadouts} departments={departments} vendors={vendors} categories={categories} />
    </>
  );
}
