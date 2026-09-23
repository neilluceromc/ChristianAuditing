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
import { EntityCombobox, type ComboOption } from "@/components/patterns/entity-combobox";
import { ReasonField } from "@/components/patterns/reason-field";
import { chipsForOutcome } from "@/lib/reason-chips";
import { RETURN_OUTCOMES, RETURN_OUTCOME_LABEL, reasonRequiredFor, type ReturnOutcome } from "@/lib/lifecycle";
import { replaceAsset } from "@/server/modules/lifecycle/actions";

/** The Phase 29 loadout wording (spec §4.3): how many spares the picker leaves out, and why. */
function hiddenSparesLine(hidden: number): string {
  return `${hidden} more spare${hidden === 1 ? "" : "s"} ${hidden === 1 ? "is" : "are"} held or queued for someone else`;
}

/**
 * Phase 15 (spec §3): one confirm swaps a held device for a spare.
 * Phase 30 (plan P-3): a controlled dialog; the caller owns the trigger and `open`.
 */
export function ReplaceDialog({ open, onClose, asset, holder, spares, hidden }: {
  open: boolean;
  onClose: () => void;
  asset: { id: string; tag: string; model: string };
  holder: { id: string; name: string };
  /** same-type spares first, then any IT spare — `spareOptions` orders them */
  spares: ComboOption[];
  /** spares left out because a hold or an open approval already claims them */
  hidden: number;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [newAssetId, setNewAssetId] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<ReturnOutcome>("TRIAGE");
  const [reason, setReason] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [retryAfter, setRetryAfter] = useState<number | null>(null);

  useEffect(() => {
    if (open) {
      setNewAssetId(null); setOutcome("TRIAGE"); setReason("");
      setError(null); setFieldErrors({}); setRetryAfter(null);
    }
  }, [open]);

  function submit() {
    setError(null); setFieldErrors({});
    startTransition(async () => {
      const res = await replaceAsset({ employeeId: holder.id, oldAssetId: asset.id, newAssetId: newAssetId ?? "", outcome, reason });
      if (res.ok) {
        toast(`${res.data.oldTag} replaced by ${res.data.newTag} for ${holder.name}`, "settled");
        onClose();
        router.refresh();
      } else if (res.kind === "rate_limited") setRetryAfter(res.retryAfterSec ?? 60);
      else if (res.kind === "validation") { const fe = res.fieldErrors ?? {}; setFieldErrors(fe); if (fe._form) setError(fe._form); }
      else setError(res.message);
    });
  }

  return (
    <Dialog open={open} onClose={onClose} title={`Replace ${asset.tag} · ${asset.model} for ${holder.name}`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={pending} onClick={submit} disabled={!newAssetId}>Replace</Button></>}>
      <div className="flex flex-col gap-3">
        <p className="text-xs text-fg-muted">
          {holder.name} keeps working: the new device takes over now, and {asset.tag} comes off their loadout with the outcome you pick. Both changes are recorded in the audit trail under your name.
        </p>
        {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
        {error && <Banner tone="fault" title={error} />}
        <FormField label="Replacement" required error={fieldErrors.newAssetId} hint={hidden > 0 ? hiddenSparesLine(hidden) : undefined}>
          {(p) => <EntityCombobox id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
            options={spares} value={newAssetId} onChange={setNewAssetId} placeholder="Type a tag or model…" autoFocus />}
        </FormField>
        <FormField label={`What happens to ${asset.tag}`} required error={fieldErrors.outcome}>
          {(p) => (
            <Select id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid} value={outcome} onChange={(e) => setOutcome(e.target.value as ReturnOutcome)}>
              {RETURN_OUTCOMES.map((o) => <option key={o} value={o}>{RETURN_OUTCOME_LABEL[o]}</option>)}
            </Select>
          )}
        </FormField>
        <ReasonField
          required={reasonRequiredFor(outcome)} error={fieldErrors.reason} value={reason} onChange={setReason}
          chips={chipsForOutcome(outcome)} disabled={pending}
        />
      </div>
    </Dialog>
  );
}
