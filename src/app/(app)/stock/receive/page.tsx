import { requireRole } from "@/server/auth/guards";
import { prisma } from "@/server/db/client";
import { stockItemOptions } from "@/server/modules/stock/queries";
import { supplierOptions } from "@/server/modules/suppliers/queries";
import { recentPicks } from "@/server/recent-picks";
import { toSearchParams } from "@/lib/url-state";
import { PageHeader } from "@/components/ui/page-header";
import { ReceiveForm, type StockItemMeta } from "@/components/stock/receive-form";

export default async function ReceiveStockPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireRole("admin", "purchasing_staff");
  const sp = toSearchParams(await searchParams);
  const initialItemId = sp.get("item");

  const [items, supplierRows, metaRows, recentItems, recentVendors] = await Promise.all([
    stockItemOptions(),
    supplierOptions(),
    prisma.stockItem.findMany({
      where: { archivedAt: null },
      select: { id: true, code: true, unit: true, packSize: true },
    }),
    recentPicks(user.id, "stock-item"),
    recentPicks(user.id, "vendor"),
  ]);
  // Leftover 3 (spec §8): receive-form.tsx's SupplierOption never used
  // `archived` (supplierOptions() with no includeId never returns one
  // anyway) — stripped here rather than widening the form's own type.
  const suppliers = supplierRows.map(({ id, name }) => ({ id, name }));
  const meta: Record<string, StockItemMeta> = {};
  for (const r of metaRows) meta[r.id] = { unit: r.unit, packSize: r.packSize, code: r.code };

  return (
    <>
      <PageHeader title="Receive stock" breadcrumb={[{ label: "Stock items", href: "/stock" }, { label: "Receive" }]} />
      <ReceiveForm
        items={items}
        meta={meta}
        suppliers={suppliers}
        recentItems={recentItems}
        recentVendors={recentVendors}
        initialItemId={initialItemId}
      />
    </>
  );
}
