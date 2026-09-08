"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/ui/form-field";
import { Banner } from "@/components/ui/banner";
import { useToast } from "@/components/ui/toast";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { EntityCombobox, type ComboOption } from "@/components/patterns/entity-combobox";
import { requestAssign, requestReturn } from "@/server/modules/employees/actions";
import { assignAsset, returnAsset } from "@/server/modules/lifecycle/actions";
import {
  DEFAULT_LOAN_DAYS, RETURN_OUTCOMES, RETURN_OUTCOME_LABEL, defaultLoanDue, minLoanDue, type ReturnOutcome,
} from "@/lib/lifecycle";

type Props =
  | { assetId: string; tag: string; mode: "assign"; employees: ComboOption[]; direct: boolean }
  | { assetId: string; tag: string; mode: "return"; holder: { id: string; name: string }; direct: boolean };

/**
 * Phase 14 (spec §7): assign / return from the asset itself, so a department
 * without IT's loadout view can hand a car to a driver and take it back. Same
 * two actions the loadout calls; the same approvals result.
 *
 * Phase 15 (spec §2.1): `direct` applies at once instead of opening an
 * approval, and the return dialog offers RETURN_OUTCOMES instead of only
 * "return".
 */
export function HolderControl(props: Props) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [mode, setMode] = useState<"DEPLOYED" | "TEMPORARY">("DEPLOYED");
  const [loanDueAt, setLoanDueAt] = useState(defaultLoanDue(new Date()));
  const [outcome, setOutcome] = useState<ReturnOutcome>("TRIAGE");
  const [reason, setReason] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [retryAfter, setRetryAfter] = useState<number | null>(null);
  const isAssign = props.mode === "assign";

  function close() {
    setOpen(false); setReason(""); setEmployeeId(null); setMode("DEPLOYED"); setLoanDueAt(defaultLoanDue(new Date()));
    setOutcome("TRIAGE"); setError(null); setFieldErrors({}); setRetryAfter(null);
  }

  function submit() {
    setError(null); setFieldErrors({});
    startTransition(async () => {
      const res = props.mode === "assign"
        ? (props.direct
            ? await assignAsset({
                assetId: props.assetId, employeeId: employeeId ?? "", status: mode,
                loanDueAt: mode === "TEMPORARY" ? loanDueAt : undefined, reason,
              })
            : await requestAssign({ employeeId: employeeId ?? "", assetId: props.assetId, reason }))
        : (props.direct ? await returnAsset({ assetId: props.assetId, outcome, reason }) : await requestReturn({ employeeId: props.holder.id, assetId: props.assetId, reason }));
      if (res.ok) {
        toast(
          props.direct
            ? (props.mode === "assign"
                ? (mode === "TEMPORARY"
                    ? `${props.tag} on loan to ${(res.data as { employeeName: string }).employeeName} until ${loanDueAt}`
                    : `${props.tag} assigned to ${(res.data as { employeeName: string }).employeeName}`)
                : `${props.tag} returned · now ${(res.data as { status: string }).status}`)
            : `${(res.data as { refNo: string }).refNo} created — waiting in the approval queue`,
          "settled",
        );
        close();
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

  const returnReasonRequired = props.mode === "return" && (props.direct ? outcome === "MISSING" : true);

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        {isAssign ? (props.direct ? "Assign" : "Assign holder") : "Return"}
      </Button>
      <Dialog
        open={open}
        onClose={close}
        title={
          props.direct
            ? (isAssign ? `Assign ${props.tag}` : `Return ${props.tag}`)
            : (isAssign ? "Assign a holder" : "Request a return")
        }
        footer={
          <>
            <Button variant="ghost" onClick={close}>Cancel</Button>
            <Button variant="primary" loading={pending} onClick={submit} disabled={isAssign && !employeeId}>
              {props.direct ? "Confirm" : (isAssign ? "Request assign" : "Request return")}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <p className="text-xs text-fg-muted">
            {props.direct ? (
              <>Applies now and is recorded in the audit trail under your name.</>
            ) : isAssign ? (
              <>Creates a <span className="font-mono">lifecycle.assign</span> approval; {props.tag} stays where it is until it executes.</>
            ) : (
              <>Creates a <span className="font-mono">lifecycle.return</span> approval; {props.tag} stays with {props.holder.name} until it executes.</>
            )}
          </p>
          {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
          {error && <Banner tone="fault" title={error} />}
          {isAssign && props.direct && (
            <SegmentedControl aria-label="Assignment kind" value={mode}
              options={[{ value: "DEPLOYED", label: "Deployed" }, { value: "TEMPORARY", label: "Loan" }]}
              onChange={(v) => setMode(v as "DEPLOYED" | "TEMPORARY")} />
          )}
          {isAssign && props.direct && mode === "TEMPORARY" && (
            <FormField label="Loan until" required error={fieldErrors.loanDueAt} hint={`Defaults to ${DEFAULT_LOAN_DAYS} days.`}>
              {(p) => (
                <Input id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid} type="date"
                  min={minLoanDue(new Date())} value={loanDueAt} onChange={(e) => setLoanDueAt(e.target.value)} />
              )}
            </FormField>
          )}
          {isAssign && (
            <FormField label="Assign to" required error={fieldErrors.employeeId}>
              {(p) => (
                <EntityCombobox id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                  options={props.employees} value={employeeId} onChange={setEmployeeId} placeholder="Type a name or EMP number…" />
              )}
            </FormField>
          )}
          {!isAssign && props.direct && (
            <FormField label="What happens to it" required error={fieldErrors.outcome}>
              {(p) => (
                <Select id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid} value={outcome} onChange={(e) => setOutcome(e.target.value as ReturnOutcome)}>
                  {RETURN_OUTCOMES.map((o) => <option key={o} value={o}>{RETURN_OUTCOME_LABEL[o]}</option>)}
                </Select>
              )}
            </FormField>
          )}
          <FormField label="Reason" required={!isAssign && returnReasonRequired} error={fieldErrors.reason}>
            {(p) => <Textarea id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid} value={reason} onChange={(e) => setReason(e.target.value)} />}
          </FormField>
        </div>
      </Dialog>
    </>
  );
}
