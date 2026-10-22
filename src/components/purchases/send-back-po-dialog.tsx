"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";
import { poSendBackToast, runPoSendBackUndo } from "@/lib/finance-review-ui";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Textarea } from "@/components/ui/textarea";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { useFinanceRunner } from "@/components/finance/use-finance-runner";
import { PO_REASON_HINT, PO_SEND_BACK_GROUPS, poSendBackFields, type PoSendBackKey } from "@/lib/po-send-back";
import { sendBackPurchaseOrder, undoPoSendBack } from "@/server/modules/purchases/po-actions";

/**
 * Spec §4 way 1 / §5: IT (or Finance) ticks what is wrong with a PO's money details and adds a note; the PO goes
 * back to Purchasing, whose team gets the bell. The same checklist idiom as Finance's per-asset send-back. Fees is on
 * the list only for a legacy PO that has a fee (poSendBackFields).
 */
export function SendBackPoDialog({
  open, onClose, id, refNo, formV2, fees,
}: { open: boolean; onClose: () => void; id: string; refNo: string; formV2: boolean; fees: number | null }) {
  const offered = poSendBackFields({ formV2, fees });
  const { pending, error, fieldErrors, retryAfter, setRetryAfter, reset, run } = useFinanceRunner(["note"]);
  const [ticked, setTicked] = useState<Set<PoSendBackKey>>(new Set());
  const [note, setNote] = useState("");
  const router = useRouter();
  const toast = useToast();

  useEffect(() => {
    if (!open) return;
    reset();
    setTicked(new Set());
    setNote("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function toggle(key: PoSendBackKey, on: boolean) {
    setTicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  function send() {
    const fields = offered.filter((f) => ticked.has(f.key)).map((f) => f.key);
    run(
      () => sendBackPurchaseOrder({ id, fields, ...(note.trim() ? { note } : {}) }),
      // Task 6 fix round 1: the send-back can be taken back for 15 minutes (undoPoSendBack), from the toast too
      () => poSendBackToast({ id, refNo }, (poId) => void runPoSendBackUndo(poId, {
        call: undoPoSendBack, toast: (m, tone) => toast(m, tone), refresh: () => router.refresh(),
      })),
      { onOk: onClose },
    );
  }

  const banner = error ?? fieldErrors.fields ?? null;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Send ${refNo} back to Purchasing`}
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
        {PO_SEND_BACK_GROUPS.map((group) => (
          <fieldset key={group} className="flex flex-col gap-1.5">
            <legend className="mb-1 text-xs font-medium text-fg">{group}</legend>
            {offered.filter((f) => f.group === group).map((f) => (
              <label key={f.key} className="flex items-center gap-2 text-[13px] text-fg-secondary">
                <Checkbox checked={ticked.has(f.key)} onChange={(e) => toggle(f.key, e.target.checked)} />
                {f.label}
              </label>
            ))}
          </fieldset>
        ))}
        <FormField label="Note for Purchasing" hint={`Optional — required for Other. ${PO_REASON_HINT}.`} error={fieldErrors.note}>
          {(p) => (
            <Textarea
              id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
              value={note} onChange={(e) => setNote(e.target.value)} maxLength={300}
            />
          )}
        </FormField>
      </div>
    </Dialog>
  );
}
