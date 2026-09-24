"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { AssetClass } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { OUTCOME_LABEL, outcomesFor, reasonRequired, type Outcome } from "@/lib/offboarding";
import { decideRemaining } from "@/server/modules/offboarding/actions";

export interface RestItem { assetId: string; tag: string; model: string; cls: AssetClass }

/** Spec §4.3: every remaining item preselected Returned, each changeable; one confirm files one decision per item. */
export function MarkRestDialog({ open, onClose, employeeId, name, items }: {
  open: boolean; onClose: () => void; employeeId: string; name: string; items: RestItem[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [rows, setRows] = useState<RestItem[]>(items);
  const [choice, setChoice] = useState<Record<string, { outcome: Outcome; reason: string }>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [retryAfter, setRetryAfter] = useState<number | null>(null);

  // Ruling R2: reset ONLY when the dialog opens, reading `items` at that
  // moment — never on every `items` change. A router.refresh() after a
  // partial refusal re-renders this dialog's parent with a fresh `items`
  // prop (the filed items now gone from the wizard's undecided set), and if
  // this effect re-ran on that change it would wipe the inline refusal
  // messages the spec requires to stay visible until the operator acts again.
  useEffect(() => {
    if (!open) return;
    setRows(items);
    setChoice(Object.fromEntries(items.map((i) => [i.assetId, { outcome: "RETURNED" as Outcome, reason: "" }])));
    setErrors({});
    setRetryAfter(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately NOT keyed on `items` (ruling R2)
  }, [open]);

  function submit() {
    const missing: Record<string, string> = {};
    for (const r of rows) {
      const c = choice[r.assetId];
      if (reasonRequired(c.outcome) && c.reason.trim().length < 3) {
        missing[r.assetId] = `${OUTCOME_LABEL[c.outcome]} needs a reason (at least 3 characters) — it lands in the approval and on the farewell report.`;
      }
    }
    setErrors(missing);
    if (Object.keys(missing).length > 0) return;
    startTransition(async () => {
      const res = await decideRemaining({
        employeeId,
        decisions: rows.map((r) => ({ assetId: r.assetId, outcome: choice[r.assetId].outcome, reason: choice[r.assetId].reason })),
      });
      if (!res.ok) {
        if (res.kind === "rate_limited" && res.retryAfterSec) setRetryAfter(res.retryAfterSec);
        else toast(res.message, "fault");
        return;
      }
      const { filed, refused } = res.data;
      if (refused.length === 0) {
        toast(`${filed.length} decisions filed`, "settled");
        onClose();
      } else {
        const filedIds = new Set(filed.map((f) => f.assetId));
        setRows((cur) => cur.filter((r) => !filedIds.has(r.assetId)));
        setErrors(Object.fromEntries(refused.map((r) => [r.assetId, r.message])));
      }
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Mark the rest as Returned · ${name}`}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={pending} onClick={submit}>File {rows.length} decisions</Button>
      </>}
    >
      {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
      <ul className="flex flex-col gap-3">
        {rows.map((r) => {
          const c = choice[r.assetId] ?? { outcome: "RETURNED" as Outcome, reason: "" };
          return (
            <li key={r.assetId} className="flex flex-col gap-1.5">
              <FormField label={`${r.tag} · ${r.model}`}>
                {(p) => (
                  <Select
                    id={p.id}
                    aria-describedby={p["aria-describedby"]}
                    value={c.outcome}
                    onChange={(e) =>
                      setChoice((cur) => ({ ...cur, [r.assetId]: { ...c, outcome: e.target.value as Outcome } }))
                    }
                  >
                    {outcomesFor(r.cls).map((o) => (
                      <option key={o} value={o}>{OUTCOME_LABEL[o]}</option>
                    ))}
                  </Select>
                )}
              </FormField>
              {reasonRequired(c.outcome) && (
                <FormField
                  label={`Reason for ${r.tag}`}
                  error={reasonRequired(c.outcome) ? errors[r.assetId] : undefined}
                >
                  {(p) => (
                    <Textarea
                      id={p.id}
                      aria-describedby={p["aria-describedby"]}
                      invalid={p.invalid}
                      value={c.reason}
                      onChange={(e) =>
                        setChoice((cur) => ({ ...cur, [r.assetId]: { ...c, reason: e.target.value } }))
                      }
                    />
                  )}
                </FormField>
              )}
              {/* A refusal unrelated to the reason (a conflict, e.g. someone
                  else decided this item) must still surface even when the
                  reason field itself is hidden (a clean Return needs none). */}
              {!reasonRequired(c.outcome) && errors[r.assetId] && (
                <p className="text-[11.5px] text-[color:var(--st-fault-text)]">{errors[r.assetId]}</p>
              )}
            </li>
          );
        })}
      </ul>
    </Dialog>
  );
}
