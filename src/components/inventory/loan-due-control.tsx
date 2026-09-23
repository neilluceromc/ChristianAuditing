"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
import { Banner } from "@/components/ui/banner";
import { DuePill } from "@/components/ui/due-pill";
import { useToast } from "@/components/ui/toast";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { setLoanDue } from "@/server/modules/lifecycle/actions";
import { defaultLoanDue, minLoanDue } from "@/lib/lifecycle";
import { fmtDate } from "@/lib/format";

/**
 * Phase 16 (spec §4.2): the record's own view of a loan's due date — separate
 * from the holder dialogs' assign/return, since changing when a device is due
 * back doesn't touch who holds it.
 *
 * Phase 30 (plan P-3, spec §4.3): split in two — `LoanLine` only shows the
 * date (a `DuePill`, accent when overdue), and `LoanDueDialog` is a controlled
 * dialog the record's More menu opens with "Set loan date…".
 */
export function LoanLine({ loanDueAt, today }: { loanDueAt: string | null; today: string }) {
  return (
    <p className="flex items-center gap-1.5 text-[13px]">
      {loanDueAt ? (
        <>
          <span className="text-fg-secondary">On loan until</span>
          <DuePill dueAt={new Date(loanDueAt + "T00:00:00Z")} today={today} withDate />
        </>
      ) : (
        <span className="font-medium" style={{ color: "var(--st-attention-text)" }}>No due date</span>
      )}
    </p>
  );
}

export function LoanDueDialog({ open, onClose, asset, loanDueAt }: {
  open: boolean;
  onClose: () => void;
  asset: { id: string; tag: string };
  loanDueAt: string | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState(loanDueAt ?? defaultLoanDue(new Date()));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [retryAfter, setRetryAfter] = useState<number | null>(null);

  useEffect(() => {
    if (open) {
      setValue(loanDueAt ?? defaultLoanDue(new Date()));
      setError(null); setFieldErrors({}); setRetryAfter(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function submit() {
    setError(null); setFieldErrors({});
    startTransition(async () => {
      const res = await setLoanDue({ assetId: asset.id, loanDueAt: value });
      if (res.ok) {
        toast(`${asset.tag} due back ${fmtDate(res.data.loanDueAt)}`, "settled");
        onClose();
        router.refresh();
      } else if (res.kind === "rate_limited") setRetryAfter(res.retryAfterSec ?? 60);
      else if (res.kind === "validation") setFieldErrors(res.fieldErrors ?? {});
      else setError(res.message);
    });
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Set the loan date for ${asset.tag}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={pending} onClick={submit}>Save date</Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
        {error && <Banner tone="fault" title={error} />}
        <FormField label="Loan until" required error={fieldErrors.loanDueAt}>
          {(p) => (
            <Input id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid} type="date"
              min={minLoanDue(new Date())} value={value} onChange={(e) => setValue(e.target.value)} />
          )}
        </FormField>
      </div>
    </Dialog>
  );
}
