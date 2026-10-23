"use client";

import { useCallback, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Role } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { Icon } from "@/components/ui/icon";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { useToast } from "@/components/ui/toast";
import { useListNavigation } from "@/components/patterns/list-navigation";
import { ROLE_LABELS, accountCreated } from "@/lib/admin-users";
import { usersListHref, type UsersFilter } from "@/lib/admin-lists";
import type { ActionResult } from "@/server/action-result";
import type { UserRow, UsersList } from "@/server/modules/admin/queries";
import { approveSignup, declineSignup, setUserDisabled, updateUser } from "@/server/modules/admin/user-actions";
import { AddUserSheet } from "./add-user-sheet";
import { ResetPasswordDialog } from "./reset-password-dialog";
import { UserPanel, type PanelNotice, type UserChanges } from "./user-panel";
import { UsersTable } from "./users-table";
import { UsersToolbar } from "./users-toolbar";
import { WaitingChip } from "./waiting-chip";

/** From 1180 px the details sit beside the list; below, they open in a drawer (full screen below 700 px). */
const WIDE = "(min-width: 1180px)";

function subscribeWide(on: () => void) {
  const m = window.matchMedia(WIDE);
  m.addEventListener("change", on);
  return () => m.removeEventListener("change", on);
}
const wideNow = () => window.matchMedia(WIDE).matches;
// The server renders the wide layout; CSS hides the side panel below 1180 px until the client knows.
const wideOnServer = () => true;

/**
 * Users & access (spec §4.4; boards Users2, Tablet2, Phone2): the client shell. The list is the server's (`?role=`,
 * `?status=`, `?q=`, `?page=`); the open person is `?sel=`, replaced in the URL so Back and a refresh keep it.
 *
 * - 1180 px and wider: list and details side by side; with nothing chosen, the first row's details show.
 * - Below 1180 px: the details open in a drawer when someone is chosen.
 * - Below 900 px: the app's own mobile shell (top bar and menu) frames the page — nothing here changes.
 * - Below 700 px: cards instead of the table, the details full screen, Add user full screen, Reset as a bottom dialog.
 *
 * Every action passes the row's `updatedAt` (`expectedUpdatedAt`), then refreshes the list so the next one has the
 * new version. A refusal shows in the panel; a conflict ("Changed by someone else since — try again") also refreshes.
 */
