import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { UserRow } from "@/server/modules/admin/queries";

/*
 * Users & access (spec §4.4, Task 4; boards Users2, Tablet2, Phone2): the list, its filters, the details panel by
 * kind of account, Add user and the temporary-password box. Node only (no DOM), so each state is rendered through
 * its props; the clicks themselves are Task 5's e2e.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/admin/users",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/server/modules/admin/user-actions", () => ({
  createUser: vi.fn(), updateUser: vi.fn(), resetUserPassword: vi.fn(), setUserDisabled: vi.fn(),
  approveSignup: vi.fn(), declineSignup: vi.fn(), setUserRole: vi.fn(),
}));
vi.mock("@/server/modules/admin/employee-link-search", () => ({ searchLinkableEmployees: vi.fn() }));

import { PERMANENT_LOCK, ROLE_CARD_OPENS, ROLE_OPTIONS, USER_STATUSES, USER_STATUS_LABEL } from "@/lib/admin-users";
import { UserStatusLabel } from "./user-status";
import { WaitingChip } from "./waiting-chip";
import { UsersToolbar } from "./users-toolbar";
import { UsersTable } from "./users-table";
import { UserPanel, type UserPanelProps } from "./user-panel";
import { AddUserForm } from "./add-user-sheet";
import { TempPasswordBox } from "./temp-password-box";
import { ResetPasswordBody } from "./reset-password-dialog";

/** The markup with React's entity escapes undone, so verbatim copy can be matched as written. */
const text = (html: string) =>
  html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
const render = (node: React.ReactNode) => text(renderToStaticMarkup(node));

const NOW = "2026-10-24T02:30:00.000Z";

function userRow(over: Partial<UserRow> = {}): UserRow {
  const id = over.id ?? "nina";
  return {
    id, name: "Nina Reyes", email: "nina@thebackroomop.com", role: "it_staff", disabled: false, locked: null,
    signIn: "credentials", workspaces: "IT",
    target: { id, role: over.role ?? "it_staff", isPermanentAdmin: !!over.locked, disabled: over.disabled ?? false },
    status: "ACTIVE", statusLabel: "Active", approvalState: "APPROVED",
    employee: { id: "emp-1", employeeNo: "EMP-1042", name: "Nina Reyes", groupLabel: "IT", offboarded: false },
    lastSignInAt: "2026-10-24T01:12:00.000Z", passwordChangedAt: "2026-09-04T03:00:00.000Z", mustChangePassword: false,
    createdAt: "2026-09-03T03:00:00.000Z", createdByName: "M. Cruz", updatedAt: "2026-10-20T03:00:00.000Z",
    ...over,
  };
}

const pending = (over: Partial<UserRow> = {}) =>
  userRow({
    id: "ana", name: "Ana Lim", email: "ana.lim@thebackroomop.com", role: "viewer", disabled: true, status: "PENDING",
    statusLabel: "Waiting for approval", approvalState: "PENDING", employee: null, lastSignInAt: null,
    createdByName: null, ...over,
  });

const permanent = () =>
  userRow({ id: "perm", name: "System Admin", email: "admin@thebackroomop.com", role: "admin", locked: PERMANENT_LOCK });

const noop = () => {};
function panel(props: Partial<UserPanelProps> & { row: UserRow }) {
  return render(
    <UserPanel
      actorId="admin-1" now={NOW} busy={false} notice={null} onSave={noop} onSetActive={noop} onReset={noop}
      onApprove={noop} onDecline={noop} {...props}
    />,
  );
}

