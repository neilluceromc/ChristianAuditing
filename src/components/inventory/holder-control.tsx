"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { FormField } from "@/components/ui/form-field";
import { Banner } from "@/components/ui/banner";
import { useToast } from "@/components/ui/toast";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { EntityCombobox, type ComboOption } from "@/components/patterns/entity-combobox";
import { ReasonField } from "@/components/patterns/reason-field";
import { REASON_CHIPS, chipsForOutcome } from "@/lib/reason-chips";
import { fmtDate } from "@/lib/format";
import { requestAssign, requestReturn } from "@/server/modules/employees/actions";
import { assignAsset, returnAsset } from "@/server/modules/lifecycle/actions";
import { reserveAsset } from "@/server/modules/reservations/actions";
import type { ActionResult } from "@/server/action-result";
import {
  DEFAULT_LOAN_DAYS, RETURN_OUTCOMES, RETURN_OUTCOME_LABEL, defaultLoanDue, minLoanDue, type ReturnOutcome,
} from "@/lib/lifecycle";

/** What every holder dialog needs to name the device it acts on (spec §4.3). */
export type AssetSummary = { id: string; tag: string; model: string };

/**
 * Phase 14 (spec §7): assign / return from the asset itself, so a department
 * without IT's loadout view can hand a car to a driver and take it back. Same
 * two actions the loadout calls; the same approvals result.
 *
 * Phase 15 (spec §2.1): `direct` applies at once instead of opening an
 * approval, and the return dialog offers RETURN_OUTCOMES instead of only
 * "return".
 *
 * Phase 30 (plan P-3): three controlled dialogs. The caller (`RecordActions`,
 * the list's row menu) owns the trigger and the `open` state; each dialog
 * resets itself when it opens. They share one submit helper.
 */
function useHolderSubmit() {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [retryAfter, setRetryAfter] = useState<number | null>(null);

  function reset() { setError(null); setFieldErrors({}); setRetryAfter(null); }

  function run<T>(call: () => Promise<ActionResult<T>>, message: (data: T) => string, onDone: () => void) {
    setError(null); setFieldErrors({});
    startTransition(async () => {
      const res = await call();
      if (res.ok) {
        toast(message(res.data), "settled");
        onDone();
        router.refresh();
      } else if (res.kind === "rate_limited") setRetryAfter(res.retryAfterSec ?? 60);
      else if (res.kind === "validation") {
        const fe = res.fieldErrors ?? {};
        setFieldErrors(fe);
        const unclaimed = fe.assetId ?? fe._form;
        if (unclaimed) setError(unclaimed);
      } else setError(res.message);
    });
  }

  return { pending, fieldErrors, error, retryAfter, setRetryAfter, reset, run };
}

/** The refusal and rate-limit pair every holder dialog shows above its fields. */
function Refusals({ error, retryAfter, onExpire }: { error: string | null; retryAfter: number | null; onExpire: () => void }) {
  return (
    <>
      {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={onExpire} />}
      {error && <Banner tone="fault" title={error} />}
    </>
  );
}

const queued = (data: { refNo: string }) => `${data.refNo} created — waiting in the approval queue`;

