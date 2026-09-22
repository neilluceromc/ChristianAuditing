import { test, expect, type Locator, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import AxeBuilder from "@axe-core/playwright";
import { PrismaClient } from "@prisma/client";
import { SEED_PASSWORD } from "../prisma/fixtures";

/**
 * Phase 27, Task 6 (spec §7) — the activity feeds and the visible smalls, seven
 * cases:
 *   1 the Action facet narrows /inventory/activity, the URL and a page link
 *     keep the selection, the unselected options keep their counts, and Clear
 *     puts the feed back.
 *   2 class hygiene on a feed: IT's inventory activity carries no Purchasing
 *     row; admin's carries the same row.
 *   3 `document.uploaded` reads as a sentence, not a raw verb.
 *   4 `import-update` prints human field names ("department, join date"), not
 *     raw diff keys.
 *   5 Enter on a focused /inventory row opens the record (rowOpenProps).
 *   6 /stock/receive loads with no open listbox, a click opens one, and the
 *     synthetic "No supplier" option clears a chosen supplier.
 *   7 the Purchasing Home stocktake tile turns accent when a stocktake is past
 *     its close-by date.
 *
 * Plan P-4: cases 1-4 write the audit rows they render straight with
 * `db.auditEntry.create` and LEAVE them — `AuditEntry` is append-only at the
 * database (a trigger refuses deletes), and `beforeAll` reseeds anyway. The one
 * non-audit row any case creates (case 7's Stocktake) is deleted in `finally`.
 *
 * Seeded fixtures this file depends on, read off prisma/seed.ts rather than
 * assumed from the brief:
 *   BR-LT-0148 — IT Laptop, DEPLOYED. The seed writes exactly THREE audit
 *     entries, all `entityType: "asset"` on this one tag: `create`, `update`
 *     and `SECRET_READ`. There is no `lifecycle.assign` row anywhere in a fresh
 *     database, which is why case 1 writes the row whose facet option it then
 *     filters on (the same P-4 licence cases 2-4 use).
 *   BR-VH-0001 / the Purchasing classes (Vehicle, Furniture, Pantry Equipment,
 *     Building) — `canSeeClass("it_staff", "PURCHASING")` is false
 *     (asset-class.ts), so every asset of those categories is outside IT's
 *     feed and inside admin's: case 2's whole experiment.
 *   Nina Robles EMP-0097 — the employee feed's fixture; the seed writes NO
 *     employee audit row at all, so case 4's row is the only one on
 *     /employees/activity.
 *   The seed's only Stocktake is ST-0001, POSTED — so `stocktakesOverdue`
 *     (stock/queries.ts: OPEN and `dueAt` before today's Manila midnight) is 0
 *     until case 7 opens its own, and back to 0 once its `finally` has run.
 */

const db = new PrismaClient();

test.beforeAll(() => {
  execSync("npm run db:seed", { timeout: 120_000 });
});
test.afterAll(async () => {
  await db.$disconnect();
});

// Copied from e2e/it-nav.spec.ts:70-122 (login / expectNoSeriousAxe /
// waitForHydration / facetCounts, itself from e2e/it-gaps.spec.ts) — house
// rule: never import helpers across spec files, since each file reseeds
// independently.
async function login(page: Page, email: string) {
  await page.goto("/logout");
  await page.getByLabel(/Email/).fill(email);
  await page.getByLabel(/Password/).fill(SEED_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

async function expectNoSeriousAxe(page: Page) {
  await page.mouse.move(0, 0);
  await page.waitForTimeout(700);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
}

async function waitForHydration(target: Locator) {
  const el = target.first();
  await el.waitFor({ state: "attached", timeout: 20_000 });
  await expect(async () => {
    expect(await el.evaluate((node) => Object.keys(node).some((k) => k.startsWith("__reactFiber$")))).toBe(
      true,
    );
  }).toPass({ timeout: 20_000 });
}

/**
 * One facet dropdown's option counts, keyed by the label the operator reads.
 * The counts live in a second `<span>` beside the option label inside each
 * `<label>` row (facet-dropdown.tsx) — `Checkbox` is a bare `<input>`, so those
 * two spans are the only ones there. The trigger is found by its
 * `aria-haspopup="dialog"`, not by role+name.
 */
async function facetCounts(page: Page, facet: string): Promise<Record<string, string>> {
  const trigger = page.locator('button[aria-haspopup="dialog"]').filter({ hasText: facet });
  await waitForHydration(trigger);
  await trigger.click();
  const dropdown = page.getByRole("dialog", { name: `Filter by ${facet}` });
  const options = dropdown.locator("label");
  await expect(options.first()).toBeVisible();
  const counts: Record<string, string> = {};
  for (let i = 0; i < (await options.count()); i += 1) {
    const spans = options.nth(i).locator("span");
    counts[(await spans.first().innerText()).trim()] = (await spans.last().innerText()).trim();
  }
  await page.keyboard.press("Escape");
  await expect(dropdown).toBeHidden();
  return counts;
}

const IT = "it@thebackroomop.com";
const ADMIN = "admin@thebackroomop.com";
const PURCHASING = "purchasing@thebackroomop.com";

test.describe("Phase 27 — activity feeds, audit sentences and the visible smalls", () => {
  test("1. the Action facet narrows /inventory/activity, the URL and paging keep it, Clear releases it", async ({ page }) => {
    test.setTimeout(60_000); // first hit of /inventory/activity in this file — cold JIT compile headroom
    const laptop = await db.asset.findUniqueOrThrow({ where: { tag: "BR-LT-0148" } });
    // P-4: the seed has no lifecycle row at all, so the option this case filters
    // on is written here rather than driven through the assign flow (which
    // e2e/direct-lifecycle.spec.ts already covers end to end).
    await db.auditEntry.create({
      data: {
        actorLabel: "e2e phase 27", entityType: "asset", entityId: laptop.id, action: "lifecycle.assign",
        diff: { assignee: { from: null, to: "Nina Robles" }, status: { from: "SPARE", to: "DEPLOYED" } },
      },
    });
    await login(page, IT);
    await page.goto("/inventory/activity");
    const counts = await facetCounts(page, "Action");
    expect(Object.keys(counts)).toContain("Assigned");
    expect(Number(counts["Assigned"])).toBeGreaterThan(0);
    await page.getByRole("button", { name: "Action" }).click();
    // Phase 27 fix wave (I-1): the facet now also lists "Assigned (approved request)" for the
    // worker's executions, so a substring label match would resolve to two rows — the option is
    // picked by its exact label span instead.
    const actionFilter = page.getByRole("dialog", { name: "Filter by Action" });
    await actionFilter.locator("label").filter({ has: page.getByText("Assigned", { exact: true }) }).getByRole("checkbox").check();
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page).toHaveURL(/action=lifecycle\.assign/);
    const feed = page.locator("ol");
    await expect(feed.locator("li").first()).toBeVisible();
    for (const text of await feed.locator("li").allInnerTexts()) expect(text).toMatch(/assigned/i);
    // the other options keep their counts while one is selected
    const narrowed = await facetCounts(page, "Action");
    expect(Object.keys(narrowed).length).toBe(Object.keys(counts).length);
    const next = page.getByRole("navigation", { name: "Pagination" }).getByRole("link", { name: "2", exact: true });
    if (await next.count()) await expect(next).toHaveAttribute("href", /action=lifecycle\.assign/);
    await page.getByRole("link", { name: "Clear", exact: true }).click();
    await expect(page).toHaveURL(/\/inventory\/activity$/);
    await expectNoSeriousAxe(page);
  });

  test("2. IT's inventory feed carries no Purchasing rows; admin's does", async ({ page }) => {
    const vehicle = await db.asset.findFirstOrThrow({ where: { cls: "PURCHASING" }, orderBy: { tag: "asc" } });
    await db.auditEntry.create({
      data: {
        actorLabel: "e2e phase 27", entityType: "asset", entityId: vehicle.id, action: "update",
        diff: { location: { from: "Depot", to: "Yard 27" } },
      },
    });
    await login(page, IT);
    await page.goto("/inventory/activity");
    await expect(page.locator("ol")).not.toContainText(vehicle.tag);
    await login(page, ADMIN);
    await page.goto("/inventory/activity");
    await expect(page.locator("ol").getByText(`e2e phase 27 updated location on ${vehicle.tag}`)).toBeVisible();
  });

  test("3. an attached document reads as a sentence", async ({ page }) => {
    const laptop = await db.asset.findUniqueOrThrow({ where: { tag: "BR-LT-0148" } });
    await db.auditEntry.create({
      data: {
        actorLabel: "e2e phase 27", entityType: "asset", entityId: laptop.id, action: "document.uploaded",
        diff: { document: { from: null, to: "warranty-27.pdf" } },
      },
    });
    await login(page, IT);
    await page.goto("/inventory/activity");
    await expect(page.locator("ol").getByText("e2e phase 27 attached warranty-27.pdf to BR-LT-0148")).toBeVisible();
  });

  test("4. an import-update row prints human field names", async ({ page }) => {
    const nina = await db.employee.findUniqueOrThrow({ where: { employeeNo: "EMP-0097" } });
    await db.auditEntry.create({
      data: {
        actorLabel: "e2e importer", entityType: "employee", entityId: nina.id, action: "import-update",
        diff: { departmentId: { from: "a", to: "b" }, joinedAt: { from: "2024-01-01", to: "2024-02-01" } },
      },
    });
    await login(page, IT);
    await page.goto("/employees/activity");
    // `AuditEntry.diff` is Postgres `jsonb`, which stores object keys in ITS
    // own order (shorter key first, then bytewise) rather than the insertion
    // order written above — so the sentence sorts its field names instead
    // (`fieldList`, lib/activity.ts, Phase 27 fix wave M-1) and the order here
    // is alphabetical, independent of both the writer and the storage.
    // The point of the case is unchanged: both keys print as WORDS ("join
    // date", "department"), never as `joinedAt`/`departmentId`.
    await expect(page.locator("ol").getByText("e2e importer updated department, join date on Nina Robles by import")).toBeVisible();
    await expect(page.locator("ol")).not.toContainText("departmentId");
  });

  test("5. Enter on a focused /inventory row opens the record", async ({ page }) => {
    const laptop = await db.asset.findUniqueOrThrow({ where: { tag: "BR-LT-0148" } });
    await login(page, IT);
    // NOT `?q=BR-LT-0148`: the USB-scanner contract in inventory/page.tsx
    // redirects an EXACT tag match straight to the record, so the list this
    // case needs would never render. "0148" fails `TAG_SHAPE`
    // (inventory/queries.ts) and stays an ordinary search.
    await page.goto("/inventory?q=0148");
    const row = page.getByRole("row", { name: /BR-LT-0148/ });
    await waitForHydration(row);
    await row.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/inventory/${laptop.id}$`));
  });

  test("6. /stock/receive loads with no open listbox; a click opens it; No supplier clears a chosen supplier", async ({ page }) => {
    await login(page, PURCHASING);
    await page.goto("/stock/receive");
    // FormField label="Item" is `required`, so the accessible name carries the
    // hidden " *" the asterisk span adds — anchored, not exact.
    const item = page.getByRole("combobox", { name: /^Item/ });
    await waitForHydration(item);
    await expect(page.getByRole("listbox")).toHaveCount(0);
    await item.click();
    await expect(page.getByRole("listbox")).toHaveCount(1);
    await page.keyboard.press("Escape");
    const supplier = page.getByRole("combobox", { name: "Supplier" });
    await supplier.click();
    const list = supplier.locator("xpath=following-sibling::ul");
    await expect(list.getByRole("option").first()).toHaveText(/No supplier/);
    await list.getByRole("option").nth(1).click();
    await expect(supplier).not.toHaveValue("");
    await supplier.click();
    await list.getByRole("option", { name: "No supplier" }).click();
    await expect(supplier).toHaveValue("");
    await expectNoSeriousAxe(page);
  });

  test("7. the Purchasing Home stocktake tile turns accent when a stocktake is past its close-by date", async ({ page }) => {
    const cat = await db.stockCategory.findFirstOrThrow({ orderBy: { prefix: "asc" } });
    const opener = await db.user.findUniqueOrThrow({ where: { email: PURCHASING } });
    const yesterday = new Date(Date.now() - 86_400_000);
    // Stocktake's required columns (schema.prisma): refNo (unique, no format
    // check), openedById and dueAt; categoryId is optional and scopes the count.
    const st = await db.stocktake.create({
      data: { refNo: "ST-E2E27", categoryId: cat.id, state: "OPEN", openedAt: yesterday, dueAt: yesterday, openedById: opener.id },
    });
    try {
      await login(page, PURCHASING);
      await page.goto("/");
      const tile = page.locator("div", { has: page.getByText("Stocktakes past close-by", { exact: true }) }).last();
      await expect(tile.locator('[data-tone="accent"]')).toBeVisible();
    } finally {
      await db.stocktake.delete({ where: { id: st.id } });
    }
  });
});
