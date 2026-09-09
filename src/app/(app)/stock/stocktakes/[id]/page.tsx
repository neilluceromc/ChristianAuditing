import { notFound } from "next/navigation";
import type { StocktakeState } from "@prisma/client";
import { requireUser } from "@/server/auth/guards";
import { getStocktake } from "@/server/modules/stock/queries";
import { canManageStock } from "@/lib/stock-access";
import { varianceRows } from "@/lib/stocktake";
import { fmtDate } from "@/lib/format";
import { toSearchParams } from "@/lib/url-state";
import { PageHeader } from "@/components/ui/page-header";
import { Pill } from "@/components/ui/pill";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { DescriptionList } from "@/components/ui/description-list";
import { StocktakeCount } from "@/components/stock/stocktake-count";
import { StocktakeReview, type ReviewRow, type ReviewSummary } from "@/components/stock/stocktake-review";

const STATE_TONE: Record<StocktakeState, "neutral" | "accent"> = { OPEN: "accent", POSTED: "neutral", CANCELLED: "neutral" };

export default async function StocktakeDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const sp = toSearchParams(await searchParams);
  const st = await getStocktake(id);
  if (!st) notFound();

  const manage = canManageStock(user.role);
  // A non-manager, and any non-OPEN stocktake, only ever sees the review — the
  // count screen exists solely for a manager mid-count on an OPEN stocktake.
  const showReview = st.state !== "OPEN" || !manage || sp.get("view") === "review";

  let review: { rows: ReviewRow[]; summary: ReviewSummary } | null = null;
  if (showReview) {
    const lineInputs = st.lines.map((l) => ({ itemId: l.itemId, bookQty: l.bookQty, countedQty: l.countedQty }));
    const current = new Map(st.lines.map((l) => [l.itemId, l.currentQty]));
    const infoById = new Map(st.lines.map((l) => [l.itemId, { code: l.code, name: l.name }]));
    const rows: ReviewRow[] = varianceRows(lineInputs, current).map((v) => {
      const info = infoById.get(v.itemId)!;
      return { ...v, code: info.code, name: info.name };
    });
    const summary: ReviewSummary = {
      counted: rows.filter((r) => r.countedQty !== null).length,
      withDiff: rows.filter((r) => r.variance !== null && r.variance !== 0).length,
      notCounted: rows.filter((r) => r.countedQty === null).length,
      moved: rows.filter((r) => r.drift !== 0).length,
    };
    review = { rows, summary };
  }

  return (
    <>
      <PageHeader
        title={st.refNo}
        breadcrumb={[
          { label: "Stock items", href: "/stock" },
          { label: "Stocktakes", href: "/stock/stocktakes" },
          { label: st.refNo },
        ]}
        badge={<Pill tone={STATE_TONE[st.state]}>{st.state}</Pill>}
      />
      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader title="Details" />
          <CardBody>
            <DescriptionList
              items={[
                { label: "Scope", value: st.scope },
                { label: "Opened", value: `${fmtDate(st.openedAt)} · ${st.openedBy}` },
                { label: "Posted", value: st.postedAt ? `${fmtDate(st.postedAt)} · ${st.postedBy}` : "—" },
                { label: "Note", value: st.note ?? "—" },
              ]}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={showReview ? "Variance review" : "Count"} />
          <CardBody>
            {showReview && review ? (
              <StocktakeReview
                stocktakeId={st.id}
                rows={review.rows}
                summary={review.summary}
                state={st.state}
                canPost={manage && st.state === "OPEN"}
              />
            ) : (
              <StocktakeCount
                stocktakeId={st.id}
                lines={st.lines.map((l) => ({ id: l.id, code: l.code, name: l.name, unit: l.unit, countedQty: l.countedQty }))}
                canCount={manage}
              />
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
