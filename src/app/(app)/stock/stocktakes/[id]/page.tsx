import type { Metadata } from "next";
import { pageTitle } from "@/lib/page-title";
import { stocktakeRefFor } from "@/server/page-titles";
import { notFound } from "next/navigation";
import type { StocktakeState } from "@prisma/client";
import { requireUser } from "@/server/auth/guards";
import { getStocktake, stocktakeCountSheet, stocktakeReviewSheet } from "@/server/modules/stock/queries";
import { canManageStock } from "@/lib/stock-access";
import { parseSheetState } from "@/lib/stocktake";
import { fmtDate, localDateISO } from "@/lib/format";
import { toSearchParams } from "@/lib/url-state";
import { PageHeader } from "@/components/ui/page-header";
import { Pill } from "@/components/ui/pill";
import { DuePill } from "@/components/ui/due-pill";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { DescriptionList } from "@/components/ui/description-list";
import { StocktakeCount } from "@/components/stock/stocktake-count";
import { StocktakeReview } from "@/components/stock/stocktake-review";

const STATE_TONE: Record<StocktakeState, "neutral" | "accent"> = { OPEN: "accent", POSTED: "neutral", CANCELLED: "neutral" };

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return { title: pageTitle((await stocktakeRefFor(id)) ?? "Stocktake") };
}

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
  const today = localDateISO(new Date());
  // A non-manager, and any non-OPEN stocktake, only ever sees the review — the
  // count screen exists solely for a manager mid-count on an OPEN stocktake.
  const showReview = st.state !== "OPEN" || !manage || sp.get("view") === "review";

  // Phase 39 (spec §4.1): both sheets page 50 lines at a time with the state in the URL; the header counts and the
  // review's posting totals stay over every line. The I-4 open-vs-posted split lives in `stocktakeReviewSheet`.
  const mode = showReview ? "review" : "count";
  const sheet = parseSheetState(sp, mode);
  const review = showReview ? await stocktakeReviewSheet(st.id, st.state, sheet) : null;
  const count = showReview ? null : await stocktakeCountSheet(st.id, sheet);

  return (
    <>
      <PageHeader
        title={st.refNo}
        breadcrumb={[
          { label: "Stock items", href: "/stock" },
          { label: "Stocktakes", href: "/stock/stocktakes" },
          { label: st.refNo },
        ]}
        badge={
          <span className="inline-flex items-center gap-1.5">
            <Pill tone={STATE_TONE[st.state]}>{st.state}</Pill>
            {st.state === "OPEN" && <DuePill dueAt={st.dueAt} today={today} withDate />}
          </span>
        }
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
          <CardHeader
            title={showReview ? "Variance review" : "Count"}
            actions={count && <span className="font-mono text-[11px] text-fg-muted">{count.stillToCount} still to count</span>}
          />
          <CardBody>
            {review ? (
              <StocktakeReview
                stocktakeId={st.id}
                rows={review.rows}
                summary={review.summary}
                state={st.state}
                canPost={manage && st.state === "OPEN"}
                sheet={sheet}
                categories={st.categories}
                page={review.page}
                pageCount={review.pageCount}
              />
            ) : count ? (
              // Never keyed by the URL: the toolbar and pagination inside stay mounted, so focus stays on the
              // control just used; the rows reset to the server's values on a page or filter change themselves.
              <StocktakeCount
                stocktakeId={st.id}
                lines={count.lines}
                sheet={sheet}
                categories={st.categories}
                page={count.page}
                pageCount={count.pageCount}
                counted={count.total - count.stillToCount}
                total={count.total}
              />
            ) : null}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
