import { test, expect, type Locator, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import AxeBuilder from "@axe-core/playwright";
import { PrismaClient } from "@prisma/client";
import { readSheet } from "read-excel-file/node";
import { SEED_PASSWORD } from "../prisma/fixtures";

/**
 * Phase 20, Task 7 — directory-quality (spec §5), 5 cases: the same-name
 * guard on create and on import, the leavers toggle, and the holdings
 * export.
 *
 * Seeded fixtures this file depends on (prisma/seed.ts), verified against
 * source: EMP-0099 Carlo Dizon, Team Lead, Operations — the same-name
 * target every "Carlo Dizon" collision in this file names — and EMP-0099
 * already carries one seeded transfer (HR -> Operations, 90 days ago), so
 * their page's Transfers card has a real row for case 5's axe sweep.
 * EMP-0093 Faith Mercado, Sales Associate, Sales, is the seeded OFFBOARDED
 * employee. EMP-0042 Marites Bautista holds BR-LT-0148, BR-MN-0902,
 * BR-DK-0071 (DEPLOYED) and BR-PH-0287 (TEMPORARY) and has no ACTIVE
 * reservations. Departments: Finance, HR, IT, Operations, Sales. Every
 * account is @thebackroomop.com / SEED_PASSWORD.
 */

const db = new PrismaClient();

test.beforeAll(() => {
  execSync("npm run db:seed", { timeout: 120_000 });
});
test.afterAll(async () => {
  await db.$disconnect();
});

// Copied from e2e/stock.spec.ts:45-51 — house rule: never import helpers
// across spec files, since each file reseeds independently.
async function login(page: Page, email: string) {
  await page.goto("/logout");
  await page.getByLabel(/Email/).fill(email);
  await page.getByLabel(/Password/).fill(SEED_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

// Copied from e2e/stock.spec.ts:56-62.
async function expectNoSeriousAxe(page: Page) {
  await page.mouse.move(0, 0);
  await page.waitForTimeout(700);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
}

// Copied from e2e/stock.spec.ts:67-77.
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

test.describe.serial("directory", () => {
  test("1. creating a same-name-in-department employee warns, refuses unticked, and creates ticked", async ({ page }) => {
    await login(page, IT);
    await page.goto("/employees/new");
    await page.getByLabel(/^Employee number\b/).fill("EMP-9101");
    await page.getByLabel(/^Joined\b/).fill("2026-02-01");
    await page.getByLabel(/^Name\b/).fill("Carlo Dizon");
    await page.getByLabel(/^Title\b/).fill("Team Lead");
    await page.getByLabel(/^Department\b/).selectOption({ label: "Operations" });

    // The live nudge (same-name-check.tsx), debounced 400ms.
    await expect(page.getByText("Another Carlo Dizon exists in Operations (EMP-0099)")).toBeVisible({
      timeout: 10_000,
    });

    await page.getByRole("button", { name: "Create employee" }).click();
    // The field refusal under Name (actions.ts's own message), unique
    // substring so it can't collide with the banner's shorter title text.
    await expect(
      page.getByText("tick 'This is a different person' to add them anyway"),
    ).toBeVisible({ timeout: 10_000 });

    await page.getByRole("checkbox", { name: "This is a different person" }).check();
    await page.getByRole("button", { name: "Create employee" }).click();
    await expect(page).toHaveURL(/\/employees\/[^/]+$/, { timeout: 15_000 });
    await expect(page.getByRole("heading", { name: "Carlo Dizon" })).toBeVisible();

    const created = await db.employee.findUniqueOrThrow({ where: { employeeNo: "EMP-9101" } });
    expect(created.name).toBe("Carlo Dizon");
  });

  test("2. importing a same-name row blocks it, and the option creates it alongside the ordinary row", async ({ page }) => {
    test.setTimeout(120_000);
    await login(page, IT);
    await page.goto("/employees/import");
    const spreadsheet = page.getByLabel(/Spreadsheet/);
    await waitForHydration(spreadsheet);
    await spreadsheet.setInputFiles("e2e/fixtures/employees-same-name.xlsx");
    await page.getByRole("button", { name: /^Validate/ }).click();

    await expect(page.getByText("1 new · 0 updates · 1 blocked")).toBeVisible({ timeout: 30_000 });
    // The blocked-cause label (import-vocabulary.ts's own spec.label, not
    // the raw "same-name-in-department" cause key).
    await expect(page.getByText("Same name already in that department")).toBeVisible();

    await page.getByRole("button", { name: "Add same-name rows as new people" }).click();
    await expect(page.getByText("2 new · 0 updates · 0 blocked")).toBeVisible({ timeout: 30_000 });

    await page.getByRole("button", { name: "Import 2 rows" }).click();
    await expect(
      page.getByText("2 new · 0 updated · 0 already matched · 0 blocked · 0 failed"),
    ).toBeVisible({ timeout: 60_000 });

    const carlo150 = await db.employee.findUniqueOrThrow({ where: { employeeNo: "EMP-0150" } });
    expect(carlo150.name).toBe("Carlo Dizon");
    const carloDept = await db.department.findUniqueOrThrow({ where: { id: carlo150.departmentId } });
    expect(carloDept.name).toBe("Operations");

    const bettina = await db.employee.findUniqueOrThrow({ where: { employeeNo: "EMP-9102" } });
    expect(bettina.name).toBe("Bettina Reyes");
  });

  test("3. /employees hides an OFFBOARDED leaver by default; Show leavers and ?employment=OFFBOARDED both reveal them", async ({ page }) => {
    await login(page, IT);
    await page.goto("/employees");
    await expect(page.getByRole("row", { name: /EMP-0093/ })).toHaveCount(0);

    // I-2 (final review): "Facet counts for employment keep counting all
    // three values" (spec §5) — the employment groupBy forces the leavers
    // toggle on internally, so the dropdown's own OFFBOARDED count must read
    // the real number of leavers (the seed has exactly one, EMP-0093) even
    // while the list itself still hides them by default. Checked BEFORE the
    // "Show leavers" click below, on the exact default state the review's
    // scenario named — this is the one moment a stale groupBy would have
    // read 0 instead.
    await page.getByRole("button", { name: "Employment" }).click();
    const employmentDialog = page.getByRole("dialog", { name: "Filter by Employment" });
    await expect(employmentDialog).toBeVisible();
    const offboardedOption = employmentDialog.locator("label", { hasText: "OFFBOARDED" });
    await expect(offboardedOption).toBeVisible();
    await expect(offboardedOption.locator("span").last()).toHaveText("1");
    await page.keyboard.press("Escape");
    await expect(employmentDialog).toBeHidden();

    await page.getByRole("link", { name: "Show leavers" }).click();
    await expect(page).toHaveURL(/leavers=1/);
    await expect(page.getByRole("row", { name: /EMP-0093/ })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("link", { name: "Hide leavers" })).toBeVisible();

    await page.goto("/employees?employment=OFFBOARDED");
    await expect(page.getByRole("row", { name: /EMP-0093/ })).toBeVisible({ timeout: 15_000 });
  });

  test("4. EMP-0042's holdings export is a typed .xlsx naming them, with the Tag header and a Reservations row", async ({ page }) => {
    const marites = await db.employee.findUniqueOrThrow({ where: { employeeNo: "EMP-0042" } });

    await login(page, IT);
    const res = await page.request.get(`/employees/${marites.id}/holdings`);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-disposition"]).toContain("holdings-EMP-0042");

    const grid = (await readSheet(Buffer.from(await res.body()))) as unknown[][];
    expect(grid[0][0]).toBe("Tag");
    expect(grid.some((row) => row[0] === "BR-LT-0148")).toBe(true);
    expect(grid.some((row) => row[0] === "Reservations")).toBe(true);
  });

  test("5. no serious or critical axe violations on an employee page with a populated Transfers card", async ({ page }) => {
    const carlo = await db.employee.findUniqueOrThrow({ where: { employeeNo: "EMP-0099" } });
    await login(page, IT);
    await page.goto(`/employees/${carlo.id}`);
    await expect(page.getByRole("heading", { name: "Transfers" })).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("li").filter({ hasText: "HR → Operations" })).toBeVisible();
    await expectNoSeriousAxe(page);
  });
});
