import type { Role } from "@prisma/client";
import { ROLE_LABELS } from "@/lib/admin-users";
import type { ActionResult } from "@/server/action-result";
import type { UserRow } from "@/server/modules/admin/queries";
import { approveSignup, declineSignup, setUserDisabled, updateUser } from "@/server/modules/admin/user-actions";
import type { PanelNotice, UserChanges } from "./user-panel";

/** What running an action needs from the page: a toast, a list refresh, and where a refusal shows. */
export interface ActionDeps {
  toast: (message: string, tone: "settled" | "fault") => void;
  refresh: () => void;
  setNotice: (userId: string, notice: PanelNotice | null) => void;
}

/**
 * One action for one person (Task 4; Review Focus #3): a toast when it stood and the list refreshes, so the next
 * action carries the new `updatedAt`. A validation refusal shows on its fields; a conflict or a rate limit shows in the
 * panel, and a conflict also refreshes (the row moved: "Changed by someone else since — try again"). Forbidden is a
 * toast: the control should not have been there.
 */
export async function runUserAction<T>(
  row: Pick<UserRow, "id">,
  action: () => Promise<ActionResult<T>>,
  done: (data: T) => string,
  deps: ActionDeps,
): Promise<void> {
  deps.setNotice(row.id, null);
  const res = await action();
  if (res.ok) {
    deps.toast(done(res.data), "settled");
    deps.refresh();
    return;
  }
  if (res.kind === "forbidden") {
    deps.toast(res.message, "fault");
    return;
  }
  deps.setNotice(row.id, res.kind === "validation" ? { fieldErrors: res.fieldErrors } : { message: res.message });
  if (res.kind === "conflict") deps.refresh();
}

/**
 * Fix round 2 (N-3): the page's pending move away (a row picked, or the drawer closed, while drafts differed). Once the
 * drafts match the row again there is nothing to discard: the move is forgotten, so a later edit doesn't ask at once.
 */
export function leavingAfterDirtyChange<L>(leaving: L | null, dirty: boolean): L | null {
  return dirty ? leaving : null;
}

export type RunAction = <T>(row: UserRow, action: () => Promise<ActionResult<T>>, done: (data: T) => string) => void;

/**
 * The panel's callbacks for `row`. Save sends exactly the changed fields with the version the drafts were made on;
 * the switch and Approve send the row's current `updatedAt` (`expectedUpdatedAt`). Decline is guarded on the approval
 * state and Reset is a deliberate overwrite, so neither carries one (ruled, fix round 1).
 */
export function panelHandlers(row: UserRow, run: RunAction, openReset: (row: UserRow) => void) {
  return {
    onSave: (changes: UserChanges, expectedUpdatedAt: string) =>
      run(row, () => updateUser({ id: row.id, expectedUpdatedAt, ...changes }), (data) => {
        if (!data.changed) return `Nothing to save for ${row.name}`;
        const who = changes.name ?? row.name;
        if (changes.role) return `${who} is now ${ROLE_LABELS[changes.role]} · signed out`;
        return `Saved ${who}'s changes${changes.email !== undefined ? " · signed out" : ""}`;
      }),
    onSetActive: (active: boolean) =>
      run(row, () => setUserDisabled({ userId: row.id, disabled: !active, expectedUpdatedAt: row.updatedAt }), () =>
        active ? `${row.name} can sign in again` : `${row.name}'s account is off · signed out`,
      ),
    onReset: () => openReset(row),
    onApprove: (role: Role, employeeId: string | null) =>
      run(row, () => approveSignup({ id: row.id, role, employeeId, expectedUpdatedAt: row.updatedAt }), () =>
        `${row.name} approved as ${ROLE_LABELS[role]} — they can sign in now`,
      ),
    onDecline: () => run(row, () => declineSignup({ id: row.id }), () => `${row.name}'s sign-up declined`),
  };
}
