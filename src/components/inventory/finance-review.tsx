"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import {
  confirmAssetDetails,
  resubmitAssetToFinance,
  returnAssetToIt,
} from "@/server/modules/inventory/actions";
import type { ActionResult } from "@/server/action-result";

type Mode = "confirm" | "return" | "resubmit";

const COPY: Record<Mode, { title: string; cta: string; done: string; blurb: string }> = {
  confirm: {
    title: "Confirm",
    cta: "Confirm",
    done: "confirmed",
    blurb: "Marks the details reviewed and accurate. Recorded in the audit trail with your name.",
  },
  return: {
    title: "Send back",
    cta: "Send back",
    done: "sent back to IT",
    blurb: "IT sees this reason on the record, so say what is wrong rather than that something is.",
  },
  resubmit: {
    title: "Mark corrected",
    cta: "Mark corrected",
    done: "resubmitted to Finance",
    blurb: "Clears the returned flag so Finance reviews the record again.",
  },
};

/**
 * Finance's confirm / send-back pair and IT's mark-corrected, in one island
 * (C-7). Deliberately not a gate: the asset is live and usable in every one
 * of these states — what moves is whether IT has been told something is wrong.
 */
export function FinanceReview({
  assetId,
  tag,
  canConfirm,
  canResubmit,
}: {
  assetId: string;
  tag: string;
  canConfirm: boolean;
  canResubmit: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<Mode | null>(null);
  const [reason, setReason] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [retryAfter, setRetryAfter] = useState<number | null>(null);

  function close() {
    setMode(null);
    setReason("");
    setFieldErrors({});
  }

  function submit() {
    if (!mode) return;
    setError(null);
    setFieldErrors({});
    startTransition(async () => {
      const res: ActionResult<{ tag: string }> =
        mode === "confirm"
          ? await confirmAssetDetails({ id: assetId })
          : mode === "return"
            ? await returnAssetToIt({ id: assetId, reason })
            : await resubmitAssetToFinance({ id: assetId });
      if (!res.ok && res.kind === "validation") {
        setFieldErrors(res.fieldErrors ?? {});
        return;
      }
      const verb = COPY[mode].done;
      close();
      if (res.ok) {
        toast(`${res.data.tag} ${verb}`, "settled");
        router.refresh();
      } else if (res.kind === "rate_limited") setRetryAfter(res.retryAfterSec ?? 60);
      else setError(res.message);
    });
  }

  return (
    <>
      {canConfirm && (
        <>
          <Button variant="primary" onClick={() => setMode("confirm")}>Confirm details</Button>
          <Button variant="ghost" onClick={() => setMode("return")}>Send back to IT</Button>
        </>
      )}
      {canResubmit && (
        <Button variant="primary" onClick={() => setMode("resubmit")}>Mark corrected</Button>
      )}
      {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
      {error && <Banner tone="fault" title={error} />}
      <Dialog
        open={mode !== null}
        onClose={close}
        title={mode ? `${COPY[mode].title} ${tag}?` : ""}
        footer={
          <>
            <Button variant="ghost" onClick={close}>Cancel</Button>
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
    </>
  );
}
