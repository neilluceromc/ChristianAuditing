import { test, expect, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import AxeBuilder from "@axe-core/playwright";
import { SEED_PASSWORD } from "../prisma/fixtures";

/**
 * Phase 44 (spec docs/superpowers/specs/2026-10-19-login-cris-design.md §5, §6, §8, §10): the Cris login page.
 *   1. Welcome, then the Log in tile turns focus mode on and Cris says his first line;
 *   2. Enter in Work email advances to the password step without navigating;
 *   3. a wrong password errors on step 2 with the email kept; the right one lands on the role's page;
 *   4. Sign up: a duplicate email bounces to step 1 (fields kept); a new one reaches "You're in" and signs in;
 *   5. Back returns to Welcome, focus mode off, day log back;
 *   6. the timeline switches scenes and Pause stops the clock;
 *   7. at 375 px: no horizontal scroll, the card comes first in tab order;
 *   8. reduced motion shows Cris's line whole, never typed;
 *   9. resizing 1440 → 1100 on Log in 1 keeps the card centred and the bubble clear of it;
 *  10. a 64-character email on Log in 2 doesn't stretch the card or the page;
 *  11. axe on Welcome, Log in 1 and Sign up 1, light and dark;
 *  12. the client checks put their messages under the right field.
 *
 * The form's inputs are controlled and have no `required`, so every message is read through the field's accessible
 * description (the always-present aria-live region it points at), never a role="alert": Next.js renders its own.
 */

const IT = "it@thebackroomop.com";
const VIEWER = "viewer@thebackroomop.com";
const ALLOWED_DOMAIN = "thebackroomop.com";
const LOGIN_1_LINE = "Hi again! What's your work email?";

// Spec files share one database and run in alphabetical order — each file reseeds so none inherits another's
// mutations (and the duplicate-email test below finds the seed's accounts).
test.beforeAll(() => {
  execSync("npm run db:seed", { timeout: 120_000 });
});

// Copied, not imported — house rule: never import helpers across spec files.
const hero = (page: Page) => page.locator(".lw-hero");
const card = (page: Page) => page.locator("main.lw-card");
/** Cris's line in the forward bubble. The ghost span beside it always holds the whole line, so read the typed one. */
const forwardLine = (page: Page) => page.locator(".lw-gb .lw-typed");
const dayLog = (page: Page) => page.getByRole("region", { name: "Cris's day" });
const workEmail = (page: Page) => page.getByLabel("Work email");
const password = (page: Page) => page.getByLabel("Password", { exact: true });
const cont = (page: Page) => page.getByRole("button", { name: "Continue", exact: true });

/** The page, hydrated: the card sets this once its handlers are attached, so a click can't race hydration. */
async function open(page: Page, path: string) {
  await page.goto(path);
  await page.locator('[data-login-ready="true"]').waitFor();
}

/** Welcome → Log in 1 through the tile. */
async function toLoginEmail(page: Page) {
  await open(page, "/login");
  await page.getByRole("link", { name: /^Log in/ }).click();
  await expect(page.getByRole("heading", { name: "What's your work email?" })).toBeVisible();
}

/** Welcome → Sign up 1 through the tile. */
async function toSignup(page: Page) {
  await open(page, "/login");
  await page.getByRole("link", { name: /^Sign up/ }).click();
  await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();
}

/** Serious and critical axe findings, with what they hit, so a failure says which element. */
async function seriousViolations(page: Page) {
  // Settle the pointer and the card's slide first, as axe-sweep.spec.ts does, so no hover state or mid-flight
  // opacity changes a measured colour.
  await page.mouse.move(0, 0);
  await page.waitForTimeout(700);
  const results = await new AxeBuilder({ page }).analyze();
  return results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`);
}

test.describe("login page", () => {
  test("1. Welcome, then Log in turns focus mode on and Cris greets", async ({ page }) => {
    await open(page, "/login");
    await expect(page.getByRole("heading", { name: "Welcome to Cris" })).toBeVisible();
    await expect(page.locator(".lw-wordmark")).toHaveText("Cris");
    await expect(hero(page)).not.toHaveClass(/lw-focus/);
    await expect(dayLog(page)).toBeVisible();

    await page.getByRole("link", { name: /^Log in/ }).click();
    await expect(page.getByRole("heading", { name: "What's your work email?" })).toBeVisible();
    await expect(hero(page)).toHaveClass(/lw-focus/);
    // The day log fades out and is taken out of the accessibility tree (visibility: hidden after the fade).
    await expect(dayLog(page)).toHaveCount(0);
    // Cris flies forward, then types the line (~0.8 s after the flight starts, then ~1.2 s of typing).
    await expect(forwardLine(page)).toHaveText(LOGIN_1_LINE, { timeout: 15_000 });
  });

  test("2. Enter in Work email advances to the password step without navigating", async ({ page }) => {
    await toLoginEmail(page);
    const url = page.url();
    await workEmail(page).fill(IT);
    await workEmail(page).press("Enter");
    await expect(page.getByRole("heading", { name: "Enter your password" })).toBeVisible();
    await expect(password(page)).toBeVisible();
    expect(page.url()).toBe(url);
  });

  test("3. a wrong password errors on step 2 with the email kept; the right one lands on the role's page", async ({ page }) => {
    await toLoginEmail(page);
    await workEmail(page).fill(IT);
    await cont(page).click();
    await password(page).fill("wrong-password");
    await page.getByRole("button", { name: "Log in", exact: true }).click();

    await expect(password(page)).toHaveAccessibleDescription(/Wrong email or password — or the account is disabled\./);
    await expect(page.getByRole("heading", { name: "Enter your password" })).toBeVisible();
    await expect(page.locator(".lw-who-e")).toHaveText(IT);

    await password(page).fill(SEED_PASSWORD);
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    // Headroom: the credentials POST, the session write and a cold render of the landing page.
    await expect(page).toHaveURL(/\/inventory/, { timeout: 30_000 });
  });

  test("4. Sign up: a duplicate email returns to step 1 with fields kept; a new one signs in", async ({ page }) => {
    await toSignup(page);
    await page.getByLabel("Full name").fill("Casey Tester");
    await workEmail(page).fill(VIEWER);
    await cont(page).click();
    await expect(page.getByRole("heading", { name: "Choose a password" })).toBeVisible();
    await password(page).fill("a-long-enough-pw");
    await page.getByRole("button", { name: "Create account", exact: true }).click();

    // The server's `field` routes the message back to Sign up 1, under Work email; nothing typed is lost.
    await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();
    await expect(workEmail(page)).toHaveAccessibleDescription(/An account with that email already exists\./);
    await expect(workEmail(page)).toHaveValue(VIEWER);
    await expect(page.getByLabel("Full name")).toHaveValue("Casey Tester");

    // A new address (the seeded domain, unique per run) goes all the way through.
    const fresh = `cris.signup.${Date.now()}@${ALLOWED_DOMAIN}`;
    await workEmail(page).fill(fresh);
    await cont(page).click();
    await expect(page.getByRole("heading", { name: "Choose a password" })).toBeVisible();
    await password(page).fill("a-long-enough-pw");
    await page.getByRole("button", { name: "Create account", exact: true }).click();

    await expect(page.getByRole("heading", { name: "You're in, Casey" })).toBeVisible({ timeout: 30_000 });
    // The session cookie is already set, so the link lands signed in on the viewer's page.
    await page.getByRole("link", { name: "Go to Cris" }).click();
    await expect(page).toHaveURL(/\/inventory/, { timeout: 30_000 });
  });

  test("5. Back from Log in 1 returns to Welcome and the day log is visible again", async ({ page }) => {
    await toLoginEmail(page);
    await expect(hero(page)).toHaveClass(/lw-focus/);
    await page.getByRole("button", { name: "Back to the start" }).click();
    await expect(page.getByRole("heading", { name: "Welcome to Cris" })).toBeVisible();
    await expect(hero(page)).not.toHaveClass(/lw-focus/);
    await expect(dayLog(page)).toBeVisible();
  });

  test("6. the timeline switches scenes and Pause stops the clock", async ({ page }) => {
    await open(page, "/login");
    const clock = page.locator(".lw-clock");
    await page.getByRole("button", { name: "09:55 Stockroom: Looking for a laptop that isn't on its shelf" }).click();
    // The clock counts up to the scene's time over the (at most 2.4 s) travel.
    await expect(clock).toHaveText("09:55", { timeout: 10_000 });
    await expect(page.locator(".lw-task")).toHaveText("Looking for a laptop that isn't on its shelf");

    const pause = page.getByRole("button", { name: "Pause the scene" });
    await expect(pause).toHaveAttribute("aria-pressed", "false");
    await pause.click();
    await expect(page.getByRole("button", { name: "Play the scene" })).toHaveAttribute("aria-pressed", "true");
    const before = await clock.textContent();
    await page.waitForTimeout(3000);
    expect(await clock.textContent()).toBe(before);
  });

  test("7. at 375 px: no horizontal scroll, and the first Tab lands inside <main>", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await open(page, "/login");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    await page.keyboard.press("Tab");
    const inMain = await page.evaluate(() => document.activeElement?.closest("main") != null);
    expect(inMain, "the first focusable control is in the card, before the day log").toBe(true);
  });

  test("8. with reduced motion Cris's line appears whole, never typed", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await open(page, "/login");
    // Record every text the forward bubble ever shows: with typing there would be partial prefixes in the list.
    await page.evaluate(() => {
      const typed = document.querySelector(".lw-gb .lw-typed");
      if (!typed) throw new Error("no forward bubble");
      const seen: string[] = [];
      (window as unknown as { __lwSeen: string[] }).__lwSeen = seen;
      new MutationObserver(() => seen.push(typed.textContent ?? "")).observe(typed, {
        childList: true,
        characterData: true,
        subtree: true,
      });
    });
    await page.getByRole("link", { name: /^Log in/ }).click();
    await expect(forwardLine(page)).toHaveText(LOGIN_1_LINE, { timeout: 5000 });
    const seen = await page.evaluate(() => (window as unknown as { __lwSeen: string[] }).__lwSeen);
    const shown = seen.filter(Boolean);
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.every((s) => s === LOGIN_1_LINE), `texts shown: ${JSON.stringify(shown)}`).toBe(true);
  });

  test("9. resizing 1440 to 1100 on Log in 1 keeps the card centred and the bubble clear of it", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, "/login?step=login");
    await expect(forwardLine(page)).toHaveText(LOGIN_1_LINE, { timeout: 15_000 });

    await page.setViewportSize({ width: 1100, height: 900 });
    // The resize handler re-places the card and Cris after an 80 ms debounce, without animating.
    await expect
      .poll(
        async () => {
          const c = await card(page).boundingBox();
          const b = await page.locator(".lw-gb").boundingBox();
          const width = await page.evaluate(() => document.documentElement.clientWidth);
          if (!c || !b) return { centred: false, bubbleClear: false };
          return {
            centred: Math.abs(c.x + c.width / 2 - width / 2) <= 2,
            bubbleClear: b.x + b.width <= c.x,
          };
        },
        { timeout: 5000 },
      )
      .toEqual({ centred: true, bubbleClear: true });
  });

  test("10. a 64-character email on Log in 2 does not stretch the card or the page", async ({ page }) => {
    const long = `${"a".repeat(46)}@${ALLOWED_DOMAIN}`;
    expect(long).toHaveLength(64);
    await open(page, "/login?step=login");
    const widthBefore = (await card(page).boundingBox())!.width;
    await workEmail(page).fill(long);
    await cont(page).click();
    await expect(page.getByRole("heading", { name: "Enter your password" })).toBeVisible();
    await expect(page.locator(".lw-who-e")).toHaveText(long);

    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth === window.innerWidth))
      .toBe(true);
    const widthAfter = (await card(page).boundingBox())!.width;
    expect(widthAfter).toBeCloseTo(widthBefore, 0);
  });

  test("11. axe: Welcome, Log in 1 and Sign up 1 have no serious or critical violations, light and dark", async ({ page, baseURL }) => {
    test.setTimeout(180_000);
    for (const theme of ["light", "dark"] as const) {
      // The cookie the root layout reads for data-theme (theme-toggle.tsx writes the same one).
      await page.context().addCookies([{ name: "br.theme", value: theme, url: baseURL! }]);
      for (const [label, path] of [
        ["Welcome", "/login"],
        ["Log in 1", "/login?step=login"],
        ["Sign up 1", "/signup"],
      ] as const) {
        await open(page, path);
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        if (path !== "/login") {
          // Let Cris finish typing so axe doesn't measure a half-drawn bubble.
          await expect(forwardLine(page)).toHaveText(/\w/, { timeout: 15_000 });
          await expect(page.locator(".lw-gb .lw-caret")).toHaveCount(0, { timeout: 15_000 });
        }
        expect(await seriousViolations(page), `axe on ${label} (${theme})`).toEqual([]);
      }
    }
  });

  test("12. client checks put their messages under the right field", async ({ page }) => {
    // Log in 1
    await toLoginEmail(page);
    await cont(page).click();
    await expect(workEmail(page)).toHaveAccessibleDescription("Enter your work email.");
    await expect(workEmail(page)).toBeFocused();

    await workEmail(page).fill("neil@");
    await cont(page).click();
    await expect(workEmail(page)).toHaveAccessibleDescription("That doesn't look like an email address. Check for typos.");

    // The seed turns on allowed_domain, so a well-formed address elsewhere is refused.
    await workEmail(page).fill("neil@example.com");
    await cont(page).click();
    await expect(workEmail(page)).toHaveAccessibleDescription(`Use your @${ALLOWED_DOMAIN} email.`);

    // Log in 2
    await workEmail(page).fill(IT);
    await cont(page).click();
    await expect(page.getByRole("heading", { name: "Enter your password" })).toBeVisible();
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await expect(password(page)).toHaveAccessibleDescription("Enter your password.");
    await expect(password(page)).toBeFocused();

    // Sign up 1 and 2
    await toSignup(page);
    await cont(page).click();
    await expect(page.getByLabel("Full name")).toHaveAccessibleDescription("Enter your name.");
    await page.getByLabel("Full name").fill("Casey Tester");
    await cont(page).click();
    await expect(workEmail(page)).toHaveAccessibleDescription("Enter your work email.");
    await workEmail(page).fill(`casey@${ALLOWED_DOMAIN}`);
    await cont(page).click();
    await expect(page.getByRole("heading", { name: "Choose a password" })).toBeVisible();
    await password(page).fill("too-short");
    await page.getByRole("button", { name: "Create account", exact: true }).click();
    await expect(password(page)).toHaveAccessibleDescription("Use at least 10 characters.");
  });
});
