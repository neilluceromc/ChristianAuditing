"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Banner } from "@/components/ui/banner";
import { Button, IconButton } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Menu, type MenuItem } from "@/components/ui/menu";
import { useToast } from "@/components/ui/toast";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { ReasonField } from "@/components/patterns/reason-field";
import { REASON_CHIPS } from "@/lib/reason-chips";
import { VERB_LABEL, type ApprovalVerb, type approvalHeader } from "@/lib/approval-header";
import {
  approveApproval, approveNow, claimApproval, escalateApproval, rejectApproval, releaseApproval, retryApproval,
} from "@/server/modules/approvals/actions";
import type { ActionResult } from "@/server/action-result";

type Acted = { refNo: string; state: string };

/** Each verb's server action — shared by this header and the queue's row menu (spec §4.2). */
export const RUN: Record<ApprovalVerb, (input: { id: string }) => Promise<ActionResult<Acted>>> = {
  "approve-now": approveNow,
  approve: approveApproval,
  claim: claimApproval,
  release: releaseApproval,
  escalate: escalateApproval,
  retry: retryApproval,
};

/** The toast's past-tense word for each verb (`{refNo} {done}`). */
export const DONE: Record<ApprovalVerb, string> = {
  "approve-now": "approved", approve: "approved", claim: "claimed", release: "released", escalate: "escalated", retry: "re-queued",
};

/**
 * The reject dialog, shared by the request page's header and the queue (plan P-6: the
 * trigger reads Reject…, the dialog keeps `Reject {refNo}?` and a danger `Reject`).
 */
export function RejectApprovalDialog({
  refNo, open, onClose, onConfirm, pending, reason, onReasonChange, error,
}: {
  refNo: string;
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  pending: boolean;
  reason: string;
  onReasonChange: (v: string) => void;
  error?: string;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={refNo ? `Reject ${refNo}?` : ""}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="danger" loading={pending} onClick={onConfirm}>Reject</Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-xs text-fg-muted">A rejection is a human decision — the reason is recorded on the approval and in the audit trail.</p>
        <ReasonField
          required error={error} value={reason} onChange={onReasonChange}
          chips={REASON_CHIPS["approval.reject"]} disabled={pending}
        />
      </div>
    </Dialog>
  );
}

/**
 * Spec §4.1: the request page's house header — one primary, a visible Reject…,
 * the rest in More, exactly as approvalHeader decides (never a verb the
 * transition would refuse). Result handling is the queue's shape: ok → toast +
 * router.refresh() (the page then shows Next in queue when no primary is left,
 * P-8); rate_limited → RateLimitNotice; validation → the reject dialog's inline
 * reason error; else a fault Banner.
 */
export function ApprovalHeaderActions({
  id,
  refNo,
  plan,
  ownerName,
}: {
  id: string;
  refNo: string;
  plan: ReturnType<typeof approvalHeader>;
  /** Set only when someone else holds the claim — the header then says so. */
  ownerName: string | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [retryAfter, setRetryAfter] = useState<number | null>(null);

  function handle(res: ActionResult<Acted>, verb: string) {
    if (res.ok) {
      toast(`${res.data.refNo} ${verb}`, "settled");
    } else if (res.kind === "rate_limited") setRetryAfter(res.retryAfterSec ?? 60);
    // The page refreshes itself after a conflict, so the banner doesn't ask the user to.
    else if (res.kind === "conflict") setError(`${res.message.replace(/ — refresh and retry\.?$/, "").replace(/\.$/, "")} — the page now shows the latest state.`);
    else setError(res.message);
    // A conflict (someone else acted first) refreshes too, so the header follows the new state (spec §10).
    if (res.ok || res.kind === "conflict") router.refresh();
  }

  function act(verb: ApprovalVerb) {
    setError(null);
    startTransition(async () => {
      handle(await RUN[verb]({ id }), DONE[verb]);
    });
  }

  function submitReject() {
    setFieldErrors({});
    startTransition(async () => {
      const res = await rejectApproval({ id, reason });
      if (!res.ok && res.kind === "validation") {
        setFieldErrors(res.fieldErrors ?? {});
        return;
      }
      setRejecting(false);
      setReason("");
      handle(res, "rejected");
    });
  }

  const moreItems: MenuItem[] = plan.more.map((verb) => ({
    label: VERB_LABEL[verb],
    onSelect: () => act(verb),
    disabled: pending,
  }));
  const hasActions = plan.primary !== null || plan.reject || moreItems.length > 0;
  // A refusal or rate-limit notice outlives the refresh that follows it: after a
  // conflict the refreshed request often has no actions left, and the notice is
  // the only word that the decision was not this user's (spec §10).
  if (!hasActions && !ownerName && !error && retryAfter === null) return null;

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {ownerName && <span className="text-xs text-fg-muted">Claimed by {ownerName}</span>}
        {plan.primary && (
          <Button variant="primary" loading={pending} onClick={() => act(plan.primary!)}>
            {VERB_LABEL[plan.primary]}
          </Button>
        )}
        {plan.reject && (
          <Button variant="secondary" disabled={pending} onClick={() => setRejecting(true)}>Reject…</Button>
        )}
        {moreItems.length > 0 && (
          <Menu
            align="end"
            items={moreItems}
            trigger={(props) => <IconButton {...props} aria-label="More actions">⋯</IconButton>}
          />
        )}
      </div>
      {retryAfter !== null && (
        <div className="max-w-[420px]">
          <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />
        </div>
      )}
      {error && <Banner tone="fault" title={error} className="max-w-[420px]" />}
      {plan.reject && (
        <RejectApprovalDialog
          refNo={refNo}
          open={rejecting}
          onClose={() => setRejecting(false)}
          onConfirm={submitReject}
          pending={pending}
          reason={reason}
          onReasonChange={setReason}
          error={fieldErrors.reason}
        />
      )}
    </div>
  );
}
