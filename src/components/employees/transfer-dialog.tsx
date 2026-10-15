"use client";

import { useEffect, useState } from "react";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { GroupSelectOptions } from "@/components/ui/group-select-options";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { ReasonField } from "@/components/patterns/reason-field";
import { REASON_CHIPS } from "@/lib/reason-chips";
import { groupPickerOptions, type PickerGroup } from "@/lib/groups";
import { localDateISO } from "@/lib/format";
import { transferEmployee } from "@/server/modules/employees/transfer-actions";
import { useEmployeeRunner } from "./use-employee-runner";

// The Asia/Manila calendar date, like every date the app prints — not the UTC
// date, which is yesterday for a Manila user before 08:00 (Phase 20 M-5).
const today = () => localDateISO(new Date());

/**
 * Phase 20 (spec §3), Phase 29 (plan P-5): the Transfer dialog on the
 * employee page header, admin/it_staff only — controlled by the caller
 * (`ProfileActions`), which owns the trigger (the More menu's "Transfer…"
 * item) and the `open` state; this component renders no trigger of its own.
 * `departments` (departments AND clients, Phase 37) is handed in with the employee's CURRENT one
 * already excluded — a transfer to the same one is a schema-level refusal
 * (`transferEmployee`'s own "Already in this department"), so the picker
 * never offers it in the first place. Archived rows are never offered (spec §2.1). `toTitle` is prefilled with the
 * current title (still required — see transfer-actions.ts's own note on why
 * a same-title transfer is still a real transfer, not a no-op).
 */
export function TransferDialog({
  open,
  onClose,
  employeeId,
  employeeName,
  currentTitle,
  departments,
}: {
  open: boolean;
  onClose: () => void;
  employeeId: string;
  employeeName: string;
  currentTitle: string;
  departments: PickerGroup[];
}) {
  // Internal first, then clients — the order the picker shows, so the preselected row is the one on top.
  const usable = groupPickerOptions(departments);
  const choices = [...usable.internal, ...usable.client];
  const { pending, error, fieldErrors, retryAfter, setRetryAfter, reset, run } =
    useEmployeeRunner(["toDepartmentId", "toTitle", "effectiveAt", "reason"]);
  const [toDepartmentId, setToDepartmentId] = useState(choices[0]?.id ?? "");
  const [toTitle, setToTitle] = useState(currentTitle);
  const [effectiveAt, setEffectiveAt] = useState(today());
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (open) {
      reset();
      setToDepartmentId(choices[0]?.id ?? "");
      setToTitle(currentTitle);
      setEffectiveAt(today());
      setReason("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function submit() {
    const toDeptName = choices.find((d) => d.id === toDepartmentId)?.name ?? "the new department";
    run(
      () => transferEmployee({ employeeId, toDepartmentId, toTitle, effectiveAt, reason }),
      `Transferred to ${toDeptName}`,
      { onOk: () => onClose() },
    );
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Transfer ${employeeName}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={pending}
            disabled={choices.length === 0}
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
        {choices.length === 0 ? (
          <p className="text-xs text-fg-muted">No other department or client exists to move them to.</p>
        ) : (
          <FormField label="Moves to" required error={fieldErrors.toDepartmentId}>
            {(p) => (
              <Select
                id={p.id}
                aria-describedby={p["aria-describedby"]}
                invalid={p.invalid}
                value={toDepartmentId}
                onChange={(e) => setToDepartmentId(e.target.value)}
              >
                <GroupSelectOptions groups={departments} />
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
        <ReasonField
          error={fieldErrors.reason} value={reason} onChange={setReason}
          chips={REASON_CHIPS["employee.transfer"]} disabled={pending}
        />
      </div>
    </Dialog>
  );
}
