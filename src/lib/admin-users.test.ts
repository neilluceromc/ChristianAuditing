import { Role } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  OFFBOARDED_NOTE, PERMANENT_LOCK, ROLE_CARD_OPENS, ROLE_LABELS, ROLE_OPTIONS, ROLE_TABS, USER_STATUSES, USER_STATUS_LABEL,
  accessHistoryHref, accountCreated, canTurnOff, createdLabel, disableChange, emailProblem, groupLabel, lastSignInLabel,
  lockReason, passwordLabel, roleChange, roleChangeNote, roleWorkspaces, selfRoleChangeWarning, turnOffConfirm,
  userStatus, waitingChip, type TargetUser,
} from "./admin-users";
import { ROLE_WORKSPACES, WORKSPACE_META, type WorkspaceId } from "./workspaces";

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

describe("roleWorkspaces", () => {
  // Asserted against ROLE_WORKSPACES's own length, not a hardcoded "4" — the
  // same mistake the ROLE_OPTIONS coverage test above avoids.
  it("names admin's access 'all four' because admin holds every workspace in the table", () => {
    const all = Object.keys(WORKSPACE_META) as WorkspaceId[];
    expect(ROLE_WORKSPACES.admin.length).toBe(all.length);
    expect(roleWorkspaces("admin")).toBe("all four");
  });

  it("joins a narrower role's workspace labels, derived from WORKSPACE_META rather than copied", () => {
    const expected = ROLE_WORKSPACES.purchasing_staff.map((id) => WORKSPACE_META[id].label).join(" · ");
    expect(roleWorkspaces("purchasing_staff")).toBe(expected);
  });

  // viewer shares it_staff's workspace but not its write access (brief §2) —
  // this is the one role the suffix must fire for.
  it("appends a read-only suffix for viewer, on top of the workspace(s) it shares", () => {
    const base = ROLE_WORKSPACES.viewer.map((id) => WORKSPACE_META[id].label).join(" · ");
    expect(roleWorkspaces("viewer")).toBe(`${base} · read-only`);
  });

  it("does not append the read-only suffix for a role that actually has write access", () => {
    expect(roleWorkspaces("it_staff")).not.toMatch(/read-only/);
  });

  it("labels every role with something non-empty", () => {
    for (const role of ROLE_OPTIONS) expect(roleWorkspaces(role)).toBeTruthy();
  });
});

/*
 * Users & access (spec §4.4, Task 3): the rules every admin account action shares.
 */
describe("Users & access rules", () => {
  const actor = { id: "actor-9" };
  const LOCK = "The permanent admin's account can only be changed by its owner.";

  it("lockReason is the permanent admin's lock copy, word for word", () => {
    expect(lockReason(permanent)).toBe(LOCK);
    expect(PERMANENT_LOCK).toBe(LOCK);
  });

  it("every refusal of the permanent admin quotes the lock copy", () => {
    expect(roleChange(permanent, "viewer", "actor-9")).toEqual({ allowed: false, reason: LOCK });
    expect(disableChange(permanent, true, "actor-9")).toEqual({ allowed: false, reason: LOCK });
    expect(canTurnOff(actor, permanent)).toEqual({ allowed: false, reason: LOCK });
  });

  describe("canTurnOff", () => {
    it("allows turning off another ordinary account", () => {
      expect(canTurnOff(actor, ordinary)).toEqual({ allowed: true });
    });

    it("refuses your own account, in its own words", () => {
      const self: TargetUser = { id: "actor-9", role: "admin", isPermanentAdmin: false, disabled: false };
      const res = canTurnOff(actor, self);
      expect(res.allowed).toBe(false);
      expect(res.allowed === false && res.reason).toMatch(/your own account/i);
      expect(res.allowed === false && res.reason).not.toBe(LOCK);
    });

    it("is what disableChange applies when turning an account off", () => {
      const self: TargetUser = { id: "actor-9", role: "admin", isPermanentAdmin: false, disabled: false };
      expect(disableChange(self, true, "actor-9")).toEqual(canTurnOff(actor, self));
    });
  });

  describe("emailProblem", () => {
    it("is null for a well-formed email on the domain, not taken", () => {
      expect(emailProblem("nina@thebackroomop.com", "thebackroomop.com", false)).toBeNull();
    });

    it("is null with no domain restriction", () => {
      expect(emailProblem("nina@gmail.com", null, false)).toBeNull();
    });

    it("refuses a malformed email first", () => {
      expect(emailProblem("nina", "thebackroomop.com", true)).toBe("Enter a valid email.");
    });

    it("refuses an email outside the allowed domain, naming the domain", () => {
      expect(emailProblem("nina@gmail.com", "thebackroomop.com", false)).toBe("Use an @thebackroomop.com address.");
    });

    it("refuses an email another account uses", () => {
      expect(emailProblem("nina@thebackroomop.com", "thebackroomop.com", true)).toBe("Another account already uses that email.");
    });

    it("reads the domain case-insensitively, after trimming", () => {
      expect(emailProblem("  Nina@TheBackroomOp.com ", "thebackroomop.com", false)).toBeNull();
    });
  });

  describe("roleChangeNote", () => {
    it("is the verbatim note, with the first name, both role labels and what each opens", () => {
      expect(roleChangeNote("Nina Reyes", "it_staff", "finance_staff")).toBe(
        "Moves Nina from IT staff to Finance staff: opens Finance instead of IT. They're signed out when you save.",
      );
    });

    it("says 'all four workspaces' for admin", () => {
      expect(roleChangeNote("Nina Reyes", "viewer", "admin")).toBe(
        "Moves Nina from Viewer to Admin: opens all four workspaces instead of IT · read-only. They're signed out when you save.",
      );
    });

    it("is null when the role isn't changing", () => {
      expect(roleChangeNote("Nina Reyes", "viewer", "viewer")).toBeNull();
    });
  });

  describe("userStatus", () => {
    const row = { approvalState: "APPROVED" as const, disabled: false, mustChangePassword: false };

    it("checks the approval state first, then disabled, then the owed password", () => {
      expect(userStatus({ ...row, approvalState: "PENDING", disabled: true, mustChangePassword: true })).toBe("PENDING");
      expect(userStatus({ ...row, approvalState: "DECLINED", disabled: true })).toBe("DECLINED");
      expect(userStatus({ ...row, disabled: true, mustChangePassword: true })).toBe("DISABLED");
      expect(userStatus({ ...row, mustChangePassword: true })).toBe("MUST_SET_PASSWORD");
      expect(userStatus(row)).toBe("ACTIVE");
    });

    it("labels the five statuses word for word", () => {
      expect(USER_STATUS_LABEL).toEqual({
        PENDING: "Waiting for approval",
        ACTIVE: "Active",
        MUST_SET_PASSWORD: "Must set password",
        DISABLED: "Disabled",
        DECLINED: "Declined",
      });
      expect(USER_STATUSES).toEqual(["PENDING", "ACTIVE", "MUST_SET_PASSWORD", "DISABLED", "DECLINED"]);
    });
  });

  it("groupLabel names a client group 'Client: X' and a department by its name", () => {
    expect(groupLabel({ name: "Finance", kind: "INTERNAL" })).toBe("Finance");
    expect(groupLabel({ name: "Acme", kind: "CLIENT" })).toBe("Client: Acme");
  });
});

