"use client";

import { useState, useTransition } from "react";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { FormError } from "@/components/ui/form-field";
import { fmtDayMonthYear } from "@/lib/format";
import { PASSWORD_CHANGED_COPY, PASSWORD_COPY, passwordProblem } from "@/lib/password-rules";
import { changeOwnPassword } from "@/server/modules/account/actions";
import { PasswordFields, type PasswordField, type PasswordValues } from "./password-fields";

const EMPTY: PasswordValues = { current: "", password: "", confirm: "" };

/**
 * Account settings' Password card (spec §4.5, boards Account2 / PhoneAccount2): "Last changed {date}" and Change
 * password, which opens Current, New and Again with Show/Hide and the checklist, then Save and Cancel.
 */
export function AccountPasswordCard({ passwordChangedAt }: { passwordChangedAt: string | null }) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<PasswordValues>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<PasswordField, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [changedAt, setChangedAt] = useState(passwordChangedAt);
  const [pending, startTransition] = useTransition();

  function onChange(field: PasswordField, value: string) {
    setValues((v) => ({ ...v, [field]: value }));
    setErrors((e) => ({ ...e, [field]: undefined }));
    setFormError(null);
  }

  function close() {
    setOpen(false);
    setValues(EMPTY);
    setErrors({});
    setFormError(null);
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!values.current) return setErrors({ current: "Enter your current password." });
    const problem = passwordProblem(values.password, { current: values.current });
    if (problem) return setErrors({ password: problem });
    if (values.password !== values.confirm) return setErrors({ confirm: PASSWORD_COPY.mismatch });
    startTransition(async () => {
      const result = await changeOwnPassword(values);
      if (result.ok) {
        setChangedAt(result.data.passwordChangedAt);
        setSaved(true);
        close();
        return;
      }
      if (result.kind === "validation" && result.fieldErrors) setErrors(result.fieldErrors);
      else setFormError(result.message);
    });
  }

  return (
    <Card>
      <CardHeader title="Password" />
      <CardBody className="flex flex-col gap-3">
        {saved && <Banner tone="settled">{PASSWORD_CHANGED_COPY}</Banner>}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[13px] text-fg-secondary">
            {changedAt ? `Last changed ${fmtDayMonthYear(changedAt)}` : "Not changed since the account was created"}
          </p>
          {!open && (
            <Button
              type="button"
              onClick={() => {
                setSaved(false);
                setOpen(true);
              }}
            >
              Change password
            </Button>
          )}
        </div>
        {open && (
          <form onSubmit={onSubmit} noValidate className="flex max-w-[420px] flex-col gap-4">
            <PasswordFields mode="change" values={values} onChange={onChange} errors={errors} />
            <FormError>{formError}</FormError>
            <div className="flex gap-2">
              <Button type="submit" variant="primary" loading={pending}>
                Save
              </Button>
              <Button type="button" variant="ghost" onClick={close} disabled={pending}>
                Cancel
              </Button>
            </div>
          </form>
        )}
      </CardBody>
    </Card>
  );
}
