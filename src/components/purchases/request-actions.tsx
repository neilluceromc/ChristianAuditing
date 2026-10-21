"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { PurchaseOrderState, Role } from "@prisma/client";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { ButtonLink } from "@/components/ui/button-link";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { ReasonField } from "@/components/patterns/reason-field";
import { REASON_CHIPS } from "@/lib/reason-chips";
import { PO_WRITE_ROLES } from "@/lib/po-flow";
import { cancelRequest } from "@/server/modules/purchases/actions";

/** States the edit page (saveDraft) still accepts — see draft-actions.ts. */
const EDITABLE: readonly PurchaseOrderState[] = ["SENT_BACK", "WITH_IT"];

/**
 * Migration 38: the old transition buttons (submit, IT review / reject, request-info, complete) are gone with
 * their actions. What is left is Edit and Cancel, for the order's requester or an admin; Task 4 replaces this
 * bar. The server re-checks everything.
 */
export function RequestActions({
  id,
  state,
  role,
  isDraftOwner,
}: {
  id: string;
  state: PurchaseOrderState;
  role: Role;
  isDraftOwner: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [retryAfter, setRetryAfter] = useState<number | null>(null);

  const canWrite = PO_WRITE_ROLES.includes(role) && isDraftOwner;
  const canEdit = canWrite && EDITABLE.includes(state);
  const canCancel = canWrite && state !== "CANCELLED";

  function cancel() {
    setError(null);
    setFieldError(undefined);
    startTransition(async () => {
      const res = await cancelRequest({ id, reason });
      if (res.ok) {
        setAsking(false);
        setReason("");
        toast(`${res.data.refNo} cancelled`, "settled");
        router.refresh();
      } else if (res.kind === "validation") setFieldError(res.fieldErrors?.reason ?? res.message);
      else if (res.kind === "rate_limited") setRetryAfter(res.retryAfterSec ?? 60);
      else {
        setAsking(false);
        setError(res.message);
      }
    });
  }

  if (!canEdit && !canCancel) return null;

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {canEdit && <ButtonLink href={`/purchases/${id}/edit`}>Edit</ButtonLink>}
        {canCancel && <Button variant="danger" onClick={() => setAsking(true)}>Cancel request</Button>}
      </div>
      {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
      {error && <Banner tone="fault" title={error} />}

      <Dialog
        open={asking}
        onClose={() => setAsking(false)}
        title="Cancel request"
        footer={
          <>
            <Button variant="ghost" onClick={() => setAsking(false)}>Cancel</Button>
            <Button variant="danger" loading={pending} onClick={cancel}>Cancel request</Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <p className="text-xs text-fg-muted">Cancelling cannot be undone. Your reason is appended to the thread.</p>
          <ReasonField
            required error={fieldError} value={reason} onChange={setReason}
            chips={REASON_CHIPS["purchase.reason"]} disabled={pending}
          />
        </div>
      </Dialog>
    </div>
  );
}
