"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { confirmAssetDetails } from "@/server/modules/inventory/actions";

/**
 * Finance-side check that a registration's details are accurate — separate
 * from the approval queue and from AssetStatus on purpose (C-5, Phase 12
 * Task 6): this is data verification, not a lifecycle change or a custody
 * state.
 */
export function ConfirmAssetDetails({ assetId, tag }: { assetId: string; tag: string }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryAfter, setRetryAfter] = useState<number | null>(null);

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await confirmAssetDetails({ id: assetId });
      if (res.ok) {
        setOpen(false);
        toast(`${res.data.tag} confirmed`, "settled");
        router.refresh();
      } else if (res.kind === "rate_limited") setRetryAfter(res.retryAfterSec ?? 60);
      else setError(res.message);
    });
  }

  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>Confirm details</Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={`Confirm ${tag}'s details?`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" loading={pending} onClick={submit}>Confirm</Button>
          </>
        }
      >
        <div className="flex flex-col gap-2">
          {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
          {error && <Banner tone="fault" title={error} />}
          <p>
            Marks {tag} as reviewed and accurate. This cannot be undone from here — if the details are
            wrong, ask IT to correct the record instead.
          </p>
        </div>
      </Dialog>
    </>
  );
}
