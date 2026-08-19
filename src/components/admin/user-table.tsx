"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Pill } from "@/components/ui/pill";
import { Select } from "@/components/ui/select";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { ROLE_LABELS, ROLE_OPTIONS, selfRoleChangeWarning } from "@/lib/admin-users";
import { setUserDisabled, setUserRole } from "@/server/modules/admin/user-actions";
import type { ActionResult } from "@/server/action-result";
import type { UserRow } from "@/server/modules/admin/queries";
import type { Role } from "@prisma/client";

/** A role picked for the actor's own row, waiting on the confirm dialog. */
interface PendingSelfChange {
  row: UserRow;
  next: Role;
  warning: string;
}

export function UserTable({ rows, actorId }: { rows: UserRow[]; actorId: string }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [retryAfter, setRetryAfter] = useState<number | null>(null);
  const [pendingChange, setPendingChange] = useState<PendingSelfChange | null>(null);

  // A real generic, not the plan's `as Awaited<ReturnType<typeof setUserRole>>`
  // cast — setUserRole and setUserDisabled no longer share a data shape, so
  // that cast would let a disable result be read as if it carried
  // `signsOutActor`. `toastFor` only runs when `changed` is true: a no-op
  // write (the role/disabled state was already what was asked for) gets no
  // toast and no revalidate — announcing a change that didn't happen would be
  // a lie, and router.refresh() would be a pointless round trip.
  function run<T extends { changed: boolean }>(
    fn: () => Promise<ActionResult<T>>,
    toastFor: (data: T) => string,
    onOk?: () => void,
  ) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (res.ok) {
        onOk?.();
        if (res.data.changed) {
          toast(toastFor(res.data), "settled");
          router.refresh();
        }
      } else if (res.kind === "rate_limited") setRetryAfter(res.retryAfterSec ?? 60);
      // Every refusal on this screen is a conflict or a forbidden — there are no
      // field-level inputs to hang a validation error on, so all of them go to
      // the banner rather than dead-ending silently.
      else setError(res.message);
    });
  }

  function submitRoleChange(row: UserRow, next: Role) {
    run(
      () => setUserRole({ userId: row.id, role: next }),
      // signsOutActor is the belt-and-braces half of the warning: the dialog
      // already said this before the click, so this only confirms what just
      // happened, right before the next request's redirect takes the actor
      // to /logout.
      (data) =>
        data.signsOutActor
          ? `You're now ${ROLE_LABELS[next]} — signing you out`
          : `${row.name} is now ${ROLE_LABELS[next]}`,
      () => setPendingChange(null),
    );
  }

  function pickRole(row: UserRow, next: Role) {
    // One function decides when a role change signs the actor out; this
    // never restates that as `row.id === actorId` so the select and the
    // action can't drift apart on when the warning applies.
    const warning = selfRoleChangeWarning(
      { id: row.id, role: row.role, isPermanentAdmin: false, disabled: row.disabled },
      next,
      actorId,
    );
    if (warning) setPendingChange({ row, next, warning });
    else submitRoleChange(row, next);
  }

  return (
    <div className="flex max-w-[860px] flex-col gap-3">
      {retryAfter !== null && !pendingChange && (
        <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />
      )}
      {error && !pendingChange && <Banner tone="fault" title={error} />}

      <Table>
        <THead>
          <Tr>
            <Th>User</Th>
            <Th width={170}>Role</Th>
            <Th width={110}>Sign-in</Th>
            <Th width={130}>Access</Th>
          </Tr>
        </THead>
        <TBody>
          {rows.map((row) => (
            <Tr key={row.id} className={cn(row.locked && "bg-surface-subtle")}>
              <Td>
                <span className={cn("block text-[12.5px]", row.disabled ? "text-fg-muted" : "text-fg")}>
                  {row.name}
                </span>
                <span className="block font-mono text-[10.5px] text-fg-muted">{row.email}</span>
              </Td>

              <Td>
                {row.locked ? (
                  // Card 3h: the constraint is STATED. A LOCKED chip plus static
                  // text, tinted one step back — never a select that fails on save.
                  <span className="flex flex-col gap-1">
                    <span className="flex items-center gap-1.5">
                      <Pill>LOCKED</Pill>
                      <span className="text-[12px] text-fg-muted">{ROLE_LABELS[row.role]}</span>
                    </span>
                    <span className="text-[10.5px] leading-snug text-fg-faint">{row.locked}</span>
                  </span>
                ) : (
                  <Select
                    aria-label={`Role for ${row.name}`}
                    value={row.role}
                    disabled={pending}
                    className="w-[150px] py-1.5 text-xs"
                    onChange={(e) => pickRole(row, e.target.value as Role)}
                  >
                    {ROLE_OPTIONS.map((role) => (
                      <option key={role} value={role}>{ROLE_LABELS[role]}</option>
                    ))}
                  </Select>
                )}
              </Td>

              <Td>
                <span className="font-mono text-[10.5px] text-fg-muted">{row.signIn}</span>
              </Td>

              <Td>
                {row.locked ? (
                  <span className="text-[12px] text-fg-muted">Always enabled</span>
                ) : (
                  <Button
                    size="sm"
                    variant={row.disabled ? "secondary" : "ghost"}
                    loading={pending}
                    onClick={() =>
                      run(
                        () => setUserDisabled({ userId: row.id, disabled: !row.disabled }),
                        () => (row.disabled ? `${row.name} can sign in again` : `${row.name} is disabled`),
                      )
                    }
                  >
                    {row.disabled ? "Enable" : "Disable"}
                  </Button>
                )}
              </Td>
            </Tr>
          ))}
        </TBody>
      </Table>

      {/*
        A Dialog, not a static hint: the README reserves dialogs for decisions
        of this weight, and this is the one control on this screen that can
        end the actor's own session. Selects stay bound to `row.role` (prop,
        not local state), so cancelling — or the dialog just closing — snaps
        the visible value back to whatever is actually saved, with no extra
        state to reset by hand.
      */}
      <Dialog
        open={pendingChange !== null}
        onClose={() => setPendingChange(null)}
        title="Change your own role?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPendingChange(null)}>Cancel</Button>
            <Button
              variant="primary"
              loading={pending}
              onClick={() => pendingChange && submitRoleChange(pendingChange.row, pendingChange.next)}
            >
              Change role
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-2">
          {/* Dialog portals to document.body and its focus trap marks every
              other body child inert, so a refusal here has to render INSIDE
              the dialog or the operator sees the spinner stop and nothing else. */}
          {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
          {error && <Banner tone="fault" title={error} />}
          <p>{pendingChange?.warning}</p>
        </div>
      </Dialog>
    </div>
  );
}
