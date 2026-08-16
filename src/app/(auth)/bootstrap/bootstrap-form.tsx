"use client";

import { useActionState } from "react";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { createBootstrapAdmin, type AuthFormState } from "@/server/auth/actions";

export function BootstrapForm() {
  const [state, action, pending] = useActionState<AuthFormState, FormData>(
    createBootstrapAdmin,
    {},
  );
  return (
    <form action={action} className="flex flex-col gap-4">
      {state.error && <Banner tone="fault" title={state.error} />}
      <FormField label="Your name" required>
        {(p) => <Input {...p} name="name" autoComplete="name" required />}
      </FormField>
      <FormField label="Admin email" required>
        {(p) => <Input {...p} name="email" type="email" required />}
      </FormField>
      <FormField label="Password" required hint="At least 10 characters">
        {(p) => <Input {...p} name="password" type="password" autoComplete="new-password" required />}
      </FormField>
      <FormField
        label="Allowed signup domain"
        hint="Changeable later under Feature flags. Leave empty for unrestricted signup."
      >
        {(p) => <Input {...p} name="domain" placeholder="thebackroomop.com" />}
      </FormField>
      <Button type="submit" variant="primary" loading={pending}>
        Create admin and open IT
      </Button>
    </form>
  );
}
