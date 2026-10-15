"use client";

import { useEffect, useState } from "react";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Textarea } from "@/components/ui/textarea";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { REGISTRATION_FIELDS, REG_FIELD_GROUPS, type RegFieldKey } from "@/lib/registration";
import { returnAssetToIt } from "@/server/modules/inventory/actions";
import { useFinanceRunner } from "./use-finance-runner";

/** Phase 35 (spec 3.3): Finance's send-back checklist and note. */
export function SendBackDialog({
  open, onClose, id, tag, deptLabel, hasCost,
}: { open: boolean; onClose: () => void; id: string; tag: string; deptLabel: string; hasCost: boolean }) {
  const runner = useFinanceRunner(["note"]);
  const { pending, error, fieldErrors, retryAfter, setRetryAfter, reset, run } = runner;
  const [ticked, setTicked] = useState<Set<RegFieldKey>>(new Set());
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!open) return;
    reset();
    setTicked(new Set<RegFieldKey>(hasCost ? [] : ["cost"]));
    setNote("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function toggle(key: RegFieldKey, on: boolean) {
    setTicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  function send() {
    run(
      () => returnAssetToIt({ id, fields: REGISTRATION_FIELDS.filter((f) => ticked.has(f.key)).map((f) => f.key), note }),
      `${tag} sent back to ${deptLabel}`,
      { onOk: onClose },
    );
  }

  const banner = error ?? fieldErrors.fields ?? null;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Send ${tag} back to ${deptLabel}`}
      footer={
        <>
          <span className="mr-auto font-mono text-xs text-fg-muted">{ticked.size} ticked</span>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="danger" loading={pending} onClick={send}>Send back</Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
        {banner && <Banner tone="fault" title={banner} />}
        {REG_FIELD_GROUPS.map((group) => (
          <fieldset key={group} className="flex flex-col gap-1.5">
            <legend className="mb-1 text-xs font-medium text-fg">{group}</legend>
            {REGISTRATION_FIELDS.filter((f) => f.group === group).map((f) => (
              <label key={f.key} className="flex items-center gap-2 text-[13px] text-fg-secondary">
                <Checkbox checked={ticked.has(f.key)} onChange={(e) => toggle(f.key, e.target.checked)} />
                {f.label}
              </label>
            ))}
          </fieldset>
        ))}
        <FormField label={`Note for ${deptLabel}`} hint="Optional — required for Other" error={fieldErrors.note}>
          {(p) => (
            <Textarea id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
              value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
          )}
        </FormField>
      </div>
    </Dialog>
  );
}
