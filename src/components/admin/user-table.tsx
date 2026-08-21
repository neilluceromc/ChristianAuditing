"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import { Avatar } from "@/components/ui/avatar";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Pill } from "@/components/ui/pill";
import { Select } from "@/components/ui/select";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import {
  ROLE_LABELS, ROLE_OPTIONS, disableChange, selfRoleChangeWarning, type RuleResult,
} from "@/lib/admin-users";
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

/** `RuleResult`'s reason, or null when the rule allows it — a small reader so
 * call sites don't each re-narrow the discriminated union by hand. */
function refusalReason(verdict: RuleResult): string | null {
  return verdict.allowed ? null : verdict.reason;
}

export function UserTable({ rows, actorId }: { rows: UserRow[]; actorId: string }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // A deadline, not a duration: RateLimitNotice resets its own countdown on
  // every mount, and this component remounts it (top of the table vs. inside
  // the confirm dialog). Storing "when it ends" and computing the remaining
  // seconds fresh at render — instead of a `retryAfterSec` captured once —
  // is what keeps a remount from restarting the clock.
  const [retryDeadline, setRetryDeadline] = useState<number | null>(null);
  const [pendingChange, setPendingChange] = useState<PendingSelfChange | null>(null);
  // Scoped to the one row whose Disable/Enable button is actually in flight —
  // `pending` alone would put a spinner in all five rows for one click.
  const [acting, setActing] = useState<string | null>(null);

  const retryAfterSec =
    retryDeadline === null ? null : Math.max(0, Math.ceil((retryDeadline - Date.now()) / 1000));

  // Both constraints this screen enforces — the permanent-admin lock and the
  // self-disable refusal — are stated once here rather than inside a 130px
  // cell (card 3h still requires both be stated, just not squeezed into the
  // Access column). Derived from the same rule functions the actions call,
  // never a second copy of the wording.
  const permanentLockCaption = rows.find((r) => r.locked)?.locked ?? null;
  const selfRow = rows.find((r) => r.id === actorId);
  // Guarded the same way the per-row check below is: when the actor IS the
  // permanent admin, disableChange would return the lock reason again —
  // identical to permanentLockCaption above it — rather than the self-disable
  // wording, which would read as the same sentence stated twice.
  const selfDisableCaption =
    selfRow && !selfRow.locked && !selfRow.disabled
      ? refusalReason(disableChange(selfRow.target, true, actorId))
      : null;

  // A real generic, not a same-shape-assumed cast — setUserRole and
  // setUserDisabled don't share a data shape beyond `changed`. `changed` can
  // only be false when this row's props were already stale (another admin
  // edited it, or this tab was open across an edit), so `router.refresh()`
  // always runs on success: in that one case it's the entire remedy, not a
  // wasted round trip, and staying silent would leave the row looking like
  // the click did nothing, forever, until a manual reload.
  function run<T extends { changed: boolean }>(
    fn: () => Promise<ActionResult<T>>,
    messages: { changed: (data: T) => string; unchanged: string },
    opts?: { onOk?: () => void; onSettled?: () => void },
  ) {
    setError(null);
    startTransition(async () => {
      try {
        const res = await fn();
        if (res.ok) {
          opts?.onOk?.();
          toast(res.data.changed ? messages.changed(res.data) : messages.unchanged, "settled");
          router.refresh();
        } else if (res.kind === "rate_limited") {
          setRetryDeadline(Date.now() + (res.retryAfterSec ?? 60) * 1000);
        } else {
          // Every refusal on this screen is a conflict or a forbidden — there
          // are no field-level inputs to hang a validation error on, so all
          // of them go to the banner rather than dead-ending silently.
          setError(res.message);
        }
      } finally {
        opts?.onSettled?.();
      }
    });
  }

  function submitRoleChange(row: UserRow, next: Role) {
    run(
      () => setUserRole({ userId: row.id, role: next }),
      {
        // The result also carries `signsOutActor`, deliberately unread here:
        // on a self change, router.refresh() above runs requireUser again,
        // whose JWT/DB role mismatch redirects this document to /logout — a
        // full navigation that tears down ToastProvider before a toast
        // queued this tick could reliably render. The confirm dialog already
        // said this before the click; a notice on /login is the only place
        // left for a post-redirect message, and that's out of scope here.
        changed: () => `${row.name} is now ${ROLE_LABELS[next]}`,
        unchanged: `${row.name} is already ${ROLE_LABELS[next]}`,
      },
      { onOk: () => setPendingChange(null) },
    );
  }

  function pickRole(row: UserRow, next: Role) {
    // One function decides when a role change signs the actor out, reading
    // the same `target` object `listUsers` built server-side — this never
    // restates that as `row.id === actorId` or re-synthesizes the target, so
    // the select and the action can't drift apart on when it applies.
    const warning = selfRoleChangeWarning(row.target, next, actorId);
    if (warning) {
      // A stale refusal from a different row's click must not leak into this
      // dialog, reading as though it were about the change being confirmed.
      setError(null);
      setRetryDeadline(null);
      setPendingChange({ row, next, warning });
    } else {
      submitRoleChange(row, next);
    }
  }

  function toggleDisabled(row: UserRow) {
    setActing(row.id);
    run(
      () => setUserDisabled({ userId: row.id, disabled: !row.disabled }),
      {
        changed: () => (row.disabled ? `${row.name} can sign in again` : `${row.name} is disabled`),
        unchanged: row.disabled ? `${row.name} can already sign in` : `${row.name} is already disabled`,
      },
      { onSettled: () => setActing(null) },
    );
  }

  return (
    <>
      {retryAfterSec !== null && !pendingChange && (
        <RateLimitNotice retryAfterSec={retryAfterSec} onExpire={() => setRetryDeadline(null)} />
      )}
      {error && !pendingChange && <Banner tone="fault" title={error} />}

      <Table>
        <THead>
          <Tr>
            <Th>User</Th>
            <Th width={170}>Role</Th>
            <Th width={150}>Workspaces</Th>
            <Th width={110}>Sign-in</Th>
            <Th width={130}>Access</Th>
          </Tr>
        </THead>
        <TBody>
          {rows.map((row) => {
            // Card 3h's thesis — the constraint is STATED, never discovered
            // through a failed save — applies to this button exactly as it
            // applies to the locked row: an admin can never actually disable
            // their own account (disableChange refuses it outright, and a
            // disabled user is bounced before they could see this page
            // anyway), so a live "Disable" button on the actor's own row
            // could only ever end in a conflict banner. Call the same rule
            // the action calls and render its refusal as static text instead.
            const disableRefusal =
              !row.locked && !row.disabled ? refusalReason(disableChange(row.target, true, actorId)) : null;

            return (
              <Tr key={row.id} className={cn(row.locked && "bg-surface-subtle")}>
                <Td>
                  <span className="flex items-center gap-2.5">
                    <Avatar name={row.name} size="sm" />
                    <span className="flex flex-col leading-tight">
                      <span className={cn("text-[12.5px]", row.disabled ? "text-fg-muted" : "text-fg")}>
                        {row.name}
                      </span>
                      <span className="font-mono text-[10.5px] text-fg-muted">
                        {row.email}
                        {row.locked && " · permanent"}
                        {!row.locked && row.disabled && " · disabled"}
                      </span>
                    </span>
                  </span>
                </Td>

                <Td>
                  {row.locked ? (
                    // Card 3h: the constraint is STATED. A LOCKED chip plus the
                    // static role label — never a select that fails on save.
                    // The reason it's locked lives in the caption below the
                    // table, not squeezed into this 170px cell.
                    <span className="flex items-center gap-1.5">
                      <Pill>LOCKED</Pill>
                      <span className="text-[12px] text-fg-muted">{ROLE_LABELS[row.role]}</span>
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
                  <span className="text-[12px] text-fg-secondary">{row.workspaces}</span>
                </Td>

                <Td>
                  <span className="font-mono text-[10.5px] text-fg-muted">{row.signIn}</span>
                </Td>

                <Td>
                  {row.locked ? (
                    <span className="text-[12px] text-fg-muted">Always enabled</span>
                  ) : disableRefusal ? (
                    // Short label in the cell; the sentence explaining it is
                    // in the caption below — the same width discipline as
                    // the locked row above.
                    <span className="text-[12px] text-fg-muted">Your own account</span>
                  ) : (
                    <Button
                      size="sm"
                      variant={row.disabled ? "secondary" : "ghost"}
                      loading={acting === row.id}
                      disabled={pending}
                      aria-label={row.disabled ? `Enable ${row.name}` : `Disable ${row.name}`}
                      onClick={() => toggleDisabled(row)}
                    >
                      {row.disabled ? "Enable" : "Disable"}
                    </Button>
                  )}
                </Td>
              </Tr>
            );
          })}
        </TBody>
      </Table>

      {(permanentLockCaption || selfDisableCaption) && (
        <div className="flex flex-col gap-1 px-1">
          {permanentLockCaption && (
            <p className="text-[11px] leading-snug text-fg-faint">{permanentLockCaption}</p>
          )}
          {selfDisableCaption && (
            <p className="text-[11px] leading-snug text-fg-faint">{selfDisableCaption}</p>
          )}
        </div>
      )}

      {/*
        A Dialog, not a static hint: the README reserves dialogs for decisions
        of this weight, and this is the one control on this screen that can
        end the actor's own session. The Select stays bound to `row.role`
        (prop, not local state), so cancelling — or the dialog just closing —
        snaps the visible value back to whatever is actually saved, with no
        extra state to reset by hand.
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
          {retryAfterSec !== null && (
            <RateLimitNotice retryAfterSec={retryAfterSec} onExpire={() => setRetryDeadline(null)} />
          )}
          {error && <Banner tone="fault" title={error} />}
          <p>{pendingChange?.warning}</p>
        </div>
      </Dialog>
    </>
  );
}
