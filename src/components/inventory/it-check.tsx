"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { verifyAssetDetails } from "@/server/modules/inventory/actions";

/** Phase 14 (spec §5.5): IT's one-click check on a Purchasing-registered IT asset. */
export function ItCheck({ assetId, tag }: { assetId: string; tag: string }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [retryAfter, setRetryAfter] = useState<number | null>(null);

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await verifyAssetDetails({ id: assetId });
      if (res.ok) {
        toast(`${res.data.tag} checked — Finance can see it now`, "settled");
        setOpen(false);
        router.refresh();
      } else if (res.kind === "rate_limited") setRetryAfter(res.retryAfterSec ?? 60);
      else setError(res.message);
    });
  }

  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>Mark checked</Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={`Mark ${tag} checked?`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
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
    </>
  );
}
