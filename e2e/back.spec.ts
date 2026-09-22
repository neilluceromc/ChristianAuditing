import { test, expect, type Locator, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import AxeBuilder from "@axe-core/playwright";
import { PrismaClient } from "@prisma/client";
import { SEED_PASSWORD } from "../prisma/fixtures";

/**
 * Phase 28, Task 1 — the "← Back" control on every page that has a parent.
 * `PageHeader` renders it whenever the page's breadcrumb carries at least one
 * LINKED crumb; the button goes where the operator came from when this tab has
 * a previous in-app page (sessionStorage `br.nav-stack` says WHETHER,
 * `router.back()` says WHERE, so a list returns with its filters intact), and
 * to the breadcrumb's nearest linked crumb otherwise — a deep link, a fresh
 * tab, a scanned QR.
 *
 * Three cases:
 *   1 the record's Back returns to the list exactly as it was left (filters);
 *   2 a deep link (fresh context, no in-app history) falls back to the parent;
 *   3 top-level lists and Home carry no Back at all, and a profile carries
 *     exactly one, reading "Back".
 *
 * Seeded fixtures (prisma/seed.ts), read off the seed:
 *   BR-HS-0502 — a SPARE headset, so it is on `/inventory?status=SPARE`.
 *   Nina Robles EMP-0097 — an ACTIVE employee with a profile page.
 * No case mutates anything; `beforeAll` reseeds all the same, in house style.
 */

const db = new PrismaClient();

test.beforeAll(() => {
  execSync("npm run db:seed", { timeout: 120_000 });
});
test.afterAll(async () => {
  await db.$disconnect();
});

// Copied from e2e/it-nav.spec.ts:66-72 (itself from e2e/it-gaps.spec.ts) —
// house rule: never import helpers across spec files, since each file reseeds
// independently.
async function login(page: Page, email: string) {
  await page.goto("/logout");
  await page.getByLabel(/Email/).fill(email);
  await page.getByLabel(/Password/).fill(SEED_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

// Copied from e2e/it-nav.spec.ts:75-80.
async function expectNoSeriousAxe(page: Page) {
  await page.mouse.move(0, 0);
  await page.waitForTimeout(700);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
}

// Copied from e2e/it-nav.spec.ts:83-91.
async function waitForHydration(target: Locator) {
  const el = target.first();
  await el.waitFor({ state: "attached", timeout: 20_000 });
  await expect(async () => {
    expect(await el.evaluate((node) => Object.keys(node).some((k) => k.startsWith("__reactFiber$")))).toBe(
      true,
    );
  }).toPass({ timeout: 20_000 });
}

const IT = "it@thebackroomop.com";

test.describe("Phase 28 — the Back control", () => {
  test("1. Back from a record returns to the list exactly as it was left", async ({ page }) => {
    await login(page, IT);
    await page.goto("/inventory?status=SPARE");
    const row = page.getByRole("row", { name: /BR-HS-0502/ });
    await waitForHydration(row);
    await row.click();
    await expect(page).toHaveURL(/\/inventory\/[a-z0-9]+$/);
    const back = page.getByRole("button", { name: "Back" });
    await waitForHydration(back);
    await back.click();
    await expect(page).toHaveURL(/\/inventory\?status=SPARE$/);
    await expectNoSeriousAxe(page);
  });

  test("2. a deep link's Back goes to the parent list", async ({ browser }) => {
    // A fresh browser context: no in-app history in this tab, and /login sits outside the tracked shell.
    const headset = await db.asset.findUniqueOrThrow({ where: { tag: "BR-HS-0502" } });
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await page.goto(`/inventory/${headset.id}`);
      await page.getByLabel(/Email/).fill(IT);
      await page.getByLabel(/Password/).fill(SEED_PASSWORD);
      await page.getByRole("button", { name: "Sign in" }).click();
      await expect(page).toHaveURL(new RegExp(`/inventory/${headset.id}$`));
      const back = page.getByRole("button", { name: "Back" });
      await waitForHydration(back);
      await back.click();
      await expect(page).toHaveURL(/\/inventory$/);
    } finally {
      await context.close();
    }
  });

  test("3. top-level lists and Home have no Back; a profile has exactly one, and it reads Back", async ({ page }) => {
    const nina = await db.employee.findUniqueOrThrow({ where: { employeeNo: "EMP-0097" } });
    await login(page, IT);
    for (const path of ["/", "/inventory", "/employees", "/approvals"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.getByRole("button", { name: "Back" })).toHaveCount(0);
    }
    await page.goto(`/employees/${nina.id}`);
    const back = page.getByRole("button", { name: "Back" });
    await expect(back).toHaveCount(1);
    await expect(back).toHaveText(/Back/);
    await expectNoSeriousAxe(page);
    await back.click();
    await expect(page).toHaveURL(/\/approvals$/); // where we came from — the last list visited above
  });
});
