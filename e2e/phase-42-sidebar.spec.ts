import { test, expect, type Locator, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import AxeBuilder from "@axe-core/playwright";
import { SEED_PASSWORD } from "../prisma/fixtures";

/**
 * Phase 42 (spec docs/superpowers/specs/2026-10-18-sidebar-views-design.md §5): a sidebar that stays put, with
 * views under the current link.
 *   1. deep in /inventory the "Primary" sidebar is still on screen and its links still work;
 *   2. Inventory's Spare view counts what /inventory?status=SPARE lists, and becomes the current page on click;
 *   3. on /employees, Inventory's views are gone and Employees' show;
 *   4. /admin/asset-types opens Setup with Asset types current;
 *   5. a viewer's Setup points straight at Equipment policies and opens no list;
 *   6. Purchasing (admin, switched): Requests' views with Awaiting finance current after a click; Assets → IT inventory;
 *   7. at 1280×600 the nav scrolls inside the sidebar and the account row stays visible;
 *   8. axe on /inventory and /purchases, light and dark;
 *   9. (Task 4 review) a deep-scrolled page, then a client navigation from a link low in the nav: the new page opens
 *      at the top with the sidebar in view — the nav's scroll-into-view never moves the window.
 *
 * Phase 46 (spec §4.2) adds a "{Link} views" toggle button beside every link with views (case 2 checks it sits
 * outside the link); collapse, the rail and click-to-open are covered in e2e/phase-46-home.spec.ts. These cases run
 * with no br.sidebar cookie, i.e. the full sidebar.
 *
 * Views render only under the current link (spec §4.2): a view that carries a count has it in its accessible name
 * ("Spare 3 spare"), hence the anchored regexes below. The current link or view has aria-current="page".
 */

const IT = "it@thebackroomop.com";
const ADMIN = "admin@thebackroomop.com";
const VIEWER = "viewer@thebackroomop.com";
const PURCHASING = "purchasing@thebackroomop.com";

/** The /inventory toolbar's own row count (as in import-export.spec.ts). */
const ASSETS = /^[\d,]+ assets?$/;

test.beforeAll(() => {
  execSync("npm run db:seed", { timeout: 120_000 });
});

// Copied from e2e/phase-40.spec.ts — house rule: never import helpers across spec files.
async function login(page: Page, email: string) {
  await page.goto("/logout");
  await page.getByRole("link", { name: /^Log in/ }).click();
  await page.locator('[data-login-ready="true"]').waitFor();
  await page.getByLabel("Work email", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel("Password", { exact: true }).fill(SEED_PASSWORD);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}
async function waitForHydration(target: Locator) {
  const el = target.first();
  await el.waitFor({ state: "attached", timeout: 20_000 });
  await expect(async () => {
    expect(await el.evaluate((node) => Object.keys(node).some((k) => k.startsWith("__reactFiber$")))).toBe(true);
  }).toPass({ timeout: 20_000 });
}

const sidebarOf = (page: Page) => page.getByRole("complementary", { name: "Primary" });
const navOf = (page: Page) => sidebarOf(page).getByRole("navigation", { name: "Workspace" });
const scrollY = (page: Page) => page.evaluate(() => window.scrollY);

/** The links (or views) in `nav` by label → href. A label is matched at the start, so a count may follow it. */
async function expectLinks(nav: Locator, links: [label: string, href: string][]) {
  for (const [label, href] of links) {
    await expect(nav.getByRole("link", { name: new RegExp(`^${label}\\b`) }), label).toHaveAttribute("href", href);
  }
}

// ── axe, as e2e/axe-sweep.spec.ts runs it (copied — house rule) ─────────────────────────────────────────────────

// Rules that fail regardless of impact (axe-sweep.spec.ts's PROMOTED_RULES).
const PROMOTED_RULES = new Set<string>(["empty-table-header", "page-has-heading-one", "heading-order", "landmark-unique"]);

/**
 * The whole page at the project's bar: any moderate, serious or critical violation fails, and so does any
 * promoted rule whatever its impact (the existing sweep records "axe moderate none"). Each failure names its node
 * targets, so a sidebar node is easy to tell from the page's. Settles the pointer first, as axe-sweep's scanHere
 * does (a hovered primary button reports a phantom contrast failure mid-transition).
 */
async function expectAxeClean(page: Page, label: string) {
  await page.mouse.move(0, 0);
  await page.waitForTimeout(700);

  const results = await new AxeBuilder({ page }).analyze();
  const bad = results.violations
    .filter((v) =>
      v.impact === "moderate" || v.impact === "serious" || v.impact === "critical" || PROMOTED_RULES.has(v.id))
    .map((v) => `${v.id} (${v.impact}) ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
  expect(bad, `axe (moderate and above) on ${label}`).toEqual([]);
}

test.describe("phase 42 — the sidebar stays put, with views under the current link", () => {
  test("1. deep in /inventory the sidebar is still on screen, and Employees can be clicked", async ({ page }) => {
    await login(page, IT);
    await page.goto("/inventory");
    await expect(page.getByRole("main").getByText(ASSETS)).toBeVisible({ timeout: 30_000 });

    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    // The window really scrolled (spec §2: the window keeps scrolling, not an inner box).
    await expect.poll(() => scrollY(page)).toBeGreaterThan(0);

    const sidebar = sidebarOf(page);
    await expect(sidebar).toBeInViewport();
    // Checked before the click: Playwright scrolls a target into view on click, which would hide a sidebar that
    // scrolled away with the page.
    const employees = navOf(page).getByRole("link", { name: "Employees", exact: true });
    await expect(employees).toBeInViewport({ ratio: 1 });
    await employees.click();
    await expect(page).toHaveURL(/\/employees$/, { timeout: 30_000 });
  });

  test("2. Inventory's views show; Spare counts what its page lists and becomes the current page", async ({ page }) => {
    await login(page, IT);
    await page.goto("/inventory");
    const nav = navOf(page);
    await expectLinks(nav, [
      ["All", "/inventory"],
      ["Spare", "/inventory?status=SPARE"],
      ["Repairs", "/inventory?status=DEFECTIVE&sort=defectiveSince"],
      ["Missing", "/inventory?status=MISSING"],
      ["Register assets", "/inventory/register"],
    ]);
    await expect(nav.getByRole("link", { name: "All", exact: true })).toHaveAttribute("aria-current", "page");
    // An open link hands the current-page role to its view.
    await expect(nav.getByRole("link", { name: "Inventory", exact: true })).not.toHaveAttribute("aria-current", "page");
    // Phase 46 (spec §4.2): the chevron is a toggle button of its own beside the link, never inside it; the current
    // link's is expanded, every other link's collapsed with its views not drawn.
    await expect(nav.getByRole("button", { name: "Inventory views" })).toHaveAttribute("aria-expanded", "true");
    await expect(nav.getByRole("button", { name: "Employees views" })).toHaveAttribute("aria-expanded", "false");
    await expect(nav.locator("a button")).toHaveCount(0);

    const spare = nav.getByRole("link", { name: /^Spare\b/ });
    const count = spare.locator('span[aria-label$=" spare"]');
    await expect(count).toHaveAttribute("aria-label", /^\d+ spare$/);
    const n = Number((await count.innerText()).trim());
    expect(n, "the seed has spares, so the count shows").toBeGreaterThan(0);
    await expect(count).toHaveAttribute("aria-label", `${n} spare`);

    await spare.click();
    await expect(page).toHaveURL(/\/inventory\?status=SPARE$/, { timeout: 30_000 });
    await expect(spare).toHaveAttribute("aria-current", "page");
    await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
    // Spec §2 anti-goal: a view's count never disagrees with the row count its own page shows.
    await expect(page.getByRole("main").getByText(ASSETS)).toHaveText(new RegExp(`^${n.toLocaleString("en-US")} assets?$`), { timeout: 30_000 });
  });

  test("3. on /employees, Inventory's views are gone and Employees' views show", async ({ page }) => {
    await login(page, IT);
    await page.goto("/employees");
    const nav = navOf(page);
    await expect(nav.getByRole("link", { name: "Inventory", exact: true })).toHaveAttribute("href", "/inventory");
    for (const href of ["/inventory?status=SPARE", "/inventory?status=MISSING", "/inventory/register"]) {
      await expect(nav.locator(`a[href="${href}"]`), href).toHaveCount(0);
    }
    await expectLinks(nav, [
      ["Everyone", "/employees"],
      ["Client staff", "/employees?kind=CLIENT"],
      ["Leaving", "/employees?employment=OFFBOARDING"],
      ["Policy gaps", "/employees?gaps=1"],
    ]);
    await expect(nav.getByRole("link", { name: "Everyone", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
    // One open list: the views' own list sits inside the current link's item, and there is only one.
    await expect(nav.locator("li ul")).toHaveCount(1);
    // No section headings (spec §1: groups are separated by spacing only).
    await expect(sidebarOf(page).getByRole("heading")).toHaveCount(0);
  });

  test("4. /admin/asset-types opens Setup, with Asset types current", async ({ page }) => {
    await login(page, IT);
    await page.goto("/admin/asset-types");
    const nav = navOf(page);
    // A link with no href of its own points at its first visible view (spec §3.5).
    const setup = nav.getByRole("link", { name: "Setup", exact: true });
    await expect(setup).toHaveAttribute("href", "/admin/asset-categories");
    await expect(setup).not.toHaveAttribute("aria-current", "page");
    await expectLinks(nav, [
      ["Asset categories", "/admin/asset-categories"],
      ["Asset types", "/admin/asset-types"],
      ["Departments & clients", "/admin/departments"],
      ["Equipment policies", "/admin/equipment-policies"],
    ]);
    await expect(nav.getByRole("link", { name: "Asset types", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
  });

  test("5. a viewer's Setup points straight at Equipment policies and opens no list", async ({ page }) => {
    await login(page, VIEWER);
    const nav = navOf(page);
    const setup = nav.getByRole("link", { name: "Setup", exact: true });
    await expect(setup).toHaveAttribute("href", "/admin/equipment-policies");

    await setup.click();
    await expect(page).toHaveURL(/\/admin\/equipment-policies$/, { timeout: 30_000 });
    // One visible view → no view list; the link itself is the current page (spec §3.5, §4.2).
    await expect(setup).toHaveAttribute("aria-current", "page");
    await expect(nav.locator("li ul")).toHaveCount(0);
    for (const label of ["Equipment policies", "Asset categories", "Asset types", "Departments & clients"]) {
      await expect(nav.getByRole("link", { name: label }), label).toHaveCount(0);
    }
  });

  test("6. Purchasing (admin, switched): Requests' views, Awaiting finance current on click; Assets → IT inventory", async ({ page }) => {
    test.setTimeout(90_000);
    await login(page, ADMIN);
    const tag = page.getByRole("button", { name: /4 workspaces/ });
    await waitForHydration(tag);
    await tag.click();
    await page.getByRole("menuitem", { name: "Purchasing" }).click();
    await expect(page).toHaveURL(/\/purchases$/, { timeout: 30_000 });
    await expect(page.getByRole("button", { name: "Switch workspace — Purchasing, 4 workspaces" })).toBeVisible();

    const nav = navOf(page);
    await expect(nav.getByRole("link", { name: "Requests", exact: true })).toHaveAttribute("href", "/purchases");
    await expectLinks(nav, [
      ["All", "/purchases"],
      ["My drafts", "/purchases?state=DRAFT"],
      ["Awaiting IT", "/purchases?state=SUBMITTED"],
      ["Awaiting finance", "/purchases?state=IT_REVIEWED"],
      ["Completed", "/purchases?state=COMPLETED"],
      ["Register purchase", "/purchases/new"],
    ]);
    await expect(nav.getByRole("link", { name: "All", exact: true })).toHaveAttribute("aria-current", "page");

    const awaitingFinance = nav.getByRole("link", { name: /^Awaiting finance\b/ });
    await awaitingFinance.click();
    await expect(page).toHaveURL(/\/purchases\?state=IT_REVIEWED$/, { timeout: 30_000 });
    await expect(awaitingFinance).toHaveAttribute("aria-current", "page");
    await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);

    const assets = nav.getByRole("link", { name: "Assets", exact: true });
    await expect(assets).toHaveAttribute("href", "/inventory?cls=PURCHASING");
    await assets.click();
    await expect(page).toHaveURL(/\/inventory\?cls=PURCHASING$/, { timeout: 30_000 });
    await expect(nav.getByRole("link", { name: "Purchasing assets", exact: true })).toHaveAttribute("aria-current", "page");
    // Requests closed when Assets became current.
    await expect(nav.locator('a[href="/purchases?state=IT_REVIEWED"]')).toHaveCount(0);

    const itInventory = nav.getByRole("link", { name: "IT inventory", exact: true });
    await expect(itInventory).toHaveAttribute("href", "/inventory?cls=IT");
    await itInventory.click();
    await expect(page).toHaveURL(/\/inventory\?cls=IT$/, { timeout: 30_000 });
    await expect(itInventory).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("heading", { name: "Inventory", level: 1 })).toBeVisible();
    await expect(page.getByRole("main").getByRole("link", { name: "BR-LT-0148" })).toBeVisible();
    await expect(page.getByRole("main").getByRole("link", { name: "BR-VH-0001" })).toHaveCount(0);
  });

  test("7. at 1280×600 the nav scrolls inside the sidebar; the account row stays visible", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 600 });
    await login(page, IT);
    await page.goto("/inventory");
    const sidebar = sidebarOf(page);
    const nav = navOf(page);
    await expect(nav.getByRole("link", { name: "All", exact: true })).toHaveAttribute("aria-current", "page");

    // The nav's scroll region: its nearest scrolling ancestor, which must sit inside the sidebar.
    const region = await nav.evaluate((el) => {
      let s: Element | null = el;
      while (s && !/(auto|scroll)/.test(getComputedStyle(s).overflowY)) s = s.parentElement;
      if (!s || s === document.documentElement || s === document.body) return null;
      return { scrollHeight: s.scrollHeight, clientHeight: s.clientHeight, inSidebar: !!s.closest('aside[aria-label="Primary"]') };
    });
    expect(region, "the nav has a scroll region of its own").not.toBeNull();
    expect(region!.inSidebar).toBe(true);
    expect(region!.scrollHeight, "at 600 px the nav does not fit, so it scrolls").toBeGreaterThan(region!.clientHeight);

    const account = sidebar.getByRole("button", { name: "Account menu" });
    await expect(account).toBeInViewport({ ratio: 1 });

    // The window still scrolls the page, and the account row stays.
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect.poll(() => scrollY(page)).toBeGreaterThan(0);
    await expect(account).toBeInViewport({ ratio: 1 });

    // Scrolling the nav reaches the last link without moving the window.
    const windowY = await scrollY(page);
    const setup = nav.getByRole("link", { name: "Setup", exact: true });
    await nav.evaluate((el) => {
      let s: Element | null = el;
      while (s && !/(auto|scroll)/.test(getComputedStyle(s).overflowY)) s = s.parentElement;
      s!.scrollTop = s!.scrollHeight;
    });
    await expect(setup).toBeInViewport({ ratio: 1 });
    expect(await scrollY(page)).toBe(windowY);
    await expect(account).toBeInViewport({ ratio: 1 });
  });

  test("8. axe passes on /inventory and /purchases, light and dark", async ({ page }) => {
    test.setTimeout(180_000);
    for (const [email, path] of [[IT, "/inventory"], [PURCHASING, "/purchases"]] as const) {
      await login(page, email);
      for (const theme of ["light", "dark"] as const) {
        // The theme cookie the root layout reads (theme-toggle.tsx writes the same one).
        await page.context().addCookies([{ name: "br.theme", value: theme, url: new URL(page.url()).origin }]);
        await page.goto(path);
        expect(new URL(page.url()).pathname, `landed on ${path}`).toBe(path);
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        await expect(navOf(page).locator('[aria-current="page"]')).toHaveCount(1);
        await expectAxeClean(page, `${path} (${email}, ${theme})`);
      }
    }
  });

  test("9. a deep-scrolled page, then a link low in the nav: the new page opens at the top with the sidebar in view", async ({ page }) => {
    // Tall enough that the whole nav fits (case 7 covers the scrolling nav), so Activity is on screen untouched.
    // Phase 46: 1000 px, not 900 — the "Collapse sidebar" row above the account row takes ~44 px from the nav.
    await page.setViewportSize({ width: 1280, height: 1000 });
    await login(page, IT);
    await page.goto("/inventory");
    await expect(page.getByRole("main").getByText(ASSETS)).toBeVisible({ timeout: 30_000 });
    const nav = navOf(page);
    // Hydrated, so the click below is a client navigation (Next's Link), not a full page load.
    const activity = nav.getByRole("link", { name: "Activity", exact: true });
    await waitForHydration(activity);
    await expect(activity).toHaveAttribute("href", "/inventory/activity");

    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect.poll(() => scrollY(page)).toBeGreaterThan(100);
    await expect(activity).toBeInViewport({ ratio: 1 });
    await activity.click();

    await expect(page).toHaveURL(/\/inventory\/activity$/, { timeout: 30_000 });
    await expect(page.getByRole("heading", { name: "Inventory activity", level: 1 })).toBeVisible({ timeout: 30_000 });
    const current = nav.getByRole("link", { name: "Inventory activity", exact: true });
    await expect(current).toHaveAttribute("aria-current", "page");
    // Next puts a new page at the top; the nav's scroll-into-view of its current entry must not move the window
    // afterwards (it runs after the route commits, so give it a beat and check again).
    await expect.poll(() => scrollY(page)).toBe(0);
    await page.waitForTimeout(500);
    expect(await scrollY(page)).toBe(0);
    await expect(sidebarOf(page)).toBeInViewport();
    await expect(current).toBeInViewport({ ratio: 1 });
  });
});
