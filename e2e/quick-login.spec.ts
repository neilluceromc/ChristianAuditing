import { test, expect } from "@playwright/test";
import { execSync } from "node:child_process";
import AxeBuilder from "@axe-core/playwright";

// Staging-only one-click sign-in. The dev server inherits QUICK_LOGIN_EMAILS
// from this process, so the battery (variable unset) proves the default — no
// dropdown — and a run with the variable set proves the dropdown signs in:
//   QUICK_LOGIN_EMAILS=it@thebackroomop.com,admin@thebackroomop.com E2E_PORT=3100 npx playwright test e2e/quick-login.spec.ts
// The port must be free first: a reused dev server keeps the env it started with.
const ON = !!process.env.QUICK_LOGIN_EMAILS;

test.beforeAll(() => {
  if (!ON) return; // the default case reads no data
  execSync("npm run db:seed", { timeout: 120_000 });
});

test("quick sign-in is absent by default", async ({ page }) => {
  test.skip(ON, "runs only with QUICK_LOGIN_EMAILS unset");
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Welcome to Cris" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Quick sign-in/ })).toHaveCount(0);
  await expect(page.getByLabel("Account", { exact: true })).toHaveCount(0);
});

test("a quick sign-in account signs in and lands on Home", async ({ page }) => {
  test.skip(!ON, "runs only with QUICK_LOGIN_EMAILS set");
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: /Quick sign-in/ })).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
  await page.getByLabel("Account", { exact: true }).selectOption({ label: "IT staff" });
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  // Finance follow-up (spec §7.1): every sign-in, quick sign-in included, lands on Home.
  await page.waitForURL((url) => url.pathname === "/");
  await expect(page.getByRole("button", { name: "Account menu" })).toBeVisible();
});

test("a forged quick sign-in for an unlisted account is refused", async ({ page }) => {
  test.skip(!ON, "runs only with QUICK_LOGIN_EMAILS set");
  await page.goto("/login");
  // Point the IT option at an account that is not on the list, then submit it.
  const account = page.getByLabel("Account", { exact: true });
  await account.locator("option", { hasText: "IT staff" }).evaluate((el) => {
    (el as HTMLOptionElement).value = "finance@thebackroomop.com";
  });
  await account.selectOption({ label: "IT staff" });
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page).toHaveURL(/\/login\?quick=refused/);
  await expect(page.getByText(/That quick sign-in is not available/)).toBeVisible();
});