describe("the list and its filters", () => {
  it("every status is a dot plus its words; waiting uses the attention tone", () => {
    for (const status of USER_STATUSES) {
      const html = render(<UserStatusLabel status={status} />);
      expect(html).toContain(USER_STATUS_LABEL[status]);
      expect(html).toContain(`data-user-status="${status}"`);
      expect(html).toMatch(/data-status-dot/);
    }
    expect(render(<UserStatusLabel status="PENDING" />)).toContain("var(--st-attention-text)");
    // Disabled and Declined stay neutral, never red.
    for (const status of ["DISABLED", "DECLINED"] as const) expect(render(<UserStatusLabel status={status} />)).not.toContain("fault");
  });

  it("the waiting chip shows only while sign-ups wait, and opens that filter", () => {
    expect(render(<WaitingChip count={0} active={false} />)).toBe("");
    const html = render(<WaitingChip count={3} active={false} />);
    expect(html).toContain("Waiting for approval · 3");
    expect(html).toContain('href="/admin/users?status=PENDING"');
  });

  it("role tabs carry their counts (All is the sum), and the current one is marked; a select stands in on a phone", () => {
    const html = render(
      <UsersToolbar
        filter={{ role: "it_staff", status: null, q: "", disabled: null }}
        roleCounts={{ admin: 2, it_staff: 4, purchasing_staff: 1, finance_staff: 3, viewer: 0 }}
      />,
    );
    for (const [label, n] of [["All", 10], ["Admin", 2], ["IT", 4], ["Purchasing", 1], ["Finance", 3], ["Viewer", 0]] as const) {
      expect(html).toMatch(new RegExp(`>${label}</span><span[^>]*>${n}</span>`));
    }
    expect(html).toMatch(/aria-current="page"[^>]*href="\/admin\/users\?role=it_staff"|href="\/admin\/users\?role=it_staff"[^>]*aria-current="page"/);
    expect(html).toContain('href="/admin/users"'); // All drops the role
    expect(html).toContain("All (10)"); // the phone's select
    expect(html).toContain("IT (4)");
    expect(html).toContain("Any status");
    for (const status of USER_STATUSES) expect(html).toContain(`<option value="${status}">${USER_STATUS_LABEL[status]}</option>`);
    expect(html).toContain('aria-label="Search users"');
  });

  it("the old ?disabled=0 filter shows as a chip that can be removed", () => {
    const html = render(
      <UsersToolbar
        filter={{ role: null, status: null, q: "", disabled: false }}
        roleCounts={{ admin: 0, it_staff: 0, purchasing_staff: 0, finance_staff: 0, viewer: 0 }}
      />,
    );
    expect(html).toContain("Can sign in");
  });

  it("rows show the person, role, employee record, status and last sign-in; a phone gets the card list", () => {
    const rows = [
      userRow(),
      pending(),
      userRow({ id: "off", name: "Liza Ong", employee: { id: "e9", employeeNo: "EMP-1012", name: "Liza Ong", groupLabel: "Client: Acme", offboarded: true } }),
    ];
    const html = render(<UsersTable rows={rows} selectedId="nina" onSelect={noop} now={NOW} filtered={false} />);
    expect(html).toContain("<table");
    expect(html).toContain("EMP-1042");
    expect(html).toContain("Client: Acme");
    expect(html).toContain("Employee offboarded");
    expect(html).toContain("Today 09:12");
    expect(html).toContain("Never");
    expect(html).toContain("Waiting for approval");
    expect(html).toContain('aria-selected="true"');
    // The narrow layout's cards: one per row, each a button naming the person.
    expect(html.match(/data-user-card=/g)).toHaveLength(3);
    expect(html).toContain("IT staff · IT");
    expect(html).toContain("Viewer · No employee record");
  });

  it("an empty filtered list says so", () => {
    const html = render(<UsersTable rows={[]} selectedId={null} onSelect={noop} now={NOW} filtered />);
    expect(html).toContain("No one matches");
    expect(html).toContain("Try another name or clear the filters.");
  });
});

