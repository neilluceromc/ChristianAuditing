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
import { EntityCombobox, type ComboOption } from "@/components/patterns/entity-combobox";
import { RETURN_OUTCOMES, RETURN_OUTCOME_LABEL, reasonRequiredFor, type ReturnOutcome } from "@/lib/lifecycle";
import { replaceAsset } from "@/server/modules/lifecycle/actions";

/** Phase 15 (spec §3): one confirm swaps a held device for a spare. */
export function ReplaceControl({ assetId, tag, employeeId, employeeName, spares }: {
  assetId: string; tag: string; employeeId: string; employeeName: string;
  /** same-type spares first, then any IT spare — the page orders them */
  spares: ComboOption[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [newAssetId, setNewAssetId] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<ReturnOutcome>("TRIAGE");
  const [reason, setReason] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [retryAfter, setRetryAfter] = useState<number | null>(null);

  function close() { setOpen(false); setNewAssetId(null); setOutcome("TRIAGE"); setReason(""); setError(null); setFieldErrors({}); setRetryAfter(null); }

  function submit() {
    setError(null); setFieldErrors({});
    startTransition(async () => {
      const res = await replaceAsset({ employeeId, oldAssetId: assetId, newAssetId: newAssetId ?? "", outcome, reason });
      if (res.ok) {
        toast(`${res.data.oldTag} replaced by ${res.data.newTag} for ${employeeName}`, "settled");
        close();
        router.refresh();
      } else if (res.kind === "rate_limited") setRetryAfter(res.retryAfterSec ?? 60);
      else if (res.kind === "validation") { const fe = res.fieldErrors ?? {}; setFieldErrors(fe); if (fe._form) setError(fe._form); }
      else setError(res.message);
    });
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>Replace</Button>
      <Dialog open={open} onClose={close} title={`Replace ${tag}`}
        footer={<><Button variant="ghost" onClick={close}>Cancel</Button>
          <Button variant="primary" loading={pending} onClick={submit} disabled={!newAssetId}>Confirm</Button></>}>
        <div className="flex flex-col gap-3">
          <p className="text-xs text-fg-muted">
            {employeeName} keeps working: the new device takes over now, and {tag} comes off their loadout with the outcome you pick. Both changes are recorded in the audit trail under your name.
          </p>
          {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
          {error && <Banner tone="fault" title={error} />}
          <FormField label="Replacement" required error={fieldErrors.newAssetId}>
            {(p) => <EntityCombobox id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
              options={spares} value={newAssetId} onChange={setNewAssetId} placeholder="Type a tag or model…" />}
          </FormField>
          <FormField label={`What happens to ${tag}`} required error={fieldErrors.outcome}>
            {(p) => (
              <Select id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid} value={outcome} onChange={(e) => setOutcome(e.target.value as ReturnOutcome)}>
                {RETURN_OUTCOMES.map((o) => <option key={o} value={o}>{RETURN_OUTCOME_LABEL[o]}</option>)}
              </Select>
            )}
          </FormField>
          <FormField label="Reason" required={reasonRequiredFor(outcome)} error={fieldErrors.reason}>
            {(p) => <Textarea id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid} value={reason} onChange={(e) => setReason(e.target.value)} />}
          </FormField>
        </div>
      </Dialog>
    </>
  );
}
