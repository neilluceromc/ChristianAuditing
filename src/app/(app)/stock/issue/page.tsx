import { requireRole } from "@/server/auth/guards";
import { prisma } from "@/server/db/client";
import { stockItemBalances, stockItemOptions } from "@/server/modules/stock/queries";
import { toSearchParams } from "@/lib/url-state";
import { PageHeader } from "@/components/ui/page-header";
import { IssueForm, type DepartmentOption, type EmployeeOption } from "@/components/stock/issue-form";
import type { StockItemMeta } from "@/components/stock/receive-form";

export default async function IssueStockPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireRole("admin", "purchasing_staff");
  const sp = toSearchParams(await searchParams);
  const initialItemId = sp.get("item");

  const [items, departmentRows, employeeRows, metaRows] = await Promise.all([
    stockItemOptions(),
    prisma.department.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.employee.findMany({
      where: { employment: "ACTIVE" }, orderBy: { name: "asc" }, select: { id: true, name: true, employeeNo: true },
    }),
    prisma.stockItem.findMany({
      where: { archivedAt: null }, select: { id: true, code: true, unit: true, packSize: true },
    }),
  ]);

  // R3: stockItemBalances(ids) returns a Map — a Map never crosses to a client component, so it's
  // converted to a plain Record here before it reaches <IssueForm>.
  const balanceMap = await stockItemBalances(items.map((i) => i.value));
  const balances: Record<string, number> = Object.fromEntries(balanceMap);

  const meta: Record<string, StockItemMeta> = {};
  for (const r of metaRows) meta[r.id] = { unit: r.unit, packSize: r.packSize, code: r.code };

  const departments: DepartmentOption[] = departmentRows;
  const employees: EmployeeOption[] = employeeRows;

  return (
    <>
      <PageHeader title="Issue stock" breadcrumb={[{ label: "Stock items", href: "/stock" }, { label: "Issue" }]} />
      <IssueForm
        items={items}
        meta={meta}
        balances={balances}
        departments={departments}
        employees={employees}
        initialItemId={initialItemId}
      />
    </>
  );
}
