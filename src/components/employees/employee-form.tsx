"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Banner } from "@/components/ui/banner";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { EMPLOYMENT_LABEL, M365_CANONICAL } from "@/lib/labels";
import { localDateISO } from "@/lib/format";
import { defaultOffboardingDue, minOffboardingDue } from "@/lib/deadlines";
import { updateEmployee } from "@/server/modules/employees/actions";
import { PolicyPreview } from "./policy-preview";
import { StartOffboardingDialog } from "./start-offboarding-dialog";

const CUSTOM = "__custom";
const today = () => localDateISO(new Date());
type Initial = {
  name: string; title: string; departmentId: string; employment: string; m365Status: string | null;
  offboardingDueAt: string;
};
// Phase 37 (spec §5.4): the edit page's single form. A new person is added by the three-step wizard
// (new-employee-wizard.tsx), so the old `mode="new"` branches are gone; `mode` stays as the edit page's
// own marker. The Department select never renders here — a department change goes through Transfer.
// Phase 40 (spec 2.2): Employment moves only through offboarding — read-only text with a Start offboarding link for
// an ACTIVE person, read-only for an OFFBOARDED one, and a two-option select (cancel offboarding) for a leaver.
type Props = {
  mode: "edit"; employeeId: string; initial: Initial;
  employeeName: string; defaultDue: string; minDue: string;
};

