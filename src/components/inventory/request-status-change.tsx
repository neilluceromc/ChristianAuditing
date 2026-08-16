"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/ui/form-field";
import { Banner } from "@/components/ui/banner";
import { useToast } from "@/components/ui/toast";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { ASSET_STATUSES } from "@/lib/inventory-list";
import { requestStatusChange } from "@/server/modules/inventory/actions";

export function RequestStatusChange({ assetId, currentStatus }: { assetId: string; currentStatus: string }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const options = ASSET_STATUSES.filter((s) => s !== currentStatus);
  const [to, setTo] = useState<string>(options[0]);
  const [reason, setReason] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [retryAfter, setRetryAfter] = useState<number | null>(null);

  function submit() {
    setError(null);
    setFieldErrors({});
    startTransition(async () => {
      const res = await requestStatusChange({ assetId, to, reason });
      if (res.ok) {
        toast(`${res.data.refNo} created — waiting in the approval queue`, "settled");
        setOpen(false);
        setReason("");
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
    <>
      <Button onClick={() => setOpen(true)}>Request status change</Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Request a status change"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" loading={pending} onClick={submit}>Request</Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <p className="text-xs text-fg-muted">
            Creates a <span className="font-mono">lifecycle.change-status</span> approval; the asset
            stays <span className="font-mono">{currentStatus}</span> until it executes.
          </p>
          {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
          {error && <Banner tone="fault" title={error} />}
          <FormField label="New status" required error={fieldErrors.to}>
            {(p) => (
              <Select id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid} value={to} onChange={(e) => setTo(e.target.value)}>
                {options.map((s) => <option key={s} value={s}>{s}</option>)}
              </Select>
            )}
          </FormField>
          <FormField label="Reason" required error={fieldErrors.reason}>
            {(p) => (
              <Textarea id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid} value={reason} onChange={(e) => setReason(e.target.value)} />
            )}
          </FormField>
        </div>
      </Dialog>
    </>
  );
}