export function AssignDialog({
  open, onClose, asset, direct, employees, recentEmployees, heldFor,
}: {
  open: boolean;
  onClose: () => void;
  asset: AssetSummary;
  direct: boolean;
  employees: ComboOption[];
  recentEmployees?: string[];
  heldFor?: { id: string; name: string };
}) {
  const { pending, fieldErrors, error, retryAfter, setRetryAfter, reset, run } = useHolderSubmit();
  // The holder a hold names comes preselected (spec 5.1), so Assign alone completes the handover.
  const preselect = heldFor && employees.some((o) => o.value === heldFor.id) ? heldFor.id : null;
  const [employeeId, setEmployeeId] = useState<string | null>(preselect);
  const [mode, setMode] = useState<"DEPLOYED" | "TEMPORARY">("DEPLOYED");
  const [loanDueAt, setLoanDueAt] = useState(defaultLoanDue(new Date()));
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (open) {
      reset();
      setEmployeeId(preselect);
      setMode("DEPLOYED");
      setLoanDueAt(defaultLoanDue(new Date()));
      setReason("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function submit() {
    if (direct) {
      run(
        () => assignAsset({
          assetId: asset.id, employeeId: employeeId ?? "", status: mode,
          loanDueAt: mode === "TEMPORARY" ? loanDueAt : undefined, reason,
        }),
        (d) => mode === "TEMPORARY"
          ? `${asset.tag} on loan to ${d.employeeName} until ${fmtDate(loanDueAt)}`
          : `${asset.tag} assigned to ${d.employeeName}`,
        onClose,
      );
    } else {
      run(() => requestAssign({ employeeId: employeeId ?? "", assetId: asset.id, reason }), queued, onClose);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={direct ? `Assign ${asset.tag} · ${asset.model}` : "Assign a holder"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={pending} onClick={submit} disabled={!employeeId}>
            {direct ? "Assign" : "Request assign"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-xs text-fg-muted">
          {direct ? (
            <>Applies now and is recorded in the audit trail under your name.</>
          ) : (
            <>This files a request for approval. Creates a <span className="font-mono">lifecycle.assign</span> approval; {asset.tag} stays where it is until it executes.</>
          )}
        </p>
        <Refusals error={error} retryAfter={retryAfter} onExpire={() => setRetryAfter(null)} />
        <FormField label="Assign to" required error={fieldErrors.employeeId}>
          {(p) => (
            <EntityCombobox id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
              options={employees} value={employeeId} onChange={setEmployeeId} placeholder="Type a name or EMP number…"
              recent={recentEmployees} autoFocus />
          )}
        </FormField>
        {heldFor && (
          <p className="text-xs text-fg-muted">Held for {heldFor.name} — assigning to anyone else is refused until the hold is released.</p>
        )}
        {direct && (
          <SegmentedControl aria-label="Assignment kind" value={mode}
            options={[{ value: "DEPLOYED", label: "Deployed" }, { value: "TEMPORARY", label: "Loan" }]}
            onChange={(v) => setMode(v as "DEPLOYED" | "TEMPORARY")} />
        )}
        {direct && mode === "TEMPORARY" && (
          <FormField label="Loan until" required error={fieldErrors.loanDueAt} hint={`Defaults to ${DEFAULT_LOAN_DAYS} days.`}>
            {(p) => (
              <Input id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid} type="date"
                min={minLoanDue(new Date())} value={loanDueAt} onChange={(e) => setLoanDueAt(e.target.value)} />
            )}
          </FormField>
        )}
        <ReasonField
          error={fieldErrors.reason} value={reason} onChange={setReason}
          chips={REASON_CHIPS["asset.assign"]} disabled={pending}
        />
      </div>
    </Dialog>
  );
}

export function ReturnDialog({
  open, onClose, asset, holder, direct,
}: {
  open: boolean;
  onClose: () => void;
  asset: AssetSummary;
  holder: { id: string; name: string };
  direct: boolean;
}) {
  const { pending, fieldErrors, error, retryAfter, setRetryAfter, reset, run } = useHolderSubmit();
  const [outcome, setOutcome] = useState<ReturnOutcome>("TRIAGE");
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (open) {
      reset();
      setOutcome("TRIAGE");
      setReason("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function submit() {
    if (direct) {
      run(
        () => returnAsset({ assetId: asset.id, outcome, reason }),
        (d) => `${asset.tag} returned · now ${d.status}`,
        onClose,
      );
    } else {
      run(() => requestReturn({ employeeId: holder.id, assetId: asset.id, reason }), queued, onClose);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={direct ? `Return ${asset.tag} · ${asset.model} from ${holder.name}?` : "Request a return"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={pending} onClick={submit}>{direct ? "Return" : "Request return"}</Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-xs text-fg-muted">
          {direct ? (
            <>Applies now and is recorded in the audit trail under your name.</>
          ) : (
            <>This files a request for approval. Creates a <span className="font-mono">lifecycle.return</span> approval; {asset.tag} stays with {holder.name} until it executes.</>
          )}
        </p>
        <Refusals error={error} retryAfter={retryAfter} onExpire={() => setRetryAfter(null)} />
        {direct && (
          <FormField label="What happens to it" required error={fieldErrors.outcome}>
            {(p) => (
              <Select id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid} value={outcome} onChange={(e) => setOutcome(e.target.value as ReturnOutcome)}>
                {RETURN_OUTCOMES.map((o) => <option key={o} value={o}>{RETURN_OUTCOME_LABEL[o]}</option>)}
              </Select>
            )}
          </FormField>
        )}
        <ReasonField
          required={direct ? outcome === "MISSING" : true} error={fieldErrors.reason} value={reason} onChange={setReason}
          chips={direct ? chipsForOutcome(outcome) : []} disabled={pending}
        />
      </div>
    </Dialog>
  );
}

export function ReserveDialog({
  open, onClose, asset, employees, recentEmployees, defaultExpiry, minExpiry,
}: {
  open: boolean;
  onClose: () => void;
  asset: AssetSummary;
  employees: ComboOption[];
  recentEmployees?: string[];
  defaultExpiry: string;
  minExpiry: string;
}) {
  const { pending, fieldErrors, error, retryAfter, setRetryAfter, reset, run } = useHolderSubmit();
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState(defaultExpiry);
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (open) {
      reset();
      setEmployeeId(null);
      setExpiresAt(defaultExpiry);
      setReason("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function submit() {
    run(
      () => reserveAsset({ assetId: asset.id, employeeId: employeeId ?? "", expiresAt, reason }),
      () => `${asset.tag} reserved for ${employees.find((o) => o.value === employeeId)?.label ?? "them"}`,
      onClose,
    );
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Reserve ${asset.tag} · ${asset.model}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={pending} onClick={submit} disabled={!employeeId}>Reserve</Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-xs text-fg-muted">
          Promises this spare to one person. It still reads SPARE and marked HOLD until it is assigned, released or the hold expires.
        </p>
        <Refusals error={error} retryAfter={retryAfter} onExpire={() => setRetryAfter(null)} />
        <FormField label="For" required error={fieldErrors.employeeId}>
          {(p) => (
            <EntityCombobox id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
              options={employees} value={employeeId} onChange={setEmployeeId} placeholder="Type a name or EMP number…"
              recent={recentEmployees} autoFocus />
          )}
        </FormField>
        <FormField label="Expires" required error={fieldErrors.expiresAt}>
          {(p) => (
            <Input id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid} type="date"
              min={minExpiry} value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
          )}
        </FormField>
        <ReasonField
          error={fieldErrors.reason} value={reason} onChange={setReason}
          chips={REASON_CHIPS["hold.place"]} disabled={pending}
        />
      </div>
    </Dialog>
  );
}
