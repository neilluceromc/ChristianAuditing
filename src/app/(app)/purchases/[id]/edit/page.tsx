import type { Metadata } from "next";
import { pageTitle } from "@/lib/page-title";
import { purchaseRefFor } from "@/server/page-titles";
import { notFound, redirect } from "next/navigation";
import { requireRole } from "@/server/auth/guards";
import { prisma } from "@/server/db/client";
import { PO_WRITE_ROLES } from "@/lib/po-flow";
import { poControls } from "@/lib/po-controls";
import { getPurchase, policyLoadouts } from "@/server/modules/purchases/queries";
import { poCategories } from "@/server/modules/purchases/po-categories";
import { formatTypedMoney, TOTAL_KEYS, type TotalKey } from "@/lib/po-totals";
import { PO_DOCUMENT_SLOTS } from "@/lib/documents";
import { PageHeader } from "@/components/ui/page-header";
import { PoForm, type InitialLine, type PoFormInitial } from "@/components/purchases/po-form/po-form";

/** What the PO form's vendor card shows: the seller block (spec §2.4). */
const VENDOR_SELECT = { id: true, name: true, registeredName: true, registrationNo: true, address: true } as const;

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
    // an edit keeps the current vendor even when it has since been archived
    prisma.vendor.findMany({
      where: { OR: [{ archivedAt: null }, { requests: { some: { id } } }] }, select: VENDOR_SELECT, orderBy: { name: "asc" },
    }),
    poCategories(),
  ]);
  if (!request) notFound();
  // The same rule as the Edit button (poControls mirrors savePurchaseOrder's stage check); this keeps the dead end off
  // the screen. The server re-checks.
  const { edit } = poControls({
    role: user.role, state: request.state, registeredCount: request.assetCount, approvedCount: request.approvedCount,
    lines: request.units.map((u) => ({ id: u.id, cls: u.cls, qty: u.qty, registered: u.registered, closedShort: u.closedShort })),
  });
  if (!edit) redirect(`/purchases/${id}`);

  const lines: InitialLine[] = request.units.map((u) => ({
    id: u.id,
    description: u.description,
    specs: u.specs ?? "",
    categoryId: u.categoryId ?? "",
    qty: String(u.qty),
    unit: u.unit,
    unitPrice: formatTypedMoney(u.unitPrice),
    locked: u.registered + u.closedShort,
  }));
  const totals = Object.fromEntries(TOTAL_KEYS.map((k) => [k, formatTypedMoney(request.totals[k])])) as Record<TotalKey, string>;
  // Each slot shows the newest document of its kind (getPurchase lists them newest first, removed ones left out).
  const onFile: PoFormInitial["onFile"] = {};
  for (const kind of PO_DOCUMENT_SLOTS) {
    const doc = request.documents.find((d) => d.kind === kind);
    if (doc) onFile[kind] = { fileName: doc.fileName, href: doc.downloadHref };
  }

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
        vendors={vendors}
        categories={categories}
        initial={{
          id: request.id, refNo: request.refNo, state: request.state, lines,
          departmentId: request.department?.id ?? null, vendorId: request.supplier?.id ?? null,
          poNumber: request.poNumber, invoiceRef: request.invoiceRef, receiptRef: request.receiptRef,
          purchasedAt: request.purchasedAt, paidBy: request.paidBy, totals,
          formV2: request.formV2,
          onFile,
          itRegistered: request.units.some((u) => u.cls === "IT" && u.registered > 0),
          sentBack: request.sentBack,
        }}
      />
    </>
  );
}
