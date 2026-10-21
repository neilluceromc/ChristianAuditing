import type { Metadata } from "next";
import type { AssetClass } from "@prisma/client";
import { notFound, redirect } from "next/navigation";
import { pageTitle } from "@/lib/page-title";
import { purchaseRefFor } from "@/server/page-titles";
import { requireRole } from "@/server/auth/guards";
import { getPurchase } from "@/server/modules/purchases/queries";
import { registerCatalog } from "@/server/modules/inventory/register-queries";
import { canRegisterLine } from "@/lib/po-flow";
import { poControls } from "@/lib/po-controls";
import { fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { PoRegisterForm, type PoRegisterLine } from "@/components/purchases/po-register-form";

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

  // Classes this person may register on this PO — what a legacy line's category may be picked from.
  const classes = (["IT", "PURCHASING"] as AssetClass[]).filter((c) => canRegisterLine(user.role, c, po.state).ok);
  const catalog = await registerCatalog(classes);

  const lines: PoRegisterLine[] = po.units
    .filter((u) => u.remaining > 0)
    .map((u) => {
      const verdict = u.cls
        ? canRegisterLine(user.role, u.cls, po.state)
        : classes.length > 0 ? { ok: true as const } : canRegisterLine(user.role, "IT", po.state);
      return {
        id: u.id, index: u.index, description: u.description, specs: u.specs,
        categoryId: u.categoryId, categoryName: u.categoryName, cls: u.cls,
        price: u.price, remaining: u.remaining, progressLabel: u.progressLabel,
        blocked: verdict.ok ? null : verdict.why,
      };
    });

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
