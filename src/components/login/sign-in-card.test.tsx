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
      quick={null}
      viewerLanding="/inventory"
      {...overrides}
    />,
  );
}

const ids = (html: string) => [...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);

describe("SignInCard", () => {
  it("is the page's <main>, labelled by the current step's focusable h1", () => {
    for (const step of ["welcome", "login-email", "login-password", "signup-name", "signup-password", "signup-done"] as Step[]) {
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

  it("Welcome: wordmark, no progress, tiles as links keeping next, domain line", () => {
    const html = render("welcome");
    expect(html).toContain(">Cris</span>");
    expect(html).toContain("IT inventory");
    expect(html).toContain("Welcome to Cris");
    expect(html).toContain("Laptops, headsets, purchases and leavers, tracked in one place.");
    expect(html).toContain('href="/login?step=login&amp;next=%2Femployees"');
    expect(html).toContain('href="/signup"');
    expect(html).toContain("I already have an account");
    expect(html).toContain("I&#x27;m new to Cris");
    expect(html).toContain('style="width:0%"');
    expect(html).toContain("Access is limited to @thebackroomop.com accounts.");
    expect(html).not.toContain("Continue with Microsoft");
    expect(html).not.toContain("Quick sign-in");
    expect(render("welcome", { next: undefined })).toContain('href="/login?step=login"');
    expect(render("welcome", { domain: null })).not.toContain("Access is limited");
  });

  it("Welcome: Microsoft and quick sign-in when on", () => {
    const html = render("welcome", {
      microsoftAction: async () => {},
      quick: {
        accounts: [
          { email: "it@x.com", label: "IT staff" },
          { email: "admin@x.com", label: "Admin" },
        ],
        refused: true,
      },
    });
    expect(html).toContain(">OR<");
    expect(html).toContain("Continue with Microsoft");
    expect(html).toContain("Quick sign-in");
    expect(html).toContain("Staging");
    expect(html).toContain("One click, no password. Turned on for this server only.");
    expect(html).toContain("That quick sign-in is not available — the account is missing or disabled.");
    expect(html).toMatch(/<select[^>]* name="email"/);
    expect(html.indexOf('value="it@x.com"')).toBeLessThan(html.indexOf('value="admin@x.com"'));
    expect(html).toContain(">Account</label>");
    expect(html).toContain('<input type="hidden" name="next" value="/employees"/>');
    expect(html).toMatch(/>it@x\.com<\/p>/);

    const none = render("welcome", { quick: { accounts: [], refused: false } });
    expect(none).toContain("None of the listed accounts exists or is enabled.");
    expect(none).not.toContain("<select");
  });

  it("Log in 1: one form with email, hidden password group and next; Continue", () => {
    const html = render("login-email");
    expect(html).toContain("Log in · 1 of 2");
    expect(html).toContain("What&#x27;s your work email?");
    expect(html).toContain('style="width:50%"');
    expect(html.match(/<form/g)).toHaveLength(1);
    expect(html).toContain(">Work email</label>");
    expect(html).toMatch(/<input[^>]* type="email" autoComplete="username"[^>]* name="email"/);
    expect(html).toContain('placeholder="name@thebackroomop.com"');
    expect(html).toContain('name="password"');
    expect(html).toContain('<input type="hidden" name="next" value="/employees"/>');
    expect(html).toContain(">Continue</span>");
    expect(html).not.toContain(">Log in</span>");
    expect(html).toContain("New to Cris?");
    expect(render("login-email", { domain: null })).toContain('placeholder="name@company.com"');
  });

  it("Log in 2: chip, Password with Show, Log in, the admin footer", () => {
    const html = render("login-password");
    expect(html).toContain("Log in · 2 of 2");
    expect(html).toContain("Enter your password");
    expect(html).toContain('style="width:100%"');
    expect(html).toContain(">Change</button>");
    expect(html).toContain(">Password</label>");
    expect(html).toContain('autoComplete="current-password"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain(">Show</button>");
    expect(html).toContain(">Log in</span>");
    expect(html).not.toContain(">Continue</span>");
    expect(html).toContain("Forgot your password? Ask an admin for help.");
    expect(html).toContain('name="email"');
  });

  it("Sign up 1 and 2: one form with name, email and password", () => {
    const one = render("signup-name");
    expect(one).toContain("Sign up · 1 of 3");
    expect(one).toContain("Create your account");
    expect(one).toContain(">Full name</label>");
    expect(one).toContain('autoComplete="name"');
    expect(one).toContain('placeholder="Juan dela Cruz"');
    expect(one).toContain('autoComplete="email"');
    expect(one).toContain("Already have an account?");
    expect(one).not.toContain('name="next"');

    const two = render("signup-password");
    expect(two).toContain("Sign up · 2 of 3");
    expect(two).toContain("Choose a password");
    expect(two).toContain('autoComplete="new-password"');
    expect(two).toContain("At least 10 characters");
    expect(two).toContain(">Create account</span>");
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
