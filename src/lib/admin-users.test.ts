import { Role } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  ROLE_LABELS, ROLE_OPTIONS, disableChange, lockReason, roleChange, selfRoleChangeWarning, type TargetUser,
} from "./admin-users";

const ordinary: TargetUser = { id: "u-1", role: "it_staff", isPermanentAdmin: false, disabled: false };
const permanent: TargetUser = { id: "u-0", role: "admin", isPermanentAdmin: true, disabled: false };

describe("ROLE_OPTIONS", () => {
  // Reads the schema's enum rather than a hardcoded copy of ROLE_OPTIONS, so
  // this actually fails if the schema grows a role this list forgets.
  it("covers every Role in the schema", () => {
    expect(new Set(ROLE_OPTIONS)).toEqual(new Set(Object.values(Role)));
  });

  // A separate assertion from the one above: this is an ordering claim (card
  // 3h wants the select to read as a privilege ladder), not a coverage one,
  // so a failure here says which of the two broke.
  it("puts admin first", () => {
    expect(ROLE_OPTIONS[0]).toBe("admin");
  });

  it("labels every option, so a select can never render a raw enum", () => {
    for (const role of ROLE_OPTIONS) expect(ROLE_LABELS[role]).toBeTruthy();
  });
});

describe("lockReason", () => {
  it("names the permanent admin, so the row can say why before the click", () => {
    expect(lockReason(permanent)).toMatch(/permanent admin/i);
  });

  it("is null for an ordinary row", () => {
    expect(lockReason(ordinary)).toBeNull();
  });
});

describe("roleChange", () => {
  it("allows an ordinary user's role to change", () => {
    expect(roleChange(ordinary, "viewer", "actor-9")).toEqual({ allowed: true });
  });

  it("refuses the permanent admin, quoting the lock reason", () => {
    const res = roleChange(permanent, "viewer", "actor-9");
    expect(res.allowed).toBe(false);
    expect(res.allowed === false && res.reason).toMatch(/permanent admin/i);
  });

  // Scope decision #3: recoverable, because the permanent admin can restore it.
  it("allows an admin to demote themselves", () => {
    const self: TargetUser = { id: "actor-9", role: "admin", isPermanentAdmin: false, disabled: false };
    expect(roleChange(self, "viewer", "actor-9")).toEqual({ allowed: true });
  });
});

describe("disableChange", () => {
  it("allows disabling an ordinary user", () => {
    expect(disableChange(ordinary, true, "actor-9")).toEqual({ allowed: true });
  });

  it("allows re-enabling an ordinary user", () => {
    const off: TargetUser = { ...ordinary, disabled: true };
    expect(disableChange(off, false, "actor-9")).toEqual({ allowed: true });
  });

  // Scope decision #1: authorize() refuses a disabled user, so disabling the
  // permanent admin locks everyone out exactly as thoroughly as demoting them.
  it("refuses to disable the permanent admin", () => {
    const res = disableChange(permanent, true, "actor-9");
    expect(res.allowed).toBe(false);
    expect(res.allowed === false && res.reason).toMatch(/permanent admin/i);
    // ...and not with the self-disable wording, which is the other refusal this
    // function can return.
    expect(res.allowed === false && res.reason).not.toMatch(/your own account/i);
  });

  it("refuses to touch the permanent admin even when re-enabling", () => {
    const off: TargetUser = { ...permanent, disabled: true };
    expect(disableChange(off, false, "actor-9").allowed).toBe(false);
  });

  // Scope decision #3: unlike a demotion, this one has no way back for you.
  //
  // Assert the DISTINGUISHING clause, not /permanent admin/. Both branches of
  // disableChange return { allowed: false }, so a reason-match both strings
  // satisfy cannot tell them apart — and no mutation test can catch that,
  // because `allowed` is false either way. The negative assertion is what keeps
  // the two strings disjoint as they get edited.
  it("refuses self-disable, and says so in its own words", () => {
    const self: TargetUser = { id: "actor-9", role: "admin", isPermanentAdmin: false, disabled: false };
    const res = disableChange(self, true, "actor-9");
    expect(res.allowed).toBe(false);
    expect(res.allowed === false && res.reason).toMatch(/your own account/i);
    expect(res.allowed === false && res.reason).not.toMatch(/permanent admin/i);
  });

  it("allows re-enabling yourself, which is unreachable but harmless", () => {
    const self: TargetUser = { id: "actor-9", role: "admin", isPermanentAdmin: false, disabled: true };
    expect(disableChange(self, false, "actor-9")).toEqual({ allowed: true });
  });
});

describe("selfRoleChangeWarning", () => {
  it("is null for another user's row", () => {
    expect(selfRoleChangeWarning(ordinary, "viewer", "actor-9")).toBeNull();
  });

  it("is null when the role isn't actually changing", () => {
    const self: TargetUser = { id: "actor-9", role: "admin", isPermanentAdmin: false, disabled: false };
    expect(selfRoleChangeWarning(self, "admin", "actor-9")).toBeNull();
  });

  it("warns when the actor is changing their own role", () => {
    const self: TargetUser = { id: "actor-9", role: "admin", isPermanentAdmin: false, disabled: false };
    expect(selfRoleChangeWarning(self, "viewer", "actor-9")).toMatch(/signed out/i);
  });

  // The tautology trap: a warning that's merely truthy could be any string.
  // This asserts it actually names the role you're about to land as.
  it("names the incoming role's label, not a raw enum", () => {
    const self: TargetUser = { id: "actor-9", role: "admin", isPermanentAdmin: false, disabled: false };
    expect(selfRoleChangeWarning(self, "viewer", "actor-9")).toMatch(/viewer/i);
  });
});
