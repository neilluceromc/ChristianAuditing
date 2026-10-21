import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Step } from "./login-steps";

// The real actions pull in next-auth and Prisma; the card only needs their identities.
const h = vi.hoisted(() => ({
  signUp: async () => ({}),
  /** When set, the sign-up form reports this state, standing in for a finished server action (static render runs no effects). */
  signupState: null as null | { created?: boolean; pendingApproval?: boolean },
}));
vi.mock("@/server/auth/actions", () => ({
  signInWithCredentials: async () => ({}),
  signUp: h.signUp,
  quickSignIn: async () => {},
}));
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useActionState: ((action: unknown, initial: unknown) => {
      const [state, run, pending] = (actual.useActionState as (a: unknown, i: unknown) => [unknown, unknown, boolean])(action, initial);
      return action === h.signUp && h.signupState ? [h.signupState, run, pending] : [state, run, pending];
    }) as typeof actual.useActionState,
  };
});

const { SignInCard } = await import("./sign-in-card");
type Props = Parameters<typeof SignInCard>[0];

function render(step: Step, overrides: Partial<Props> = {}): string {
  return renderToStaticMarkup(
    <SignInCard
      step={step}
      onStep={() => {}}
      domain="thebackroomop.com"
      next="/employees"
      microsoftAction={null}
      viewerLanding="/inventory"
      {...overrides}
    />,
  );
}

const ids = (html: string) => [...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);

describe("SignInCard", () => {
  it("is the page's <main>, labelled by the current step's focusable h1", () => {
    for (const step of ["login", "signup-name", "signup-password", "signup-done"] as Step[]) {
      const html = render(step);
      expect(html.startsWith("<main")).toBe(true);
      const labelledBy = html.match(/<main[^>]* aria-labelledby="([^"]+)"/)?.[1];
      expect(labelledBy).toBeTruthy();
      expect(html).toMatch(new RegExp(`<h1 id="${labelledBy}" tabindex="-1"`));
      expect(html.match(/<h1/g)).toHaveLength(1);
      expect(new Set(ids(html)).size).toBe(ids(html).length);
      expect(html).not.toContain("required");
    }
  });

  it("sign-in: one form with Work email, Password and next; no wordmark, no progress", () => {
    const html = render("login");
    expect(html).toContain("Welcome back");
    expect(html).toContain("Sign in to your Cris workspace.");
    expect(html).not.toContain("lw-wordmark");
    expect(html).not.toContain("lw-segs");
    expect(html.match(/<form/g)).toHaveLength(1);
    expect(html).toContain(">Work email</label>");
    expect(html).toMatch(/<input[^>]* type="email" autoComplete="username"[^>]* name="email"/);
    expect(html).toContain('placeholder="name@thebackroomop.com"');
    expect(html).toContain(">Password</label>");
    expect(html).toContain('autoComplete="current-password"');
    expect(html).toContain('<input type="hidden" name="next" value="/employees"/>');
    expect(html).toMatch(/>Log in<\/span><\/button>/);
    expect(html).not.toContain(">Continue");
    expect(render("login", { domain: null })).toContain('placeholder="name@company.com"');
  });

  it("sign-in: Show, Forgot password and the admin hint, the sign-up link and the domain line", () => {
    const html = render("login");
    expect(html).toContain('aria-pressed="false"');
    expect(html).toMatch(/>Show<\/button>/);
    expect(html).toMatch(/<button type="button" class="lw-link lw-forgot" aria-expanded="false" aria-controls="([^"]+)">Forgot password\?<\/button>/);
    const hintId = html.match(/aria-controls="([^"]+)">Forgot password\?/)![1];
    expect(html).toContain(`<p id="${hintId}" class="lw-hint" hidden="">Forgot your password? Ask an admin for help.</p>`);
    expect(html).toContain("New to Cris?");
    expect(html).toMatch(/<a href="\/signup" class="lw-link">Create an account<\/a>/);
    expect(html).toContain("Access is limited to @thebackroomop.com accounts.");
    expect(render("login", { domain: null })).not.toContain("Access is limited");
  });

  it("sign-in: Microsoft on top, then the email divider, when on", () => {
    const html = render("login", { microsoftAction: async () => {} });
    expect(html).toContain("Continue with Microsoft");
    expect(html).toContain("or sign in with email");
    expect(html.indexOf("Continue with Microsoft")).toBeLessThan(html.indexOf(">Work email</label>"));
    expect(html.match(/<form/g)).toHaveLength(2);
    expect(render("login")).not.toContain("Continue with Microsoft");
  });

  it("Sign up 1 and 2: one form with name, email and password, segment bars", () => {
    const one = render("signup-name");
    expect(one).toContain("Sign up · 1 of 3");
    expect(one).toContain('aria-label="Back to sign in"');
    expect(one).toContain("Create your account");
    expect(one).toContain(">Full name</label>");
    expect(one).toContain('autoComplete="name"');
    expect(one).toContain('placeholder="Juan dela Cruz"');
    expect(one).toContain('autoComplete="email"');
    expect(one).toContain("Already have an account?");
    expect(one).toContain('href="/login?step=login&amp;next=%2Femployees"');
    expect(one).not.toContain('name="next"');
    expect(one).toContain('class="lw-seg lw-seg-on"');
    expect(one.match(/class="lw-seg[ "]/g)).toHaveLength(3);

    const two = render("signup-password");
    expect(two).toContain("Sign up · 2 of 3");
    expect(two).toContain("Choose a password");
    expect(two).toContain('autoComplete="new-password"');
    expect(two).toContain("At least 10 characters");
    expect(two).toMatch(/>Create account<\/span><\/button>/);
    expect(two).not.toContain("Forgot password?");
    for (const name of ["name", "email", "password"]) expect(two).toContain(`name="${name}"`);
  });

  it("Sign up 3: You're in, Viewer, Go to Cris links to the viewer landing", () => {
    const html = render("signup-done");
    expect(html).toContain("Sign up · 3 of 3");
    expect(html).toContain("You&#x27;re in");
    expect(html).toContain("Viewer");
    expect(html).toContain("An admin assigns your role, which decides the workspaces you can open. You&#x27;ll start on Home.");
    expect(html).not.toContain("land in"); // every sign-in lands on Home now (final review M7)
    expect(html).toMatch(/<a[^>]* href="\/inventory"[^>]*>Go to Cris<\/a>/);
  });

  it("Sign up 3 with pendingApproval: Account created, admin approval copy, back to sign in, no You're in", () => {
    h.signupState = { created: true, pendingApproval: true };
    try {
      const html = render("signup-done");
      expect(html).toContain("Sign up · 3 of 3");
      expect(html).toContain("Account created");
      expect(html).toContain("An admin needs to approve it before you can sign in.");
      expect(html).not.toContain("You&#x27;re in");
      expect(html).not.toContain("Go to Cris");
      expect(html).not.toContain("Viewer");
      expect(html).toMatch(/<a[^>]* href="\/login\?step=login&amp;next=%2Femployees"[^>]*>Back to sign in<\/a>/);
    } finally {
      h.signupState = null;
    }
  });
});
