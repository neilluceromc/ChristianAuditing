import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel(/Email/).fill(email);
  await page.getByLabel(/Password/).fill("ChangeMe123!");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

test.describe("auth", () => {
  test("login page passes axe", async ({ page }) => {
    await page.goto("/login");
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
  });

  test("unauthenticated deep link redirects to login and back", async ({ page }) => {
    await page.goto("/employees");
    await expect(page).toHaveURL(/\/login\?next=%2Femployees|\/login\?next=\/employees/);
    await page.getByLabel(/Email/).fill("it@thebackroomop.com");
    await page.getByLabel(/Password/).fill("ChangeMe123!");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/employees/);
  });

  test("wrong password shows an inline error", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel(/Email/).fill("it@thebackroomop.com");
    await page.getByLabel(/Password/).fill("wrong-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    // Scoped to the app's error Banner: Next.js also renders its own (empty,
    // always-present) role="alert" route announcer, so an unscoped
    // getByRole("alert") is a strict-mode violation once both exist.
    const errorAlert = page.getByRole("alert").filter({ hasText: "Wrong email or password" });
    await expect(errorAlert).toContainText(/Wrong email or password/);
  });

  test("roles land on their brief-mandated defaults", async ({ page }) => {
    await login(page, "purchasing@thebackroomop.com");
    await expect(page).toHaveURL(/\/purchases$/);
  });

  test("bootstrap 404s once users exist", async ({ page }) => {
    const res = await page.goto("/bootstrap");
    expect(res?.status()).toBe(404);
  });

  test("signed-in users are bounced off /login", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await page.goto("/login");
    await expect(page).toHaveURL(/\/inventory/);
  });
});

test.describe("workspace gating", () => {
  test("purchasing cannot open IT-only pages", async ({ page }) => {
    await login(page, "purchasing@thebackroomop.com");
    await page.goto("/audit");
    await expect(page).toHaveURL(/\/purchases$/);
  });

  test("viewer is excluded from reference-data CRUD", async ({ page }) => {
    await login(page, "viewer@thebackroomop.com");
    await page.goto("/admin/asset-categories");
    await expect(page).toHaveURL(/\/inventory$/);
    await expect(page.getByRole("navigation", { name: "Workspace" })).not.toContainText("Asset categories");
  });

  test("admin switches workspaces; the cookie sticks", async ({ page }) => {
    await login(page, "admin@thebackroomop.com");
    await page.getByRole("button", { name: /br\.dept/ }).click();
    await page.getByRole("menuitem", { name: "Purchasing" }).click();
    await expect(page).toHaveURL(/\/purchases$/);
    await expect(page.getByRole("navigation", { name: "Workspace" })).toContainText("Procurement");
    await page.reload();
    await expect(page.getByRole("navigation", { name: "Workspace" })).toContainText("Procurement");
  });

  test("single-workspace roles get a static label, no switcher", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await expect(page.getByText("br.dept · 1 available")).toBeVisible();
    await expect(page.getByRole("button", { name: /br\.dept/ })).toHaveCount(0);
  });
});

test.describe("shell", () => {
  test("approvals badge shows the seeded urgent count", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    const badge = page.getByLabel(/open approvals/);
    await expect(badge).toContainText("3");
    await expect(badge).toHaveClass(/fault/);
  });

  test("theme survives a reload via the cookie contract", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await page.getByRole("button", { name: /Switch to dark/ }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  });

  test("shell passes axe (light)", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
  });

  test("mobile drawer opens, traps, and closes on ESC", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await login(page, "it@thebackroomop.com");
    await page.getByRole("button", { name: "Open navigation" }).click();
    await expect(page.getByRole("dialog", { name: "IT" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Open navigation" })).toBeFocused();
    expect(await page.evaluate(() => document.body.style.overflow)).toBe("");
  });

  test("command palette searches and navigates", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    // The post-login redirect is a fresh navigation; keyboard.press is a
    // single fire-and-forget action with no actionability retry (unlike a
    // locator click), so it can race the client hydration that attaches the
    // ⌘K listener. Wait for the page to go quiet before firing the shortcut.
    await page.waitForLoadState("networkidle");
    await page.keyboard.press("ControlOrMeta+k");
    const input = page.getByRole("dialog", { name: "Command palette" }).getByLabel("Search");
    await expect(input).toBeFocused();
    await input.fill("BR-LT-0148");
    await expect(page.getByRole("option", { name: /BR-LT-0148/ })).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/inventory\//);
    await expect(page.getByRole("dialog", { name: "Command palette" })).toHaveCount(0);
  });
});
