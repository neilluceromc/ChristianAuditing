import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Step } from "./login-steps";

// The real actions pull in next-auth and Prisma; the page only needs their identities.
vi.mock("@/server/auth/actions", () => ({
  signInWithCredentials: async () => ({}),
  signUp: async () => ({}),
  quickSignIn: async () => {},
}));

const { LoginExperience } = await import("./login-experience");
type Card = Parameters<typeof LoginExperience>[0]["card"];

const base: Card = {
  domain: "thebackroomop.com",
  microsoftAction: null,
  quick: null,
  viewerLanding: "/",
};

function render(initialStep: Step, card: Partial<Card> = {}): string {
  return renderToStaticMarkup(
    <LoginExperience page={initialStep === "login" ? "login" : "signup"} initialStep={initialStep} card={{ ...base, ...card }} />,
  );
}

const heroTag = (html: string) => html.match(/<div[^>]*class="lw-hero[^"]*"[^>]*>/)?.[0] ?? "";

describe("LoginExperience (server render)", () => {
  it("opens /login on the stage, not in focus mode, with the day log's first scene", () => {
    const html = render("login");
    expect(heroTag(html)).toMatch(/class="lw-hero"/);
    expect(html).toMatch(/class="lw-stage lw-ph-scan"/);
    expect(html).toContain("Checking in a returned laptop");
    expect(html.match(/class="lw-dot[ "]/g)).toHaveLength(6);
  });

  it("opens /signup in focus mode", () => {
    expect(heroTag(render("signup-name"))).toMatch(/class="lw-hero lw-focus"/);
  });

  it("hides the whole stage from assistive tech and puts the card first after it", () => {
    const html = render("login");
    expect(html).toMatch(/<div class="lw-left" aria-hidden="true">/);
    const stageEnd = html.indexOf("<main");
    expect(html.indexOf('class="lw-left"')).toBeLessThan(stageEnd);
    // Nothing focusable inside the hidden stage.
    const stage = html.slice(html.indexOf('class="lw-left"'), stageEnd);
    expect(stage).not.toMatch(/<(button|a|input|select)\b/);
  });

  it("draws Cris with the app's gold orb, and the room svg once", () => {
    const html = render("login");
    expect(html).toContain('<use href="#cris-gold"');
    expect(html).toContain('<symbol id="cris-gold"');
    expect(html.match(/class="lw-f-wall lw-blobwall"/g)).toHaveLength(1);
    // The wall is the blob's own shape, never a full-size rect a browser could paint outside the mask as a square.
    expect(html).toContain('<use href="#lw-blob-shape" class="lw-f-wall lw-blobwall"');
    expect(html).not.toMatch(/<rect class="lw-f-wall"/);
    expect(html).toContain("PO-1042");
    expect(html).not.toContain("PR-1042");
  });

  it("has a Pause control for the motion and a polite status for the signed-in sequence", () => {
    const html = render("login");
    expect(html).toMatch(/<button type="button" class="lw-pause" aria-pressed="false">.*Pause motion<\/button>/);
    expect(html).toMatch(/<div class="lw-enter" role="status" aria-live="polite">/);
  });

  it("shows the STAGING pill only when quick sign-in is on, closed unless a quick sign-in was refused", () => {
    expect(render("login")).not.toContain("lw-secret");
    const on = render("login", { quick: { accounts: [{ email: "it@x.com", label: "IT staff" }], refused: false } });
    expect(on).toMatch(/<button type="button" class="lw-secret" aria-expanded="false" aria-controls="[^"]+">.*Staging<\/button>/);
    expect(on).not.toContain("Quick sign-in");
  });

  it("opens the quick sign-in popover on a refusal, with the banner, the picker and next", () => {
    const html = render("login", {
      next: "/employees",
      quick: {
        accounts: [
          { email: "it@x.com", label: "IT staff" },
          { email: "admin@x.com", label: "Admin" },
        ],
        refused: true,
      },
    });
    expect(html).toMatch(/aria-expanded="true"/);
    expect(html).toContain(">Quick sign-in</h2>");
    expect(html).toContain("One click, no password. Turned on for this server only.");
    expect(html).toContain("That quick sign-in is not available — the account is missing or disabled.");
    expect(html).toMatch(/<select[^>]* name="email"/);
    expect(html.indexOf('value="it@x.com"')).toBeLessThan(html.indexOf('value="admin@x.com"'));
    expect(html).toContain(">Account</label>");
    expect(html).toContain('aria-label="Close quick sign-in"');
    // `next` rides on both forms: the sign-in form and the quick sign-in.
    expect(html.match(/<input type="hidden" name="next" value="\/employees"\/>/g)).toHaveLength(2);
    expect(html).toMatch(/>it@x\.com<\/p>/);
  });

  it("says when none of the listed quick sign-in accounts exists", () => {
    const html = render("login", { quick: { accounts: [], refused: true } });
    expect(html).toContain("None of the listed accounts exists or is enabled.");
    expect(html).not.toContain("<select");
  });
});
