"use client";

import { useActionState } from "react";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { signInWithCredentials, type AuthFormState } from "@/server/auth/actions";

export function LoginForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState<AuthFormState, FormData>(
    signInWithCredentials,
    {},
  );
  return (
    <form action={action} className="flex flex-col gap-4">
      {next && <input type="hidden" name="next" value={next} />}
      {state.error && <Banner tone="fault" title={state.error} />}
      <FormField label="Email" required>
        {(p) => <Input {...p} name="email" type="email" autoComplete="email" required />}
      </FormField>
      <FormField label="Password" required>
        {(p) => (
          <Input {...p} name="password" type="password" autoComplete="current-password" required />
        )}
      </FormField>
      <Button type="submit" variant="primary" loading={pending}>
        Sign in
      </Button>
    </form>
  );
}
