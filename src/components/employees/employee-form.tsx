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
import { useToast } from "@/components/ui/toast";
import { M365_CANONICAL } from "@/lib/labels";
import { localDateISO } from "@/lib/format";
import { defaultOffboardingDue, minOffboardingDue } from "@/lib/deadlines";
import { createEmployee, updateEmployee } from "@/server/modules/employees/actions";
import { SameNameCheck } from "./same-name-check";
import { EmployeeNoCheck } from "./employee-no-check";
import { PolicyPreview } from "./policy-preview";

const CUSTOM = "__custom";
const today = () => localDateISO(new Date());
type Initial = {
  name: string; title: string; departmentId: string; employment: string; m365Status: string | null;
  offboardingDueAt: string;
};
// The edit branch never renders the Department select (a department change
// goes through Transfer), so it takes no departments — the page does not
// query them for nothing.
type Props =
  | { mode: "edit"; employeeId: string; initial: Initial; departments?: Array<{ id: string; name: string }> }
  | { mode: "new"; departments: Array<{ id: string; name: string }> };

export function EmployeeForm(props: Props) {
  const departments = props.departments ?? [];
  const initial: Initial = props.mode === "edit"
    ? props.initial
    : { name: "", title: "", departmentId: "", employment: "ACTIVE", m365Status: null, offboardingDueAt: "" };
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const isCustom = initial.m365Status !== null && !(M365_CANONICAL as readonly string[]).includes(initial.m365Status);
  const [form, setForm] = useState({
    employeeNo: "",
    joinedAt: today(),
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
  // Lifted from SameNameCheck, sent only on create — updateEmployee's schema
  // has no such field (it also never receives departmentId, see `common`
  // below).
  const [confirmSameName, setConfirmSameName] = useState(false);
  // Phase 29 (plan P-3, ruling R3): the refusal sentence the server hands
  // back under `_sameName` — no FormField claims it, so it is routed to the
  // SameNameCheck banner instead of dead-ending under Name.
  const [sameNameRefusal, setSameNameRefusal] = useState<string | null>(null);
  const [addAnother, setAddAnother] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
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
    setSameNameRefusal(null);
    startTransition(async () => {
      const m365Status =
        form.m365Select === "" ? null : form.m365Select === CUSTOM ? form.m365Custom.trim() || null : form.m365Select;
      // departmentId is NOT part of the shared payload — a department change
      // goes through Transfer, never a side effect of any other edit.
      // `createEmployee` gets it back (a new person has no transfer history
      // to start from).
      const common = {
        name: form.name, title: form.title, employment: form.employment, m365Status,
        offboardingDueAt: form.employment === "OFFBOARDING" ? form.offboardingDueAt : "",
      };
      const res = props.mode === "edit"
        ? await updateEmployee({ id: props.employeeId, ...common })
        : await createEmployee({
            ...common,
            departmentId: form.departmentId,
            employeeNo: form.employeeNo,
            joinedAt: form.joinedAt,
            confirmSameName,
          });
      if (res.ok) {
        if (props.mode === "new") {
          if (addAnother) {
            toast(`Added ${form.name}`, "settled");
            setForm((f) => ({
              ...f, employeeNo: "", joinedAt: today(), name: "", title: "", employment: "ACTIVE",
              m365Select: "", m365Custom: "", offboardingDueAt: "",
            }));
            setConfirmSameName(false);
            setSameNameRefusal(null);
            setAddAnother(false);
            nameRef.current?.focus();
          } else {
            router.push(`/employees/${res.data.id}?created=1`);
          }
          return;
        }
        setSaved(true); setTimeout(() => setSaved(false), 3000); router.refresh();
      } else if (res.kind === "rate_limited") setRetryAfter(res.retryAfterSec ?? 60);
      else if (res.kind === "validation") {
        const fe = res.fieldErrors ?? {};
        // Plan P-3 / ruling R3: `_sameName` belongs to the SameNameCheck
        // banner, never to a FormField — Name never shows it.
        const { _sameName, ...rest } = fe;
        setErrors(rest);
        setSameNameRefusal(_sameName ?? null);
        // errors no FormField claims (_form/id) must not dead-end silently
        const unclaimed = rest._form ?? rest.id;
        if (unclaimed) setError(unclaimed);
      } else setError(res.message);
    });
  }

  return (
    <form ref={rootRef} onSubmit={submit} className="flex max-w-[560px] flex-col gap-4">
      {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
      {error && <Banner tone="fault" title={error} />}
      <Card>
        <CardHeader title="Person" />
        <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="Name" required error={errors.name}>
            {(p) => (
              <Input
                id={p.id} ref={nameRef} autoFocus aria-describedby={p["aria-describedby"]} invalid={p.invalid}
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
          {props.mode === "new" ? (
            <FormField label="Department" required error={errors.departmentId}>
              {(p) => (
                <Select id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                  value={form.departmentId} onChange={(e) => setForm((f) => ({ ...f, departmentId: e.target.value }))}>
                  <option value="">Choose a department</option>
                  {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </Select>
              )}
            </FormField>
          ) : (
            // The Department select is gone in edit mode — a department
            // change is dated and recorded only through Transfer (the
            // employee page header), never a plain edit.
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
          )}
          {props.mode === "new" && (
            <div className="sm:col-span-2">
              <SameNameCheck
                name={form.name} departmentId={form.departmentId} onConfirmChange={setConfirmSameName}
                refusal={sameNameRefusal}
              />
            </div>
          )}
          {props.mode === "new" && (
            <>
              <div className="flex flex-col gap-1.5">
                <FormField label="Employee number" required error={errors.employeeNo} hint="Any text up to 60 characters; must be unique.">
                  {(p) => (
                    <Input
                      id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                      value={form.employeeNo} onChange={(e) => setForm((f) => ({ ...f, employeeNo: e.target.value }))}
                      onBlur={() => setForm((f) => ({ ...f, employeeNo: f.employeeNo.trim() }))}
                    />
                  )}
                </FormField>
                <EmployeeNoCheck value={form.employeeNo} onUse={(no) => setForm((f) => ({ ...f, employeeNo: no }))} />
              </div>
              <FormField label="Joined" required error={errors.joinedAt} hint="defaults to today">
                {(p) => <Input id={p.id} type="date" aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                  value={form.joinedAt} onChange={(e) => setForm((f) => ({ ...f, joinedAt: e.target.value }))} />}
              </FormField>
            </>
          )}
          <FormField label="Employment" required error={errors.employment} hint="Offboarding is started from the person's page.">
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
                <option value="ACTIVE">ACTIVE</option>
                <option value="OFFBOARDING">OFFBOARDING</option>
                <option value="OFFBOARDED">OFFBOARDED</option>
              </Select>
            )}
          </FormField>
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
        {props.mode === "new" && <Button type="button" variant="ghost" onClick={() => router.back()}>Cancel</Button>}
        <Button type="submit" variant="primary" loading={pending && !addAnother} onClick={() => setAddAnother(false)}>
          {props.mode === "new" ? "Create employee" : saved ? "✓ Saved" : "Save changes"}
        </Button>
        {props.mode === "new" && (
          <Button type="submit" variant="secondary" loading={pending && addAnother} onClick={() => setAddAnother(true)}>
            Create and add another
          </Button>
        )}
        {saved && <span className="text-xs text-fg-muted">audit entry written</span>}
      </div>
    </form>
  );
}
