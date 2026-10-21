import type { Metadata } from "next";
import { pageTitle } from "@/lib/page-title";
import { purchaseRefFor } from "@/server/page-titles";
import { notFound, redirect } from "next/navigation";
import { requireRole } from "@/server/auth/guards";
import { prisma } from "@/server/db/client";
import { PO_WRITE_ROLES } from "@/lib/po-flow";
import { getPurchase, policyLoadouts } from "@/server/modules/purchases/queries";
import { PageHeader } from "@/components/ui/page-header";
import { DraftForm, type UnitDraft } from "@/components/purchases/draft-form";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return { title: pageTitle("Edit", await purchaseRefFor(id)) };
}

export default async function EditPurchasePage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole(...PO_WRITE_ROLES);
  const { id } = await params;
  const [request, loadouts, departments, vendors, categories] = await Promise.all([
    getPurchase(id),
    policyLoadouts(),
    prisma.department.findMany({ select: { id: true, name: true, kind: true, archivedAt: true }, orderBy: { name: "asc" } }),
    prisma.vendor.findMany({ where: { archivedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.assetCategory.findMany({ select: { id: true, name: true, cls: true }, orderBy: { name: "asc" } }),
  ]);
  if (!request) notFound();
  // Editable while sent back, or with IT / ready with nothing registered (savePurchaseOrder enforces it, team-wide);
  // this keeps the dead end off the screen.
  const editable = request.state === "SENT_BACK"
    || ((request.state === "WITH_IT" || request.state === "READY") && request.assetCount === 0);
  if (!editable) redirect(`/purchases/${id}`);

  const units: UnitDraft[] = request.units.map((u) => ({
    id: u.id,
    description: u.description,
    specs: u.specs ?? "",
    categoryId: u.categoryId ?? "",
    qty: String(u.qty),
    unitPrice: u.unitPrice === null ? "" : String(u.unitPrice),
  }));
  // an edit keeps the current supplier even when it has since been archived
  const supplierOptions = request.supplier?.archived
    ? [...vendors, { id: request.supplier.id, name: request.supplier.name }]
    : vendors;

  return (
    <>
      <PageHeader
        title={`Edit ${request.refNo}`}
        breadcrumb={[
          { label: "Purchase requests", href: "/purchases" },
          { label: request.refNo, href: `/purchases/${id}` },
          { label: "Edit" },
        ]}
      />
      <DraftForm
        loadouts={loadouts}
        departments={departments}
        vendors={supplierOptions}
        categories={categories}
        initial={{
          id: request.id, refNo: request.refNo, state: request.state, units,
          departmentId: request.department?.id ?? null, vendorId: request.supplier?.id ?? null,
          invoiceRef: request.invoiceRef, receiptRef: request.receiptRef, purchasedAt: request.purchasedAt, fees: request.fees,
          sentBack: request.sentBack,
        }}
      />
    </>
  );
}
