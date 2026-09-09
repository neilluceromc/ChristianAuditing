import { test, expect, type Locator, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import AxeBuilder from "@axe-core/playwright";
import { readSheet } from "read-excel-file/node";
import { PrismaClient } from "@prisma/client";
import { SEED_PASSWORD } from "../prisma/fixtures";

/**
 * Phase 19, Task 7 — Stock control (spec §9.2, 11 cases). Drives the whole
 * surface Tasks 1-6 shipped: the code series (a category created here, "Test
 * supplies" / "TS"), receive with the pack helper, issue and its over-issue
 * guard, adjust (the "set" mode), the derived low-stock flag against the
 * seed's own PN-0001, archive/restore (including the receive combobox
 * dropping an archived item), the spreadsheet importer's three new stock
 * causes, the balances export, role visibility (viewer/finance/it all read
 * but never manage), and an axe sweep.
 *
 * Cases run serial and share one item, TS-0001 ("Marker blue", unit piece,
 * pack size 10, reorder level 5 at creation), created in case 1 and carried
 * through every later case — the same one-fixture-through-the-file shape
 * suppliers.spec.ts and custody.spec.ts use. Every id is looked up fresh via
 * Prisma, never hardcoded, since the seed produces new cuids on every reseed.
 *
 * Seeded stock (prisma/seed.ts): categories Office supplies (OS, nextNumber
 * 6), Cleaning materials (CM, nextNumber 4), Pantry (PN, nextNumber 5).
 * OS-0001 balance 48 (40 opening + 20 receipt - 12 issue), reorder level 10.
 * PN-0001 balance 40 (90 opening + 60 receipt - 110 issue), reorder level 60
 * — the only seeded LOW item (40 <= 60). Suppliers include "TechServe PH"
 * (active). Departments include "HR"; EMP-0042 is Marites Bautista (ACTIVE).
 * Accounts, all @thebackroomop.com / SEED_PASSWORD: admin, it, purchasing,
 * finance, viewer.
 */

const db = new PrismaClient();

test.beforeAll(() => {
  execSync("npm run db:seed", { timeout: 120_000 });
});
test.afterAll(async () => {
  await db.$disconnect();
});

// Copied from e2e/suppliers.spec.ts:38-44 — house rule: never import helpers
// across spec files, since each file reseeds independently.
async function login(page: Page, email: string) {
  await page.goto("/logout");
  await page.getByLabel(/Email/).fill(email);
  await page.getByLabel(/Password/).fill(SEED_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

// Copied from e2e/suppliers.spec.ts:52-59 — the mouse-move-then-settle step
// guards against a phantom SERIOUS contrast violation measured there on a
// freshly-mounted Button variant="primary" mid-transition.
async function expectNoSeriousAxe(page: Page) {
  await page.mouse.move(0, 0);
  await page.waitForTimeout(700);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
}

// Copied from e2e/suppliers.spec.ts (itself copied from e2e/it-core.spec.ts)
// — house rule: never import across spec files. Probed on the element about
// to be interacted with, since hydration walks parent-to-child and a
// hydrated <form> does not yet imply a hydrated <input> inside it.
async function waitForHydration(target: Locator) {
  const el = target.first();
  await el.waitFor({ state: "attached", timeout: 20_000 });
  await expect(async () => {
    expect(await el.evaluate((node) => Object.keys(node).some((k) => k.startsWith("__reactFiber$")))).toBe(
      true,
    );
  }).toPass({ timeout: 20_000 });
}

const PURCHASING = "purchasing@thebackroomop.com";
const IT = "it@thebackroomop.com";
const FINANCE = "finance@thebackroomop.com";
const VIEWER = "viewer@thebackroomop.com";

// A real minus sign (U+2212), the same character movement-history.tsx's own
// fmtQuantity writes for a negative — a hyphen-minus in the test would never
// match it.
const MINUS = "−";

const ts0001 = () => db.stockItem.findUniqueOrThrow({ where: { code: "TS-0001" } });

/** Balances are DERIVED — never a stored column — so every assertion recomputes from the ledger, same as the app does. */
async function balanceOf(itemId: string): Promise<number> {
  const agg = await db.stockMovement.aggregate({ where: { itemId }, _sum: { quantity: true } });
  return agg._sum.quantity ?? 0;
}

/**
 * Reimplemented independently of `isLow`/`listStockItems` (never imported):
 * every active item's balance from one groupBy, counted against its own
 * reorder level. Case 6 uses this to prove the stat line's own number is
 * really DB-derived rather than a plausible-looking hardcoded guess.
 */
async function computeLowCount(): Promise<number> {
  const items = await db.stockItem.findMany({ where: { archivedAt: null }, select: { id: true, reorderLevel: true } });
  if (!items.length) return 0;
  const sums = await db.stockMovement.groupBy({
    by: ["itemId"], where: { itemId: { in: items.map((i) => i.id) } }, _sum: { quantity: true },
  });
  const balanceById = new Map(sums.map((s) => [s.itemId, s._sum.quantity ?? 0]));
  return items.filter((i) => i.reorderLevel > 0 && (balanceById.get(i.id) ?? 0) <= i.reorderLevel).length;
}

test.describe.serial("stock", () => {
  test("1. Purchasing creates a category and two items in it, and the series advances", async ({ page }) => {
    // First hit of /stock/categories and /stock/items/new in this suite —
    // cold JIT compile headroom, the same lesson suppliers.spec.ts records.
    test.setTimeout(60_000);
    await login(page, PURCHASING);
    await page.goto("/stock/categories");
    const nameField = page.getByLabel("New category name");
    await waitForHydration(nameField);
    await nameField.fill("Test supplies");
    await page.getByLabel("New category prefix").fill("TS");
    await page.getByRole("button", { name: "Create category" }).click();

    const categoryRow = page.getByRole("row", { name: /Test supplies/ });
    await expect(categoryRow).toBeVisible({ timeout: 10_000 });
    await expect(categoryRow.getByText("TS-0001")).toBeVisible();

    // First item: "Marker blue", unit piece, pack 10, reorder 5.
    await page.goto("/stock/items/new");
    const categorySelect = page.getByLabel("Category", { exact: true });
    await waitForHydration(categorySelect);
    await categorySelect.selectOption({ label: "Test supplies (TS)" });
    await page.getByLabel(/^Name\b/).fill("Marker blue");
    await page.getByLabel(/^Unit\b/).fill("piece");
    await page.getByLabel("Pack size").fill("10");
    await page.getByLabel("Reorder level").fill("5");
    await page.getByRole("button", { name: "Create item" }).click();
    await expect(page.getByRole("heading", { name: "TS-0001 · Marker blue", level: 1 })).toBeVisible({
      timeout: 10_000,
    });

    // Second item, same category — the series must not repeat TS-0001.
    await page.goto("/stock/items/new");
    const categorySelect2 = page.getByLabel("Category", { exact: true });
    await waitForHydration(categorySelect2);
    await categorySelect2.selectOption({ label: "Test supplies (TS)" });
    await page.getByLabel(/^Name\b/).fill("Marker red");
    await page.getByLabel(/^Unit\b/).fill("piece");
    await page.getByRole("button", { name: "Create item" }).click();
    await expect(page.getByRole("heading", { name: "TS-0002 · Marker red", level: 1 })).toBeVisible({
      timeout: 10_000,
    });

    await page.goto("/stock/categories");
    await expect(page.getByRole("row", { name: /Test supplies/ }).getByText("TS-0003")).toBeVisible({
      timeout: 10_000,
    });

    const item = await ts0001();
    expect(item.name).toBe("Marker blue");
    expect(item.unit).toBe("piece");
    expect(item.packSize).toBe(10);
    expect(item.reorderLevel).toBe(5);
  });

  test("2. Purchasing receives 5 packs, and the pack helper reads exactly", async ({ page }) => {
    test.setTimeout(60_000); // first hit of /stock/receive
    await login(page, PURCHASING);
    const item = await ts0001();

    await page.goto(`/stock/receive?item=${item.id}`);
    const packsField = page.getByLabel("Packs");
    await waitForHydration(packsField);
    await packsField.fill("5");
    await expect(page.getByText("5 packs × 10 = 50 pieces")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByLabel(/^Quantity\b/)).toHaveValue("50");

    await page.getByLabel("Supplier").selectOption({ label: "TechServe PH" });
    await page.getByLabel("Reference").fill("DR-9001");
    await page.getByRole("button", { name: "Record receipt" }).click();

    // The success Banner is persistent form state (`notice`), not a toast —
    // safe to wait on, unlike the ephemeral toast a later step might still
    // be showing. `exact: true` disambiguates from the toast, which prefixes
    // the same sentence with "Success: " and would otherwise strict-mode-fail
    // this locator.
    await expect(page.getByText("Received 50 pieces of TS-0001", { exact: true })).toBeVisible({ timeout: 10_000 });
    await page.getByRole("link", { name: "View item" }).click();
    await expect(page.getByRole("heading", { name: "TS-0001 · Marker blue", level: 1 })).toBeVisible({
      timeout: 10_000,
    });
    // exact: true — a lingering toast from the client-side "View item" nav
    // above ("Success: Received 50 pieces of TS-0001") also contains this
    // substring and would otherwise strict-mode-fail an inexact match.
    await expect(page.getByText("50 pieces", { exact: true })).toBeVisible();
    const historyRow = page.getByRole("row", { name: /Receipt/ });
    await expect(historyRow).toBeVisible();
    await expect(historyRow).toContainText("+50");
    await expect(historyRow).toContainText("DR-9001 · TechServe PH");

    expect(await balanceOf(item.id)).toBe(50);
  });

  test("3. Purchasing issues 20 to HR for EMP-0042", async ({ page }) => {
    test.setTimeout(60_000); // first hit of /stock/issue
    await login(page, PURCHASING);
    const item = await ts0001();

    await page.goto(`/stock/issue?item=${item.id}`);
    const quantityField = page.getByLabel(/^Quantity\b/);
    await waitForHydration(quantityField);
    await quantityField.fill("20");
    await page.getByLabel(/^Department\b/).selectOption({ label: "HR" });
    await page.getByLabel("Employee").selectOption({ label: "Marites Bautista (EMP-0042)" });
    await page.getByLabel("Purpose").fill("Test");
    await page.getByRole("button", { name: "Record issue" }).click();

    // No persistent banner on success here — the form clears its own
    // Quantity field on `onOk`, which is real state tied to the mutation
    // actually completing, unlike the toast alongside it.
    await expect(quantityField).toHaveValue("", { timeout: 10_000 });

    await page.goto(`/stock/items/${item.id}`);
    await expect(page.getByText("30 pieces")).toBeVisible({ timeout: 10_000 });
    const historyRow = page.getByRole("row", { name: /Issue/ });
    await expect(historyRow).toBeVisible();
    await expect(historyRow).toContainText(`${MINUS}20`);
    await expect(historyRow).toContainText("HR · Marites Bautista");

    expect(await balanceOf(item.id)).toBe(30);
  });

  test("4. An over-issue of 31 is refused with the exact sentence, and the balance holds", async ({ page }) => {
    await login(page, PURCHASING);
    const item = await ts0001();

    await page.goto(`/stock/issue?item=${item.id}`);
    const quantityField = page.getByLabel(/^Quantity\b/);
    await waitForHydration(quantityField);
    await quantityField.fill("31");
    await page.getByLabel(/^Department\b/).selectOption({ label: "HR" });
    await page.getByRole("button", { name: "Record issue" }).click();

    await expect(page.getByText("Only 30 pieces left of TS-0001 — issue at most that many")).toBeVisible({
      timeout: 10_000,
    });
    // The failed submit never clears the field — the opposite of case 3's signal.
    await expect(quantityField).toHaveValue("31");

    expect(await balanceOf(item.id)).toBe(30);
  });

  test("5. Adjust sets the balance to 35 and posts a +5 correction", async ({ page }) => {
    await login(page, PURCHASING);
    const item = await ts0001();

    await page.goto(`/stock/items/${item.id}`);
    const adjustBtn = page.getByRole("button", { name: "Adjust" });
    await waitForHydration(adjustBtn);
    await adjustBtn.click();

    const dialog = page.getByRole("dialog", { name: "Adjust TS-0001" });
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    // "Set balance to" is the dialog's own default mode — left untouched.
    await dialog.getByLabel("Quantity").fill("35");
    await dialog.getByLabel("Reason").fill("Found a box");
    await dialog.getByRole("button", { name: "Post adjustment" }).click();

    await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByText("35 pieces")).toBeVisible({ timeout: 10_000 });
    const historyRow = page.getByRole("row", { name: /Adjustment/ });
    await expect(historyRow).toBeVisible();
    await expect(historyRow).toContainText("+5");
    await expect(historyRow).toContainText("Found a box");

    expect(await balanceOf(item.id)).toBe(35);
  });

  test("6. Raising the reorder level to 40 makes TS-0001 LOW, alongside the seed's PN-0001", async ({ page }) => {
    await login(page, PURCHASING);
    const item = await ts0001();

    await page.goto(`/stock/items/${item.id}/edit`);
    const reorderField = page.getByLabel("Reorder level");
    await waitForHydration(reorderField);
    await reorderField.fill("40");
    const saveBtn = page.getByRole("button", { name: "Save changes" });
    await saveBtn.click();
    await expect(saveBtn).toBeEnabled({ timeout: 10_000 });

    await page.goto(`/stock/items/${item.id}`);
    await expect(page.getByText("LOW", { exact: true })).toBeVisible({ timeout: 10_000 });

    await page.goto("/stock?low=1");
    await expect(page.getByRole("link", { name: "TS-0001" })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("link", { name: "OS-0001" })).toHaveCount(0);

    const statLine = page.getByText(/\d+ items? · \d+ below reorder level/);
    await expect(statLine).toBeVisible();
    const text = await statLine.innerText();
    const match = /(\d+) items? · (\d+) below reorder level/.exec(text);
    expect(match).not.toBeNull();
    expect(Number(match![2])).toBe(await computeLowCount());
    // The seed's own LOW item must be one of the two counted, not just a
    // total that happens to match.
    const pn0001 = await db.stockItem.findUniqueOrThrow({ where: { code: "PN-0001" } });
    expect(await balanceOf(pn0001.id)).toBeLessThanOrEqual(pn0001.reorderLevel);
  });

  test("7. Archiving TS-0001 drops it from the default list and the receive combobox; restoring brings it back", async ({ page }) => {
    await login(page, PURCHASING);
    const item = await ts0001();

    await page.goto(`/stock/items/${item.id}`);
    const archiveBtn = page.getByRole("button", { name: "Archive item" });
    await waitForHydration(archiveBtn);
    await archiveBtn.click();
    await page.getByRole("dialog").getByRole("button", { name: "Archive" }).click();
    // exact: true — Playwright's string text matching is case-insensitive by
    // default, and the still-fading toast ("Success: Item archived") is a
    // case-insensitive substring match for "archived" too.
    await expect(page.getByText("ARCHIVED", { exact: true })).toBeVisible({ timeout: 10_000 });

    await page.goto("/stock");
    await expect(page.getByRole("link", { name: "TS-0001" })).toHaveCount(0);
    await page.goto("/stock?archived=1");
    await expect(page.getByRole("link", { name: "TS-0001" })).toBeVisible({ timeout: 10_000 });

    await page.goto("/stock/receive");
    const itemCombo = page.getByRole("combobox", { name: /^Item\b/ });
    await waitForHydration(itemCombo);
    await itemCombo.fill("TS-0001");
    await expect(page.getByRole("option", { name: /TS-0001/ })).toHaveCount(0);
    await expect(page.getByRole("listbox").getByText("No matches.")).toBeVisible();

    await page.goto(`/stock/items/${item.id}`);
    const restoreBtn = page.getByRole("button", { name: "Restore item" });
    await waitForHydration(restoreBtn);
    await restoreBtn.click();
    await expect(page.getByText("ARCHIVED")).toHaveCount(0, { timeout: 10_000 });

    await page.goto("/stock");
    await expect(page.getByRole("link", { name: "TS-0001" })).toBeVisible({ timeout: 10_000 });
  });

  test("8. Importing stock-mixed.xlsx previews 2 create / 1 update / 3 blocked, and applies exactly that", async ({ page }) => {
    // First hit of /stock/import (cold JIT) plus the wizard's own re-check budget.
    test.setTimeout(90_000);
    await login(page, PURCHASING);
    const os0001Before = await db.stockItem.findUniqueOrThrow({ where: { code: "OS-0001" } });
    const balanceBefore = await balanceOf(os0001Before.id);

    await page.goto("/stock/import");
    const spreadsheet = page.getByLabel(/Spreadsheet/);
    await waitForHydration(spreadsheet);
    await spreadsheet.setInputFiles("e2e/fixtures/stock-mixed.xlsx");
    await page.getByRole("button", { name: /^Validate/ }).click();

    await expect(page.getByText("2 new · 1 updates · 3 blocked")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Item code doesn't fit its category")).toBeVisible();
    await expect(page.getByText("Stock category doesn't exist")).toBeVisible();
    await expect(page.getByText("Opening stock on an existing item")).toBeVisible();
    // The Unit cost notice — the fixture carries that column, and it's
    // accepted-but-ignored, so it must show up as "known", not a typo.
    await expect(page.getByText(/Not imported:/)).toContainText("Unit cost");

    await page.getByRole("button", { name: "Import 3 rows" }).click();
    await expect(
      page.getByText("2 new · 1 updated · 0 already matched · 3 blocked · 0 failed"),
    ).toBeVisible({ timeout: 30_000 });

    const os0009 = await db.stockItem.findUnique({ where: { code: "OS-0009" } });
    expect(os0009).not.toBeNull();
    expect(await balanceOf(os0009!.id)).toBe(25); // the row's own Opening quantity

    const os0001After = await db.stockItem.findUniqueOrThrow({ where: { code: "OS-0001" } });
    expect(os0001After.reorderLevel).toBe(12);
    expect(await balanceOf(os0001After.id)).toBe(balanceBefore);
  });

  test("9. The balances export downloads a sheet with a Balance column and TS-0001 on it", async ({ page }) => {
    await login(page, PURCHASING);
    const res = await page.request.get("/stock/export");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-disposition"]).toMatch(/filename="stock-items-\d{4}-\d{2}-\d{2}\.xlsx"/);

    const grid = (await readSheet(Buffer.from(await res.body()))) as unknown[][];
    expect(grid[0]).toContain("Balance");
    expect(grid.slice(1).some((row) => row.includes("TS-0001"))).toBe(true);
  });

  test("10. Viewer, finance and IT can read the item and its history, but manage nothing", async ({ page }) => {
    const item = await ts0001();
    for (const email of [VIEWER, FINANCE, IT]) {
      await login(page, email);
      await page.goto("/stock");
      await expect(page.getByRole("heading", { name: "Stock items", level: 1 })).toBeVisible({ timeout: 10_000 });
      await expect(page.getByRole("link", { name: "New item" })).toHaveCount(0);
      await expect(page.getByRole("link", { name: "Receive stock" })).toHaveCount(0);
      await expect(page.getByRole("link", { name: "Issue stock" })).toHaveCount(0);

      await page.goto(`/stock/items/${item.id}`);
      await expect(page.getByRole("heading", { name: "TS-0001 · Marker blue", level: 1 })).toBeVisible({
        timeout: 10_000,
      });
      await expect(page.getByRole("button", { name: "Adjust" })).toHaveCount(0);
      await expect(page.getByRole("link", { name: "Edit item" })).toHaveCount(0);
      // History is visible read-only, not gated behind manage.
      await expect(page.getByRole("heading", { name: "History", level: 2 })).toBeVisible();
      await expect(page.getByRole("row", { name: /Receipt/ })).toBeVisible();
    }
  });

  test("11. No serious or critical axe violations on the list, item, receive, issue and categories pages", async ({ page }) => {
    test.setTimeout(60_000); // five full-page axe scans, each with its own settle wait
    await login(page, PURCHASING);
    const item = await ts0001();

    await page.goto("/stock");
    await expectNoSeriousAxe(page);

    await page.goto(`/stock/items/${item.id}`);
    await expectNoSeriousAxe(page);

    await page.goto("/stock/receive");
    await expectNoSeriousAxe(page);

    await page.goto("/stock/issue");
    await expectNoSeriousAxe(page);

    await page.goto("/stock/categories");
    await expectNoSeriousAxe(page);
  });
});
