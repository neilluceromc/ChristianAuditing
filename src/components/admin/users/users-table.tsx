"use client";

import { cn } from "@/lib/cn";
import { Avatar } from "@/components/ui/avatar";
import { Icon } from "@/components/ui/icon";
import { Pill } from "@/components/ui/pill";
import { Table, TBody, Td, Th, THead, Tr, rowOpenProps } from "@/components/ui/table";
import { OFFBOARDED_NOTE, ROLE_LABELS, lastSignInLabel } from "@/lib/admin-users";
import type { UserRow } from "@/server/modules/admin/queries";
import { UserStatusLabel } from "./user-status";

/** A column that gives way when the list itself (an `@container`, users-view.tsx) is under 900 px wide. */
const NARROW_HIDE = "@max-[900px]:hidden";

/** The amber "Employee offboarded" note (spec §4.4: the account is not changed; the admin decides). */
export function OffboardedNote({ className }: { className?: string }) {
  return (
    <span className={cn("text-[11.5px] font-medium", className)} style={{ color: "var(--st-attention-text)" }}>
      {OFFBOARDED_NOTE}
    </span>
  );
}

/**
 * Users & access (spec §4.4; Users2, Phone2): the list. A table from 700 px; below it the same rows as cards, each a
 * button that opens the details sheet. Both are in the markup and CSS shows one, so the server's first paint is
 * already the right one. Picking a row or card opens that person's details (`onSelect`).
 */
export function UsersTable({
  rows,
  selectedId,
  onSelect,
  now,
  filtered,
}: {
  rows: UserRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** ISO: "now" as the server saw it, so the relative sign-in times render the same on both sides */
  now: string;
  /** a filter or search is on (the empty state then says so) */
  filtered: boolean;
}) {
  const at = new Date(now);
  if (rows.length === 0) {
    return (
      <div className="px-4 py-12 text-center">
        <p className="text-[14px] font-semibold text-fg">{filtered ? "No one matches" : "No accounts yet"}</p>
        <p className="mt-1 text-[13px] text-fg-muted">
          {filtered ? "Try another name or clear the filters." : "Add the first one with Add user."}
        </p>
      </div>
    );
  }

  return (
    <>
      <Table className="rounded-none border-0 shadow-none max-[700px]:hidden">
        <THead>
          <Tr>
            <Th>Person</Th>
            <Th width={130}>Role</Th>
            {/* Beside the details panel (1180 px and up) the list is ~710 px, on a tablet ~790 px: this column gives
                way below 900 px of list, so Person keeps its room; the panel shows the record (Task 5). */}
            <Th width={190} className={NARROW_HIDE}>Employee record</Th>
            <Th width={170}>Status</Th>
            <Th width={120}>Last sign-in</Th>
          </Tr>
        </THead>
        <TBody>
          {rows.map((r) => {
            const selected = r.id === selectedId;
            const dim = r.status === "DISABLED" || r.status === "DECLINED";
            return (
              <Tr
                key={r.id}
                selected={selected}
                data-user-row={r.id}
                className={cn("cursor-pointer", selected && "shadow-[inset_3px_0_0_var(--accent)]")}
                style={{ height: "var(--list-row-h)" }}
                {...rowOpenProps(() => onSelect(r.id))}
              >
                <Td className="max-w-0">
                  <span className="flex min-w-0 items-center gap-2.5">
                    <Avatar name={r.name} size="xl" className="shrink-0" />
                    <span className="flex min-w-0 flex-col leading-tight">
                      <span className={cn("flex min-w-0 items-center gap-1.5 text-[13px]", dim ? "text-fg-muted" : "text-fg", selected && "font-semibold")}>
                        <span className="truncate">{r.name}</span>
                        {r.locked && <Pill className="shrink-0">Permanent</Pill>}
                      </span>
                      <span className="truncate text-[11.5px] text-fg-muted">{r.email}</span>
                    </span>
                  </span>
                </Td>
                <Td>
                  <span className="inline-flex h-6 items-center rounded-full bg-border-faint px-2.5 text-[11.5px] font-medium text-fg-secondary">
                    {ROLE_LABELS[r.role]}
                  </span>
                </Td>
                <Td className={cn("max-w-0", NARROW_HIDE)}>
                  {r.employee ? (
                    <span className="flex min-w-0 flex-col leading-tight">
                      <span className="truncate font-mono text-[12px] text-fg-secondary">{r.employee.employeeNo}</span>
                      {r.employee.offboarded ? (
                        <OffboardedNote />
                      ) : (
                        <span className="truncate text-[11.5px] text-fg-muted">{r.employee.groupLabel}</span>
                      )}
                    </span>
                  ) : (
                    <span className="text-[12px] text-fg-muted">Not linked</span>
                  )}
                </Td>
                <Td>
                  <UserStatusLabel status={r.status} className="text-[12.5px]" />
                </Td>
                <Td className="text-[12.5px] text-fg-secondary">{lastSignInLabel(r.lastSignInAt, at)}</Td>
              </Tr>
            );
          })}
        </TBody>
      </Table>

      <ul className="hidden flex-col gap-2 p-2 max-[700px]:flex" aria-label="User cards">
        {rows.map((r) => (
          <li key={r.id}>
            <button
              type="button"
              data-user-card={r.id}
              aria-current={r.id === selectedId ? "true" : undefined}
              onClick={() => onSelect(r.id)}
              className="flex w-full items-center gap-3 rounded-(--radius-card) border border-border bg-surface p-3 text-left hover:bg-surface-subtle"
            >
              <Avatar name={r.name} size="xl" className="shrink-0" />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-[15px] font-semibold text-fg">{r.name}</span>
                <span className="truncate text-[13px] text-fg-secondary">
                  {`${ROLE_LABELS[r.role]} · ${r.employee ? r.employee.groupLabel : "No employee record"}`}
                </span>
                {r.employee?.offboarded && <OffboardedNote />}
                <span className="flex flex-wrap items-center gap-1 text-[12px]">
                  <UserStatusLabel status={r.status} />
                  <span className="text-fg-muted">· {lastSignInLabel(r.lastSignInAt, at)}</span>
                </span>
              </span>
              <span aria-hidden className="text-fg-faint"><Icon name="chevron" size={14} /></span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