export function UsersView({
  list,
  filter,
  sel,
  selected,
  actorId,
  domain,
  now,
}: {
  list: UsersList;
  filter: UsersFilter;
  /** `?sel=`, when it names an account (listed or not) */
  sel: string | null;
  /** the `?sel=` account's row, whether or not this page lists it */
  selected: UserRow | null;
  actorId: string;
  domain: string | null;
  /** ISO: the server's "now", for the relative sign-in times */
  now: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const { pending: listing } = useListNavigation();
  const wide = useSyncExternalStore(subscribeWide, wideNow, wideOnServer);
  const [busy, startAction] = useTransition();
  const [notice, setNotice] = useState<{ userId: string; notice: PanelNotice } | null>(null);
  const [adding, setAdding] = useState(false);
  /** below 1180 px a new account is selected once Add user closes, so its drawer never covers the password */
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [resetting, setResetting] = useState<{ id: string; name: string } | null>(null);

  const { rows, total, page, pageCount, pendingCount, roleCounts } = list;
  const shown = selected ?? (wide ? rows[0] ?? null : null);
  const filtered = !!(filter.role || filter.status || filter.q || filter.disabled !== null);

  const select = useCallback(
    (id: string | null) => {
      setNotice(null);
      router.replace(usersListHref(filter, page, id), { scroll: false });
    },
    [router, filter, page],
  );

  /** Runs one action for `row`: a toast when it stood, the refusal in the panel otherwise; the list refreshes. */
  function run<T>(row: UserRow, action: () => Promise<ActionResult<T>>, done: (data: T) => string) {
    setNotice(null);
    startAction(async () => {
      const res = await action();
      if (res.ok) {
        toast(done(res.data), "settled");
        router.refresh();
        return;
      }
      if (res.kind === "forbidden") {
        toast(res.message, "fault");
        return;
      }
      setNotice({ userId: row.id, notice: res.kind === "validation" ? { fieldErrors: res.fieldErrors } : { message: res.message } });
      // A conflict means the row moved under us: the fresh one replaces the stale panel (its drafts are moot).
      if (res.kind === "conflict") router.refresh();
    });
  }

  const handlers = (row: UserRow) => ({
    onSave: (changes: UserChanges) =>
      run(row, () => updateUser({ id: row.id, expectedUpdatedAt: row.updatedAt, ...changes }), (data) => {
        if (!data.changed) return `Nothing to save for ${row.name}`;
        const signedOut = changes.role !== undefined || changes.email !== undefined;
        const who = changes.name ?? row.name;
        return changes.role
          ? `${who} is now ${ROLE_LABELS[changes.role]} · signed out`
          : `Saved ${who}'s changes${signedOut ? " · signed out" : ""}`;
      }),
    onSetActive: (active: boolean) =>
      run(row, () => setUserDisabled({ userId: row.id, disabled: !active, expectedUpdatedAt: row.updatedAt }), () =>
        active ? `${row.name} can sign in again` : `${row.name}'s account is off · signed out`,
      ),
    onReset: () => setResetting({ id: row.id, name: row.name }),
    onApprove: (role: Role, employeeId: string | null) =>
      run(row, () => approveSignup({ id: row.id, role, employeeId, expectedUpdatedAt: row.updatedAt }), () =>
        `${row.name} approved as ${ROLE_LABELS[role]} — they can sign in now`,
      ),
    onDecline: () => run(row, () => declineSignup({ id: row.id }), () => `${row.name}'s sign-up declined`),
  });

  const panelFor = (row: UserRow, onClose?: () => void) => (
    <UserPanel
      // A saved or refreshed row starts clean: new version, new drafts.
      key={`${row.id}:${row.updatedAt}`}
      row={row}
      actorId={actorId}
      now={now}
      busy={busy}
      notice={notice?.userId === row.id ? notice.notice : null}
      onClose={onClose}
      {...handlers(row)}
    />
  );

  return (
    <div className="flex flex-col gap-3.5">
      <PageHeader
        title="Users & access"
        actions={
          <Button variant="primary" className="h-11 px-4" onClick={() => setAdding(true)}>
            <Icon name="add" size={15} />
            Add user
          </Button>
        }
      />
      <p className="-mt-4 text-[13.5px] text-fg-secondary">
        Each person&apos;s role decides which workspaces they open. New sign-ups wait here for approval.
      </p>

      <WaitingChip count={pendingCount} active={filter.status === "PENDING"} />

      <div className="grid grid-cols-1 items-start gap-4 min-[1180px]:grid-cols-[minmax(0,1fr)_420px]">
        <section
          aria-label="Users"
          aria-busy={listing || undefined}
          className="flex min-w-0 flex-col overflow-hidden rounded-(--radius-card) border border-border bg-surface shadow-card"
        >
          <UsersToolbar filter={filter} roleCounts={roleCounts} />
          <div className={listing ? "opacity-60 transition-opacity" : undefined}>
            <UsersTable rows={rows} selectedId={shown?.id ?? null} onSelect={(id) => select(id)} now={now} filtered={filtered} />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border-faint px-4 py-2.5 text-[12.5px] text-fg-secondary">
            <span aria-live="polite">{total === 1 ? "1 person" : `${total} people`}</span>
            <span className="text-fg-muted">Sorted by name</span>
          </div>
          {pageCount > 1 && (
            <div className="border-t border-border-faint px-4 py-2">
              <Pagination page={page} pageCount={pageCount} hrefFor={(p) => usersListHref(filter, p)} />
            </div>
          )}
        </section>

        {wide && shown && (
          <aside
            aria-label={`${shown.name}'s details`}
            className="sticky top-4 hidden max-h-[calc(100dvh-6rem)] min-h-[480px] flex-col overflow-hidden rounded-(--radius-card) border border-border bg-surface shadow-card min-[1180px]:flex"
          >
            {panelFor(shown)}
          </aside>
        )}
      </div>

      {!wide && sel && selected && (
        <Drawer open onClose={() => select(null)} title={`${selected.name}'s details`} width={440} bare className="max-[700px]:w-full!">
          {panelFor(selected, () => select(null))}
        </Drawer>
      )}

      <AddUserSheet
        open={adding}
        onClose={() => {
          setAdding(false);
          if (createdId) select(createdId);
          setCreatedId(null);
        }}
        domain={domain}
        onCreated={({ id, name }) => {
          toast(accountCreated(name), "settled");
          // Select the new account (the page reads it even when the filters hide it): beside the list at once when
          // wide; otherwise after the sheet closes, since its drawer would open over the temporary password.
          if (wide) select(id);
          else {
            setCreatedId(id);
            router.refresh();
          }
        }}
      />

      {resetting && (
        <ResetPasswordDialog
          key={resetting.id}
          name={resetting.name}
          userId={resetting.id}
          onClose={() => setResetting(null)}
          onReset={() => router.refresh()}
        />
      )}
    </div>
  );
}
