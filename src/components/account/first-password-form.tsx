"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/form-field";
import { PASSWORD_COPY, passwordProblem } from "@/lib/password-rules";
import { setOwnPassword } from "@/server/modules/account/actions";
import { PasswordFields, type PasswordField, type PasswordValues } from "./password-fields";

/**
 * First sign-in (spec §4.3, board PhoneFirst2): New password, Type it again, the live checklist and "Save and
 * continue". The server refreshes this device's session as it saves, so success only has to move on, to Home.
 */
export function FirstPasswordForm() {
  const router = useRouter();
  const [values, setValues] = useState<PasswordValues>({ current: "", password: "", confirm: "" });
  const [errors, setErrors] = useState<Partial<Record<PasswordField, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onChange(field: PasswordField, value: string) {
    setValues((v) => ({ ...v, [field]: value }));
    setErrors((e) => ({ ...e, [field]: undefined }));
    setFormError(null);
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const problem = passwordProblem(values.password, {});
    if (problem) return setErrors({ password: problem });
    if (values.password !== values.confirm) return setErrors({ confirm: PASSWORD_COPY.mismatch });
    startTransition(async () => {
      const result = await setOwnPassword({ password: values.password, confirm: values.confirm });
      if (result.ok) {
        router.replace("/");
        return;
      }
      if (result.kind === "validation" && result.fieldErrors) setErrors(result.fieldErrors);
      // Fix round 1 (M6): a plain refusal means no new password is owed any more (another tab already chose one, or
      // the account changed): move on rather than show "You don't have permission to do that."
      else if (result.kind === "forbidden" && !result.reason) router.replace("/");
      else setFormError(result.message);
    });
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <PasswordFields mode="first" values={values} onChange={onChange} errors={errors} />
      <FormError>{formError}</FormError>
      <Button type="submit" variant="primary" size="lg" loading={pending} className="w-full">
        Save and continue
      </Button>
    </form>
  );
}
