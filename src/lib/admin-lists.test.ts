import { describe, expect, it } from "vitest";
import { FLAG_SPECS } from "./admin-flags";
import {
  filterFlags, flagsHref, isFlagUnavailable, parseFlagsState, parseUsersDisabled, usersHref, usersWhere,
} from "./admin-lists";

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
