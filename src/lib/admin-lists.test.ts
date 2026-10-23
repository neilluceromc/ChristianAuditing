import { describe, expect, it } from "vitest";
import { FLAG_SPECS } from "./admin-flags";
import {
  filterFlags, flagsHref, isFlagUnavailable, parseFlagsState, parseUserRole, parseUserStatus, parseUsersDisabled,
  parseUsersFilter, userStatusWhere, usersHref, usersListHref, usersListWhere, usersWhere,
} from "./admin-lists";
import { USER_STATUSES, userStatus } from "./admin-users";

describe("/admin/users?disabled=0|1 (Phase 46 spec §3.2, §4.3)", () => {
  it("reads 1 as disabled, 0 as active, anything else as everyone", () => {
    expect(parseUsersDisabled("1")).toBe(true);
    expect(parseUsersDisabled("0")).toBe(false);
    for (const raw of [null, undefined, "", "yes", "2"]) expect(parseUsersDisabled(raw)).toBeNull();
  });

  it("filters User.disabled true or false, and nothing else (the page lists every user)", () => {
    expect(usersWhere(true)).toEqual({ disabled: true });
    expect(usersWhere(false)).toEqual({ disabled: false });
    expect(usersWhere(null)).toEqual({});
  });

  it("keeps the filter across pages", () => {
    expect(usersHref(null, 1)).toBe("/admin/users");
    expect(usersHref(null, 3)).toBe("/admin/users?page=3");
    expect(usersHref(true, 1)).toBe("/admin/users?disabled=1");
    expect(usersHref(false, 2)).toBe("/admin/users?disabled=0&page=2");
  });
});

describe("/admin/flags?state=unavailable (Phase 46 spec §4.3)", () => {
  it("parses only unavailable", () => {
    expect(parseFlagsState("unavailable")).toBe("unavailable");
    for (const raw of [null, undefined, "", "on", "UNAVAILABLE"]) expect(parseFlagsState(raw)).toBeNull();
  });

  it("is the UNAVAILABLE pill's own predicate: a non-empty reason (FlagRow) or true (the Admin home summary)", () => {
    expect(isFlagUnavailable({ unavailable: "not wired up" })).toBe(true);
    expect(isFlagUnavailable({ unavailable: null })).toBe(false);
    expect(isFlagUnavailable({ unavailable: true })).toBe(true);
    expect(isFlagUnavailable({ unavailable: false })).toBe(false);
  });

  it("keeps only the unavailable flags under the filter, every flag without it", () => {
    const rows = [
      { key: "a", unavailable: "no callback" },
      { key: "b", unavailable: null },
    ];
    expect(filterFlags(rows, "unavailable").map((r) => r.key)).toEqual(["a"]);
    expect(filterFlags(rows, null)).toEqual(rows);
  });

  it("counts this build's unavailable specs (m365_sso today)", () => {
    expect(filterFlags(FLAG_SPECS, "unavailable").map((f) => f.key)).toEqual(["m365_sso"]);
  });

  it("links the filter", () => {
    expect(flagsHref("unavailable")).toBe("/admin/flags?state=unavailable");
    expect(flagsHref(null)).toBe("/admin/flags");
  });
});

describe("Users & access list filters (spec §4.4, Task 3)", () => {
  const q = (s: string) => new URLSearchParams(s);

  it("parses ?role, ?status and ?q, ignoring anything unknown", () => {
    expect(parseUsersFilter(q("role=finance_staff&status=PENDING&q=%20nina%20"))).toEqual({
      role: "finance_staff", status: "PENDING", q: "nina", disabled: null,
    });
    expect(parseUsersFilter(q("role=boss&status=asleep"))).toEqual({ role: null, status: null, q: "", disabled: null });
    expect(parseUsersFilter(q("disabled=1")).disabled).toBe(true);
    expect(parseUsersFilter(q(`q=${"x".repeat(200)}`)).q).toHaveLength(100);
  });

  it("parseUserStatus and parseUserRole accept only the known values", () => {
    for (const s of USER_STATUSES) expect(parseUserStatus(s)).toBe(s);
    expect(parseUserStatus("pending")).toBeNull();
    expect(parseUserRole("viewer")).toBe("viewer");
    expect(parseUserRole("root")).toBeNull();
  });

  // Every state a row can be in: the status filter's where must pick exactly the rows userStatus names that status.
  it("each status's where matches exactly the rows userStatus maps to it", () => {
    type Row = { approvalState: "APPROVED" | "PENDING" | "DECLINED"; disabled: boolean; mustChangePassword: boolean };
    const rows: Row[] = [];
    for (const approvalState of ["APPROVED", "PENDING", "DECLINED"] as const) {
      for (const disabled of [false, true]) for (const mustChangePassword of [false, true]) rows.push({ approvalState, disabled, mustChangePassword });
    }
    const matches = (row: Row, where: Record<string, unknown>) =>
      Object.entries(where).every(([k, v]) => row[k as keyof Row] === v);
    for (const status of USER_STATUSES) {
      const where = userStatusWhere(status) as Record<string, unknown>;
      for (const row of rows) expect(matches(row, where), `${status} ${JSON.stringify(row)}`).toBe(userStatus(row) === status);
    }
  });

  it("searches name, email, employee no. and department, case-insensitively", () => {
    const where = usersListWhere({ q: "fin" });
    expect(where).toEqual({
      AND: [{
        OR: [
          { name: { contains: "fin", mode: "insensitive" } },
          { email: { contains: "fin", mode: "insensitive" } },
          { employee: { is: { employeeNo: { contains: "fin", mode: "insensitive" } } } },
          { employee: { is: { department: { is: { name: { contains: "fin", mode: "insensitive" } } } } } },
        ],
      }],
    });
  });

  it("ANDs role, status, the old disabled filter and the search; no filter lists everyone", () => {
    expect(usersListWhere({})).toEqual({ AND: [] });
    expect(usersListWhere({ role: "admin", status: "DISABLED", disabled: true })).toEqual({
      AND: [{ role: "admin" }, userStatusWhere("DISABLED"), { disabled: true }],
    });
  });

  it("keeps every filter across pages", () => {
    expect(usersListHref({}, 1)).toBe("/admin/users");
    expect(usersListHref({ role: "viewer", status: "PENDING", q: "ana lim" }, 2)).toBe(
      "/admin/users?role=viewer&status=PENDING&q=ana+lim&page=2",
    );
    expect(usersListHref({ disabled: true }, 1)).toBe("/admin/users?disabled=1");
  });
});
