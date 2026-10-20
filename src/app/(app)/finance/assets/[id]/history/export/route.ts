import { requireRole } from "@/server/auth/guards";
import { financeAssetDetail } from "@/server/modules/finance/asset-detail";
import { buildHistory } from "@/lib/finance-history";
import { historyCsv, parseAssetPageState } from "@/lib/finance-asset-page";

/**
 * Phase 47 (spec §4.5): Export log — the asset's Financial history as CSV. Guarded like the page; honours the tab's
 * kind (`hk`) and person (`hw`) filters and writes every matching entry (not one page), newest first.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireRole("admin", "finance_staff");
  const { id } = await params;
  const d = await financeAssetDetail(id);
  if (!d) return new Response("Not found", { status: 404 });

  const state = parseAssetPageState(new URL(req.url).searchParams);
  const all = d.audit.length + d.depLines.length;
  const { rows } = buildHistory(
    d.audit,
    d.depLines,
    { kind: state.hk, person: state.hw ?? undefined, page: 1, pageSize: Math.max(1, all) },
    { assetTag: d.tag, categoryName: d.category, purchaseUnits: d.purchaseUnits, names: d.historyNames },
  );
  // the tag is free text: keep only what is safe inside the quoted filename
  const safeTag = d.tag.replace(/[^A-Za-z0-9_-]/g, "");
  const filename = `asset-${safeTag}-history-${new Date().toISOString().slice(0, 10)}.csv`;
  return new Response(historyCsv(rows), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
}
