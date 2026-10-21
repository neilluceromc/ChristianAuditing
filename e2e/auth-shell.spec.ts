import { test, expect, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import AxeBuilder from "@axe-core/playwright";
import { PrismaClient } from "@prisma/client";
import { SEED_PASSWORD } from "../prisma/fixtures";

const db = new PrismaClient();
test.afterAll(async () => {
  await db.$disconnect();
});

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByRole("link", { name: /^Log in/ }).click();
  await page.locator('[data-login-ready="true"]').waitFor();
  await page.getByLabel("Work email", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel("Password", { exact: true }).fill(SEED_PASSWORD);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
  // Phase 47 (spec §5.4): the first page after a sign-in rewrites the settings cookies from the person's saved prefs
  // (UiPrefsSync → restoreUiPrefs, stamping br.uid) and refreshes; wait for it, so the next step never races that refresh.
  const { id } = await db.user.findUniqueOrThrow({ where: { email: email.toLowerCase() }, select: { id: true } });
  await expect
    .poll(async () => (await page.context().cookies()).find((c) => c.name === "br.uid")?.value, { timeout: 30_000 })
    .toBe(id);
}

/**
 * Phase 42 spec §4.3 (builder-check ruling): IT's Approvals badge label. With no purchase reviews waiting it is
 * exactly the old "{n} open approvals[, some past SLA]"; otherwise "{sum} waiting: {a} open approval(s), {b}
 * purchase review(s)[, some approvals past SLA]". Copied, not imported — house rule.
 */
function itApprovalsLabel(open: number, reviews: number, overdue: boolean): string {
  if (reviews === 0) return `${open} open approvals${overdue ? ", some past SLA" : ""}`;
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  return `${open + reviews} waiting: ${plural(open, "open approval")}, ${plural(reviews, "purchase review")}`
    + (overdue ? ", some approvals past SLA" : "");
}

// Spec files share one database and run in alphabetical order — each file
// reseeds so no file inherits another's mutations (approvals-audit deploys
// BR-LT-0181 and drains the badge, which broke auth-shell/it-core).
test.beforeAll(() => {
  execSync("npm run db:seed", { timeout: 120_000 });
});

test.describe("auth", () => {
  test("login page passes axe", async ({ page }) => {
    await page.goto("/login");
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
  });

  test("unauthenticated deep link redirects to login and back", async ({ page }) => {
    await page.goto("/employees");
    await expect(page).toHaveURL(/\/login\?next=%2Femployees|\/login\?next=\/employees/);
    await page.getByRole("link", { name: /^Log in/ }).click();
    await page.locator('[data-login-ready="true"]').waitFor();
    await page.getByLabel("Work email", { exact: true }).fill("it@thebackroomop.com");
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page.getByLabel("Password", { exact: true }).fill(SEED_PASSWORD);
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    // Headroom, not a weaker assertion. This is the one place in the file that
    // signs in WITHOUT the `login` helper above — the helper uses
    // `waitForURL`, which gets the 30s navigation budget, while a bare
    // `toHaveURL` gets the 5s expect budget. Those 5s have to cover the
    // credentials POST, the session write, the bounce back to `?next=`, and a
    // cold render of /employees; it doesn't always, and it failed here in the
    // Task 13 battery with the browser still sitting on /login. Same class as
    // §6a rule 61's neighbours in it-core.spec.ts.
    await expect(page).toHaveURL(/\/employees/, { timeout: 30_000 });
  });

  test("wrong password shows an inline error", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("link", { name: /^Log in/ }).click();
    await page.locator('[data-login-ready="true"]').waitFor();
    await page.getByLabel("Work email", { exact: true }).fill("it@thebackroomop.com");
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page.getByLabel("Password", { exact: true }).fill("wrong-password");
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    // The error sits under the Password field (an aria-live region the field points at), and the card stays on
    // step 2 with the email still shown. Read through the field's accessible description, not a role="alert":
    // Next.js renders its own always-present, empty role="alert" route announcer.
    await expect(page.getByLabel("Password", { exact: true })).toHaveAccessibleDescription(/Wrong email or password/);
    await expect(page.getByText("it@thebackroomop.com", { exact: true })).toBeVisible();
  });

  // Finance follow-up (spec §7.1): every sign-in lands on Home, whatever the role (a `next` link still wins — above).
  test("every role lands on Home after signing in", async ({ page }) => {
    await login(page, "purchasing@thebackroomop.com");
    await expect(page).toHaveURL((u) => u.pathname === "/");
  });

  test("bootstrap 404s once users exist", async ({ page }) => {
    const res = await page.goto("/bootstrap");
    expect(res?.status()).toBe(404);
  });

  test("signed-in users are bounced off /login", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await page.goto("/login");
    await expect(page).toHaveURL((u) => u.pathname === "/");
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
    // Phase 42 (spec §3.1, §3.5): Asset categories is a Setup view, and views render only under the current link —
    // so look where it would be, on Setup's own page. The viewer's Setup has one visible view (Equipment
    // policies): the link points straight at it and opens no list.
    await page.goto("/admin/equipment-policies");
    const nav = page.getByRole("navigation", { name: "Workspace" });
    await expect(nav.getByRole("link", { name: "Setup", exact: true })).toHaveAttribute("href", "/admin/equipment-policies");
    await expect(nav).not.toContainText("Asset categories");
  });

  test("admin switches workspaces; the cookie sticks", async ({ page }) => {
    await login(page, "admin@thebackroomop.com");
    // Phase 40 (spec §3): the switcher reads "{n} workspaces", never the cookie name.
    await page.getByRole("button", { name: /4 workspaces/ }).click();
    await page.getByRole("menuitem", { name: "Purchasing" }).click();
    await expect(page).toHaveURL(/\/purchases$/);
    // Phase 42 (spec §3.2): no headings any more — Purchasing's nav is known by its Requests link.
    const nav = page.getByRole("navigation", { name: "Workspace" });
    await expect(nav.getByRole("link", { name: "Requests", exact: true })).toHaveAttribute("href", "/purchases");
    await expect(page.getByRole("button", { name: /^Switch workspace — Purchasing, 4 workspaces$/ })).toBeVisible();
    await page.reload();
    await expect(nav.getByRole("link", { name: "Requests", exact: true })).toHaveAttribute("href", "/purchases");
    await expect(page.getByRole("button", { name: /^Switch workspace — Purchasing, 4 workspaces$/ })).toBeVisible();
  });

  test("single-workspace roles get a static label, no switcher", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    // Phase 42 (spec §4.4): the brand row's workspace tag reads just "IT" — plain text, not a control, and the
    // old "1 workspace" line is gone.
    const sidebar = page.getByRole("complementary", { name: "Primary" });
    await expect(sidebar.getByText("IT", { exact: true })).toBeVisible();
    await expect(sidebar).not.toContainText(/workspace/i);
    await expect(page.getByRole("button", { name: /workspaces?$/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Switch workspace/ })).toHaveCount(0);
    await expect(page.getByText(/br\.dept/)).toHaveCount(0);
  });
});