describe("the details panel, by kind of account", () => {
  it("an approved account: Access, Employee record, Name & email, Sign-in, Account and the history link", () => {
    const html = panel({ row: userRow() });
    for (const heading of ["Access", "Employee record", "Name & email", "Sign-in", "Account"]) expect(html).toContain(heading);
    for (const role of ROLE_OPTIONS) expect(html).toContain(ROLE_CARD_OPENS[role]);
    expect(html).toContain("Reset password…");
    expect(html).toContain("Set by them, 4 Sep");
    expect(html).toContain("3 Sep 2026 by M. Cruz");
    expect(html).toContain("See this person's access history →");
    expect(html).toContain('href="/audit?entity=user&q=nina"');
    expect(html).not.toContain("Approve sign-up");
  });

  it("a waiting sign-up gets Approve sign-up (role defaults to Viewer, employee pre-searched) and no switch", () => {
    const html = panel({ row: pending() });
    expect(html).toContain("Approve sign-up");
    expect(html).toContain("Signed up 3 Sep 2026");
    expect(html).toMatch(/>Approve</);
    expect(html).toMatch(/>Decline</);
    expect(html).toMatch(/value="viewer"[^>]*checked=""|checked=""[^>]*value="viewer"/);
    expect(html).toContain('value="Ana Lim"'); // the employee search, pre-searched with their name
    expect(html).not.toContain('role="switch"');
    expect(html).not.toContain("Reset password…");
    expect(html).not.toContain(">Sign-in<");
  });

  it("a declined sign-up can still be approved, but not declined again", () => {
    const html = panel({ row: pending({ status: "DECLINED", statusLabel: "Declined", approvalState: "DECLINED" }) });
    expect(html).toContain("Approve sign-up");
    expect(html).toMatch(/>Approve</);
    expect(html).not.toMatch(/>Decline</);
    expect(html).not.toContain('role="switch"');
  });

  it("Decline asks once", () => {
    const html = panel({ row: pending(), initial: { confirmingDecline: true } });
    expect(html).toContain("Decline Ana Lim's sign-up?");
    expect(html).toMatch(/>Decline sign-up</);
  });

  it("the permanent admin's panel states the lock; the switch, Reset and the edits are disabled", () => {
    const html = panel({ row: permanent() });
    expect(html).toContain(PERMANENT_LOCK);
    expect(html).toMatch(/role="switch"[^>]*disabled=""/);
    expect(html).toMatch(/disabled=""[^>]*>(<span[^>]*>)?Reset password…/);
    expect(html).not.toMatch(/>Edit</);
    expect(html.match(/type="radio"[^>]*disabled=""/g)?.length).toBe(5);
  });

  it("your own panel: the switch is disabled with the reason, and Reset points at Account settings", () => {
    const html = panel({ row: userRow({ id: "admin-1", name: "M. Cruz", role: "admin" }) });
    expect(html).toMatch(/role="switch"[^>]*disabled=""/);
    expect(html).toContain("You can't turn off your own account");
    expect(html).toContain("Change your own password in Account settings.");
    expect(html).toContain('href="/settings/account"');
  });
});

describe("the panel's copy", () => {
  it("picking another role shows the verbatim role-change note", () => {
    const html = panel({ row: userRow(), initial: { draft: { role: "finance_staff" } } });
    expect(html).toContain(
      "Moves Nina from IT staff to Finance staff: opens Finance instead of IT. They're signed out when you save.",
    );
  });

  it("changing your own role also warns you'll be signed out", () => {
    const html = panel({ row: userRow({ id: "admin-1", name: "M. Cruz", role: "admin" }), initial: { draft: { role: "viewer" } } });
    expect(html).toContain("You're changing your own role");
  });

  it("a linked employee who is offboarding shows the amber note", () => {
    const row = userRow({ employee: { id: "emp-1", employeeNo: "EMP-1042", name: "Nina Reyes", groupLabel: "IT", offboarded: true } });
    const html = panel({ row });
    expect(html).toContain("Employee offboarded");
    expect(html).toContain("var(--st-attention-text)");
  });

  it("the Unsaved changes bar shows only while a field differs", () => {
    expect(panel({ row: userRow() })).not.toContain("Unsaved changes");
    expect(panel({ row: userRow(), initial: { draft: { role: "it_staff", name: "Nina Reyes" } } })).not.toContain("Unsaved changes");
    for (const draft of [{ role: "viewer" as const }, { name: "Nina B. Reyes" }, { email: "nina.reyes@thebackroomop.com" }, { employee: null }]) {
      const html = panel({ row: userRow(), initial: { draft } });
      expect(html).toContain("Unsaved changes");
      expect(html).toMatch(/>Discard</);
      expect(html).toMatch(/>Save</);
    }
  });

  it("Name & email edit inline, with each field's error", () => {
    const html = panel({
      row: userRow(),
      initial: { editingName: true },
      notice: { fieldErrors: { email: "Use an @thebackroomop.com address." } },
    });
    expect(html).toContain('value="Nina Reyes"');
    expect(html).toContain('value="nina@thebackroomop.com"');
    expect(html).toContain("Use an @thebackroomop.com address.");
  });

  it("a refusal shows in the panel", () => {
    const html = panel({ row: userRow(), notice: { message: "Changed by someone else since — try again" } });
    expect(html).toContain("Changed by someone else since — try again");
  });

  it("turning the account off asks inline first, with the verbatim copy", () => {
    const html = panel({ row: userRow(), initial: { confirmingOff: true } });
    expect(html).toContain("Turn off Nina Reyes's account? They're signed out now and can't sign in. Their history stays.");
    expect(html).toMatch(/>Turn off account</);
    expect(html).toMatch(/>Cancel</);
  });
});

