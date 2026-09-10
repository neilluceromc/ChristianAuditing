"use client";

import { useState } from "react";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { transferEmployee } from "@/server/modules/employees/transfer-actions";
import { useEmployeeRunner } from "./use-employee-runner";

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Phase 20 (spec §3): the Transfer button + dialog on the employee page
 * header, admin/it_staff only (the caller gates rendering — same
 * `canMutate` the Edit button already checks). `departments` is handed in
 * with the employee's CURRENT department already excluded — a transfer to
 * the same department is a schema-level refusal (`transferEmployee`'s own
 * "Already in this department"), so the picker never offers it in the first
 * place. `toTitle` is prefilled with the current title (still required —
 * see transfer-actions.ts's own note on why a same-title transfer is still a
 * real transfer, not a no-op).
 */
export function TransferDialog({
  employeeId,
  employeeName,
  currentTitle,
  departments,
}: {
  employeeId: string;
  employeeName: string;
  currentTitle: string;
  departments: Array<{ id: string; name: string }>;
}) {
  const [open, setOpen] = useState(false);
  const { pending, error, fieldErrors, retryAfter, setRetryAfter, reset, run } =
    useEmployeeRunner(["toDepartmentId", "toTitle", "effectiveAt", "reason"]);
  const [toDepartmentId, setToDepartmentId] = useState(departments[0]?.id ?? "");
  const [toTitle, setToTitle] = useState(currentTitle);
  const [effectiveAt, setEffectiveAt] = useState(today());
  const [reason, setReason] = useState("");

  function openDialog() {
    reset();
    setToDepartmentId(departments[0]?.id ?? "");
    setToTitle(currentTitle);
    setEffectiveAt(today());
    setReason("");
    setOpen(true);
  }

  function submit() {
    const toDeptName = departments.find((d) => d.id === toDepartmentId)?.name ?? "the new department";
    run(
      () => transferEmployee({ employeeId, toDepartmentId, toTitle, effectiveAt, reason }),
      `Transferred to ${toDeptName}`,
      { onOk: () => setOpen(false) },
    );
  }

  return (
    <>
      <Button onClick={openDialog}>Transfer</Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={`Transfer ${employeeName}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              variant="primary"
              loading={pending}
              disabled={departments.length === 0}
              onClick={submit}
            >
              Record transfer
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
          {error && <Banner tone="fault" title={error} />}
          {departments.length === 0 ? (
            <p className="text-xs text-fg-muted">No other department exists to transfer into.</p>
          ) : (
            <FormField label="New department" required error={fieldErrors.toDepartmentId}>
              {(p) => (
                <Select
                  id={p.id}
                  aria-describedby={p["aria-describedby"]}
                  invalid={p.invalid}
                  value={toDepartmentId}
                  onChange={(e) => setToDepartmentId(e.target.value)}
                >
                  {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </Select>
              )}
            </FormField>
          )}
          <FormField label="New title" required error={fieldErrors.toTitle}>
            {(p) => (
              <Input
                id={p.id}
                aria-describedby={p["aria-describedby"]}
                invalid={p.invalid}
                value={toTitle}
                onChange={(e) => setToTitle(e.target.value)}
              />
            )}
          </FormField>
          <FormField label="Effective date" required error={fieldErrors.effectiveAt}>
            {(p) => (
              <Input
                id={p.id}
                type="date"
                max={today()}
                aria-describedby={p["aria-describedby"]}
                invalid={p.invalid}
                value={effectiveAt}
                onChange={(e) => setEffectiveAt(e.target.value)}
              />
            )}
          </FormField>
          <FormField label="Reason" error={fieldErrors.reason}>
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
        </div>
      </Dialog>
    </>
  );
}
