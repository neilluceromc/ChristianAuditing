"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { verifyAssetDetails } from "@/server/modules/inventory/actions";

/**
 * Phase 14 (spec §5.5): IT's one-click check on a Purchasing-registered IT asset.
 * Phase 30 (plan P-3): a controlled dialog; the caller owns the trigger and `open`.
 */
export function ItCheckDialog({ open, onClose, asset }: {
  open: boolean;
  onClose: () => void;
  asset: { id: string; tag: string };
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [retryAfter, setRetryAfter] = useState<number | null>(null);

  useEffect(() => {
    if (open) { setError(null); setRetryAfter(null); }
  }, [open]);

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await verifyAssetDetails({ id: asset.id });
      if (res.ok) {
        toast(`${res.data.tag} checked — Finance can see it now`, "settled");
        onClose();
        router.refresh();
      } else if (res.kind === "rate_limited") setRetryAfter(res.retryAfterSec ?? 60);
      else setError(res.message);
    });
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Mark ${asset.tag} checked?`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={pending} onClick={submit}>Mark checked</Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-xs text-fg-muted">
          Confirms the details Purchasing registered are right for IT. Finance sees this record only after.
          Edit first if something is wrong.
        </p>
        {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
        {error && <Banner tone="fault" title={error} />}
      </div>
    </Dialog>
  );
}
