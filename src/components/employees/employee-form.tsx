"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Banner } from "@/components/ui/banner";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { M365_CANONICAL } from "@/lib/labels";
import { updateEmployee } from "@/server/modules/employees/actions";

const CUSTOM = "__custom";

export function EmployeeForm({
  employeeId,
  departments,
  initial,
}: {
  employeeId: string;
  departments: Array<{ id: string; name: string }>;
  initial: { name: string; title: string; departmentId: string; employment: string; m365Status: string | null };
}) {
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
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [retryAfter, setRetryAfter] = useState<number | null>(null);
  const [saved, setSaved] = useState(false);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});
    setError(null);
    startTransition(async () => {
      const m365Status =
        form.m365Select === "" ? null : form.m365Select === CUSTOM ? form.m365Custom.trim() || null : form.m365Select;
      const res = await updateEmployee({
        id: employeeId,
        name: form.name,
        title: form.title,
        departmentId: form.departmentId,
        employment: form.employment,
        m365Status,
      });
      if (res.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
        router.refresh();
      } else if (res.kind === "rate_limited") setRetryAfter(res.retryAfterSec ?? 60);
      else if (res.kind === "validation") {
        const fe = res.fieldErrors ?? {};
        setErrors(fe);
        // errors no FormField claims (_form/id) must not dead-end silently
        const unclaimed = fe._form ?? fe.id;
        if (unclaimed) setError(unclaimed);
      } else setError(res.message);
    });
  }

  return (
    <form onSubmit={submit} className="flex max-w-[560px] flex-col gap-4">
      {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
      {error && <Banner tone="fault" title={error} />}
      <Card>
        <CardHeader title="Person" />
        <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="Name" required error={errors.name}>
            {(p) => <Input id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
              value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />}
          </FormField>
          <FormField label="Title" required error={errors.title} hint="Title drives role-based equipment policies.">
            {(p) => <Input id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
              value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />}
          </FormField>
          <FormField label="Department" required error={errors.departmentId}>
            {(p) => (
              <Select id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                value={form.departmentId} onChange={(e) => setForm((f) => ({ ...f, departmentId: e.target.value }))}>
                {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </Select>
            )}
          </FormField>
          <FormField label="Employment" required error={errors.employment} hint="The offboarding wizard (Phase 7) owns the full flow.">
            {(p) => (
              <Select id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                value={form.employment} onChange={(e) => setForm((f) => ({ ...f, employment: e.target.value }))}>
                <option value="ACTIVE">ACTIVE</option>
                <option value="OFFBOARDING">OFFBOARDING</option>
                <option value="OFFBOARDED">OFFBOARDED</option>
              </Select>
            )}
          </FormField>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Microsoft 365" />
        <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="Account status" error={errors.m365Status}
            hint="Sourced from the tenant directory once Entra sync lands (Phase 8). Custom values map to the Neutral family.">
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
              {(p) => <Input id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                value={form.m365Custom} onChange={(e) => setForm((f) => ({ ...f, m365Custom: e.target.value }))} />}
            </FormField>
          )}
        </CardBody>
      </Card>
      <div className="flex items-center gap-3">
        <Button type="submit" variant="primary" loading={pending}>
          {saved ? "✓ Saved" : "Save changes"}
        </Button>
        {saved && <span className="text-xs text-fg-muted">audit entry written</span>}
      </div>
    </form>
  );
}
