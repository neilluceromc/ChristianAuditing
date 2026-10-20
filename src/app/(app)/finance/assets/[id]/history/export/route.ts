import { requireRole } from "@/server/auth/guards";
import { financeAssetDetail } from "@/server/modules/finance/asset-detail";
import { exportFilename } from "@/server/export/respond";
import { assetHistory, historyCsv, parseAssetPageState } from "@/lib/finance-asset-page";

/**
 * Phase 47 (spec §4.5): Export log — the asset's Financial history as CSV. Guarded like the page; honours the tab's
 * kind (`hk`) and person (`hw`, an unknown person read as Everyone, as on the page) filters and writes every matching
 * entry (not one page), newest first.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireRole("admin", "finance_staff");
  const { id } = await params;
  const d = await financeAssetDetail(id);
  if (!d) return new Response("Not found", { status: 404 });

  const state = parseAssetPageState(new URL(req.url).searchParams);
  const { history } = assetHistory(
    d.audit,
    d.depLines,
    { hk: state.hk, hw: state.hw, hp: 1 },
    { assetTag: d.tag, categoryName: d.category, purchaseUnits: d.purchaseUnits, names: d.historyNames },
    Math.max(1, d.audit.length + d.depLines.length),
  );
  // the tag is free text: exportFilename keeps only what is safe inside the quoted filename
  const filename = exportFilename(`asset-${d.tag}-history`, new Date(), "csv");
  return new Response(historyCsv(history.rows), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
}
