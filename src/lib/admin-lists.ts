import type { Prisma, Role } from "@prisma/client";
import { ROLE_OPTIONS, USER_STATUSES, type UserStatus } from "./admin-users";

/*
 * Phase 46 spec §3.2 / §4.3: the Admin list filters the sidebar views and the Admin overview tiles link to. Pure, so
 * the pages, the nav counts and the tests share one predicate each.
 */

/** `/admin/users?disabled=1` lists disabled accounts, `?disabled=0` active ones; anything else lists every user. */
export type UsersDisabled = boolean | null;

export function parseUsersDisabled(raw: string | null | undefined): UsersDisabled {
  if (raw === "1") return true;
  if (raw === "0") return false;
  return null;
}

/**
 * The users page lists every User with no other exclusion, so `disabled=0`'s count is the Admin overview's "Active
 * accounts" (`adminHome().users.active`). Task 4: `disabled=0` lists ACTIVE_ACCOUNTS_WHERE below, and the page redirects
 * `disabled=1` to `?status=DISABLED` (`adminHome().users.disabled`).
 */
export function usersWhere(disabled: UsersDisabled): Prisma.UserWhereInput {
  return disabled === null ? {} : { disabled };
}

/** A page of the users list, keeping its filter. */
export function usersHref(disabled: UsersDisabled, page = 1): string {
  const qs = new URLSearchParams();
  if (disabled !== null) qs.set("disabled", disabled ? "1" : "0");
  if (page > 1) qs.set("page", String(page));
  const s = qs.toString();
  return s ? `/admin/users?${s}` : "/admin/users";
}

/*
 * Users & access (spec §4.4): /admin/users?role=&status=&q= — the role tabs, the status filter and the search. The
 * page, the "Waiting for approval" nav count and listUsers' pendingCount all read these wheres. `disabled` is the
 * Phase 46 filter above, kept while the Disabled view and the Admin overview tiles still link to it.
 */
export interface UsersFilter {
  role: Role | null;
  status: UserStatus | null;
  q: string;
  disabled: UsersDisabled;
}

const Q_MAX = 100;

export function parseUserStatus(raw: string | null | undefined): UserStatus | null {
  return (USER_STATUSES as readonly string[]).includes(raw ?? "") ? (raw as UserStatus) : null;
}

export function parseUserRole(raw: string | null | undefined): Role | null {
  return (ROLE_OPTIONS as string[]).includes(raw ?? "") ? (raw as Role) : null;
}

export function parseUsersFilter(params: URLSearchParams): UsersFilter {
  return {
    role: parseUserRole(params.get("role")),
    status: parseUserStatus(params.get("status")),
    q: (params.get("q") ?? "").trim().slice(0, Q_MAX),
    disabled: parseUsersDisabled(params.get("disabled")),
  };
}

/** `userStatus` (admin-users.ts) as a where: approval state first, then turned off, then a password owed. */
export function userStatusWhere(status: UserStatus): Prisma.UserWhereInput {
  switch (status) {
    case "PENDING":
      return { approvalState: "PENDING" };
    case "DECLINED":
      return { approvalState: "DECLINED" };
    case "DISABLED":
      return { approvalState: "APPROVED", disabled: true };
    case "MUST_SET_PASSWORD":
      return { approvalState: "APPROVED", disabled: false, mustChangePassword: true };
    case "ACTIVE":
      return { approvalState: "APPROVED", disabled: false, mustChangePassword: false };
  }
}

/**
 * Task 4 fix round 1: the accounts that can sign in — approved and turned on. `?disabled=0` (the Admin overview's
 * "Active accounts") lists these, and adminHome counts them, so a waiting or declined sign-up never reads as active.
 */
export const ACTIVE_ACCOUNTS_WHERE = { approvalState: "APPROVED", disabled: false } as const satisfies Prisma.UserWhereInput;

/** Every filter given, ANDed; the search matches name, email, employee no. or department, ignoring case. */
export function usersListWhere(filter: Partial<UsersFilter>): Prisma.UserWhereInput {
  const and: Prisma.UserWhereInput[] = [];
  if (filter.role) and.push({ role: filter.role });
  if (filter.status) and.push(userStatusWhere(filter.status));
  if (filter.disabled === true) and.push({ disabled: true });
  if (filter.disabled === false) and.push(ACTIVE_ACCOUNTS_WHERE);
  const q = filter.q?.trim();
  if (q) {
    const has = { contains: q, mode: "insensitive" as const };
    and.push({
      OR: [
        { name: has },
        { email: has },
        { employee: { is: { employeeNo: has } } },
        { employee: { is: { department: { is: { name: has } } } } },
      ],
    });
  }
  return { AND: and };
}

/** A page of the users list, keeping every filter, and (Task 4) the person whose details are open (`?sel=`). */
export function usersListHref(filter: Partial<UsersFilter>, page = 1, sel: string | null = null): string {
  const qs = new URLSearchParams();
  if (filter.role) qs.set("role", filter.role);
  if (filter.status) qs.set("status", filter.status);
  if (filter.q?.trim()) qs.set("q", filter.q.trim());
  if (filter.disabled !== undefined && filter.disabled !== null) qs.set("disabled", filter.disabled ? "1" : "0");
  if (page > 1) qs.set("page", String(page));
  if (sel) qs.set("sel", sel);
  const s = qs.toString();
  return s ? `/admin/users?${s}` : "/admin/users";
}

/** `/admin/flags?state=unavailable`: only the flags whose UNAVAILABLE pill shows. */
export type FlagsState = "unavailable" | null;

export function parseFlagsState(raw: string | null | undefined): FlagsState {
  return raw === "unavailable" ? "unavailable" : null;
}

/**
 * The UNAVAILABLE pill's predicate (flag-rows.tsx shows it while `row.unavailable` is set): a FlagRow or FlagSpec
 * carries the reason string, the Admin home summary carries a boolean.
 */
export function isFlagUnavailable(flag: { unavailable: string | boolean | null }): boolean {
  return !!flag.unavailable;
}

export function filterFlags<T extends { unavailable: string | boolean | null }>(rows: T[], state: FlagsState): T[] {
  return state === "unavailable" ? rows.filter(isFlagUnavailable) : rows;
}

export function flagsHref(state: FlagsState): string {
  return state ? `/admin/flags?state=${state}` : "/admin/flags";
}