test.describe("shell", () => {
  test("approvals badge shows the seeded urgent count", async ({ page }) => {
    // Phase 42 (spec §4.3): IT's Approvals badge is the 3 seeded open approvals (one past SLA) plus the purchase
    // reviews waiting for IT (the seed's PR-0198), so waiting reviews stay visible while Approvals is closed.
    const reviews = await db.purchaseOrder.count({ where: { state: "WITH_IT" } });
    await login(page, "it@thebackroomop.com");
    const badge = page.getByLabel(/open approval/);
    await expect(badge).toHaveText(String(3 + reviews));
    await expect(badge).toHaveAttribute("aria-label", itApprovalsLabel(3, reviews, true));
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
    await page.getByRole("button", { name: "Open menu" }).click();
    await expect(page.getByRole("dialog", { name: "IT" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Open menu" })).toBeFocused();
    expect(await page.evaluate(() => document.body.style.overflow)).toBe("");
  });

  test("command palette searches and navigates", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    // The post-login redirect is a fresh navigation; keyboard.press is a
    // single fire-and-forget action with no actionability retry (unlike a
    // locator click), so it can race the client hydration that attaches the
    // ⌘K listener, and networkidle alone does not guarantee it is attached.
    // So retry the shortcut until the palette is open, pressing only while the
    // dialog is not visible (a press while it is open would close it).
    await page.waitForLoadState("networkidle");
    const dialog = page.getByRole("dialog", { name: "Command palette" });
    const input = dialog.getByRole("combobox", { name: "Search" });
    await expect(async () => {
      if (!(await dialog.isVisible())) await page.keyboard.press("ControlOrMeta+k");
      await expect(input).toBeFocused({ timeout: 1_000 });
    }).toPass({ timeout: 15_000 });
    await input.fill("BR-LT-0148");
    await expect(page.getByRole("option", { name: /BR-LT-0148/ })).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/inventory\//);
    await expect(page.getByRole("dialog", { name: "Command palette" })).toHaveCount(0);
  });

  /**
   * Regression guard for a deleted `(app)/[...pending]` catch-all.
   *
   * That route survived from the phased build and intercepted every 404 under
   * the (app) group, rendering "This screen arrives in Phase 3 — on the
   * roadmap, the page isn't built yet" with a PLANNED pill and HTTP 200. Once
   * all eleven phases had shipped that message could never be true again, and
   * it meant the app had no real 404 inside its shell: any typo under an
   * allowed path prefix became a confident promise of a feature.
   *
   * The failure mode of re-adding such a catch-all is SILENT — 404s simply
   * stop happening and every wrong URL looks like a page — so this asserts
   * the STATUS CODE, not just the copy. A test that only checked for the
   * words would pass against any friendly-looking placeholder.
   */
  test("an unmatched path under the app shell is a real 404, not a placeholder", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    // Must sit under a prefix PATH_RULES admits: a path no rule allows is
    // redirected to the role's own landing by middleware.ts before routing is
    // ever consulted, so it would never reach a 404 either way.
    const resp = await page.goto("/inventory/labels/no-such-page");
    expect(resp?.status(), "an unmatched route must answer 404").toBe(404);
    await expect(page.getByText("This page doesn't exist")).toBeVisible();
    await expect(page.getByText(/arrives in Phase/)).toHaveCount(0);
  });
});