describe("Users & access page words (spec §4.4, Task 4)", () => {
  // 2026-10-24 10:30 in Manila (UTC+8).
  const now = new Date("2026-10-24T02:30:00Z");

  it("the role tabs: All, then each role's short name, in ROLE_OPTIONS order", () => {
    expect(ROLE_TABS.map((t) => t.label)).toEqual(["All", "Admin", "IT", "Purchasing", "Finance", "Viewer"]);
    expect(ROLE_TABS.map((t) => t.role)).toEqual([null, ...ROLE_OPTIONS]);
  });

  it("each role card names the workspaces the role opens", () => {
    for (const role of ROLE_OPTIONS) {
      const opens = ROLE_CARD_OPENS[role];
      if (role === "admin") expect(opens).toMatch(/^Every workspace/);
      else for (const id of ROLE_WORKSPACES[role]) expect(opens).toContain(WORKSPACE_META[id].label);
    }
    expect(ROLE_CARD_OPENS.viewer).toMatch(/read-only/);
  });

  it("last sign-in: Never, today with the Manila time, yesterday, days ago, then the date", () => {
    expect(lastSignInLabel(null, now)).toBe("Never");
    expect(lastSignInLabel("2026-10-24T01:12:00Z", now)).toBe("Today 09:12");
    // 23:50 on the 23rd in Manila is yesterday there, though it is the 23rd in UTC too
    expect(lastSignInLabel("2026-10-23T15:50:00Z", now)).toBe("Yesterday");
    // 07:00 on the 24th in Manila is 23:00 on the 23rd in UTC: still today in Manila
    expect(lastSignInLabel("2026-10-23T23:00:00Z", now)).toBe("Today 07:00");
    expect(lastSignInLabel("2026-10-21T03:00:00Z", now)).toBe("3 days ago");
    expect(lastSignInLabel("2026-09-14T03:00:00Z", now)).toBe("14 Sep 2026");
  });

  it("password: temporary with the date it was given, set by them, or SSO only", () => {
    const at = "2026-10-23T03:00:00Z";
    expect(passwordLabel({ signIn: "credentials", mustChangePassword: true, passwordChangedAt: at })).toBe("Temporary, given 23 Oct");
    expect(passwordLabel({ signIn: "credentials", mustChangePassword: false, passwordChangedAt: at })).toBe("Set by them, 23 Oct");
    expect(passwordLabel({ signIn: "credentials", mustChangePassword: false, passwordChangedAt: null })).toBe("Set by them");
    expect(passwordLabel({ signIn: "SSO only", mustChangePassword: false, passwordChangedAt: null })).toBe("None — signs in with SSO");
  });

  it("created: the date, and the admin who created it when one did", () => {
    expect(createdLabel("2026-09-01T03:00:00Z", "M. Cruz")).toBe("1 Sep 2026 by M. Cruz");
    expect(createdLabel("2026-09-01T03:00:00Z", null)).toBe("1 Sep 2026");
  });

  it("the verbatim copy", () => {
    expect(turnOffConfirm("Nina Reyes")).toBe(
      "Turn off Nina Reyes's account? They're signed out now and can't sign in. Their history stays.",
    );
    expect(accountCreated("Ana Lim")).toBe("Account created for Ana Lim — give them the temporary password");
    expect(waitingChip(3)).toBe("Waiting for approval · 3");
    expect(OFFBOARDED_NOTE).toBe("Employee offboarded");
  });

  it("the access history link is the Activity page filtered to that user's entries", () => {
    expect(accessHistoryHref("clx0abc")).toBe("/audit?entity=user&q=clx0abc");
  });
});
