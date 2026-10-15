"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { resubmitAssetToFinance } from "@/server/modules/inventory/actions";

/**
 * Phase 35 (plan P-9, spec §3.4): IT's / Purchasing's "Mark corrected…" — the asset goes back to Finance,
 * with an optional reply saying what was fixed. Finance's own confirm / send-back live on the Finance asset page.
 */
export function ResubmitDialog({
  open,
  onClose,
  asset,
}: {
  open: boolean;
  onClose: () => void;
  asset: { id: string; tag: string };
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [reply, setReply] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [retryAfter, setRetryAfter] = useState<number | null>(null);

  useEffect(() => {
    if (open) {
      setReply(""); setFieldErrors({}); setError(null); setRetryAfter(null);
    }
  }, [open]);

  function submit() {
    setError(null);
    setFieldErrors({});
    startTransition(async () => {
      const trimmed = reply.trim();
      const res = await resubmitAssetToFinance({ id: asset.id, ...(trimmed ? { reply: trimmed } : {}) });
      if (res.ok) {
        toast(`${res.data.tag} sent back to Finance`, "settled");
        onClose();
        router.refresh();
      } else if (res.kind === "validation") {
        const fe = res.fieldErrors ?? {};
        setFieldErrors(fe);
        setError(fe._form ?? fe.id ?? null);
      } else if (res.kind === "rate_limited") setRetryAfter(res.retryAfterSec ?? 60);
      else setError(res.message);
    });
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Mark ${asset.tag} corrected?`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={pending} onClick={submit}>Send to Finance</Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-xs text-fg-muted">Finance reviews it again. Say what you fixed if it helps them.</p>
        {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
        {error && <Banner tone="fault" title={error} />}
        <FormField label="Reply to Finance" hint="Optional" error={fieldErrors.reply}>
          {(p) => (
            <Textarea
              id={p.id}
              aria-describedby={p["aria-describedby"]}
              invalid={p.invalid}
              value={reply}
              onChange={(e) => setReply(e.target.value)}
            />
          )}
        </FormField>
      </div>
    </Dialog>
  );
}
