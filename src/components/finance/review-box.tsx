"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { confirmAssetDetails } from "@/server/modules/inventory/actions";
import { SendBackDialog } from "./send-back-dialog";
import { useFinanceRunner } from "./use-finance-runner";

/** Phase 35 (spec 3.2): Finance's review box on the asset page (rendered only while the asset is with Finance). */
export function ReviewBox({
  id, tag, hasCost, reply, deptLabel,
}: { id: string; tag: string; cls?: string; hasCost: boolean; reply: string | null; deptLabel: string }) {
  const router = useRouter();
  const { pending, error, retryAfter, setRetryAfter, run } = useFinanceRunner();
  const [sending, setSending] = useState(false);

  function approve() {
    run(
      () => confirmAssetDetails({ id, notCapitalised: !hasCost }),
      (d) => (hasCost ? `${d.tag} approved` : `${d.tag} approved as not capitalised`),
      { onOk: (d) => { if (d.next) router.push(`/finance/assets/${d.next.id}`); }, refresh: true },
    );
  }

  return (
    <section role="region" aria-label="Review" className="mb-4 rounded-(--radius-card) border border-accent-soft-border bg-accent-soft px-4 py-3">
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
