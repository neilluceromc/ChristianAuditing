import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth/guards";
import { getStockItem } from "@/server/modules/stock/queries";
import { canManageStock } from "@/lib/stock-access";
import { unitsLabel } from "@/lib/stock-balance";
import { toSearchParams } from "@/lib/url-state";
import { parsePage } from "@/lib/paging";
import { PageHeader } from "@/components/ui/page-header";
import { Pill } from "@/components/ui/pill";
import { ButtonLink } from "@/components/ui/button-link";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Stat } from "@/components/ui/stat";
import { Banner } from "@/components/ui/banner";
import { AdjustDialog } from "@/components/stock/adjust-dialog";
import { ItemArchiveControls } from "@/components/stock/item-archive-controls";
import { MovementHistory } from "@/components/stock/movement-history";

export default async function StockItemPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const sp = toSearchParams(await searchParams);
  const page = parsePage(sp);
  const item = await getStockItem(id, page);
  if (!item) notFound();

  const manage = canManageStock(user.role);

  return (
    <>
      <PageHeader
        title={`${item.code} · ${item.name}`}
        breadcrumb={[{ label: "Stock items", href: "/stock" }, { label: item.code }]}
        badge={
          <span className="inline-flex gap-2">
            <Pill>{item.category.name}</Pill>
            {item.low && <Pill tone="accent">LOW</Pill>}
            {item.archived && <Pill>ARCHIVED</Pill>}
          </span>
        }
        actions={
          manage ? (
            <>
              <ButtonLink href={`/stock/receive?item=${id}`}>Receive stock</ButtonLink>
              <ButtonLink href={`/stock/issue?item=${id}`}>Issue stock</ButtonLink>
              <AdjustDialog itemId={id} code={item.code} unit={item.unit} balance={item.balance} />
              <ButtonLink href={`/stock/items/${id}/edit`}>Edit item</ButtonLink>
              <ItemArchiveControls id={id} archived={item.archived} />
            </>
          ) : undefined
        }
      />

      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader title="Balance" />
          <CardBody className="flex flex-col gap-3">
            <Stat label="On hand" value={unitsLabel(item.balance, item.unit)} />
            <p className="text-xs text-fg-secondary">
              Reorder level: {item.reorderLevel > 0 ? item.reorderLevel : "none"}
            </p>
            {item.packSize && (
              <p className="text-xs text-fg-secondary">Pack size: {item.packSize} per pack</p>
            )}
            {item.notes && <p className="text-xs text-fg-secondary">{item.notes}</p>}
            {item.low && (
              <Banner
                tone="attention"
                title={`Below the reorder level — ${item.balance} on hand, ${item.reorderLevel} wanted.`}
              />
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="History" />
          <CardBody>
            <MovementHistory
              rows={item.movements.rows}
              page={item.movements.page}
              pageCount={item.movements.pageCount}
            />
          </CardBody>
        </Card>
      </div>
    </>
  );
}