describe("accessibility", () => {
  it("the account switch is a labelled switch reporting its state", () => {
    const on = panel({ row: userRow() });
    expect(on).toMatch(/role="switch"[^>]*aria-checked="true"[^>]*aria-label="Account active"/);
    const off = panel({ row: userRow({ disabled: true, status: "DISABLED", statusLabel: "Disabled" }) });
    expect(off).toMatch(/role="switch"[^>]*aria-checked="false"/);
    expect(off).not.toMatch(/role="switch"[^>]*disabled=""/); // turning it back on needs no confirm and is allowed
  });

  it("the panel is named by the person's name", () => {
    const html = panel({ row: userRow() });
    expect(html).toMatch(/<h2 id="([^"]+)"[^>]*>Nina Reyes<\/h2>/);
  });

  it("a Close button appears only when the panel is a drawer", () => {
    expect(panel({ row: userRow() })).not.toContain('aria-label="Close details"');
    expect(panel({ row: userRow(), onClose: noop })).toContain('aria-label="Close details"');
  });
});

describe("Add user and the temporary password", () => {
  it("the sheet shows the domain in the email hint and the five role cards", () => {
    const html = render(<AddUserForm domain="thebackroomop.com" onClose={noop} onCreated={noop} />);
    expect(html).toContain("Full name");
    expect(html).toContain("Work email");
    expect(html).toContain("It must be a @thebackroomop.com address.");
    expect(html.match(/type="radio"/g)).toHaveLength(5);
    for (const role of ROLE_OPTIONS) expect(html).toContain(ROLE_CARD_OPENS[role]);
    expect(html).toContain("Employee record");
    expect(html).toMatch(/>Create account</);
  });

  it("without a domain rule, the hint names none", () => {
    expect(render(<AddUserForm domain={null} onClose={noop} onCreated={noop} />)).not.toContain("It must be a @");
  });

  it("once created, the sheet confirms with the verbatim line and shows the password with Copy", () => {
    const html = render(
      <AddUserForm domain="thebackroomop.com" onClose={noop} onCreated={noop} initialDone={{ id: "u9", name: "Ana Lim", tempPassword: "Maple-4207-river" }} />,
    );
    expect(html).toContain("Account created for Ana Lim — give them the temporary password");
    expect(html).toContain('value="Maple-4207-river"');
    expect(html).toMatch(/>Copy</);
    expect(html).toMatch(/>Done</);
  });

  it("the temporary-password box has Copy, and says Copied ✓ once copied", () => {
    const html = render(<TempPasswordBox password="Cedar-3388-lumen" />);
    expect(html).toContain('value="Cedar-3388-lumen"');
    expect(html).toContain("readOnly");
    expect(html).toMatch(/>Copy</);
    expect(render(<TempPasswordBox password="Cedar-3388-lumen" copiedDefault />)).toContain("Copied ✓");
  });

  it("Reset asks first, then shows the password once", () => {
    const ask = render(<ResetPasswordBody name="Nina Reyes" temp={null} error={null} />);
    expect(ask).toContain("Their current password stops working and they're signed out everywhere.");
    const done = render(<ResetPasswordBody name="Nina Reyes" temp="Cedar-3388-lumen" error={null} />);
    expect(done).toContain('value="Cedar-3388-lumen"');
    expect(done).toContain("Shown once. They choose their own at their next sign-in.");
  });
});

