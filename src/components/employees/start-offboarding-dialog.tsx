"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { startOffboarding } from "@/server/modules/employees/actions";
import { useEmployeeRunner } from "./use-employee-runner";

/**
 * Phase 25 (spec §3.2): the profile header's "Start offboarding" button — the
 * page renders it only for admin/it_staff on an ACTIVE employee. Complete-by is
 * prefilled with the Phase 23 default (five working days) and stays editable;
 * the server floor ("Pick today or later") is the rule, `min` a courtesy.
 * Success lands in the wizard; `useEmployeeRunner` owns the result ladder.
 */
export function StartOffboardingDialog({
  employeeId, employeeName, defaultDue, minDue,
}: {
  employeeId: string; employeeName: string; defaultDue: string; minDue: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [dueAt, setDueAt] = useState(defaultDue);
  const { pending, error, fieldErrors, retryAfter, setRetryAfter, reset, run } = useEmployeeRunner(["offboardingDueAt"]);

  function openDialog() {
    reset();
    setDueAt(defaultDue);
    setOpen(true);
  }

  function submit() {
    run(
      () => startOffboarding({ employeeId, offboardingDueAt: dueAt }),
      "Offboarding started",
      { onOk: () => { setOpen(false); router.push(`/offboarding/${employeeId}`); }, refresh: false },
    );
  }

  return (
    <>
      <Button onClick={openDialog}>Start offboarding</Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={`Start offboarding ${employeeName}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" loading={pending} onClick={submit}>Start</Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
          {error && <Banner tone="fault" title={error} />}
          <p className="text-xs text-fg-muted">
            Freezes {employeeName}&apos;s equipment slots and opens the collection wizard.
          </p>
          <FormField label="Complete by" required error={fieldErrors.offboardingDueAt}>
            {(p) => (
              <Input
                id={p.id}
                type="date"
                min={minDue}
                autoFocus
                aria-describedby={p["aria-describedby"]}
                invalid={p.invalid}
                value={dueAt}
                onChange={(e) => setDueAt(e.target.value)}
              />
            )}
          </FormField>
        </div>
      </Dialog>
    </>
  );
}
