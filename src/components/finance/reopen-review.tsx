"use client";

import { useState } from "react";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { ReasonField } from "@/components/patterns/reason-field";
import { reopenReasonError } from "@/lib/finance-review-ui";
import { REOPEN_REASON_MAX, REOPEN_REASON_MIN } from "@/lib/finance-undo";
import { reopenFinanceReview } from "@/server/modules/finance/undo-actions";
import { requestReviewFocus } from "./review-focus";
import { useFinanceRunner } from "./use-finance-runner";

/**
 * Finance follow-up (spec §3): an admin reopens an approved review at any time, with a reason of 5–300 characters. The
 * approval is cleared and the asset goes back to To review. The page renders this for admins on approved assets only
 * (`canReopenReview`); the server checks both again.
 */
export function ReopenReview({ id, tag }: { id: string; tag: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const { pending, error, fieldErrors, setFieldErrors, retryAfter, setRetryAfter, reset, run } = useFinanceRunner(["reason"]);

  function show() {
    reset();
    setReason("");
    setOpen(true);
  }

  function confirm() {
    const bad = reopenReasonError(reason);
    if (bad) {
      setFieldErrors({ reason: bad });
      return;
    }
    run(
      () => reopenFinanceReview({ assetId: id, reason }),
      (d) => ({ message: `Reopened ${d.tag}'s review`, detail: "It is back in To review" }),
      {
        onOk: () => {
          // the refresh takes this button away (no longer approved): the review box that appears takes focus
          requestReviewFocus();
          setOpen(false);
        },
      },
    );
  }

  return (
    <>
      <Button onClick={show}>Reopen review</Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={`Reopen ${tag}'s review`}
        footer={<ReopenFooter pending={pending} onCancel={() => setOpen(false)} onConfirm={confirm} />}
      >
        <div className="flex flex-col gap-3">
          {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
          {error && <Banner tone="fault" title={error} />}
          <p className="text-[13px] text-fg-secondary">
            The approval is cleared and {tag} goes back to To review. Its history keeps the approval and records this with
            your reason.
          </p>
          <ReasonField
            required
            hint={`${REOPEN_REASON_MIN} to ${REOPEN_REASON_MAX} characters`}
            error={fieldErrors.reason}
            value={reason}
            onChange={setReason}
            chips={[]}
            disabled={pending}
          />
        </div>
      </Dialog>
    </>
  );
}

/** The dialog's buttons: Cancel is disabled while the reopen is on its way, so it cannot close mid-request. */
export function ReopenFooter({ pending, onCancel, onConfirm }: { pending: boolean; onCancel: () => void; onConfirm: () => void }) {
  return (
    <>
      <Button variant="ghost" onClick={onCancel} disabled={pending}>Cancel</Button>
      <Button variant="danger" loading={pending} onClick={onConfirm}>Reopen review</Button>
    </>
  );
}
