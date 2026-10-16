import type { Metadata } from "next";
import { pageTitle } from "@/lib/page-title";
import { requireRole } from "@/server/auth/guards";
import { prisma } from "@/server/db/client";
import { stockItemBalances, stockItemOptions } from "@/server/modules/stock/queries";
import { recentPeopleOptions } from "@/server/modules/employees/queries";
import { recentPicks } from "@/server/recent-picks";
import { toSearchParams } from "@/lib/url-state";
import { PageHeader } from "@/components/ui/page-header";
import { IssueForm, type DepartmentOption } from "@/components/stock/issue-form";
import type { StockItemMeta } from "@/components/stock/receive-form";

export const metadata: Metadata = { title: pageTitle("Issue stock") };

export default async function IssueStockPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireRole("admin", "purchasing_staff");
  const sp = toSearchParams(await searchParams);
  const initialItemId = sp.get("item");

  const [items, departmentRows, metaRows, recentPeople, recentItems] = await Promise.all([
    stockItemOptions(),
    prisma.department.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, kind: true, archivedAt: true } }),
    prisma.stockItem.findMany({
      where: { archivedAt: null }, select: { id: true, code: true, unit: true, packSize: true },
    }),
    recentPeopleOptions(user.id),
    recentPicks(user.id, "stock-item"),
  ]);

  // R3: stockItemBalances(ids) returns a Map — a Map never crosses to a client component, so it's
  // converted to a plain Record here before it reaches <IssueForm>.
  const balanceMap = await stockItemBalances(items.map((i) => i.value));
  const balances: Record<string, number> = Object.fromEntries(balanceMap);

  const meta: Record<string, StockItemMeta> = {};
  for (const r of metaRows) meta[r.id] = { unit: r.unit, packSize: r.packSize, code: r.code };

  const departments: DepartmentOption[] = departmentRows;

  return (
    <>
      <PageHeader title="Issue stock" breadcrumb={[{ label: "Stock items", href: "/stock" }, { label: "Issue" }]} />
      <IssueForm
        items={items}
        meta={meta}
        balances={balances}
        departments={departments}
        recentPeople={recentPeople}
        recentItems={recentItems}
        initialItemId={initialItemId}
      />
    </>
  );
}
