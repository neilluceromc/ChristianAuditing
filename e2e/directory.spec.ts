import { test, expect, type Locator, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import AxeBuilder from "@axe-core/playwright";
import { PrismaClient } from "@prisma/client";
import { readSheet } from "read-excel-file/node";
import { login } from "./fixtures/login";

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

/**
 * Phase 37 (spec §5): Add employee is three steps — Next past Details, wait for Equipment to load its
 * lines, Next again to Check & create. Copied per file (house rule: no helpers across spec files).
 */
async function toCheckAndCreate(page: Page) {
  const next = page.getByRole("button", { name: "Next", exact: true });
  await next.click();
  await expect(page.getByRole("list", { name: "Steps" }).getByRole("listitem").filter({ hasText: "Equipment" }))
    .toHaveAttribute("aria-current", "step", { timeout: 15_000 });
  await expect(next).toBeEnabled({ timeout: 15_000 });
  await next.click();
  await expect(page.getByRole("button", { name: "Create employee" })).toBeVisible({ timeout: 15_000 });
}

test.describe.serial("directory", () => {
  test("1. creating a same-name-in-department employee warns, refuses unticked, and creates ticked", async ({ page }) => {
    await login(page, IT);
    await page.goto("/employees/new");
    await page.getByLabel(/^Employee no\./).fill("EMP-9101");
    await page.getByLabel(/^Start date\b/).fill("2026-02-01");
    await page.getByLabel(/^Name\b/).fill("Carlo Dizon");
    await page.getByLabel(/^Title\b/).fill("Team Lead");
    await page.getByLabel(/^Department\b/).selectOption({ label: "Operations" });

    // The live nudge (same-name-check.tsx), debounced 400ms.
    await expect(page.getByText("Another Carlo Dizon exists in Operations (EMP-0099)")).toBeVisible({
      timeout: 10_000,
    });

    await toCheckAndCreate(page);
    await page.getByRole("button", { name: "Create employee" }).click();
    // The refusal lands back on step 1, in the same-name banner (actions.ts's own message), unique
    // substring so it can't collide with the banner's shorter title text.
    await expect(
      page.getByText("tick 'This is a different person' to add them anyway"),
    ).toBeVisible({ timeout: 10_000 });

    await page.getByRole("checkbox", { name: "This is a different person" }).check();
    await toCheckAndCreate(page);
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

  test("3. /employees hides an OFFBOARDED leaver by default; the leavers link and ?employment=OFFBOARDED both reveal them", async ({ page }) => {
    await login(page, IT);
    await page.goto("/employees");
    await expect(page.getByRole("row", { name: /EMP-0093/ })).toHaveCount(0);

    // I-2 (final review): the hidden-leavers count must read the real number
    // of leavers (the seed has exactly one, EMP-0093) while the list itself
    // still hides them by default. Phase 45 (spec §3.2): the Employment facet
    // left the toolbar, so the count that says so is the toolbar's own
    // "· 1 leaver hidden" link — checked BEFORE the click below, on the exact
    // default state, the one moment a stale count would read 0 (and the link
    // would be missing).
    const leaversLink = page.getByRole("link", { name: "1 leaver hidden", exact: true });
    await expect(leaversLink).toBeVisible();
    expect(await db.employee.count({ where: { employment: "OFFBOARDED" } })).toBe(1);

    await leaversLink.click();
    await expect(page).toHaveURL(/leavers=1/);
    await expect(page.getByRole("row", { name: /EMP-0093/ })).toBeVisible({ timeout: 15_000 });
    // "· leavers shown · Hide" — Hide takes the scope back off.
    await expect(page.getByRole("link", { name: "Hide", exact: true })).toBeVisible();

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
    // Phase 39 (spec §2.1, §2.5): transfers live on the side card's Transfers tab; ?side= opens it.
    await page.goto(`/employees/${carlo.id}?side=transfers`);
    await expect(page.getByRole("tab", { name: /^Transfers/ })).toHaveAttribute("aria-selected", "true", { timeout: 15_000 });
    await expect(page.getByRole("tabpanel", { name: /^Transfers/ }).locator("li").filter({ hasText: "HR → Operations" })).toBeVisible();
    await expectNoSeriousAxe(page);
  });
});
