"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";
import { FormField } from "@/components/ui/form-field";
import { Banner } from "@/components/ui/banner";
import { useToast } from "@/components/ui/toast";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { ReasonField } from "@/components/patterns/reason-field";
import { REASON_CHIPS } from "@/lib/reason-chips";
import type { AssetClass, AssetStatus } from "@prisma/client";
import { STATUS_LABEL, statusTargets } from "@/lib/asset-class";
import { requestStatusChange } from "@/server/modules/inventory/actions";
import { changeStatus } from "@/server/modules/lifecycle/actions";

/**
 * Phase 15 (spec §2.1): direct mode applies at once instead of opening an approval.
 * Phase 30 (spec §4.2, plan P-3/P-6): a controlled dialog offering only `statusTargets`, in
 * friendly words (option values stay the enum), with nothing preselected.
 */
export function ChangeStatusDialog({
  open,
  onClose,
  asset,
  direct,
}: {
  open: boolean;
  onClose: () => void;
  asset: { id: string; tag: string; model: string; cls: AssetClass; status: AssetStatus; hasHolder: boolean };
  direct: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const options = statusTargets(asset);
  const [to, setTo] = useState<string>("");
  const [reason, setReason] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [retryAfter, setRetryAfter] = useState<number | null>(null);

  useEffect(() => {
    if (open) {
      setTo(""); setReason("");
      setError(null); setFieldErrors({}); setRetryAfter(null);
    }
  }, [open]);

  function submit() {
    setError(null);
    if (!to) { setFieldErrors({ to: "Pick a status" }); return; }
    setFieldErrors({});
    startTransition(async () => {
      const res = direct
        ? await changeStatus({ assetId: asset.id, to, reason })
        : await requestStatusChange({ assetId: asset.id, to, reason });
      if (res.ok) {
        toast(
          direct
            ? `${asset.tag} is now ${to}`
            : `${(res.data as { refNo: string }).refNo} created — waiting in the approval queue`,
          "settled",
        );
        onClose();
        router.refresh();
      } else if (res.kind === "rate_limited") setRetryAfter(res.retryAfterSec ?? 60);
      else if (res.kind === "validation") {
        const fe = res.fieldErrors ?? {};
        setFieldErrors(fe);
        const unclaimed = fe.assetId ?? fe._form;
        if (unclaimed) setError(unclaimed);
      }
      else setError(res.message);
    });
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={direct ? `Change status of ${asset.tag} · ${asset.model}` : "Request a status change"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={pending} onClick={submit}>{direct ? "Change status" : "Request"}</Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-xs text-fg-muted">
          {direct ? (
            <>Applies now and is recorded in the audit trail under your name.</>
          ) : (
            <>
              This files a request for approval. Creates a <span className="font-mono">lifecycle.change-status</span> approval; the asset
              stays <span className="font-mono">{asset.status}</span> until it executes.
            </>
          )}
        </p>
        {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
        {error && <Banner tone="fault" title={error} />}
        <FormField label="New status" required error={fieldErrors.to}>
          {(p) => (
            <Select id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid} value={to} onChange={(e) => setTo(e.target.value)}>
              <option value="" disabled>Pick a status…</option>
              {options.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </Select>
          )}
        </FormField>
        <ReasonField
          required={!direct} error={fieldErrors.reason} value={reason} onChange={setReason}
          chips={REASON_CHIPS["asset.status"]} disabled={pending}
        />
      </div>
    </Dialog>
  );
}
