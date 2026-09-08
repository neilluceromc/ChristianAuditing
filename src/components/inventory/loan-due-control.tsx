"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
import { Banner } from "@/components/ui/banner";
import { useToast } from "@/components/ui/toast";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { setLoanDue } from "@/server/modules/lifecycle/actions";
import { defaultLoanDue, minLoanDue } from "@/lib/lifecycle";
import { fmtDate } from "@/lib/format";

/**
 * Phase 16 (spec §4.2): the record's own view of a loan's due date — separate
 * from HolderControl's assign/return, since changing when a device is due
 * back doesn't touch who holds it.
 */
export function LoanDueControl({ assetId, tag, loanDueAt }: { assetId: string; tag: string; loanDueAt: string | null }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState(loanDueAt ?? defaultLoanDue(new Date()));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [retryAfter, setRetryAfter] = useState<number | null>(null);

  function openDialog() {
    setValue(loanDueAt ?? defaultLoanDue(new Date()));
    setError(null);
    setFieldErrors({});
    setRetryAfter(null);
    setOpen(true);
  }

  function close() {
    setOpen(false); setError(null); setFieldErrors({}); setRetryAfter(null);
  }

  function submit() {
    setError(null); setFieldErrors({});
    startTransition(async () => {
      const res = await setLoanDue({ assetId, loanDueAt: value });
      if (res.ok) {
        toast(`${tag} due back ${res.data.loanDueAt}`, "settled");
        close();
        router.refresh();
      } else if (res.kind === "rate_limited") setRetryAfter(res.retryAfterSec ?? 60);
      else if (res.kind === "validation") setFieldErrors(res.fieldErrors ?? {});
      else setError(res.message);
    });
  }

  return (
    <>
      <p className="flex items-center gap-1.5 text-[13px]">
        {loanDueAt ? (
          <>
            <span className="text-fg-secondary">On loan until {fmtDate(loanDueAt)}</span>
            <span className="text-fg-secondary">·</span>
          </>
        ) : (
          <span className="font-medium" style={{ color: "var(--st-attention-text)" }}>No due date — set one</span>
        )}
        <Button variant="ghost" size="sm" onClick={openDialog}>{loanDueAt ? "Change" : "Set date"}</Button>
      </p>
      <Dialog
        open={open}
        onClose={close}
        title={`Loan due date for ${tag}`}
        footer={
          <>
            <Button variant="ghost" onClick={close}>Cancel</Button>
            <Button variant="primary" loading={pending} onClick={submit}>Save</Button>
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
    </>
  );
}
