import type { Metadata } from "next";
import { pageTitle } from "@/lib/page-title";
import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/guards";

export const metadata: Metadata = { title: pageTitle("Stock reports") };

/** Spec §3: `/stock/reports` is a bare redirect to the on-hand report — the first of the three tabs. */
export default async function StockReportsPage() {
  await requireUser();
  redirect("/stock/reports/on-hand");
}
