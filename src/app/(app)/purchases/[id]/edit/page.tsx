import type { Metadata } from "next";
import { pageTitle } from "@/lib/page-title";
import { purchaseRefFor } from "@/server/page-titles";
import { notFound, redirect } from "next/navigation";
import { requireRole } from "@/server/auth/guards";
import { prisma } from "@/server/db/client";
import { PO_WRITE_ROLES } from "@/lib/po-flow";
import { poControls } from "@/lib/po-controls";
import { getPurchase, policyLoadouts } from "@/server/modules/purchases/queries";
import { PageHeader } from "@/components/ui/page-header";
import { PoForm, type UnitDraft } from "@/components/purchases/po-form";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return { title: pageTitle("Edit", await purchaseRefFor(id)) };
}

export default async function EditPurchasePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole(...PO_WRITE_ROLES);
  const { id } = await params;
  const [request, loadouts, departments, vendors, categories] = await Promise.all([
    getPurchase(id),
    policyLoadouts(),
    prisma.department.findMany({ select: { id: true, name: true, kind: true, archivedAt: true }, orderBy: { name: "asc" } }),
    prisma.vendor.findMany({ where: { archivedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.assetCategory.findMany({ select: { id: true, name: true, cls: true }, orderBy: { name: "asc" } }),
  ]);
  if (!request) notFound();
  // The same rule as the Edit button (poControls mirrors savePurchaseOrder's stage check); this keeps the dead end off
  // the screen. The server re-checks.
  const { edit } = poControls({
    role: user.role, state: request.state, registeredCount: request.assetCount, approvedCount: request.approvedCount,
    lines: request.units.map((u) => ({ id: u.id, cls: u.cls, qty: u.qty, registered: u.registered, closedShort: u.closedShort })),
  });
  if (!edit) redirect(`/purchases/${id}`);

  const units: UnitDraft[] = request.units.map((u) => ({
    id: u.id,
    description: u.description,
    specs: u.specs ?? "",
    categoryId: u.categoryId ?? "",
    qty: String(u.qty),
    unitPrice: u.unitPrice === null ? "" : String(u.unitPrice),
    locked: u.registered + u.closedShort,
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
          { label: "Purchase orders", href: "/purchases" },
          { label: request.refNo, href: `/purchases/${id}` },
          { label: "Edit" },
        ]}
      />
      <PoForm
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
