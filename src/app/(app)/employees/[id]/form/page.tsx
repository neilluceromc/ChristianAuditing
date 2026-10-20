import type { Metadata } from "next";
import { pageTitle } from "@/lib/page-title";
import { employeeNameFor } from "@/server/page-titles";
import { requireUser } from "@/server/auth/guards";
import { PrintButton } from "@/components/ui/print-button";
import { EquipmentForm } from "@/components/employees/equipment-form";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return { title: pageTitle("Accountability form", await employeeNameFor(id)) };
}

export default async function AccountabilityFormPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;

  return (
    <div className="mx-auto max-w-[760px]">
      <div className="flex justify-end pb-3 print:hidden">
        <PrintButton />
      </div>
      <EquipmentForm employeeId={id} />
    </div>
  );
}
