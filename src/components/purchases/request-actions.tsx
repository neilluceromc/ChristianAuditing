"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { PurchaseRequestState, Role } from "@prisma/client";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { ButtonLink } from "@/components/ui/button-link";
import { Dialog } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { canAct, type PurchaseAction } from "@/lib/purchase-flow";
import {
  cancelRequest, completeRequest, itRejectRequest, itReviewRequest, requestMoreInfo, submitRequest,
} from "@/server/modules/purchases/actions";
import type { ActionResult } from "@/server/action-result";

/** Mirrors what the transitions return (kept local — see actions.ts). */
type Acted = { refNo: string; state: string };

const RUN: Record<PurchaseAction, (input: { id: string; reason?: string }) => Promise<ActionResult<Acted>>> = {
  submit: submitRequest,
  "it-review": itReviewRequest,
  "it-reject": itRejectRequest,
  "request-info": requestMoreInfo,
  cancel: cancelRequest,
  complete: completeRequest,
};

const COPY: Record<PurchaseAction, { label: string; variant: "primary" | "secondary" | "danger"; past: string; prompt?: string }> = {
  submit: { label: "Submit for IT review", variant: "primary", past: "submitted" },
  "it-review": { label: "Mark IT-reviewed", variant: "primary", past: "marked IT-reviewed" },
  "it-reject": {
    label: "Send back to purchasing", variant: "danger", past: "sent back",
    prompt: "It goes back to DRAFT so purchasing can edit and resubmit. Your reason is appended to the thread — nothing is cleared.",
  },
  "request-info": {
    label: "Request more info", variant: "danger", past: "sent back",
    prompt: "It goes back to SUBMITTED so IT can revisit the per-unit fields. Nothing captured is cleared, and your reason is appended to the thread.",
  },
  cancel: { label: "Cancel request", variant: "danger", past: "cancelled", prompt: "Cancelling withdraws every open line. This cannot be undone." },
  complete: { label: "Complete", variant: "primary", past: "completed" },
};

/**
 * The button set is what the CURRENT state + this role allow, asked of the
 * same pure function the server action calls — never a disabled button
 * standing in for a transition that would fail.
 */
export function RequestActions({
  id,
  state,
  role,
  isDraftOwner,
}: {
  id: string;
  state: PurchaseRequestState;
  role: Role;
  isDraftOwner: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  // Which action is actually in flight — the loading spinner belongs on the
  // one button the person clicked, not permanently pinned to "submit". A
  // dialog-gated action's trigger button just opens the dialog (nothing async
  // happens until the dialog is confirmed), so only the confirm button and the
  // no-prompt action buttons ever need a spinner.
  const [firing, setFiring] = useState<PurchaseAction | null>(null);
  const [asking, setAsking] = useState<PurchaseAction | null>(null);
  const [reason, setReason] = useState("");
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [retryAfter, setRetryAfter] = useState<number | null>(null);

  function fire(action: PurchaseAction, withReason?: string) {
    setError(null);
    setFieldError(undefined);
    setFiring(action);
    startTransition(async () => {
      const res = await RUN[action]({ id, reason: withReason });
      setFiring(null);
      if (res.ok) {
        setAsking(null);
        setReason("");
        toast(`${res.data.refNo} ${COPY[action].past}`, "settled");
        router.refresh();
      } else if (res.kind === "validation") setFieldError(res.fieldErrors?.reason ?? res.message);
      else if (res.kind === "rate_limited") setRetryAfter(res.retryAfterSec ?? 60);
      else {
        setAsking(null);
        setError(res.message);
      }
    });
  }

  const available = (["submit", "it-review", "it-reject", "request-info", "complete", "cancel"] as PurchaseAction[])
    .filter((a) => canAct(state, a, role));

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {state === "DRAFT" && isDraftOwner && <ButtonLink href={`/purchases/${id}/edit`}>Edit draft</ButtonLink>}
        {available.map((action) => (
          <Button
            key={action}
            variant={COPY[action].variant}
            loading={pending && firing === action}
            onClick={() => (COPY[action].prompt ? setAsking(action) : fire(action))}
          >
            {COPY[action].label}
          </Button>
        ))}
      </div>
      {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
      {error && <Banner tone="fault" title={error} />}

      <Dialog
        open={asking !== null}
        onClose={() => setAsking(null)}
        title={asking ? COPY[asking].label : ""}
        footer={
          <>
            <Button variant="ghost" onClick={() => setAsking(null)}>Cancel</Button>
            <Button variant="danger" loading={pending && firing === asking} onClick={() => asking && fire(asking, reason)}>
              {asking ? COPY[asking].label : ""}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <p className="text-xs text-fg-muted">{asking ? COPY[asking].prompt : ""}</p>
          <FormField label="Reason" required error={fieldError}>
            {(p) => (
              <Textarea
                id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                value={reason} onChange={(e) => setReason(e.target.value)}
              />
            )}
          </FormField>
        </div>
      </Dialog>
    </div>
  );
}
