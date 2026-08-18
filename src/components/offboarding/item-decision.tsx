"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { FormError, FormField } from "@/components/ui/form-field";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { OUTCOMES, OUTCOME_LABEL, OUTCOME_STATUS, reasonRequired, type Outcome } from "@/lib/offboarding";
import { decideItem } from "@/server/modules/offboarding/actions";

/**
 * The 4-way control (README 3e). Missing is first-class and sits in the same
 * row as the other three — not behind a "more" menu — because pretending
 * everything comes back is why spreadsheets drift.
 *
 * Confirm is enabled as soon as an outcome is picked, even with the reason
 * empty: the SERVER refuses a reasonless Defective/Buyout/Missing, and letting
 * the operator see that refusal is how the rule stays real rather than being a
 * client-side courtesy.
 */
export function ItemDecision({
  employeeId,
  assetId,
  tag,
}: {
  employeeId: string;
  assetId: string;
  tag: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [outcome, setOutcome] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [retryAfter, setRetryAfter] = useState<number | null>(null);

  const picked = (OUTCOMES as readonly string[]).includes(outcome) ? (outcome as Outcome) : null;

  function submit() {
    if (!picked) {
      setFieldErrors({ outcome: "Pick an outcome — undecided is not the same as returned." });
      return;
    }
    setError(null);
    setFieldErrors({});
    startTransition(async () => {
      const res = await decideItem({ employeeId, assetId, outcome: picked, reason });
      if (res.ok) {
        toast(`${res.data.refNo} created — ${tag} → ${OUTCOME_STATUS[picked]}`, "settled");
        router.refresh();
      } else if (res.kind === "rate_limited") setRetryAfter(res.retryAfterSec ?? 60);
      else if (res.kind === "validation") setFieldErrors(res.fieldErrors ?? {});
      else setError(res.message);
    });
  }

  return (
    // named group: one row's controls are addressable on their own, by a
    // screen reader and by the e2e spec alike
    <div role="group" aria-label={`Decide ${tag}`} className="flex flex-col gap-2">
      {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
      {error && <Banner tone="fault" title={error} />}
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl
          aria-label={`Outcome for ${tag}`}
          options={OUTCOMES.map((o) => ({ value: o, label: OUTCOME_LABEL[o] }))}
          value={outcome}
          onChange={setOutcome}
        />
        <Button size="sm" variant="primary" loading={pending} onClick={submit}>
          Confirm decision
        </Button>
        <span className="font-mono text-[10px] text-fg-muted">
          {picked ? `creates a lifecycle.return → ${OUTCOME_STATUS[picked]}` : "creates its own request the moment you confirm"}
        </span>
      </div>
      <FormError>{fieldErrors.outcome}</FormError>
      <FormField
        label="Reason"
        required={picked ? reasonRequired(picked) : false}
        hint={
          picked && reasonRequired(picked)
            ? `${OUTCOME_LABEL[picked]} needs a reason — it lands in the approval and on the farewell report.`
            : "Optional for a clean return."
        }
        error={fieldErrors.reason}
      >
        {(p) => (
          <Textarea
            id={p.id}
            aria-describedby={p["aria-describedby"]}
            invalid={p.invalid}
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        )}
      </FormField>
    </div>
  );
}
