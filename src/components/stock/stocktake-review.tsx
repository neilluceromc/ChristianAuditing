"use client";

import { useState } from "react";
import Link from "next/link";
import type { StocktakeState } from "@prisma/client";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Pill } from "@/components/ui/pill";
import { Table, THead, TBody, Th, Tr, Td } from "@/components/ui/table";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { cancelStocktake, postStocktake } from "@/server/modules/stock/stocktake-actions";
import { useStockRunner } from "./use-stock-runner";

/**
 * I-4: an OPEN review is a live view (today's Now/Variance/MOVED against the
 * current ledger); a POSTED or CANCELLED review is a frozen RECORD of what
 * was posted (Book/Counted/Adjustment only — never a live recomputation).
 * The two shapes are different enough (no `currentQty`/`drift` in one, no
 * `adjustment` in the other) that a discriminated union is clearer than one
 * interface with fields that are meaningless half the time; `kind` always
 * agrees with the `state` prop below, since the page builds both from the
 * same `st.state` check (`varianceRows` vs `postedReviewRows`).
 */
export type ReviewRow =
  | {
      kind: "open";
      itemId: string;
      code: string;
      name: string;
      bookQty: number;
      currentQty: number;
      countedQty: number | null;
      variance: number | null;
      drift: number;
    }
  | {
      kind: "posted";
      itemId: string;
      code: string;
      name: string;
      bookQty: number;
      countedQty: number | null;
      adjustment: number | null;
    };

export type ReviewSummary =
  | { kind: "open"; counted: number; withDiff: number; notCounted: number; moved: number }
  | { kind: "posted"; counted: number; adjusted: number; notCounted: number };

/** Real minus (U+2212) for a negative — never a hyphen-minus (movement-history.tsx's own convention). */
function fmtVariance(v: number | null): string {
  if (v === null) return "";
  return v >= 0 ? `+${v}` : `−${Math.abs(v)}`;
}

/**
 * Spec §5.3/§7.5, Task 5 Step 4, I-4. `rows`/`summary` are computed
 * server-side in the page — `varianceRows` (OPEN, a live view against
 * today's ledger) or `postedReviewRows` (POSTED/CANCELLED, a frozen record
 * of what was actually posted) from `lib/stocktake.ts`; this component only
 * formats, picking columns by `state`, and, for an OPEN stocktake a manager
 * is viewing, offers post/cancel. The preview counts in the post confirm
 * dialog (`summary.withDiff`/`summary.notCounted`, OPEN only) mirror exactly
 * what `planStocktakePost` computes server-side, since both come from the
 * same countedQty-vs-current comparison.
 */
export function StocktakeReview({
  stocktakeId,
  rows,
  summary,
  state,
  canPost,
}: {
  stocktakeId: string;
  rows: ReviewRow[];
  summary: ReviewSummary;
  state: StocktakeState;
  canPost: boolean;
}) {
  const [postOpen, setPostOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const { pending, error, retryAfter, setRetryAfter, reset, run } = useStockRunner();

  function openPost() { reset(); setPostOpen(true); }
  function openCancel() { reset(); setCancelOpen(true); }

  function post() {
    run(
      () => postStocktake({ id: stocktakeId }),
      (data) => `Posted — ${data.adjusted} adjustments`,
      { onOk: () => setPostOpen(false) },
    );
  }

  function doCancel() {
    run(() => cancelStocktake({ id: stocktakeId }), "Stocktake cancelled", { onOk: () => setCancelOpen(false) });
  }

  // D-9b, folded in while I-4 touched this component: `canPost` is already
  // `manage && state === "OPEN"` (computed once by the page), so re-checking
  // `state === "OPEN"` here was redundant.
  const showControls = canPost;
  const isOpen = state === "OPEN";

  return (
    <div className="flex flex-col gap-3">
      {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
      {error && <Banner tone="fault" title={error} />}
      <Table>
        <THead>
          <Tr>
            <Th>Code</Th>
            <Th>Name</Th>
            <Th align="right">Book</Th>
            {isOpen && <Th align="right">Now</Th>}
            <Th align="right">Counted</Th>
            <Th align="right">{isOpen ? "Variance" : "Adjustment"}</Th>
            {isOpen && <Th aria-label="Flags" />}
          </Tr>
        </THead>
        <TBody>
          {rows.map((r) => (
            <Tr key={r.itemId}>
              <Td mono>
                {r.kind === "posted" && r.adjustment !== null ? (
                  <Link href={`/stock/items/${r.itemId}`} className="text-accent hover:underline">{r.code}</Link>
                ) : (
                  r.code
                )}
              </Td>
              <Td>{r.name}</Td>
              <Td align="right" mono>{r.bookQty}</Td>
              {r.kind === "open" && <Td align="right" mono>{r.currentQty}</Td>}
              <Td align="right" mono>{r.countedQty ?? "not counted"}</Td>
              {r.kind === "open" ? (
                <Td align="right" mono>{fmtVariance(r.variance)}</Td>
              ) : (
                <Td align="right" mono>{r.adjustment !== null ? fmtVariance(r.adjustment) : "—"}</Td>
              )}
              {r.kind === "open" && <Td align="right">{r.drift !== 0 && <Pill tone="accent">MOVED</Pill>}</Td>}
            </Tr>
          ))}
        </TBody>
      </Table>
      <p className="font-mono text-[11px] text-fg-muted">
        {summary.kind === "open" ? (
          <>
            {summary.counted} items counted · {summary.withDiff} with a difference · {summary.notCounted} not counted{" "}
            · {summary.moved} moved since opening
          </>
        ) : (
          <>
            {summary.counted} items counted · {summary.adjusted} adjusted · {summary.notCounted} not counted
          </>
        )}
      </p>

      {showControls ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" onClick={openPost}>Post stocktake</Button>
          <Button variant="danger" onClick={openCancel}>Cancel stocktake</Button>
          <Link href={`/stock/stocktakes/${stocktakeId}`} className="text-xs text-accent hover:underline">
            Back to counting
          </Link>
        </div>
      ) : (
        <Link href="/stock/stocktakes" className="text-xs text-accent hover:underline">Back to stocktakes</Link>
      )}

      <Dialog
        open={postOpen}
        onClose={() => setPostOpen(false)}
        title="Post this stocktake?"
        footer={
          <>
            <Button onClick={() => setPostOpen(false)}>Cancel</Button>
            <Button variant="primary" loading={pending} onClick={post}>Post</Button>
          </>
        }
      >
        {summary.kind === "open" && (
          <>Post {summary.withDiff} adjustments? {summary.notCounted} uncounted items are left as they are.</>
        )}
      </Dialog>

      <Dialog
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title="Cancel this stocktake?"
        footer={
          <>
            <Button onClick={() => setCancelOpen(false)}>Cancel</Button>
            <Button variant="danger" loading={pending} onClick={doCancel}>Cancel stocktake</Button>
          </>
        }
      >
        Counts recorded so far are discarded — nothing is adjusted.
      </Dialog>
    </div>
  );
}
