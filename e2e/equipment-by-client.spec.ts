import { test, expect, type Locator, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { readSheet } from "read-excel-file/node";
import { login } from "./fixtures/login";

/**
 * Phase 38 — Equipment by client (spec §4.2). Five cases:
 *   1 Finance sees "Book value today", the Book value column and a ₱ amount on the Bluepeak Telecom row; selecting
 *     the row shows "By category" with a value.
 *   2 IT sees no ₱ anywhere in the main area, on the table or with the Bluepeak panel open, and no Book value
 *     column (Review Focus 1: the page never carries a peso amount for a role that cannot see money).
 *   3 Exports: "Export all (.xlsx)" downloads a dated file for each role. IT's sheet has no Cost or Book value
 *     header; Finance's has both (Review Focus 1: no money in the export either).
 *   4 Gaps: a Bluepeak hire with nothing assigned. "With gaps" lists Bluepeak and the panel lists the hire with
 *     the policy's missing numbered labels.
 *   5 Ended client (Review Focus 4): a test client with a person and an item is on the report; ended in the
 *     database (Finance cannot open /admin/departments) it leaves the report, its person is counted under no
 *     other group, and its group export is a 404.
 *
 * Seed (prisma/seed.ts): Bluepeak Telecom (client) has a base policy of four required lines: Workstation (PC),
 * Monitor, Monitor, Headset — numbered Workstation (PC) / Monitor / Monitor 2 / Headset — and no staff. Every case
 * makes the people and items it needs straight in the database and deletes them in `finally`, so any case runs
 * alone and none leaves anything for the next file.
 *
 * Never reference a raw cuid — the DB reseeds and cuids change every run.
 */

const db = new PrismaClient();

test.beforeAll(() => {
  execSync("npm run db:seed", { timeout: 120_000 });
});
test.afterAll(async () => {
  await db.$disconnect();
});

async function waitForHydration(target: Locator) {
  const el = target.first();
  await el.waitFor({ state: "attached", timeout: 20_000 });
  await expect(async () => {
    expect(await el.evaluate((node) => Object.keys(node).some((k) => k.startsWith("__reactFiber$")))).toBe(true);
  }).toPass({ timeout: 20_000 });
}

const IT = "it@thebackroomop.com";
const FINANCE = "finance@thebackroomop.com";

const uniq = () => `${String(Date.now()).slice(-8)}${Math.floor(Math.random() * 100)}`;

/** A person in a group, straight in the database. The employee number is unique per call. */
async function makePerson(departmentId: string, name: string) {
  return db.employee.create({
    data: { employeeNo: `EMP-${uniq()}`, name, title: "Agent", departmentId, joinedAt: new Date() },
  });
}

/**
 * A deployed, Finance-approved Monitor held by `employeeId`, bought today for ₱24,000, so the group has an item
 * and (for Finance and Admin) a value. The tag is unique per call; the category is read by name.
 */
async function makeHeldMonitor(employeeId: string) {
  const category = await db.assetCategory.findUniqueOrThrow({ where: { name: "Monitor" } });
  return db.asset.create({
    data: {
      tag: `BR-MN-E${uniq()}`, model: "E2E Monitor", categoryId: category.id, cls: "IT", status: "DEPLOYED",
      assigneeId: employeeId, cost: 24_000, purchasedAt: new Date(), financeConfirmedAt: new Date(),
    },
  });
}

/** The one row of the groups table for a group, found by its name button. */
const groupRow = (page: Page, name: string) => page.getByRole("row", { name: new RegExp(name) });

/** Selects a group: clicks its name once the table is hydrated, and waits for the panel's heading. */
async function selectGroup(page: Page, name: string) {
  const button = page.getByRole("button", { name, exact: true });
  await waitForHydration(button);
  await button.click();
  await expect(page).toHaveURL(/group=/);
  await expect(page.getByRole("heading", { name, level: 2 })).toBeVisible({ timeout: 15_000 });
}

/** The header row of a downloaded sheet, as strings. */
async function headerOf(path: string): Promise<string[]> {
  const grid = (await readSheet(readFileSync(path))) as unknown[][];
  return grid[0].map(String);
}

test.describe.serial("Phase 38 — Equipment by client", () => {
  test("1. Finance sees Book value today, the Book value column and a ₱ amount on Bluepeak; selecting it shows By category with values", async ({ page }) => {
    test.setTimeout(120_000);
    const bluepeak = await db.department.findUniqueOrThrow({ where: { name: "Bluepeak Telecom" } });
    const person = await makePerson(bluepeak.id, `E2E Holder ${uniq()}`);
    const monitor = await makeHeldMonitor(person.id);
    try {
      await login(page, FINANCE);
      await page.goto("/equipment-by-client");
      await expect(page.getByRole("heading", { name: "Equipment by client", level: 1 })).toBeVisible({ timeout: 30_000 });

      await expect(page.getByText("Book value today", { exact: true })).toBeVisible();
      await expect(page.getByRole("columnheader", { name: /^Book value/ })).toBeVisible();
      await expect(groupRow(page, "Bluepeak Telecom")).toContainText("₱");

      await selectGroup(page, "Bluepeak Telecom");
      const category = page.locator("section").filter({ has: page.getByRole("heading", { name: "By category", level: 3 }) });
      await expect(category).toContainText("Monitor");
      await expect(category).toContainText("₱");
    } finally {
      await db.asset.delete({ where: { id: monitor.id } });
      await db.employee.delete({ where: { id: person.id } });
    }
  });

  test("2. IT sees no ₱ anywhere and no Book value column, with the Bluepeak panel open too", async ({ page }) => {
    test.setTimeout(120_000);
    const bluepeak = await db.department.findUniqueOrThrow({ where: { name: "Bluepeak Telecom" } });
    const person = await makePerson(bluepeak.id, `E2E Holder ${uniq()}`);
    // a costed item: if the cost reached the page for IT, a ₱ would show somewhere below
    const monitor = await makeHeldMonitor(person.id);
    try {
      await login(page, IT);
      await page.goto("/equipment-by-client");
      await expect(page.getByRole("heading", { name: "Equipment by client", level: 1 })).toBeVisible({ timeout: 30_000 });
      // the table has rendered: Bluepeak's row is there with its item counted
      await expect(groupRow(page, "Bluepeak Telecom")).toBeVisible();

      await expect(page.getByRole("columnheader", { name: /^Book value/ })).toHaveCount(0);
      await expect(page.getByText("Book value today", { exact: true })).toHaveCount(0);
      await expect(page.locator("main")).not.toContainText("₱");

      await selectGroup(page, "Bluepeak Telecom");
      await expect(page.locator("section").filter({ has: page.getByRole("heading", { name: "By category", level: 3 }) })).toContainText("Monitor");
      await expect(page.locator("main")).not.toContainText("₱");
    } finally {
      await db.asset.delete({ where: { id: monitor.id } });
      await db.employee.delete({ where: { id: person.id } });
    }
  });

  test("3. exports: IT's has no Cost or Book value, Finance's has both", async ({ page }) => {
    test.setTimeout(120_000);
    const bluepeak = await db.department.findUniqueOrThrow({ where: { name: "Bluepeak Telecom" } });
    const person = await makePerson(bluepeak.id, `E2E Holder ${uniq()}`);
    const monitor = await makeHeldMonitor(person.id);

    async function exportAll(email: string): Promise<string[]> {
      await login(page, email);
      await page.goto("/equipment-by-client");
      const link = page.getByRole("link", { name: "Export all (.xlsx)", exact: true });
      await expect(link).toBeVisible({ timeout: 30_000 });
      const [download] = await Promise.all([page.waitForEvent("download"), link.click()]);
      expect(download.suggestedFilename()).toMatch(/^equipment-by-client-\d{4}-\d{2}-\d{2}\.xlsx$/);
      return headerOf(await download.path());
    }

    try {
      const common = ["Works for", "Staff", "Person", "Employee no.", "Category", "Type", "Tag", "Model", "Serial", "Status", "Purchased", "Held since", "On loan until"];

      const itHeader = await exportAll(IT);
      expect(itHeader).toEqual(common);
      expect(itHeader).not.toContain("Cost");
      expect(itHeader).not.toContain("Book value");

      const financeHeader = await exportAll(FINANCE);
      expect(financeHeader).toEqual([...common, "Cost", "Book value"]);
    } finally {
      await db.asset.delete({ where: { id: monitor.id } });
      await db.employee.delete({ where: { id: person.id } });
    }
  });

  test("4. gaps: a Bluepeak hire with nothing assigned is listed under With gaps with the missing labels", async ({ page }) => {
    test.setTimeout(120_000);
    const bluepeak = await db.department.findUniqueOrThrow({ where: { name: "Bluepeak Telecom" } });
    // "AAA" sorts first, so the hire is within the 20 people the panel lists whatever else is in Bluepeak
    const name = `AAA E2E Gap ${uniq()}`;
    const person = await makePerson(bluepeak.id, name);
    try {
      await login(page, IT);
      await page.goto("/equipment-by-client");
      await expect(groupRow(page, "Bluepeak Telecom")).toBeVisible({ timeout: 30_000 });

      const gaps = page.getByRole("button", { name: /^With gaps/ });
      await waitForHydration(gaps);
      await gaps.click();
      await expect(gaps).toHaveAttribute("aria-pressed", "true");
      await expect(groupRow(page, "Bluepeak Telecom")).toBeVisible();
      // Harborline Billing has no policy, so no one there is ever missing something: filtered out
      await expect(groupRow(page, "Harborline Billing")).toHaveCount(0);

      await selectGroup(page, "Bluepeak Telecom");
      await expect(page.getByRole("heading", { name: /^Missing something \(\d+\)$/, level: 3 })).toBeVisible();
      const entry = page.getByRole("listitem").filter({ hasText: name });
      await expect(entry).toHaveCount(1);
      // the profile's numbered labels: the policy's second Monitor line is "Monitor 2"
      await expect(entry).toContainText("Workstation (PC)");
      await expect(entry).toContainText("Monitor 2");
      await expect(entry).toContainText("Headset");
      await expect(entry).toContainText(person.employeeNo);
    } finally {
      await db.employee.delete({ where: { id: person.id } });
    }
  });

  test("5. an ended client leaves the report, and its person is counted under no other group", async ({ page }) => {
    test.setTimeout(120_000);
    const name = `E2E Ended ${uniq()}`;
    const client = await db.department.create({ data: { name, kind: "CLIENT" } });
    const person = await makePerson(client.id, `E2E Staff ${uniq()}`);
    const monitor = await makeHeldMonitor(person.id);

    /** The Tag column of the whole-report export for a tab, as seen by Finance. */
    async function exportedTags(tab: "client" | "internal"): Promise<string[]> {
      const res = await page.request.get(`/equipment-by-client/export?tab=${tab}`);
      expect(res.status(), `export ${tab}`).toBe(200);
      const grid = (await readSheet(Buffer.from(await res.body()))) as unknown[][];
      const tagAt = grid[0].map(String).indexOf("Tag");
      return grid.slice(1).map((r) => String(r[tagAt]));
    }

    try {
      await login(page, FINANCE);
      await page.goto("/equipment-by-client");
      await expect(groupRow(page, name)).toBeVisible({ timeout: 30_000 });
      expect(await exportedTags("client")).toContain(monitor.tag);
      expect((await page.request.get(`/equipment-by-client/export?tab=client&group=${client.id}`)).status()).toBe(200);

      // End the client while it still has a person holding an item (Finance cannot open /admin/departments).
      await db.department.update({ where: { id: client.id }, data: { archivedAt: new Date() } });

      await page.goto("/equipment-by-client");
      await expect(groupRow(page, "Bluepeak Telecom")).toBeVisible({ timeout: 30_000 });
      await expect(groupRow(page, name)).toHaveCount(0);
      await expect(page.getByRole("button", { name, exact: true })).toHaveCount(0);

      // not counted under another group: the item is in neither tab's export, and its own export is a 404
      expect(await exportedTags("client")).not.toContain(monitor.tag);
      expect(await exportedTags("internal")).not.toContain(monitor.tag);
      expect((await page.request.get(`/equipment-by-client/export?tab=client&group=${client.id}`)).status()).toBe(404);

      // a link to its panel shows no panel
      await page.goto(`/equipment-by-client?group=${client.id}`);
      await expect(groupRow(page, "Bluepeak Telecom")).toBeVisible({ timeout: 30_000 });
      await expect(page.getByRole("heading", { name, level: 2 })).toHaveCount(0);
    } finally {
      // Restore it, then remove everything this case made, so no later case or file sees it.
      await db.department.update({ where: { id: client.id }, data: { archivedAt: null } });
      await db.asset.delete({ where: { id: monitor.id } });
      await db.employee.delete({ where: { id: person.id } });
      await db.department.delete({ where: { id: client.id } });
    }
  });
});
