"use client";

import Link from "next/link";
import type { Role } from "@prisma/client";
import { cn } from "@/lib/cn";
import { Select } from "@/components/ui/select";
import { SearchBox } from "@/components/patterns/search-box";
import { ChipFilterRow } from "@/components/patterns/chip-filter-row";
import { useListNavigation } from "@/components/patterns/list-navigation";
import { ROLE_TABS, USER_STATUSES, USER_STATUS_LABEL } from "@/lib/admin-users";
import { parseUserRole, parseUserStatus, usersListHref, type UsersFilter } from "@/lib/admin-lists";

/**
 * Users & access (spec §4.4; Users2 / Phone2): the role tabs with their counts (a select below 700 px), the status
 * filter and the search. Every change is a URL (`?role=&status=&q=`) the server lists; a change starts at page 1 and
 * closes the details (the person may no longer be listed).
 */
export function UsersToolbar({ filter, roleCounts }: { filter: UsersFilter; roleCounts: Record<Role, number> }) {
  const { navigate, replace } = useListNavigation();
  const all = Object.values(roleCounts).reduce((a, b) => a + b, 0);
  const tabs = ROLE_TABS.map((t) => ({
    ...t,
    count: t.role ? roleCounts[t.role] : all,
    href: usersListHref({ ...filter, role: t.role }),
    active: filter.role === t.role,
  }));

  return (
    <div className="flex flex-col gap-1 border-b border-border-faint px-3.5 py-3">
      <div className="flex flex-wrap items-center gap-2.5">
        <nav
          aria-label="Role"
          className="flex shrink-0 gap-0.5 rounded-(--radius-btn) border border-border bg-surface-subtle p-0.5 max-[700px]:hidden"
        >
          {tabs.map((t) => (
            <Link
              key={t.label}
              href={t.href}
              aria-current={t.active ? "page" : undefined}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-[5px] px-2.5 text-[12.5px] transition-colors duration-(--dur-1)",
                t.active ? "bg-surface font-semibold text-fg shadow-card" : "text-fg-muted hover:text-fg-secondary",
              )}
            >
              <span>{t.label}</span><span className="font-mono text-[11px] font-normal text-fg-muted">{t.count}</span>
            </Link>
          ))}
        </nav>

        <label className="hidden min-w-[140px] flex-1 max-[700px]:block">
          <span className="sr-only">Role</span>
          <Select
            value={filter.role ?? ""}
            onChange={(e) => navigate(usersListHref({ ...filter, role: parseUserRole(e.target.value) }))}
            className="h-11"
          >
            {tabs.map((t) => (
              <option key={t.label} value={t.role ?? ""}>{`${t.label} (${t.count})`}</option>
            ))}
          </Select>
        </label>

        <label className="min-w-[140px] flex-1 basis-[140px] min-[700px]:max-w-[190px]">
          <span className="sr-only">Status</span>
          <Select
            value={filter.status ?? ""}
            onChange={(e) => navigate(usersListHref({ ...filter, status: parseUserStatus(e.target.value) }))}
            className="h-10 max-[700px]:h-11"
          >
            <option value="">Any status</option>
            {USER_STATUSES.map((s) => (
              <option key={s} value={s}>{USER_STATUS_LABEL[s]}</option>
            ))}
          </Select>
        </label>

        <SearchBox
          value={filter.q}
          ariaLabel="Search users"
          placeholder="Search name, email, employee no."
          className="min-w-0 flex-1 basis-[220px] max-[700px]:basis-full"
          inputClassName="h-10 max-[700px]:h-11"
          onSubmit={(q) => replace(usersListHref({ ...filter, q }))}
        />
      </div>
      {/* The Admin overview's "Active accounts" tile still links ?disabled=0 (turned on, any status): a chip says so. */}
      {filter.disabled !== null && (
        <ChipFilterRow
          chips={[{ label: filter.disabled ? "Turned off" : "Can sign in", removeHref: usersListHref({ ...filter, disabled: null }) }]}
          clearHref={usersListHref({})}
        />
      )}
    </div>
  );
}
