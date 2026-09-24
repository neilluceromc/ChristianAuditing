import { test, expect, type Locator, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import AxeBuilder from "@axe-core/playwright";
import { PrismaClient } from "@prisma/client";
import { readSheet } from "read-excel-file/node";
import { SEED_PASSWORD } from "../prisma/fixtures";

/**
 * Phase 31 — the leftovers sweep, four cases, each independent:
 *   1 a derived sort orders only as the PRIMARY key: Loadout, then a click on
 *     Employee, orders the people by name (it used to stay in Loadout order,
 *     the twin of Phase 30's Attention fix).
 *   2 the People export follows the Loadout sort, row for row with the list.
 *   3 the inventory export follows the Attention sort, row for row with the list.
 *   4 the pager's disabled arrows are not links: nothing to Tab to, no
 *     `page=0` (or past-the-end) href; the live arrows are named.
 *
 * Cases 1–3 prove themselves non-vacuous: each first asserts that the derived
 * order really differs from the plain one on the seed, so a seed change that
 * made them coincide fails loudly instead of passing for the wrong reason.
 * Case 4 needs a second page of IT assets: `beforeAll` adds 30 `BR-ZP-` spares
 * (checked, unassigned — no attention reason, so case 3's head is unchanged).
 */

const db = new PrismaClient();

test.beforeAll(async () => {
  execSync("npm run db:seed", { timeout: 120_000 });
  const laptop = await db.assetCategory.findFirstOrThrow({ where: { name: "Laptop" } });
  const now = new Date();
  await db.asset.createMany({
    data: Array.from({ length: 30 }, (_, i) => ({
      tag: `BR-ZP-${String(i + 1).padStart(4, "0")}`,
      model: "ZP Pager Unit",
      categoryId: laptop.id,
      cls: "IT" as const,
      status: "SPARE" as const,
      itVerifiedAt: now,
    })),
  });
});
test.afterAll(async () => {
  await db.$disconnect();
});

// Copied from e2e/it-nav.spec.ts:59-65 — house rule: never import helpers across spec files.
async function login(page: Page, email: string) {
  await page.goto("/logout");
  await page.getByLabel(/Email/).fill(email);
  await page.getByLabel(/Password/).fill(SEED_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

// Copied from e2e/it-nav.spec.ts:68-73.
async function expectNoSeriousAxe(page: Page) {
  await page.mouse.move(0, 0);
  await page.waitForTimeout(700);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
}

// Copied from e2e/it-nav.spec.ts:76-84.
async function waitForHydration(target: Locator) {
  const el = target.first();
  await el.waitFor({ state: "attached", timeout: 20_000 });
  await expect(async () => {
    expect(await el.evaluate((node) => Object.keys(node).some((k) => k.startsWith("__reactFiber$")))).toBe(true);
  }).toPass({ timeout: 20_000 });
}

/** The EMP-#### of every row on the people list, top to bottom (the first cell carries "EMP-0042 · Title"). */
async function employeeNos(page: Page): Promise<string[]> {
  await expect(page.locator("tbody tr").first()).toBeVisible();
  const cells = await page.locator("tbody tr td:nth-child(1)").allInnerTexts();
  return cells.map((c) => /EMP-\d+/.exec(c)?.[0] ?? `?${c}`);
}

/** The tag of every row on the inventory list, top to bottom, read from the "Tag" column. */
async function assetTags(page: Page): Promise<string[]> {
  await expect(page.locator("tbody tr").first()).toBeVisible();
  const idx = await page
    .locator("thead th")
    .evaluateAll((ths) => ths.findIndex((th) => (th.textContent ?? "").trim().startsWith("Tag")));
  expect(idx, 'a "Tag" column').toBeGreaterThanOrEqual(0);
  const cells = await page.locator(`tbody tr td:nth-child(${idx + 1})`).allInnerTexts();
  return cells.map((c) => /BR-[A-Z]+-\d+/.exec(c)?.[0] ?? `?${c}`);
}

/** Column 1 of a downloaded sheet (Employee no / Tag), header row dropped. */
async function sheetFirstColumn(page: Page, url: string): Promise<string[]> {
  const res = await page.request.get(url);
  expect(res.status(), `GET ${url}`).toBe(200);
  const grid = (await readSheet(Buffer.from(await res.body()))) as unknown[][];
  return grid.slice(1).map((r) => String(r[0]));
}

const IT = "it@thebackroomop.com";

test.describe("Phase 31 — leftovers sweep", () => {
  test("1. Loadout, then a click on Employee, orders the people by name", async ({ page }) => {
    await login(page, IT);
    await page.goto("/employees?sort=name");
    const byName = await employeeNos(page);
    await page.goto("/employees?sort=loadout");
    const byLoadout = await employeeNos(page);
    expect(byLoadout, "the seed's Loadout order differs from its name order").not.toEqual(byName);

    const employee = page.getByRole("button", { name: "Employee" });
    await waitForHydration(employee);
    await employee.click();
    // toggleSort demotes Loadout to the secondary key: sort=name,loadout.
    await expect(page).toHaveURL(/[?&]sort=name(%2C|,)loadout(&|$)/);
    await expect.poll(() => employeeNos(page)).toEqual(byName);
  });

  test("2. the People export follows the Loadout sort", async ({ page }) => {
    await login(page, IT);
    await page.goto("/employees?sort=loadout");
    const listed = await employeeNos(page);
    // Compare the same window the assertion below compares, or a length mismatch passes it for free.
    expect((await sheetFirstColumn(page, "/employees/export?sort=name")).slice(0, listed.length)).not.toEqual(listed);
    const sheet = await sheetFirstColumn(page, "/employees/export?sort=loadout");
    expect(sheet.slice(0, listed.length)).toEqual(listed);
  });

  test("3. the inventory export follows the Attention sort", async ({ page }) => {
    await login(page, IT);
    await page.goto("/inventory?sort=attention");
    const listed = await assetTags(page);
    const sheet = await sheetFirstColumn(page, "/inventory/export?sort=attention");
    expect((await sheetFirstColumn(page, "/inventory/export")).slice(0, listed.length)).not.toEqual(listed);
    expect(sheet.slice(0, listed.length)).toEqual(listed);
  });

  test("4. the pager's disabled arrows are not links; the live ones are named", async ({ page }) => {
    await login(page, IT);
    await page.goto("/inventory");
    const pager = page.getByRole("navigation", { name: "Pagination" });
    await expect(pager).toBeVisible();

    const prev = pager.getByLabel("Previous page");
    await expect(prev).toHaveAttribute("aria-disabled", "true");
    expect(await prev.evaluate((el) => el.tagName)).toBe("SPAN");
    expect(await prev.evaluate((el) => el.hasAttribute("href") || el.tabIndex >= 0)).toBe(false);
    const next = pager.getByRole("link", { name: "Next page" });
    await expect(next).toHaveAttribute("href", /[?&]page=2(&|$)/);
    // No link on page 1 points anywhere below page 1.
    for (const href of await pager.locator("a").evaluateAll((as) => as.map((a) => a.getAttribute("href") ?? ""))) {
      expect(href).not.toMatch(/[?&]page=0(&|$)/);
    }
    await expectNoSeriousAxe(page);

    // The last page mirrors it: › is the disabled one, ‹ the live link.
    const last = Math.max(...(await pager.locator("a").allInnerTexts()).map(Number).filter(Number.isFinite));
    await page.goto(`/inventory?page=${last}`);
    await expect(pager.getByRole("link", { name: String(last), exact: true })).toHaveAttribute("aria-current", "page");
    const nextOnLast = pager.getByLabel("Next page");
    await expect(nextOnLast).toHaveAttribute("aria-disabled", "true");
    expect(await nextOnLast.evaluate((el) => el.tagName)).toBe("SPAN");
    await expect(pager.getByRole("link", { name: "Previous page" })).toHaveAttribute(
      "href",
      new RegExp(`[?&]page=${last - 1}(&|$)`),
    );
  });
});
