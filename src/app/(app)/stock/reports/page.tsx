import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/guards";

/** Spec §3: `/stock/reports` is a bare redirect to the on-hand report — the first of the three tabs. */
export default async function StockReportsPage() {
  await requireUser();
  redirect("/stock/reports/on-hand");
}
