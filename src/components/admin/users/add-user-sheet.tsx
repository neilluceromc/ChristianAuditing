"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import type { Role } from "@prisma/client";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import type { ComboOption } from "@/components/patterns/entity-combobox";
import { accountCreated } from "@/lib/admin-users";
import { createUser } from "@/server/modules/admin/user-actions";
import { EmployeePicker } from "./employee-picker";
import { RoleCards } from "./role-cards";
import { TempPasswordBox } from "./temp-password-box";

export interface CreatedAccount {
  id: string;
  name: string;
  tempPassword: string;
}

/**
 * Users & access (spec §4.4; Users2's Add user, PhoneAdd2): a side sheet, full screen below 700 px. Nothing of the
 * form or the temporary password outlives the sheet: the Drawer unmounts its children when it closes.
 */
export function AddUserSheet({
  open,
  onClose,
  domain,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  domain: string | null;
  onCreated: (account: { id: string; name: string }) => void;
}) {
  // While Create account runs, nothing closes the sheet (Escape, the veil, ✕, Cancel): the account may already exist,
  // and its temporary password must not unmount unseen (fix round 1, Minor 1).
  const creating = useRef(false);
  const guardedClose = () => { if (!creating.current) onClose(); };
  return (
    <Drawer open={open} onClose={guardedClose} title="Add user" width={480} bare className="max-[700px]:w-full!">
      <AddUserForm domain={domain} onClose={guardedClose} onCreated={onCreated} onPending={(p) => { creating.current = p; }} />
    </Drawer>
  );
}

/**
 * The sheet's content: full name, work email (the allowed domain in its hint), the role cards and the optional
 * employee record; Create account; then the verbatim confirmation and the temporary password, once, with Copy. The
 * password is made on the server (createUser) and comes back in that one result.
 */
export function AddUserForm({
  domain,
  onClose,
  onCreated,
  initialDone = null,
  onPending,
}: {
  domain: string | null;
  onClose: () => void;
  onCreated: (account: { id: string; name: string }) => void;
  /** told while Create account runs, so the sheet can refuse to close */
  onPending?: (pending: boolean) => void;
  /** tests only: render the created step */
  initialDone?: CreatedAccount | null;
}) {
  const titleId = useId();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("viewer");
  const [employee, setEmployee] = useState<ComboOption | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [refusal, setRefusal] = useState<string | null>(null);
  const [done, setDone] = useState<CreatedAccount | null>(initialDone);
  const [pending, startTransition] = useTransition();
  useEffect(() => { onPending?.(pending); }, [pending, onPending]);

  function create() {
    setErrors({});
    setRefusal(null);
    startTransition(async () => {
      const res = await createUser({ name, email, role, employeeId: employee?.value ?? null });
      if (res.ok) {
        setDone({ id: res.data.id, name: name.trim(), tempPassword: res.data.tempPassword });
        onCreated({ id: res.data.id, name: name.trim() });
      } else if (res.kind === "validation" && res.fieldErrors) {
        setErrors(res.fieldErrors);
      } else {
        setRefusal(res.message);
      }
    });
  }

  const header = (
    <div className="flex shrink-0 items-center gap-2.5 border-b border-border-faint px-5 py-4">
      <h2 id={titleId} className="flex-1 text-[17px] font-semibold text-fg">Add user</h2>
      <button
        type="button"
        onClick={onClose}
        disabled={pending}
        aria-label="Close"
        className="inline-flex size-11 items-center justify-center rounded-(--radius-btn) bg-surface-subtle text-fg-secondary hover:bg-border-faint disabled:opacity-55"
      >
        ✕
      </button>
    </div>
  );

  if (done) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        {header}
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
          <p role="status" className="text-[14px] font-medium text-fg">{accountCreated(done.name)}</p>
          <TempPasswordBox password={done.tempPassword} takeFocus />
          <p className="text-[12px] text-fg-muted">
            Shown once. Give it to them in person or by chat. They choose their own the first time they sign in.
          </p>
        </div>
        <div className="flex shrink-0 justify-end gap-2 border-t border-border-faint px-5 py-3.5">
          <Button variant="primary" className="h-11" onClick={onClose}>Done</Button>
        </div>
      </div>
    );
  }

  return (
    <form
      className="flex h-full min-h-0 flex-col"
      aria-labelledby={titleId}
      onSubmit={(e) => { e.preventDefault(); create(); }}
    >
      {header}
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
        {refusal && <Banner tone="fault" title={refusal} />}
        <FormField label="Full name" required error={errors.name}>
          {(p) => (
            <Input {...p} value={name} autoComplete="off" maxLength={120} className="h-11 text-[15px]" onChange={(e) => setName(e.currentTarget.value)} />
          )}
        </FormField>
        <FormField
          label="Work email"
          required
          error={errors.email}
          hint={domain ? `They sign in with this. It must be a @${domain} address.` : "They sign in with this."}
        >
          {(p) => (
            <Input {...p} type="email" value={email} autoComplete="off" maxLength={320} className="h-11 text-[15px]" onChange={(e) => setEmail(e.currentTarget.value)} />
          )}
        </FormField>
        <RoleCards name="add-user-role" legend="Role" value={role} onChange={setRole} disabled={pending} />
        {errors.role && <p role="alert" className="text-[11px] font-medium" style={{ color: "var(--error-text)" }}>{errors.role}</p>}
        <EmployeePicker
          label={<>Employee record <span className="font-normal text-fg-muted">(optional for shared accounts)</span></>}
          value={employee}
          onPick={setEmployee}
          error={errors.employeeId}
          disabled={pending}
        />
        <p className="text-[12px] text-fg-muted">
          A temporary password is made when you create the account and shown once. They choose their own the first time
          they sign in.
        </p>
      </div>
      <div className="flex shrink-0 justify-end gap-2 border-t border-border-faint px-5 py-3.5">
        <Button type="button" variant="ghost" className="h-11" disabled={pending} onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="primary" className="h-11" loading={pending}>Create account</Button>
      </div>
    </form>
  );
}
