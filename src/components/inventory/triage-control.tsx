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
import {
  TRIAGE_DECISION_MESSAGE, TRIAGE_OUTCOMES, TRIAGE_LABEL, TRIAGE_REASON_MESSAGE,
  triageNeedsReason, triageReasonValid, type TriageOutcome,
} from "@/lib/lifecycle";
import { REASON_CHIPS } from "@/lib/reason-chips";
import { triageAsset } from "@/server/modules/lifecycle/actions";

const CHIPS = REASON_CHIPS["asset.triage"];

/**
 * Phase 15 (spec §1 rows 6–7): decide what a "back, not checked" device becomes.
 * Phase 30 (plan P-3): a controlled dialog; the caller owns the trigger and `open`.
 * Phase 40 (spec §8): nothing is preselected — a decision is a choice, not a default someone saves
 * past — and Dispose and Donate need a reason (a chip or at least 2 characters). The same rule is
 * `triageAsset`'s zod (triageInputSchema), so an old client cannot skip it.
 */
export function TriageDialog({ open, onClose, asset }: {
  open: boolean;
  onClose: () => void;
  asset: { id: string; tag: string; model: string };
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [outcome, setOutcome] = useState<TriageOutcome | "">("");
  const [note, setNote] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [retryAfter, setRetryAfter] = useState<number | null>(null);

  useEffect(() => {
    if (open) {
      setOutcome(""); setNote("");
      setError(null); setFieldErrors({}); setRetryAfter(null);
    }
  }, [open]);

  const needsReason = outcome !== "" && triageNeedsReason(outcome);

  function choose(next: TriageOutcome) {
    setOutcome(next);
    setFieldErrors((fe) => ({ ...fe, outcome: "" }));
    // A chip is a disposal reason; it does not carry over as a note on a device that stays.
    if (!triageNeedsReason(next) && (CHIPS as readonly string[]).includes(note)) setNote("");
  }

  function submit() {
    setError(null);
    const fe: Record<string, string> = {};
    if (outcome === "") fe.outcome = TRIAGE_DECISION_MESSAGE;
    else if (!triageReasonValid(outcome, note)) fe.note = TRIAGE_REASON_MESSAGE;
    setFieldErrors(fe);
    if (outcome === "" || fe.note) return;
    startTransition(async () => {
      const res = await triageAsset({ assetId: asset.id, outcome, note });
      if (res.ok) {
        toast(`${asset.tag} triaged · ${TRIAGE_LABEL[outcome]}`, "settled");
        onClose();
        router.refresh();
      } else if (res.kind === "rate_limited") setRetryAfter(res.retryAfterSec ?? 60);
      else if (res.kind === "validation") { const sfe = res.fieldErrors ?? {}; setFieldErrors(sfe); if (sfe._form) setError(sfe._form); }
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
        <FormField label="Decision" required error={fieldErrors.outcome || undefined}>
          {(p) => (
            <Select id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid} value={outcome} onChange={(e) => choose(e.target.value as TriageOutcome)}>
              <option value="" disabled>Choose…</option>
              {TRIAGE_OUTCOMES.map((o) => <option key={o} value={o}>{TRIAGE_LABEL[o]}</option>)}
            </Select>
          )}
        </FormField>
        <ReasonField
          label={needsReason ? "Reason" : "Note"} required={needsReason}
          error={fieldErrors.note || undefined} value={note} onChange={setNote}
          chips={needsReason ? CHIPS : []} disabled={pending}
        />
      </div>
    </Dialog>
  );
}
