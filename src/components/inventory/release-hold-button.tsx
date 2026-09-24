"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { ReasonField } from "@/components/patterns/reason-field";
import { REASON_CHIPS } from "@/lib/reason-chips";
import { releaseHold } from "@/server/modules/reservations/actions";

/**
 * Phase 32 (spec §7, plan P-12): the Release dialog on its own, controlled, so
 * /reservations can open it from a row menu. With `model` and `holderName` the
 * title names the device and the person; without them it keeps the short title
 * the record banner, the Reservations tab and the profile use.
 */
export function ReleaseHoldDialog({ open, onClose, reservationId, tag, model, holderName }: {
  open: boolean; onClose: () => void; reservationId: string; tag: string; model?: string; holderName?: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [retryAfter, setRetryAfter] = useState<number | null>(null);

  function close() { setReason(""); setError(null); setRetryAfter(null); onClose(); }
  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await releaseHold({ reservationId, reason });
      if (res.ok) { toast(`Hold on ${tag} released`, "settled"); close(); router.refresh(); }
      else if (res.kind === "rate_limited") setRetryAfter(res.retryAfterSec ?? 60);
      else if (res.kind === "validation") setError(res.fieldErrors?.reason ?? res.fieldErrors?._form ?? "Check the form");
      else setError(res.message);
    });
  }

  const title = model && holderName ? `Release the hold on ${tag} · ${model} for ${holderName}?` : `Release the hold on ${tag}?`;

  return (
    <Dialog open={open} onClose={close} title={title}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button><Button variant="primary" loading={pending} onClick={submit}>Release</Button></>}>
      <div className="flex flex-col gap-3">
        <p className="text-xs text-fg-muted">The spare goes back to the pool; the person keeps nothing. Recorded in the audit trail under your name.</p>
        {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
        {error && <Banner tone="fault" title={error} />}
        <ReasonField value={reason} onChange={setReason} chips={REASON_CHIPS["hold.release"]} disabled={pending} />
      </div>
    </Dialog>
  );
}

/** Phase 26 (spec §5): the Release control on the record banner, the record's Reservations tab and the profile's holding area. */
export function ReleaseHoldButton({ reservationId, tag, size = "md" }: { reservationId: string; tag: string; size?: "sm" | "md" }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button size={size} onClick={(e) => { e.stopPropagation(); setOpen(true); }}>Release</Button>
      <ReleaseHoldDialog open={open} onClose={() => setOpen(false)} reservationId={reservationId} tag={tag} />
    </>
  );
}
