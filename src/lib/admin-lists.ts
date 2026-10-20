import type { Prisma } from "@prisma/client";

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
 * accounts" (`adminHome().users.total - disabled`) and `disabled=1`'s is its "Disabled accounts".
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
