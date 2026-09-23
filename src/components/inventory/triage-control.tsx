"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/ui/form-field";
import { Banner } from "@/components/ui/banner";
import { useToast } from "@/components/ui/toast";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { TRIAGE_OUTCOMES, TRIAGE_LABEL, type TriageOutcome } from "@/lib/lifecycle";
import { triageAsset } from "@/server/modules/lifecycle/actions";

/**
 * Phase 15 (spec §1 rows 6–7): decide what a "back, not checked" device becomes.
 * Phase 30 (plan P-3): a controlled dialog; the caller owns the trigger and `open`.
 */
export function TriageDialog({ open, onClose, asset }: {
  open: boolean;
  onClose: () => void;
  asset: { id: string; tag: string; model: string };
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [outcome, setOutcome] = useState<TriageOutcome>(TRIAGE_OUTCOMES[0]);
  const [note, setNote] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [retryAfter, setRetryAfter] = useState<number | null>(null);

  useEffect(() => {
    if (open) {
      setOutcome(TRIAGE_OUTCOMES[0]); setNote("");
      setError(null); setFieldErrors({}); setRetryAfter(null);
    }
  }, [open]);

  function submit() {
    setError(null); setFieldErrors({});
    startTransition(async () => {
      const res = await triageAsset({ assetId: asset.id, outcome, note });
      if (res.ok) {
        toast(`${asset.tag} triaged · ${TRIAGE_LABEL[outcome]}`, "settled");
        onClose();
        router.refresh();
      } else if (res.kind === "rate_limited") setRetryAfter(res.retryAfterSec ?? 60);
      else if (res.kind === "validation") { const fe = res.fieldErrors ?? {}; setFieldErrors(fe); if (fe._form) setError(fe._form); }
      else setError(res.message);
    });
  }

  return (
    <Dialog open={open} onClose={onClose} title={`Triage ${asset.tag} · ${asset.model}`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={pending} onClick={submit}>Save decision</Button></>}>
      <div className="flex flex-col gap-3">
        <p className="text-xs text-fg-muted">
          Applies now and is recorded in the audit trail under your name.
        </p>
        {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
        {error && <Banner tone="fault" title={error} />}
        <FormField label="Decision" required error={fieldErrors.outcome}>
          {(p) => (
            <Select id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid} value={outcome} onChange={(e) => setOutcome(e.target.value as TriageOutcome)}>
              {TRIAGE_OUTCOMES.map((o) => <option key={o} value={o}>{TRIAGE_LABEL[o]}</option>)}
            </Select>
          )}
        </FormField>
        <FormField label="Note" error={fieldErrors.note}>
          {(p) => <Textarea id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid} value={note} onChange={(e) => setNote(e.target.value)} />}
        </FormField>
      </div>
    </Dialog>
  );
}