export function EmployeeForm(props: Props) {
  const initial = props.initial;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const isCustom = initial.m365Status !== null && !(M365_CANONICAL as readonly string[]).includes(initial.m365Status);
  const [form, setForm] = useState({
    name: initial.name,
    title: initial.title,
    departmentId: initial.departmentId,
    employment: initial.employment,
    m365Select: initial.m365Status === null ? "" : isCustom ? CUSTOM : initial.m365Status,
    m365Custom: isCustom ? initial.m365Status! : "",
    offboardingDueAt: initial.offboardingDueAt,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [retryAfter, setRetryAfter] = useState<number | null>(null);
  const [saved, setSaved] = useState(false);
  const [offboardingOpen, setOffboardingOpen] = useState(false);
  const rootRef = useRef<HTMLFormElement>(null);
  // Ruling R8: the completion-date `min` is the EARLIER of today's floor and
  // the date already in the field. This form has no `noValidate` and Save is a
  // `type="submit"`, so a `min` above the stored value sets `rangeUnderflow`
  // and the browser silently refuses to submit — which froze EVERY edit (name,
  // title, M365, employment) on an already-overdue leaver behind a native
  // tooltip that reads as a dead button. An untouched past date is therefore
  // floored at itself; a date the operator actually moves still cannot land
  // before today, and `updateEmployee` applies exactly the same rule server-side.
  const dueFloor = minOffboardingDue(today());
  const dueMin = form.offboardingDueAt && form.offboardingDueAt < dueFloor ? form.offboardingDueAt : dueFloor;

  // Every field error renders in one pass; focus and scroll to the first
  // invalid field after a refused submit. This runs in an effect (rather
  // than a queueMicrotask right where `errors` is set) because the state
  // update happens inside a `startTransition` callback — its DOM commit
  // lands on a later task than the microtask queue, so a queueMicrotask
  // scheduled alongside the setState call reliably runs BEFORE React has
  // painted the new aria-invalid attributes, finds nothing, and silently
  // never focuses anything. An effect keyed on `errors` runs after commit.
  useEffect(() => {
    if (Object.keys(errors).length === 0) return;
    const first = rootRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
    first?.focus();
    first?.scrollIntoView({ block: "center" });
  }, [errors]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});
    setError(null);
    startTransition(async () => {
      const m365Status =
        form.m365Select === "" ? null : form.m365Select === CUSTOM ? form.m365Custom.trim() || null : form.m365Select;
      // departmentId is NOT part of the payload — a department change goes
      // through Transfer, never a side effect of any other edit.
      // Final review I1: employment (and its completion date) is sent only when the select is shown — a leaver's
      // form. Anyone else's form leaves it out, which the server reads as "keep", so a page loaded while the
      // person was ACTIVE can never cancel an offboarding started meanwhile.
      const leaver = initial.employment === "OFFBOARDING";
      const res = await updateEmployee({
        id: props.employeeId,
        name: form.name, title: form.title, m365Status,
        ...(leaver ? {
          employment: form.employment,
          offboardingDueAt: form.employment === "OFFBOARDING" ? form.offboardingDueAt : "",
        } : {}),
      });
      if (res.ok) {
        setSaved(true); setTimeout(() => setSaved(false), 3000); router.refresh();
      } else if (res.kind === "rate_limited") setRetryAfter(res.retryAfterSec ?? 60);
      else if (res.kind === "validation") {
        const fe = res.fieldErrors ?? {};
        setErrors(fe);
        // errors no FormField claims (_form/id) must not dead-end silently
        const unclaimed = fe._form ?? fe.id ?? (initial.employment === "OFFBOARDING" ? undefined : fe.employment);
        if (unclaimed) setError(unclaimed);
      } else setError(res.message);
    });
  }

  return (
    <>
      <form ref={rootRef} onSubmit={submit} className="flex max-w-[560px] flex-col gap-4">
        {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
        {error && <Banner tone="fault" title={error} />}
        <Card>
          <CardHeader title="Person" />
          <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="Name" required error={errors.name}>
              {(p) => (
                <Input
                  id={p.id} autoFocus aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                  value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  onBlur={() => setForm((f) => ({ ...f, name: f.name.trim() }))}
                />
              )}
            </FormField>
            <div className="flex flex-col gap-1.5">
              <FormField label="Title" required error={errors.title} hint="Title drives role-based equipment policies.">
                {(p) => (
                  <Input
                    id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                    value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                    onBlur={() => setForm((f) => ({ ...f, title: f.title.trim() }))}
                  />
                )}
              </FormField>
              <PolicyPreview title={form.title} departmentId={form.departmentId} />
            </div>
            {/* The Department select is gone in edit mode — a department
                change is dated and recorded only through Transfer (the
                employee page header), never a plain edit. */}
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-fg">Department</span>
              <p className="text-[11px] text-fg-muted">
                Department changes are recorded with{" "}
                <Link href={`/employees/${props.employeeId}`} className="underline hover:text-fg-secondary">
                  Transfer
                </Link>
                .
              </p>
            </div>
            {initial.employment === "OFFBOARDING" ? (
              <FormField label="Employment" required error={errors.employment}>
                {(p) => (
                  <Select id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                    value={form.employment}
                    onChange={(e) => {
                      const employment = e.target.value;
                      setForm((f) => ({
                        ...f, employment,
                        offboardingDueAt: employment === "OFFBOARDING" ? (f.offboardingDueAt || defaultOffboardingDue(today())) : "",
                      }));
                    }}>
                    <option value="OFFBOARDING">Offboarding</option>
                    <option value="ACTIVE">Active (cancel offboarding)</option>
                  </Select>
                )}
              </FormField>
            ) : (
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-fg">Employment</span>
                <p className="text-[13px] text-fg">
                  {EMPLOYMENT_LABEL[initial.employment as keyof typeof EMPLOYMENT_LABEL] ?? initial.employment}
                </p>
                {initial.employment === "ACTIVE" && (
                  <button type="button" onClick={() => setOffboardingOpen(true)}
                    className="w-fit text-left text-[11px] text-fg-muted underline hover:text-fg-secondary">
                    Start offboarding…
                  </button>
                )}
              </div>
            )}
            {form.employment === "OFFBOARDING" && (
              <FormField label="Complete offboarding by" required error={errors.offboardingDueAt} hint="5 working days by default.">
                {(p) => <Input id={p.id} type="date" aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                  min={dueMin} value={form.offboardingDueAt}
                  onChange={(e) => setForm((f) => ({ ...f, offboardingDueAt: e.target.value }))} />}
              </FormField>
            )}
            <FormField label="Account status" error={errors.m365Status}
              hint="Set when the M365 account exists; the directory sync fills it in later.">
              {(p) => (
                <Select id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                  value={form.m365Select} onChange={(e) => setForm((f) => ({ ...f, m365Select: e.target.value }))}>
                  <option value="">no sync yet</option>
                  {M365_CANONICAL.map((s) => <option key={s} value={s}>{s}</option>)}
                  <option value={CUSTOM}>custom…</option>
                </Select>
              )}
            </FormField>
            {form.m365Select === CUSTOM && (
              <FormField label="Custom value" hint="Stored exactly as typed.">
                {(p) => (
                  <Input
                    id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                    value={form.m365Custom} onChange={(e) => setForm((f) => ({ ...f, m365Custom: e.target.value }))}
                    onBlur={() => setForm((f) => ({ ...f, m365Custom: f.m365Custom.trim() }))}
                  />
                )}
              </FormField>
            )}
          </CardBody>
        </Card>
        <div className="sticky bottom-0 z-10 -mx-1 flex items-center gap-3 border-t border-border bg-surface px-1 py-3">
          <Button type="submit" variant="primary" disabled={pending} loading={pending}>
            {saved ? "✓ Saved" : "Save changes"}
          </Button>
          {saved && <span className="text-xs text-fg-muted">audit entry written</span>}
        </div>
      </form>
      {initial.employment === "ACTIVE" && (
        <StartOffboardingDialog open={offboardingOpen} onClose={() => setOffboardingOpen(false)}
          employeeId={props.employeeId} employeeName={props.employeeName} defaultDue={props.defaultDue} minDue={props.minDue} />
      )}
    </>
  );
}
