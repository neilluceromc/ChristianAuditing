"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { approveToast, financeAssetHref } from "@/lib/finance-review-ui";
import { confirmAssetDetails } from "@/server/modules/inventory/actions";
import { SendBackDialog } from "./send-back-dialog";
import { takeReviewFocus } from "./review-focus";
import { useFinanceRunner } from "./use-finance-runner";
import { useFinanceUndo } from "./use-finance-undo";

/**
 * Phase 35 (spec 3.2): Finance's review box on the asset page (rendered only while the asset is with Finance).
 * Finance follow-up (spec §4): approving says what it started (`approveDetail`, computed by the page), moves on to the
 * next asset and names it and how many are left; its toast offers Undo and "Open <tag>" to go back.
 */
export function ReviewBox({
  id, tag, hasCost, reply, deptLabel, approveDetail = null,
}: {
  id: string; tag: string; cls?: string; hasCost: boolean; reply: string | null; deptLabel: string;
  /** "Depreciation starts Oct 2026 · ₱2,131.11 a month" (finance-review-ui.ts `approveDetail`). */
  approveDetail?: string | null;
}) {
  const router = useRouter();
  const { pending, error, retryAfter, setRetryAfter, run } = useFinanceRunner();
  const undo = useFinanceUndo();
  const [sending, setSending] = useState(false);
  const box = useRef<HTMLElement>(null);

  // after an admin's Reopen review, this box replaces the Reopen button: focus lands here, not on the body
  useEffect(() => {
    if (takeReviewFocus()) box.current?.focus();
  }, []);

  function approve() {
    run(
      () => confirmAssetDetails({ id, notCapitalised: !hasCost }),
      (d) => approveToast(
        { assetId: id, tag: d.tag, notCapitalised: !hasCost, detail: approveDetail, next: d.next, remaining: d.remaining },
        undo,
      ),
      { onOk: (d) => { if (d.next) router.push(financeAssetHref(d.next.id)); }, refresh: true },
    );
  }

  return (
    <section ref={box} tabIndex={-1} role="region" aria-label="Review" className="mb-4 rounded-(--radius-card) border border-accent-soft-border bg-accent-soft px-4 py-3">
      <h2 className="text-[15px] font-semibold text-fg">Waiting for your review</h2>
      <p className="mt-1 text-[13px] text-fg-secondary">
        {hasCost
          ? "Check the purchase details and documents below. Approve to start depreciation from the purchase month, or send it back with a checklist."
          : "No cost recorded. Send it back for the cost, or approve it as not capitalised."}
      </p>
      {reply && <p className="mt-2 text-[13px] text-fg">{deptLabel} replied: “{reply}”</p>}
      {retryAfter !== null && <div className="mt-2"><RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} /></div>}
      {error && <div className="mt-2"><Banner tone="fault" title={error} /></div>}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="primary" loading={pending} onClick={approve}>
          {hasCost ? "Approve" : "Approve as not capitalised"}
        </Button>
        <Button onClick={() => setSending(true)} disabled={pending}>Send back to {deptLabel}…</Button>
      </div>
      <SendBackDialog open={sending} onClose={() => setSending(false)} id={id} tag={tag} deptLabel={deptLabel} hasCost={hasCost} />
    </section>
  );
}
