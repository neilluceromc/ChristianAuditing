import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

/* Users & access (spec §4.3, §4.5; boards PhoneFirst2, Account2, PhoneAccount2): the shared password fields, the
 * first-sign-in form and the two Account settings cards. */

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/server/modules/account/actions", () => ({ setOwnPassword: vi.fn(), changeOwnPassword: vi.fn() }));

import { PasswordChecklist, PasswordFields, PasswordInput } from "./password-fields";
import { FirstPasswordForm } from "./first-password-form";
import { AccountPasswordCard } from "./account-password-card";
import { YourAccountCard } from "./your-account-card";

const noop = () => {};

describe("PasswordChecklist", () => {
  it("marks each rule met or not, live", () => {
    const html = renderToStaticMarkup(
      <PasswordChecklist checks={{ long: true, mixed: false, fresh: true }} freshLabel="Not your current password" />,
    );
    expect(html).toContain("At least 10 characters");
    expect(html).toContain("Letters and at least one number");
    expect(html).toContain("Not your current password");
    expect(html.match(/data-met="true"/g)).toHaveLength(2);
    expect(html.match(/data-met="false"/g)).toHaveLength(1);
    expect(html).toContain("✓");
    expect(html).toContain("○");
    // Read out as met / not met, not as the glyphs.
    expect(html).toContain("Met: ");
    expect(html).toContain("Not met: ");
  });

  it("a rule the browser can't check (the temporary password) shows as checked on save, never as met", () => {
    const html = renderToStaticMarkup(
      <PasswordChecklist checks={{ long: true, mixed: true, fresh: true }} freshLabel="Not the temporary password" freshUnknown />,
    );
    expect(html.match(/data-met="true"/g)).toHaveLength(2);
    expect(html).toContain('data-met="unknown"');
    expect(html).toContain("Checked when you save");
  });
});

describe("PasswordInput", () => {
  it("is hidden by default, with a Show button", () => {
    const html = renderToStaticMarkup(<PasswordInput label="New password" name="password" value="" onChange={noop} autoComplete="new-password" />);
    expect(html).toContain('type="password"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toMatch(/>Show</);
  });

  it("Show turns the field into plain text and the button into Hide", () => {
    const html = renderToStaticMarkup(
      <PasswordInput label="New password" name="password" value="" onChange={noop} autoComplete="new-password" defaultShown />,
    );
    expect(html).toContain('type="text"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toMatch(/>Hide</);
  });

  it("shows its error under the field", () => {
    const html = renderToStaticMarkup(
      <PasswordInput label="Current password" name="current" value="" onChange={noop} autoComplete="current-password" error="That isn't your current password" />,
    );
    expect(html).toContain("That isn&#x27;t your current password");
    expect(html).toContain('aria-invalid="true"');
  });
});

describe("PasswordFields", () => {
  it("first sign-in: New password and Type it again, no current password", () => {
    const html = renderToStaticMarkup(
      <PasswordFields mode="first" values={{ current: "", password: "", confirm: "" }} onChange={noop} errors={{}} />,
    );
    expect(html).toContain("New password");
    expect(html).toContain("Type it again");
    expect(html).not.toContain("Current password");
    expect(html).toContain("Not the temporary password");
  });

  it("Account settings: Current, New and Again, the fresh rule checked against the current one", () => {
    const html = renderToStaticMarkup(
      <PasswordFields mode="change" values={{ current: "old-pass-12", password: "old-pass-12", confirm: "" }} onChange={noop} errors={{}} />,
    );
    expect(html).toContain("Current password");
    expect(html).toContain("New password");
    expect(html).toContain("Type it again");
    expect(html).toContain("Not your current password");
    // long and mixed met; fresh not (same as current)
    expect(html.match(/data-met="true"/g)).toHaveLength(2);
    expect(html.match(/data-met="false"/g)).toHaveLength(1);
  });
});

describe("FirstPasswordForm", () => {
  it("offers Save and continue", () => {
    const html = renderToStaticMarkup(<FirstPasswordForm />);
    expect(html).toContain("Save and continue");
    expect(html).toContain("Type it again");
  });
});

describe("YourAccountCard (read-only)", () => {
  const base = {
    name: "Nina Reyes",
    email: "nina.reyes@thebackroomop.com",
    role: "finance_staff" as const,
    createdAt: new Date("2026-10-03T02:00:00Z"),
  };

  it("shows initials, name, email, role with what it opens, the employee record, who created it, and the help line", () => {
    const html = renderToStaticMarkup(
      <YourAccountCard {...base} employee={{ name: "Nina Reyes", employeeNo: "EMP-0042" }} createdByName="M. Cruz" />,
    );
    expect(html).toContain(">NR<");
    expect(html).toContain("Nina Reyes");
    expect(html).toContain("nina.reyes@thebackroomop.com");
    expect(html).toContain("Finance staff");
    expect(html).toContain("Opens Finance");
    expect(html).toContain("EMP-0042");
    expect(html).toContain("Account created 3 Oct 2026 by M. Cruz");
    expect(html).toContain("Something here wrong? Ask an admin to change it.");
    expect(html).not.toContain("<input");
  });

  it("an unlinked account and one nobody created (a sign-up) read plainly", () => {
    const html = renderToStaticMarkup(<YourAccountCard {...base} role="admin" employee={null} createdByName={null} />);
    expect(html).toContain("Not linked");
    expect(html).toContain("Account created 3 Oct 2026");
    expect(html).not.toContain(" by ");
    expect(html).toContain("Opens all four workspaces");
  });

  it("a viewer's role says read-only", () => {
    expect(renderToStaticMarkup(<YourAccountCard {...base} role="viewer" employee={null} createdByName={null} />)).toContain(
      "Opens IT · read-only",
    );
  });
});

describe("AccountPasswordCard", () => {
  it("shows when the password last changed and a Change password button; the form starts closed", () => {
    const html = renderToStaticMarkup(<AccountPasswordCard passwordChangedAt="2026-10-20T03:00:00.000Z" />);
    expect(html).toContain("Password");
    expect(html).toContain("Last changed 20 Oct 2026");
    expect(html).toContain("Change password");
    expect(html).not.toContain("Current password");
  });

  it("a password never changed says so", () => {
    expect(renderToStaticMarkup(<AccountPasswordCard passwordChangedAt={null} />)).toContain("Not changed since the account was created");
  });
});
