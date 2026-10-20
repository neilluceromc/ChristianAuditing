import type { Metadata } from "next";
import { pageTitle } from "@/lib/page-title";
import { requireRole } from "@/server/auth/guards";
import { PageHeader } from "@/components/ui/page-header";
import { CrisAtWork } from "@/components/cris/cris-at-work";

export const metadata: Metadata = { title: pageTitle("Disposal") };

/**
 * Phase 47 spec §5.2: a placeholder, guarded like the other Finance pages, until disposals are built. Task 10 (owner,
 * 2026-10-21): its body is the "Cris at Work" scene; the sidebar and top bar stay as on every page.
 */
export default async function DisposalPage() {
  await requireRole("admin", "finance_staff");
  return (
    <>
      <PageHeader title="Disposal" />
      <div className="flex justify-center">
        <CrisAtWork />
      </div>
    </>
  );
}
