import { notFound, redirect } from "next/navigation";
import { requireRole } from "@/server/auth/guards";
import { DRAFT_ROLES } from "@/lib/purchase-flow";
import { getPurchase, policyLoadouts } from "@/server/modules/purchases/queries";
import { PageHeader } from "@/components/ui/page-header";
import { DraftForm, type UnitDraft } from "@/components/purchases/draft-form";

export default async function EditPurchasePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole(...DRAFT_ROLES);
  const { id } = await params;
  const [request, loadouts] = await Promise.all([getPurchase(id), policyLoadouts()]);
  if (!request) notFound();
  // only a draft is editable, and only by its requester (or an admin) — the
  // server action enforces both; this keeps the dead end off the screen
  if (request.state !== "DRAFT") redirect(`/purchases/${id}`);
  if (request.requestedById !== user.id && user.role !== "admin") redirect(`/purchases/${id}`);

  const units: UnitDraft[] = request.units.map((u) => ({
    id: u.id,
    description: u.description,
    specs: u.specs ?? "",
    qty: String(u.qty),
    unitPrice: u.unitPrice === null ? "" : String(u.unitPrice),
  }));

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
      <DraftForm loadouts={loadouts} initial={{ id: request.id, refNo: request.refNo, units }} />
    </>
  );
}
