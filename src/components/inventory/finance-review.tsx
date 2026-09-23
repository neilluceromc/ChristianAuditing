"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import type { AssetClass } from "@prisma/client";
import { CLASS_LABEL } from "@/lib/asset-class";
import {
  confirmAssetDetails,
  resubmitAssetToFinance,
  // The action keeps its Phase 12 name; it sends the record back to
  // whichever department registered it, not necessarily IT.
  returnAssetToIt,
} from "@/server/modules/inventory/actions";
import type { ActionResult } from "@/server/action-result";

export type FinanceReviewMode = "confirm" | "return" | "resubmit";

/** The next record waiting on Finance, or null when the queue is clear (spec §4.6). */
export type NextToReview = { id: string; tag: string } | null;

/**
 * `return`'s copy names the class it is sending back to (D-13) — the other
 * two modes are class-neutral, so only `return` is computed per class rather
 * than duplicating the whole table.
 */
function copyFor(cls: AssetClass): Record<FinanceReviewMode, { title: string; cta: string; done: string; blurb: string }> {
  return {
    confirm: {
      // spec §3: a dialog confirms with a verb, never a bare "Confirm" — the title reads
      // "Confirm details of BR-LT-0148?", matching the record header's primary.
      title: "Confirm details of",
      cta: "Confirm details",
      done: "confirmed",
      blurb: "Marks the details reviewed and accurate. Recorded in the audit trail with your name.",
    },
    return: {
      title: "Send back",
      cta: "Send back",
      done: `sent back to ${CLASS_LABEL[cls]}`,
      blurb: `${CLASS_LABEL[cls]} sees this reason on the record, so say what is wrong rather than that something is.`,
    },
    resubmit: {
      title: "Mark corrected",
      cta: "Mark corrected",
      done: "resubmitted to Finance",
      blurb: "Clears the returned flag so Finance reviews the record again.",
    },
  };
}

/**
 * Finance's confirm / send-back pair and the registering department's
 * mark-corrected, in one dialog (C-7). Deliberately not a gate: the asset is
 * live and usable in every one of these states — what moves is whether the
 * registering department has been told something is wrong.
 *
 * Phase 30 (plan P-3, spec §4.6, F-RECORD-14): controlled by `mode` — the
 * caller owns the triggers. Every refusal renders inside the dialog, which
 * stays open on failure; a successful confirm hands the caller the next
 * record to review.
 */
export function FinanceReviewDialog({
  mode,
  onClose,
  asset,
  onConfirmed,
}: {
  mode: FinanceReviewMode | null;
  onClose: () => void;
  asset: { id: string; tag: string; cls: AssetClass };
  onConfirmed?: (next: NextToReview) => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const COPY = copyFor(asset.cls);
  const [pending, startTransition] = useTransition();
  const [reason, setReason] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [retryAfter, setRetryAfter] = useState<number | null>(null);

  useEffect(() => {
    if (mode) {
      setReason(""); setFieldErrors({}); setError(null); setRetryAfter(null);
    }
  }, [mode]);

  function submit() {
    if (!mode) return;
    const current = mode;
    setError(null);
    setFieldErrors({});
    startTransition(async () => {
      const res: ActionResult<{ tag: string; next?: NextToReview }> =
        current === "confirm"
          ? await confirmAssetDetails({ id: asset.id })
          : current === "return"
            ? await returnAssetToIt({ id: asset.id, reason })
            : await resubmitAssetToFinance({ id: asset.id });
      if (res.ok) {
        toast(`${res.data.tag} ${COPY[current].done}`, "settled");
        if (current === "confirm") onConfirmed?.(res.data.next ?? null);
        onClose();
        router.refresh();
      } else if (res.kind === "validation") {
        const fe = res.fieldErrors ?? {};
        setFieldErrors(fe);
        // only `reason` has a field here; anything else (e.g. "Unknown asset") shows as the banner
        setError(fe._form ?? fe.id ?? null);
      }
      else if (res.kind === "rate_limited") setRetryAfter(res.retryAfterSec ?? 60);
      else setError(res.message);
    });
  }

  return (
    <Dialog
      open={mode !== null}
      onClose={onClose}
      title={mode ? `${COPY[mode].title} ${asset.tag}?` : ""}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant={mode === "return" ? "danger" : "primary"}
            loading={pending}
            onClick={submit}
          >
            {mode ? COPY[mode].cta : ""}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-xs text-fg-muted">{mode ? COPY[mode].blurb : ""}</p>
        {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
        {error && <Banner tone="fault" title={error} />}
        {mode === "return" && (
          <FormField label="What is wrong?" required error={fieldErrors.reason}>
            {(p) => (
              <Textarea
                id={p.id}
                aria-describedby={p["aria-describedby"]}
                invalid={p.invalid}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            )}
          </FormField>
        )}
      </div>
    </Dialog>
  );
}
