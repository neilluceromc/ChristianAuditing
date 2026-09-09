import { notFound } from "next/navigation";
import type { StocktakeState } from "@prisma/client";
import { requireUser } from "@/server/auth/guards";
import { getStocktake } from "@/server/modules/stock/queries";
import { canManageStock } from "@/lib/stock-access";
import { postedReviewRows, varianceRows } from "@/lib/stocktake";
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

  // I-4: an OPEN review is a live view against today's ledger (`varianceRows`);
  // a POSTED/CANCELLED review is a frozen record of what was actually posted
  // (`postedReviewRows`) — the two never mix, picked once here by `st.state`.
  let review: { rows: ReviewRow[]; summary: ReviewSummary } | null = null;
  if (showReview) {
    const lineInputs = st.lines.map((l) => ({ itemId: l.itemId, bookQty: l.bookQty, countedQty: l.countedQty }));
    const infoById = new Map(st.lines.map((l) => [l.itemId, { code: l.code, name: l.name }]));
    if (st.state === "OPEN") {
      const current = new Map(st.lines.map((l) => [l.itemId, l.currentQty]));
      const rows: ReviewRow[] = varianceRows(lineInputs, current).map((v) => {
        const info = infoById.get(v.itemId)!;
        return { kind: "open", ...v, code: info.code, name: info.name };
      });
      const summary: ReviewSummary = {
        kind: "open",
        counted: rows.filter((r) => r.countedQty !== null).length,
        withDiff: rows.filter((r) => r.kind === "open" && r.variance !== null && r.variance !== 0).length,
        notCounted: rows.filter((r) => r.countedQty === null).length,
        moved: rows.filter((r) => r.kind === "open" && r.drift !== 0).length,
      };
      review = { rows, summary };
    } else {
      const rows: ReviewRow[] = postedReviewRows(lineInputs, st.adjustments).map((v) => {
        const info = infoById.get(v.itemId)!;
        return { kind: "posted", ...v, code: info.code, name: info.name };
      });
      const summary: ReviewSummary = {
        kind: "posted",
        counted: rows.filter((r) => r.countedQty !== null).length,
        adjusted: rows.filter((r) => r.kind === "posted" && r.adjustment !== null).length,
        notCounted: rows.filter((r) => r.countedQty === null).length,
      };
      review = { rows, summary };
    }
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
