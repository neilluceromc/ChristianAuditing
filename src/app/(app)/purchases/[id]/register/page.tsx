import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { pageTitle } from "@/lib/page-title";
import { purchaseRefFor } from "@/server/page-titles";
import { requireRole } from "@/server/auth/guards";
import { getPurchase } from "@/server/modules/purchases/queries";
import { poRegisterModel } from "@/server/modules/purchases/po-register-model";
import { poControls } from "@/lib/po-controls";
import { fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { PoRegisterForm } from "@/components/purchases/po-register-form";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return { title: pageTitle("Register", await purchaseRefFor(id)) };
}

/**
 * Spec §4 ways 1 and 2: Register on a purchase order. The form is pre-filled from the PO's lines — class and money
 * come from the PO; the person registering adds the tags and, per unit, the serial (required for IT gear), plus the
 * model and warranty. IT registers the IT lines, Purchasing the others (canRegisterLine); a line the viewer can't
 * register is listed with why. Part of a line may be registered now and the rest later (partial deliveries).
 */
export default async function RegisterFromPoPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole("admin", "it_staff", "purchasing_staff");
  const { id } = await params;
  const po = await getPurchase(id);
  if (!po) notFound();

  // The Register button's own rule (poControls); this keeps the dead end off the screen. The server re-checks.
  const { register } = poControls({
    role: user.role, state: po.state, registeredCount: po.assetCount, approvedCount: po.approvedCount,
    lines: po.units.map((u) => ({ id: u.id, cls: u.cls, qty: u.qty, registered: u.registered, closedShort: u.closedShort })),
  });
  if (!register) redirect(`/purchases/${id}`);

  // The lines with units left and the catalog, which carries each line's own (even new) category (poRegisterModel).
  const { lines, catalog } = await poRegisterModel(po, user.role);

  const facts = [
    po.supplier?.name ?? "no supplier",
    po.invoiceRef ? `SI ${po.invoiceRef}` : "no SI number yet",
    po.purchasedAt ? `bought ${fmtDate(`${po.purchasedAt}T00:00:00Z`)}` : null,
  ].filter(Boolean).join(" · ");

  return (
    <>
      <PageHeader
        title={`Register from ${po.refNo}`}
        breadcrumb={[
          { label: "Purchase orders", href: "/purchases" },
          { label: po.refNo, href: `/purchases/${id}` },
          { label: "Register" },
        ]}
      />
      <p className="-mt-2 pb-4 font-mono text-[11px] text-fg-muted">
        {facts} · each asset takes these and its line&apos;s unit price
      </p>
      <PoRegisterForm poId={po.id} refNo={po.refNo} lines={lines} catalog={catalog} />
    </>
  );
}
