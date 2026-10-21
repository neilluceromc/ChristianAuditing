import { test, expect, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import AxeBuilder from "@axe-core/playwright";
// Loads .env into this process the way `next dev` loads it into the server, so ON below matches what a reused dev
// server shows (Prisma reads .env on import).
import "@prisma/client";

// Staging-only one-click sign-in, tucked behind the STAGING pill in the login page's corner (Task 10). The dev server
// inherits QUICK_LOGIN_EMAILS from its environment, so a run without the variable proves the default — no pill — and a
// run with it proves the pill opens the picker and signs in:
//   QUICK_LOGIN_EMAILS=it@thebackroomop.com,admin@thebackroomop.com E2E_PORT=3100 npx playwright test e2e/quick-login.spec.ts
// The port must be free first: a reused dev server keeps the env it started with.
const ON = !!process.env.QUICK_LOGIN_EMAILS;

test.beforeAll(() => {
  if (!ON) return; // the default case reads no data
  execSync("npm run db:seed", { timeout: 120_000 });
});

const pill = (page: Page) => page.getByRole("button", { name: /^staging$/i });

async function open(page: Page, path: string) {
  await page.goto(path);
  await page.locator('[data-login-ready="true"]').waitFor();
}

test("quick sign-in is absent by default", async ({ page }) => {
  test.skip(ON, "runs only with QUICK_LOGIN_EMAILS unset");
  await open(page, "/login");
  await expect(page.getByRole("heading", { name: "Welcome back", level: 1 })).toBeVisible();
  await expect(pill(page)).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /Quick sign-in/ })).toHaveCount(0);
  await expect(page.getByLabel("Account", { exact: true })).toHaveCount(0);
});

test("the STAGING pill opens quick sign-in by keyboard; an account signs in and lands on Home", async ({ page }) => {
  test.skip(!ON, "runs only with QUICK_LOGIN_EMAILS set");
  await open(page, "/login");
  // Closed until asked for.
  await expect(pill(page)).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("heading", { name: /Quick sign-in/ })).toHaveCount(0);

  // Keyboard: the pill is a real button in the tab order; Enter opens the popover and moves into the picker.
  expect(await pill(page).evaluate((el) => (el as HTMLElement).tabIndex)).toBe(0);
  await pill(page).focus();
  await page.keyboard.press("Enter");
  await expect(pill(page)).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("heading", { name: /Quick sign-in/ })).toBeVisible();
  await expect(page.getByLabel("Account", { exact: true })).toBeFocused();
  // Escape closes it and returns to the pill.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: /Quick sign-in/ })).toHaveCount(0);
  await expect(pill(page)).toBeFocused();
  await page.keyboard.press("Enter");

  await page.mouse.move(0, 0);
  await page.waitForTimeout(400); // the popover's rise
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);

  await page.getByLabel("Account", { exact: true }).selectOption({ label: "IT staff" });
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  // Finance follow-up (spec §7.1): every sign-in, quick sign-in included, lands on Home.
  await page.waitForURL((url) => url.pathname === "/");
  await expect(page.getByRole("button", { name: "Account menu" })).toBeVisible();
});

test("a forged quick sign-in for an unlisted account is refused, and the popover opens on the refusal", async ({ page }) => {
  test.skip(!ON, "runs only with QUICK_LOGIN_EMAILS set");
  await open(page, "/login");
  await pill(page).focus();
  await page.keyboard.press("Enter");
  // Point the IT option at an address that is on no list (the env's list varies by machine), then submit it.
  const account = page.getByLabel("Account", { exact: true });
  const forged = `quick.forged.${Date.now()}@thebackroomop.com`;
  await account.locator("option", { hasText: "IT staff" }).evaluate((el, value) => {
    (el as HTMLOptionElement).value = value;
  }, forged);
  await account.selectOption({ label: "IT staff" });
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page).toHaveURL(/\/login\?quick=refused/);
  await expect(page.getByText(/That quick sign-in is not available/)).toBeVisible();

  // A fresh load of the refusal opens the popover by itself, banner showing.
  await open(page, "/login?quick=refused");
  await expect(pill(page)).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByText(/That quick sign-in is not available/)).toBeVisible();
});
