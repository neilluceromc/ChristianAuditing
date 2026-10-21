import { test, expect, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import AxeBuilder from "@axe-core/playwright";
import { submitSignIn } from "./fixtures/login";

/**
 * The Cris login page, blob style (Task 10, the owner's "Cris Login Redesign"; behaviour from Phase 44's spec
 * docs/superpowers/specs/2026-10-19-login-cris-design.md §5, §6, §8):
 *   1. the one sign-in form lands on Home, and the signed-in sequence (if it shows) runs in order;
 *   2. a `next` link still wins;
 *   3. a wrong password errors under Password with the email kept, and the card comes back;
 *   4. Sign up: reachable from the form; a duplicate email bounces to step 1 (fields kept); a new one signs in;
 *   5. Back from Sign up 1 returns to the sign-in form, focus mode off;
 *   6. focusing the form turns focus mode on and Cris greets; leaving it untouched turns it off;
 *   7. Pause stops the motion (the blob and the day), and reduced motion never starts it;
 *   8. at 375 px: no sideways scroll on /login or /signup, the first Tab lands in <main>, Cris peeks in focus mode;
 *   9. axe on the form, the focused form and Sign up 1, light and dark;
 *  10. the client checks put their messages under the right field;
 *  11. Forgot password and Show/Hide;
 *  12. a 64-character email doesn't stretch the card or the page.
 * Quick sign-in behind the STAGING pill is e2e/quick-login.spec.ts (it depends on QUICK_LOGIN_EMAILS).
 *
 * The form's inputs are controlled and have no `required`, so every message is read through the field's accessible
 * description (the always-present aria-live region it points at), never a role="alert": Next.js renders its own.
 */

const IT = "it@thebackroomop.com";
const VIEWER = "viewer@thebackroomop.com";
const ALLOWED_DOMAIN = "thebackroomop.com";
const GREETING = "Hi again! What's your work email?";
const ENTER_LINES = [
  "Checking your badge…",
  "Unlocking the stockroom…",
  "Counting your assets…",
  "Welcome back, It!",
  "Opening your dashboard…",
];

// Spec files share one database and run in alphabetical order — each file reseeds so none inherits another's
// mutations (and the duplicate-email test below finds the seed's accounts).
test.beforeAll(() => {
  execSync("npm run db:seed", { timeout: 120_000 });
});

const hero = (page: Page) => page.locator(".lw-hero");
const card = (page: Page) => page.locator("main.lw-card");
const bubble = (page: Page) => page.locator(".lw-bubble");
const workEmail = (page: Page) => page.getByLabel("Work email", { exact: true });
const password = (page: Page) => page.getByLabel("Password", { exact: true });
const logIn = (page: Page) => page.getByRole("button", { name: "Log in", exact: true });
const cont = (page: Page) => page.getByRole("button", { name: "Continue", exact: true });

/** The page, hydrated: the card sets this once its handlers are attached, so a click can't race hydration. */
async function open(page: Page, path: string) {
  await page.goto(path);
  await page.locator('[data-login-ready="true"]').waitFor();
}

/** The sign-in form → Sign up 1 through its link. */
async function toSignup(page: Page) {
  await open(page, "/login");
  await page.getByRole("link", { name: "Create an account" }).click();
  await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();
}

/** The first blob drop's centre: the liquid blob reshapes it every frame while the motion runs. */
const dropX = (page: Page) => page.locator("#lw-blob circle").first().getAttribute("cx");

/** Serious and critical axe findings, with what they hit, so a failure says which element. */
async function seriousViolations(page: Page) {
  // Settle the pointer and the step's rise first, as axe-sweep.spec.ts does, so no hover state or mid-flight
  // opacity changes a measured colour.
  await page.mouse.move(0, 0);
  await page.waitForTimeout(700);
  const results = await new AxeBuilder({ page }).analyze();
  return results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`);
}

test.describe("login page", () => {
  test("1. the sign-in form lands on Home; the signed-in sequence runs in order while the request is in flight", async ({ page }) => {
    await open(page, "/login");
    await expect(page.getByRole("heading", { name: "Welcome back", level: 1 })).toBeVisible();
    await expect(page.getByText("Sign in to your Cris workspace.")).toBeVisible();
    // No wordmark (Phase 47's name lives in the tab title).
    await expect(page.locator(".lw-wordmark")).toHaveCount(0);
    await expect(page).toHaveTitle(/· CRIS$/);

    // Record every status the sequence shows; sessionStorage survives the redirect to Home.
    await page.evaluate(() => {
      const status = document.querySelector(".lw-le-status");
      if (!status) throw new Error("no signed-in status");
      new MutationObserver(() => {
        const seen = JSON.parse(sessionStorage.getItem("lwSeen") ?? "[]") as string[];
        const text = status.textContent ?? "";
        if (text && seen.at(-1) !== text) sessionStorage.setItem("lwSeen", JSON.stringify([...seen, text]));
      }).observe(status, { childList: true, characterData: true, subtree: true });
    });
    await submitSignIn(page, IT);
    // Headroom: the credentials POST, the session write and a cold render of Home (spec §7.1: everyone lands there).
    await expect(page).toHaveURL((u) => u.pathname === "/", { timeout: 30_000 });
    const seen = await page.evaluate(() => JSON.parse(sessionStorage.getItem("lwSeen") ?? "[]") as string[]);
    // It never holds the redirect, so how far it got depends on the server; whatever showed came in order.
    expect(seen, `statuses shown: ${JSON.stringify(seen)}`).toEqual(ENTER_LINES.slice(0, seen.length));
  });

  test("2. a next link still wins over Home", async ({ page }) => {
    await page.goto("/employees");
    await expect(page).toHaveURL(/\/login\?next=%2Femployees|\/login\?next=\/employees/);
    await submitSignIn(page, IT);
    await expect(page).toHaveURL(/\/employees/, { timeout: 30_000 });
  });

  test("3. a wrong password errors under Password with the email kept, and the card comes back", async ({ page }) => {
    await open(page, "/login");
    await submitSignIn(page, IT, "wrong-password");
    await expect(password(page)).toHaveAccessibleDescription(/Wrong email or password — or the account is disabled\./);
    await expect(password(page)).toBeFocused();
    await expect(workEmail(page)).toHaveValue(IT);
    await expect(page).toHaveURL(/\/login/);
    // The sequence ends with the request: the card is back, usable, and the status is empty.
    await expect(hero(page)).not.toHaveClass(/lw-entering/);
    await expect(card(page)).toHaveCSS("opacity", "1");
    await expect(page.locator(".lw-le-status")).toHaveText("");
    await expect(bubble(page)).toHaveText(/^Hmm\. Wrong email or password/);
  });

  test("4. Sign up: a duplicate email returns to step 1 with fields kept; a new one signs in", async ({ page }) => {
    await toSignup(page);
    await expect(page).toHaveURL(/\/login/); // changed in place, no navigation
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
    await expect(page.getByText("You'll start on Home.")).toBeVisible();
    // The session cookie is already set, so the link lands signed in on Home (Finance follow-up, spec §7.1).
    await page.getByRole("link", { name: "Go to Cris" }).click();
    await expect(page).toHaveURL((u) => u.pathname === "/", { timeout: 30_000 });
  });

  test("5. Back from Sign up 1 returns to the sign-in form with focus mode off", async ({ page }) => {
    await open(page, "/signup");
    await expect(hero(page)).toHaveClass(/lw-focus/);
    await page.getByRole("button", { name: "Back to sign in" }).click();
    await expect(page.getByRole("heading", { name: "Welcome back", level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Welcome back", level: 1 })).toBeFocused();
    await expect(hero(page)).not.toHaveClass(/lw-focus/);
  });

  test("6. focusing the form brings Cris beside the card; leaving it untouched sends her back", async ({ page }) => {
    await open(page, "/login");
    await expect(hero(page)).not.toHaveClass(/lw-focus/);
    await workEmail(page).focus();
    await expect(hero(page)).toHaveClass(/lw-focus/);
    // She flies over (~0.8 s), then greets.
    await expect(bubble(page)).toHaveText(GREETING, { timeout: 10_000 });
    await expect(bubble(page)).toHaveClass(/lw-on/);

    // Out of the form with nothing typed: back to her day.
    await page.locator("body").click({ position: { x: 5, y: 5 } });
    await expect(hero(page)).not.toHaveClass(/lw-focus/);

    // `?step=login` (the links back from sign-up) opens with the email focused, in focus mode.
    await open(page, "/login?step=login");
    await expect(workEmail(page)).toBeFocused();
    await expect(hero(page)).toHaveClass(/lw-focus/);
  });

  test("7. Pause stops the motion; reduced motion never starts it", async ({ page }) => {
    await open(page, "/login");
    const pause = page.getByRole("button", { name: "Pause motion" });
    await expect(pause).toHaveAttribute("aria-pressed", "false");
    // Running: the blob reshapes.
    const a = await dropX(page);
    await expect.poll(() => dropX(page), { timeout: 5000 }).not.toBe(a);

    // Pause is reachable by keyboard.
    await pause.focus();
    await page.keyboard.press("Enter");
    await expect(pause).toHaveAttribute("aria-pressed", "true");
    await expect(hero(page)).toHaveClass(/lw-still/);
    await page.waitForTimeout(300);
    const still = await dropX(page);
    const task = await page.locator(".lw-dl-task").textContent();
    // Longer than a scene's dwell (6.2 s): neither the blob nor the day moves on.
    await page.waitForTimeout(7000);
    expect(await dropX(page)).toBe(still);
    expect(await page.locator(".lw-dl-task").textContent()).toBe(task);

    await pause.click();
    await expect(pause).toHaveAttribute("aria-pressed", "false");
    await expect.poll(() => dropX(page), { timeout: 5000 }).not.toBe(still);

    await page.emulateMedia({ reducedMotion: "reduce" });
    await open(page, "/login");
    await expect(hero(page)).toHaveClass(/lw-still/);
    const r = await dropX(page);
    await page.waitForTimeout(1500);
    expect(await dropX(page)).toBe(r);
  });

  test("8. at 375 px: no sideways scroll, the first Tab lands in <main>, and Cris peeks in focus mode", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    for (const path of ["/login", "/signup"]) {
      await open(page, path);
      expect(await page.evaluate(() => document.documentElement.scrollWidth), path).toBeLessThanOrEqual(375);
    }
    await open(page, "/login");
    await page.keyboard.press("Tab");
    const inMain = await page.evaluate(() => document.activeElement?.closest("main") != null);
    expect(inMain, "the first focusable control is in the card").toBe(true);

    await workEmail(page).fill(IT);
    await expect(hero(page)).toHaveClass(/lw-focus/);
    // She peeks over the card's top edge: her centre sits above the card.
    await expect
      .poll(async () => {
        const c = await card(page).boundingBox();
        const o = await page.locator(".lw-cris-body").boundingBox();
        return !!c && !!o && o.y + o.height / 2 < c.y;
      })
      .toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  });

  test("9. axe: the form, the focused form and Sign up 1 have no serious or critical violations, light and dark", async ({ page, baseURL }) => {
    test.setTimeout(180_000);
    for (const theme of ["light", "dark"] as const) {
      // The cookie the root layout reads for data-theme (theme-toggle.tsx writes the same one).
      await page.context().addCookies([{ name: "br.theme", value: theme, url: baseURL! }]);
      for (const [label, path] of [
        ["Sign in", "/login"],
        ["Sign in, focused", "/login?step=login"],
        ["Sign up 1", "/signup"],
      ] as const) {
        await open(page, path);
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        if (path !== "/login") await expect(bubble(page)).toHaveClass(/lw-on/, { timeout: 10_000 });
        expect(await seriousViolations(page), `axe on ${label} (${theme})`).toEqual([]);
      }
    }
  });

  test("10. client checks put their messages under the right field", async ({ page }) => {
    await open(page, "/login");
    await logIn(page).click();
    await expect(workEmail(page)).toHaveAccessibleDescription("Enter your work email.");
    await expect(workEmail(page)).toBeFocused();

    await workEmail(page).fill("neil@");
    await logIn(page).click();
    await expect(workEmail(page)).toHaveAccessibleDescription("That doesn't look like an email address. Check for typos.");

    // Sign-in does not check the allowed domain (the server never has): a well-formed address elsewhere moves on to
    // the password check.
    await workEmail(page).fill("neil@example.com");
    await logIn(page).click();
    await expect(password(page)).toHaveAccessibleDescription("Enter your password.");
    await expect(password(page)).toBeFocused();
    await expect(page).toHaveURL(/\/login/);

    // Sign up 1 and 2
    await toSignup(page);
    await cont(page).click();
    await expect(page.getByLabel("Full name")).toHaveAccessibleDescription("Enter your name.");
    await page.getByLabel("Full name").fill("Casey Tester");
    await cont(page).click();
    await expect(workEmail(page)).toHaveAccessibleDescription("Enter your work email.");
    // The seed turns on allowed_domain, so Sign up 1 refuses a well-formed address elsewhere.
    await workEmail(page).fill("neil@example.com");
    await cont(page).click();
    await expect(workEmail(page)).toHaveAccessibleDescription(`Use your @${ALLOWED_DOMAIN} email.`);
    await workEmail(page).fill(`casey@${ALLOWED_DOMAIN}`);
    await cont(page).click();
    await expect(page.getByRole("heading", { name: "Choose a password" })).toBeVisible();
    await password(page).fill("too-short");
    await page.getByRole("button", { name: "Create account", exact: true }).click();
    await expect(password(page)).toHaveAccessibleDescription("Use at least 10 characters.");
  });

  test("11. Forgot password reveals the admin hint; Show reveals the password", async ({ page }) => {
    await open(page, "/login");
    const forgot = page.getByRole("button", { name: "Forgot password?" });
    await expect(forgot).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByText("Forgot your password? Ask an admin for help.")).toBeHidden();
    await forgot.click();
    await expect(forgot).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByText("Forgot your password? Ask an admin for help.")).toBeVisible();
    await expect(password(page)).toHaveAccessibleDescription(/Ask an admin for help/);

    await password(page).fill("secret-ish");
    await expect(password(page)).toHaveAttribute("type", "password");
    await page.getByRole("button", { name: "Show" }).click();
    await expect(password(page)).toHaveAttribute("type", "text");
    await expect(page.getByRole("button", { name: "Hide" })).toHaveAttribute("aria-pressed", "true");
  });

  test("12. a 64-character email does not stretch the card or the page", async ({ page }) => {
    const long = `${"a".repeat(46)}@${ALLOWED_DOMAIN}`;
    expect(long).toHaveLength(64);
    await open(page, "/login");
    const widthBefore = (await card(page).boundingBox())!.width;
    await workEmail(page).fill(long);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth === window.innerWidth))
      .toBe(true);
    const widthAfter = (await card(page).boundingBox())!.width;
    expect(widthAfter).toBeCloseTo(widthBefore, 0);
  });
});
