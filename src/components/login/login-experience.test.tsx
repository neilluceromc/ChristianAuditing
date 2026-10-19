import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Step } from "./login-steps";

// The real actions pull in next-auth and Prisma; the card only needs their identities.
vi.mock("@/server/auth/actions", () => ({
  signInWithCredentials: async () => ({}),
  signUp: async () => ({}),
  quickSignIn: async () => {},
}));

const { LoginExperience } = await import("./login-experience");

const card = {
  domain: "thebackroomop.com",
  microsoftAction: null,
  quick: null,
  viewerLanding: "/inventory",
};

function render(initialStep: Step): string {
  return renderToStaticMarkup(
    <LoginExperience page="login" initialStep={initialStep} world="<svg></svg>" card={card} />,
  );
}

const heroTag = (html: string) => html.match(/<div[^>]*class="lw-hero[^"]*"[^>]*>/)?.[0] ?? "";

describe("LoginExperience focus mode (server render)", () => {
  it("renders Welcome unfocused: the room Cris shows and the forward Cris is out of sight", () => {
    const html = render("welcome");
    expect(heroTag(html)).toMatch(/class="lw-hero"/);
    expect(heroTag(html)).not.toContain("data-snap");
    expect(html).toMatch(/class="lw-crisw"/);
    expect(html).toMatch(/class="lw-guide"/);
  });

  it("renders a direct load focused, placed without animating, the room Cris hidden", () => {
    for (const step of ["login-email", "signup-name"] as Step[]) {
      const html = render(step);
      expect(heroTag(html)).toMatch(/class="lw-hero lw-focus"/);
      expect(heroTag(html)).toContain('data-snap="all"');
      expect(html).toMatch(/class="lw-crisw lw-gone"/);
    }
  });

  it("keeps the forward Cris and its bubble outside the scene, hidden from assistive tech, after the day log", () => {
    const html = render("login-email");
    const mainEnd = html.indexOf("</main>");
    const dayLog = html.indexOf('aria-label="Cris&#x27;s day"');
    const guide = html.indexOf('class="lw-guide');
    const bubble = html.indexOf('class="lw-bubble lw-gb');
    expect(mainEnd).toBeGreaterThan(0);
    expect(dayLog).toBeGreaterThan(mainEnd);
    expect(guide).toBeGreaterThan(dayLog);
    expect(bubble).toBeGreaterThan(guide);
    expect(html).toMatch(/<div class="lw-guide"[^>]*aria-hidden="true"/);
    expect(html).toMatch(/<div class="lw-bubble lw-gb"[^>]*aria-hidden="true"/);
  });
});