/** Every button and link opening tag in `html` whose class gives it no 44 px target. */
function smallTargets(html: string): string[] {
  const tags = html.match(/<(button|a)\b[^>]*>/g) ?? [];
  expect(tags.length).toBeGreaterThan(0); // never vacuous
  return tags.filter((tag) => {
    if (tag.includes('role="switch"')) return !tag.includes("before:-inset-y-[13px]");
    return !/(^|[\s"])(h-11|size-11|min-h-11|min-h-\[44px\])[\s"]/.test(tag);
  });
}

describe("fix round 1, I-2: every target in the panel, the sheet and the dialogs is at least 44 px", () => {
  it("the panel, in each of its shapes", () => {
    const shapes = [
      panel({ row: userRow(), onClose: noop }),
      panel({ row: userRow(), initial: { draft: { role: "viewer" }, confirmingOff: true, editingName: true, picking: true } }),
      panel({ row: userRow({ employee: null }) }),
      panel({ row: userRow({ id: "admin-1", name: "M. Cruz", role: "admin" }) }),
      panel({ row: pending() }),
      panel({ row: pending(), initial: { confirmingDecline: true } }),
      panel({ row: userRow(), leaving: true, initial: { draft: { role: "viewer" } } }),
    ];
    for (const html of shapes) expect(smallTargets(html)).toEqual([]);
  });

  it("Add user, before and after creating, and the reset dialog's password", () => {
    expect(smallTargets(render(<AddUserForm domain="thebackroomop.com" onClose={noop} onCreated={noop} />))).toEqual([]);
    expect(
      smallTargets(render(<AddUserForm domain={null} onClose={noop} onCreated={noop} initialDone={{ id: "u", name: "A", tempPassword: "Maple-4207-river" }} />)),
    ).toEqual([]);
    expect(smallTargets(render(<ResetPasswordBody name="Nina Reyes" temp="Cedar-3388-lumen" error={null} />))).toEqual([]);
  });
});

describe("fix round 1, I-1: focus targets in the inline steps", () => {
  it("the turn-off confirm puts Cancel first and the switch stays enabled (focus never falls off it)", () => {
    const html = panel({ row: userRow(), initial: { confirmingOff: true } });
    expect(html.indexOf('data-focus="turn-off-cancel"')).toBeGreaterThan(-1);
    expect(html.indexOf('data-focus="turn-off-cancel"')).toBeLessThan(html.indexOf("Turn off account"));
    expect(html).not.toMatch(/role="switch"[^>]*disabled=""/);
    expect(html).toContain('data-focus="switch"');
  });

  it("the decline confirm puts Cancel first; Decline, Approve, Edit, Change and the title are targets", () => {
    const html = panel({ row: pending(), initial: { confirmingDecline: true } });
    expect(html.indexOf('data-focus="decline-cancel"')).toBeLessThan(html.indexOf("Decline sign-up"));
    const closed = panel({ row: pending() });
    for (const name of ["decline", "approve", "edit", "title"]) expect(closed).toContain(`data-focus="${name}"`);
    expect(panel({ row: userRow() })).toContain('data-focus="pick"');
  });

  it("the name fields, the employee search and Save carry their targets", () => {
    expect(panel({ row: userRow(), initial: { editingName: true } })).toContain('data-focus="name"');
    expect(panel({ row: userRow(), initial: { picking: true } })).toContain('data-focus="pick-search"');
    expect(panel({ row: userRow(), initial: { draft: { role: "viewer" } } })).toContain('data-focus="save"');
  });
});

describe("fix round 1, Minor 5: unsaved drafts are never dropped silently", () => {
  it("moving to another person while drafts differ asks first, instead of the Save bar", () => {
    const html = panel({ row: userRow(), leaving: true, initial: { draft: { role: "viewer" } } });
    expect(html).toContain("Discard unsaved changes?");
    expect(html).toMatch(/>Keep editing</);
    expect(html).toMatch(/>Discard</);
    expect(html).not.toContain('aria-label="Unsaved changes"');
    // with nothing drafted there is nothing to ask
    expect(panel({ row: userRow(), leaving: true })).not.toContain("Discard unsaved changes?");
  });

  it("a refresh that changed the row while drafts differ asks, naming the change", () => {
    const base = userRow();
    const fresher = userRow({ updatedAt: "2026-10-21T03:00:00.000Z", disabled: true, status: "DISABLED", statusLabel: "Disabled" });
    const html = panel({ row: fresher, initial: { base, draft: { role: "viewer" } } });
    expect(html).toContain("Nina Reyes's account changed since you started editing. Discard unsaved changes?");
  });

  it("a refresh that matches the drafts (our own save) is taken over silently", () => {
    const base = userRow();
    const saved = userRow({ role: "viewer", updatedAt: "2026-10-21T03:00:00.000Z" });
    const html = panel({ row: saved, initial: { base, draft: { role: "viewer" } } });
    expect(html).not.toContain("Discard unsaved changes?");
    expect(html).not.toContain("Unsaved changes");
  });
});

