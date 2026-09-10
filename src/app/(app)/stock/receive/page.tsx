import { requireRole } from "@/server/auth/guards";
import { prisma } from "@/server/db/client";
import { stockItemOptions } from "@/server/modules/stock/queries";
import { supplierOptions } from "@/server/modules/suppliers/queries";
import { toSearchParams } from "@/lib/url-state";
import { PageHeader } from "@/components/ui/page-header";
import { ReceiveForm, type StockItemMeta } from "@/components/stock/receive-form";

export default async function ReceiveStockPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireRole("admin", "purchasing_staff");
  const sp = toSearchParams(await searchParams);
  const initialItemId = sp.get("item");

  const [items, suppliers, metaRows] = await Promise.all([
    stockItemOptions(),
    supplierOptions(),
    prisma.stockItem.findMany({
      where: { archivedAt: null },
      select: { id: true, code: true, unit: true, packSize: true },
    }),
  ]);
  const meta: Record<string, StockItemMeta> = {};
  for (const r of metaRows) meta[r.id] = { unit: r.unit, packSize: r.packSize, code: r.code };

  return (
    <>
      <PageHeader title="Receive stock" breadcrumb={[{ label: "Stock items", href: "/stock" }, { label: "Receive" }]} />
      <ReceiveForm items={items} meta={meta} suppliers={suppliers} initialItemId={initialItemId} />
    </>
  );
}
