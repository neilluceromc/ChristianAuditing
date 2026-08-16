"use client";

import { useActionState } from "react";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { signUp, type AuthFormState } from "@/server/auth/actions";

export function SignupForm() {
  const [state, action, pending] = useActionState<AuthFormState, FormData>(signUp, {});
  return (
    <form action={action} className="flex flex-col gap-4">
      {state.error && <Banner tone="fault" title={state.error} />}
      <FormField label="Name" required>
        {(p) => <Input {...p} name="name" autoComplete="name" required />}
      </FormField>
      <FormField label="Email" required>
        {(p) => <Input {...p} name="email" type="email" autoComplete="email" required />}
      </FormField>
      <FormField label="Password" required hint="At least 10 characters">
        {(p) => (
          <Input {...p} name="password" type="password" autoComplete="new-password" required />
        )}
      </FormField>
      <Button type="submit" variant="primary" loading={pending}>
        Create account
      </Button>
    </form>
  );
}
