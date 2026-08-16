"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import {
  approveApproval, claimApproval, escalateApproval, rejectApproval, releaseApproval, retryApproval,
} from "@/server/modules/approvals/actions";
import type { ActionResult } from "@/server/action-result";

type Acted = { refNo: string; state: string };

/**
 * Per-state action panel (README 1k / 2c): the button set is what the CURRENT
 * state + ownership allow — never a disabled button standing in for a
 * transition that would fail. Approve only exists once you own the claim.
 * Mutations share the exact result-handling shape as queue-table.tsx: ok →
 * toast + router.refresh(); rate_limited → RateLimitNotice; validation →
 * inline reason error in the shared reject dialog; else a fault Banner.
 */
export function ApprovalActions({
  id,
  refNo,
  state,
  mine,
  ownerName,
  canAct,
  isAdmin,
  workerError,
}: {
  id: string;
  refNo: string;
  state: string;
  mine: boolean;
  ownerName: string | null;
  canAct: boolean;
  isAdmin: boolean;
  workerError: string | null;
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
      router.refresh();
    } else if (res.kind === "rate_limited") setRetryAfter(res.retryAfterSec ?? 60);
    else setError(res.message);
  }

  function act(run: () => Promise<ActionResult<Acted>>, verb: string) {
    setError(null);
    startTransition(async () => {
      handle(await run(), verb);
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

  const notices = (
    <>
      {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
      {error && <Banner tone="fault" title={error} />}
    </>
  );

  const rejectDialog = (
    <Dialog
      open={rejecting}
      onClose={() => setRejecting(false)}
      title={`Reject ${refNo}?`}
      footer={
        <>
          <Button variant="ghost" onClick={() => setRejecting(false)}>Cancel</Button>
          <Button variant="danger" loading={pending} onClick={submitReject}>Reject</Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-xs text-fg-muted">A rejection is a human decision — the reason is recorded on the approval and in the audit trail.</p>
        <FormField label="Reason" required error={fieldErrors.reason}>
          {(p) => (
            <Textarea id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
              value={reason} onChange={(e) => setReason(e.target.value)} />
          )}
        </FormField>
      </div>
    </Dialog>
  );

  if (state === "PENDING") {
    if (!canAct) return null;
    return (
      <div className="flex flex-col gap-3">
        {notices}
        <div className="flex gap-2">
          <Button variant="primary" loading={pending} onClick={() => act(() => claimApproval({ id }), "claimed")}>
            Claim
          </Button>
          <Button variant="danger" onClick={() => setRejecting(true)}>Reject</Button>
          <Button variant="secondary" loading={pending} onClick={() => act(() => escalateApproval({ id }), "escalated")}>
            Escalate
          </Button>
        </div>
        {rejectDialog}
      </div>
    );
  }

  if (state === "CLAIMED") {
    if (mine && canAct) {
      return (
        <div className="flex flex-col gap-3">
          {notices}
          <div className="flex gap-2">
            <Button variant="primary" loading={pending} onClick={() => act(() => approveApproval({ id }), "approved")}>
              Approve
            </Button>
            <Button variant="secondary" loading={pending} onClick={() => act(() => releaseApproval({ id }), "released")}>
              Release
            </Button>
            <Button variant="danger" onClick={() => setRejecting(true)}>Reject</Button>
            <Button variant="secondary" loading={pending} onClick={() => act(() => escalateApproval({ id }), "escalated")}>
              Escalate
            </Button>
          </div>
          {rejectDialog}
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-3">
        {notices}
        <p className="text-xs text-fg-muted">Claimed by {ownerName ?? "someone else"}</p>
        {isAdmin && (
          <div className="flex gap-2">
            <Button variant="secondary" loading={pending} onClick={() => act(() => releaseApproval({ id }), "released")}>
              Release
            </Button>
            <Button variant="danger" onClick={() => setRejecting(true)}>Reject</Button>
          </div>
        )}
        {rejectDialog}
      </div>
    );
  }

  if (state === "APPROVED") {
    return (
      <Card>
        <CardHeader
          title={
            <span className="inline-flex items-center gap-2">
              <span className="inline-block size-[7px] rounded-full bg-[var(--st-inflight-dot)] animate-[pulse_1.9s_ease-in-out_infinite]" />
              Queued for execution
            </span>
          }
        />
        <CardBody>
          <p className="text-xs text-fg-secondary">
            The worker picks this up within seconds. Until it lands, the asset still reads its old status everywhere.
          </p>
        </CardBody>
      </Card>
    );
  }

  if (state === "EXECUTION_FAILED") {
    return (
      <div className="flex flex-col gap-3">
        {notices}
        <Banner
          tone="fault"
          title="Execution failed"
          actions={
            canAct && (
              <>
                <Button variant="primary" loading={pending} onClick={() => act(() => retryApproval({ id }), "re-queued")}>
                  Retry
                </Button>
                <Button variant="danger" onClick={() => setRejecting(true)}>Reject</Button>
              </>
            )
          }
        >
          <pre className="whitespace-pre-wrap font-mono text-xs">{workerError}</pre>
        </Banner>
        {rejectDialog}
      </div>
    );
  }

  // REJECTED / EXECUTED / anything else: the page's resolution line already says it all.
  return null;
}
