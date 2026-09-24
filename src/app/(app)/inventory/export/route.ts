import type { Prisma } from "@prisma/client";
import { requireUser } from "@/server/auth/guards";
import { prisma } from "@/server/db/client";
import { toXlsxBuffer } from "@/server/xlsx/write";
import { ASSET_EXPORT_COLUMNS, EXPORT_CAP, IDS_CAP } from "@/lib/export-columns";
import { capRefusal, exportFilename, idsRefusal, xlsxResponse } from "@/server/export/respond";
import {
  buildAssetOrderBy, buildAssetWhere, INVENTORY_LIST_CONFIG, parsePurchaseYear,
} from "@/lib/inventory-list";
import { defaultClassFor, parseCls, visibleClassWhere } from "@/lib/asset-class";
import { parseListState, primarySortOf, withFilter } from "@/lib/url-state";
import { attentionOrdered, repairStageIds } from "@/server/modules/inventory/queries";
import { PROVENANCE_LABEL, provenanceOf } from "@/lib/provenance";

export async function GET(req: Request) {
  const user = await requireUser();
  const url = new URL(req.url);

  const idsParam = url.searchParams.get("ids");
  const ids = idsParam ? idsParam.split(",").filter(Boolean) : null;
  // Refuse rather than slice (scope decision 10). This check precedes the
  // query, so an over-large selection costs one comparison, not a fetch.
  if (ids && ids.length > IDS_CAP) return idsRefusal(ids.length);

  let state = parseListState(url.searchParams, INVENTORY_LIST_CONFIG);
  // Not a config facet (see parsePurchaseYear) — read off the raw params
  // directly, same as `ids` above, so this route and the page it serves
  // cannot disagree about which year is active.
  const purchaseYear = parsePurchaseYear(url.searchParams.get("purchaseYear"));
  const cls = parseCls(url.searchParams.get("cls")) ?? defaultClassFor(user.role);
  // Repair stages are IT's (inventory/page.tsx, D-16): a hand-built
  // ?cls=PURCHASING&stage=… would otherwise narrow to the repair candidate
  // set regardless of class and return rows the list would never show.
  if (cls !== "IT" && state.filters.stage) state = withFilter(state, "stage", []);
  // `stage` is a derived facet — buildAssetWhere only narrows to the repair
  // CANDIDATE set in SQL, so a stage-filtered export must resolve to the same
  // exact ids the list screen shows, or the row count won't match the UI.
  const cutIds = ids ? null : await repairStageIds(state, purchaseYear, cls);
  const scope = visibleClassWhere(user.role);
  const where: Prisma.AssetWhereInput = ids
    ? { AND: [{ id: { in: ids } }, scope] }
    : cutIds !== null
      ? { AND: [{ id: { in: cutIds } }, scope] }
      : { AND: [buildAssetWhere(state, purchaseYear, cls), scope] };

  const count = await prisma.asset.count({ where });
  if (count > EXPORT_CAP) return capRefusal(count);

  const orderBy = buildAssetOrderBy(state.sort);
  const fetched = await prisma.asset.findMany({
    where,
    orderBy: ids ? { tag: "asc" } : orderBy,
    // provenanceOf() below needs purchaseRequestId + importedAt — an include keeps every scalar; do not narrow to select without adding them.
    include: { category: true, type: true, assignee: true, vendor: true },
  });
  // Phase 31: the Attention sort (primary key only, as on the list) is derived, so the sheet takes
  // its order from the same helper the list pages from — same rows, same order as the screen. The
  // count above already capped the set, so this second pass is bounded by EXPORT_CAP.
  const attentionSort = ids ? undefined : primarySortOf(state.sort, "attention");
  let assets = fetched;
  if (attentionSort) {
    const rank = new Map((await attentionOrdered(where, orderBy, attentionSort.dir, new Date())).map((r, i) => [r.id, i]));
    // a row created between the two passes has no rank: it goes last (a stable sort keeps its SQL place among any others)
    assets = [...fetched].sort((a, b) => (rank.get(a.id) ?? rank.size) - (rank.get(b.id) ?? rank.size));
  }

  const buffer = await toXlsxBuffer(
    ASSET_EXPORT_COLUMNS,
    assets.map((a) => ({
      tag: a.tag,
      model: a.model,
      brand: a.brand,
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
      loanDueAt: a.loanDueAt,
      vendorName: a.vendor?.name ?? null,
      provenance: PROVENANCE_LABEL[provenanceOf(a)],
      invoiceRef: a.invoiceRef,
      rmaRef: a.rmaRef,
      notes: a.notes,
    })),
  );
  return xlsxResponse(exportFilename("assets", new Date()), buffer);
}
