import { requireUser } from "@/server/auth/guards";
import { prisma } from "@/server/db/client";
import { toXlsxBuffer } from "@/server/xlsx/write";
import { ASSET_EXPORT_COLUMNS, EXPORT_CAP, IDS_CAP } from "@/lib/export-columns";
import { capRefusal, exportFilename, idsRefusal, xlsxResponse } from "@/server/export/respond";
import {
  buildAssetOrderBy, buildAssetWhere, INVENTORY_LIST_CONFIG, parsePurchaseYear,
} from "@/lib/inventory-list";
import { parseListState } from "@/lib/url-state";
import { repairStageIds } from "@/server/modules/inventory/queries";

export async function GET(req: Request) {
  await requireUser();
  const url = new URL(req.url);

  const idsParam = url.searchParams.get("ids");
  const ids = idsParam ? idsParam.split(",").filter(Boolean) : null;
  // Refuse rather than slice (scope decision 10). This check precedes the
  // query, so an over-large selection costs one comparison, not a fetch.
  if (ids && ids.length > IDS_CAP) return idsRefusal(ids.length);

  const state = parseListState(url.searchParams, INVENTORY_LIST_CONFIG);
  // Not a config facet (see parsePurchaseYear) — read off the raw params
  // directly, same as `ids` above, so this route and the page it serves
  // cannot disagree about which year is active.
  const purchaseYear = parsePurchaseYear(url.searchParams.get("purchaseYear"));
  // `stage` is a derived facet — buildAssetWhere only narrows to the repair
  // CANDIDATE set in SQL, so a stage-filtered export must resolve to the same
  // exact ids the list screen shows, or the row count won't match the UI.
  const cutIds = ids ? null : await repairStageIds(state, purchaseYear);
  const where = ids
    ? { id: { in: ids } }
    : cutIds !== null
      ? { id: { in: cutIds } }
      : buildAssetWhere(state, purchaseYear);

  const count = await prisma.asset.count({ where });
  if (count > EXPORT_CAP) return capRefusal(count);

  const assets = await prisma.asset.findMany({
    where,
    orderBy: ids ? { tag: "asc" } : buildAssetOrderBy(state.sort),
    include: { category: true, type: true, assignee: true, vendor: true },
  });

  const buffer = await toXlsxBuffer(
    ASSET_EXPORT_COLUMNS,
    assets.map((a) => ({
      tag: a.tag,
      model: a.model,
      serial: a.serial,
      categoryName: a.category.name,
      typeName: a.type?.name ?? null,
      status: a.status,
      assigneeName: a.assignee?.name ?? null,
      assigneeNo: a.assignee?.employeeNo ?? null,
      purchasedAt: a.purchasedAt,
      // Prisma.Decimal -> number at the boundary, once. `toNumber()` is exact
      // for Decimal(12,2) values in this range, and the sheet needs a number
      // or Excel right-aligns nothing and SUM() returns 0.
      cost: a.cost ? a.cost.toNumber() : null,
      warrantyUntil: a.warrantyUntil,
      vendorName: a.vendor?.name ?? null,
      rmaRef: a.rmaRef,
      notes: a.notes,
    })),
  );
  return xlsxResponse(exportFilename("assets", new Date()), buffer);
}
