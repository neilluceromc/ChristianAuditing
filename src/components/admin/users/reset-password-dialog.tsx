"use client";

import { useState, useTransition } from "react";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { resetUserPassword } from "@/server/modules/admin/user-actions";
import { closeBlocked } from "./panel-actions";
import { TempPasswordBox } from "./temp-password-box";

/**
 * Users & access (spec §4.4): Reset password… asks first, then shows the new temporary password once, with Copy. A
 * bottom dialog below 700 px. The caller mounts it per reset and unmounts it on close, so the password is gone with it.
 */
export function ResetPasswordDialog({
  name,
  userId,
  onClose,
  onReset,
}: {
  name: string;
  userId: string;
  onClose: () => void;
  /** the reset stood: the caller refreshes the list (their status is now Must set password) */
  onReset: () => void;
}) {
  const [temp, setTemp] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function reset() {
    setError(null);
    startTransition(async () => {
      const res = await resetUserPassword({ id: userId });
      if (res.ok) {
        setTemp(res.data.tempPassword);
        onReset();
      } else {
        setError(res.message);
      }
    });
  }

  // While the reset runs, nothing closes the dialog: the password may already have changed, and the new one must not
  // unmount unseen (fix round 1, Minor 1).
  // Blocked only until the password shows (Task 5): the list refresh after it runs in the same transition.
  const guardedClose = () => { if (!closeBlocked(pending, temp !== null)) onClose(); };
  return (
    <Dialog
      open
      onClose={guardedClose}
      title={`Reset ${name}'s password?`}
      bottomOnPhone
      footer={
        temp ? (
          <Button variant="primary" className="h-11" onClick={onClose}>Done</Button>
        ) : (
          <>
            <Button variant="ghost" className="h-11" disabled={pending} onClick={guardedClose}>Cancel</Button>
            <Button variant="primary" className="h-11" loading={pending} onClick={reset}>Reset password</Button>
          </>
        )
      }
    >
      <ResetPasswordBody name={name} temp={temp} error={error} />
    </Dialog>
  );
}

/** The dialog's body: the question, or the password shown once. */
export function ResetPasswordBody({ name, temp, error }: { name: string; temp: string | null; error: string | null }) {
  if (temp) {
    return (
      <div className="flex flex-col gap-3">
        <TempPasswordBox password={temp} label={`${name}'s temporary password`} takeFocus />
        <p className="text-[12.5px] text-fg-secondary">Shown once. They choose their own at their next sign-in.</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {error && <Banner tone="fault" title={error} />}
      <p>Their current password stops working and they&apos;re signed out everywhere. You&apos;ll get a temporary password to give them.</p>
    </div>
  );
}
