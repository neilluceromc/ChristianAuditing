import { requireUser } from "@/server/auth/guards";
import { prisma } from "@/server/db/client";
import { toCsv } from "@/lib/csv";
import { buildAssetOrderBy, buildAssetWhere, INVENTORY_LIST_CONFIG } from "@/lib/inventory-list";
import { parseListState } from "@/lib/url-state";
import { repairStageIds } from "@/server/modules/inventory/queries";

const CAP = 10_000;

export async function GET(req: Request) {
  await requireUser();
  const url = new URL(req.url);

  const idsParam = url.searchParams.get("ids");
  const state = parseListState(url.searchParams, INVENTORY_LIST_CONFIG);
  // `stage` is a derived facet — buildAssetWhere only narrows to the repair
  // CANDIDATE set in SQL, so a stage-filtered export must resolve to the same
  // exact ids the list screen shows, or the CSV row count won't match the UI.
  const cutIds = idsParam ? null : await repairStageIds(state);
  const where = idsParam
    ? { id: { in: idsParam.split(",").filter(Boolean).slice(0, 500) } }
    : cutIds !== null
      ? { id: { in: cutIds } }
      : buildAssetWhere(state);

  const count = await prisma.asset.count({ where });
  if (count > CAP) {
    return new Response(
      `Export refused: ${count} rows exceeds the ${CAP}-row cap. ` +
        `Narrow the filters (splitting by purchase year works well) and try again. Nothing was exported.`,
      { status: 413, headers: { "content-type": "text/plain; charset=utf-8" } },
    );
  }

  const assets = await prisma.asset.findMany({
    where,
    orderBy: idsParam ? { tag: "asc" } : buildAssetOrderBy(state.sort),
    include: { category: true, type: true, assignee: true, vendor: true },
  });

  const csv = toCsv(
    ["tag", "model", "serial", "category", "type", "status", "assignee", "employeeNo",
     "purchasedAt", "cost", "warrantyUntil", "vendor", "rmaRef", "notes"],
    assets.map((a) => [
      a.tag, a.model, a.serial, a.category.name, a.type?.name ?? "", a.status,
      a.assignee?.name ?? "", a.assignee?.employeeNo ?? "",
      a.purchasedAt?.toISOString().slice(0, 10) ?? "", a.cost?.toString() ?? "",
      a.warrantyUntil?.toISOString().slice(0, 10) ?? "", a.vendor?.name ?? "",
      a.rmaRef ?? "", a.notes ?? "",
    ]),
  );

  return new Response("﻿" + csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="inventory-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
