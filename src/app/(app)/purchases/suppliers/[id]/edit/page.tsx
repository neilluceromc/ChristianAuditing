import type { Metadata } from "next";
import { pageTitle } from "@/lib/page-title";
import { supplierNameFor } from "@/server/page-titles";
import { notFound } from "next/navigation";
import { requireRole } from "@/server/auth/guards";
import { prisma } from "@/server/db/client";
import { supplierCategories } from "@/server/modules/suppliers/queries";
import type { SupplierInput } from "@/lib/supplier-schema";
import { PageHeader } from "@/components/ui/page-header";
import { SupplierForm } from "@/components/suppliers/supplier-form";

const toDateInput = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return { title: pageTitle("Edit", await supplierNameFor(id)) };
}

export default async function EditSupplierPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole("admin", "purchasing_staff");
  const { id } = await params;
  const [vendor, categories] = await Promise.all([
    prisma.vendor.findUnique({ where: { id } }),
    supplierCategories(),
  ]);
  if (!vendor) notFound();

  const initial: SupplierInput = {
    name: vendor.name,
    registeredName: vendor.registeredName ?? "",
    category: vendor.category ?? "",
    contactPerson: vendor.contactPerson ?? "",
    phone: vendor.phone ?? "",
    email: vendor.email ?? "",
    address: vendor.address ?? "",
    registrationNo: vendor.registrationNo ?? "",
    contractStatus: vendor.contractStatus,
    contractStart: toDateInput(vendor.contractStart),
    contractEnd: toDateInput(vendor.contractEnd),
    contractTerms: vendor.contractTerms ?? "",
    notes: vendor.notes ?? "",
  };

  return (
    <>
      <PageHeader
        title={`Edit ${vendor.name}`}
        breadcrumb={[
          { label: "Purchase orders", href: "/purchases" },
          { label: "Vendors", href: "/purchases/suppliers" },
          { label: vendor.name, href: `/purchases/suppliers/${id}` },
          { label: "Edit" },
        ]}
      />
      <SupplierForm mode="edit" id={id} initial={initial} categories={categories} />
    </>
  );
}
