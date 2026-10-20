"use client";

import { useState } from "react";
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
import { peopleCount, type BlockedPerson } from "@/lib/bulk-transfer";
import { bulkTransferEmployees } from "@/server/modules/employees/transfer-actions";
import { useEmployeeRunner } from "./use-employee-runner";

// The Asia/Manila calendar date, as the single Transfer dialog uses (Phase 20 M-5).
const today = () => localDateISO(new Date());

/** How many blocked people the dialog names; the rest are counted. */
const BLOCKED_SHOWN = 5;

/**
 * Phase 45 (spec §3.4): Transfer… from the Employees bulk bar — the single Transfer dialog's destination, effective
 * date and reason fields, without the title (each person keeps their own). The caller mounts it only while open, so
 * every opening starts fresh. All or nothing: when anyone can't move, nothing is written and the dialog names up to
 * five of them with their reasons ("Untick them and try again"). On success it toasts, then `onDone` clears the
 * selection and closes, and the runner refreshes the list.
 */
export function BulkTransferDialog({
  ids,
  departments,
  onClose,
  onDone,
}: {
  /** The ticked people, in page order (never an Offboarded row — those are not selectable). */
  ids: string[];
  /** Departments and clients; archived rows are never offered. */
  departments: PickerGroup[];
  onClose: () => void;
  onDone: () => void;
}) {
  const usable = groupPickerOptions(departments);
  const choices = [...usable.internal, ...usable.client];
  const { pending, error, fieldErrors, retryAfter, setRetryAfter, run } =
    useEmployeeRunner(["toDepartmentId", "effectiveAt", "note"]);
  const [toDepartmentId, setToDepartmentId] = useState(choices[0]?.id ?? "");
  const [effectiveAt, setEffectiveAt] = useState(today());
  const [note, setNote] = useState("");
  const [blocked, setBlocked] = useState<BlockedPerson[]>([]);

  function submit() {
    run(
      async () => {
        const res = await bulkTransferEmployees({ ids, toDepartmentId, effectiveAt, note });
        setBlocked(!res.ok && res.blocked ? res.blocked : []);
        return res;
      },
      (data) => `Transferred ${peopleCount(data.count)}`,
      { onOk: onDone },
    );
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Transfer ${peopleCount(ids.length)}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={pending} disabled={choices.length === 0} onClick={submit}>
            Record transfer
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
        {blocked.length > 0 ? (
          <Banner tone="fault" title={error ?? `${peopleCount(blocked.length)} can't be transferred`}>
            <ul className="flex flex-col gap-0.5">
              {blocked.slice(0, BLOCKED_SHOWN).map((b) => (
                <li key={b.id}>{b.name} — {b.reason}</li>
              ))}
              {blocked.length > BLOCKED_SHOWN && <li>and {blocked.length - BLOCKED_SHOWN} more</li>}
            </ul>
            <p className="mt-1.5">Untick them and try again</p>
          </Banner>
        ) : (
          error && <Banner tone="fault" title={error} />
        )}
        {choices.length === 0 ? (
          <p className="text-xs text-fg-muted">No department or client exists to move them to.</p>
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
        <p className="text-xs text-fg-muted">Everyone keeps their own job title.</p>
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
          error={fieldErrors.note} value={note} onChange={setNote}
          chips={REASON_CHIPS["employee.transfer"]} disabled={pending}
        />
      </div>
    </Dialog>
  );
}
