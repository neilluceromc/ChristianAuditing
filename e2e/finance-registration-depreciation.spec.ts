import { test, expect, type Locator, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import AxeBuilder from "@axe-core/playwright";
import { PrismaClient } from "@prisma/client";
import { readSheet } from "read-excel-file/node";
import { SEED_PASSWORD } from "../prisma/fixtures";
import { asOfMonth, depStartMonth, depreciate, manilaMonth, monthLabel, resolvePolicy, type MonthIndex } from "@/lib/depreciation";
import { fmtMoneyExact } from "@/lib/format";
import { COLUMN_PREF_KEYS, INVENTORY_COLUMNS_SEEN_KEY } from "@/lib/column-prefs";

/**
 * Phase 35, Task 12: registration review + Finance asset register + depreciation, twelve independent cases.
 *   1   the registration round trip (send back with a checklist -> Edit shows the flags -> Mark corrected with a
 *       reply -> Finance sees the reply -> Approve -> Fully registered), with its three audit rows
 *   2   no cost: Approve as not capitalised, the chip, then IT's cost reopens the review
 *   3   the register: chips, search, the tag link into the asset page
 *   4   the Policies tab: a notice, the change warning, the toast, the DB and an audit row
 *   5   a confirmed laptop's book value equals depreciate() computed here; the footer
 *   6   the per-asset override and its clearing
 *   7   the asset page's year-by-year schedule, with projected months
 *   8   Finance's home: Book value and registrations to review
 *   9   the year schedule: subtotals, a Total, projected headers, an empty year
 *   10  the three Excel exports
 *   11  access: it@ and purchasing@ are redirected away from the new pages
 *   12  axe on the Registration column, the register, and the asset page with the send-back dialog open
 *
 * Fixtures are plain field updates on seeded assets (BR-HS-0502, BR-MN-0911, BR-MN-0910, BR-MN-0731, BR-HS-0510,
 * BR-LT-0148, BR-LT-0201), each snapshotted first and restored in `finally`. Audit rows are only ever added.
 */

const db = new PrismaClient();

const IT = "it@thebackroomop.com";
const FINANCE = "finance@thebackroomop.com";
const PURCHASING = "purchasing@thebackroomop.com";

const DAY = 86_400_000;
const CATEGORY_LIFE = 36;
const CATEGORY_SALVAGE = 10;

test.beforeAll(async () => {
  execSync("npm run db:seed", { timeout: 120_000 });
  await chooseRegistrationColumn(IT);
});
test.afterAll(async () => {
  await db.$disconnect();
});

/** The two preference rows the Columns chooser writes (saveColumns): the chosen set and the columns seen then. */
const COLUMN_KEYS = ["columns:inventory", INVENTORY_COLUMNS_SEEN_KEY];

/**
 * Phase 45 (spec §2.3): Registration is off by default now, and most cases here read IT's list through that column
 * ("With Finance", "Needs correction", Mark corrected…). So IT starts the file having chosen it, exactly as the
 * Columns chooser saves it: the default set plus Registration, and the seen marker. Case 12 starts from the
 * default instead and turns it on through the chooser itself. The next spec file's reseed drops both rows.
 */
async function chooseRegistrationColumn(email: string) {
  const user = await db.user.findUniqueOrThrow({ where: { email } });
  const rows: Array<[string, string[]]> = [
    ["columns:inventory", ["serial", "category", "assigned", "registration"]],
    [INVENTORY_COLUMNS_SEEN_KEY, [...COLUMN_PREF_KEYS["columns:inventory"]]],
  ];
  for (const [key, value] of rows) {
    await db.userPreference.upsert({
      where: { userId_key: { userId: user.id, key } },
      create: { userId: user.id, key, value },
      update: { value },
    });
  }
}

// Copied from e2e/queues-records-ux.spec.ts — house rule: never import helpers across spec files.
async function login(page: Page, email: string) {
  await page.goto("/logout");
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
    expect(await el.evaluate((node) => Object.keys(node).some((k) => k.startsWith("__reactFiber$")))).toBe(true);
  }).toPass({ timeout: 20_000 });
}

/** Finance's "Fix money details" on its asset page: a cost with a reason (purchase-orders spec §5). */
async function fixCostOnFinancePage(page: Page, id: string, tag: string, cost: string) {
  await page.goto(`/finance/assets/${id}`);
  const fix = page.getByRole("button", { name: "Fix money details" });
  await waitForHydration(fix);
  await fix.click();
  const dialog = page.getByRole("dialog", { name: `Fix money details on ${tag}` });
  await dialog.getByLabel("Cost ₱").fill(cost);
  await dialog.getByRole("textbox", { name: "Reason" }).fill("e2e: the invoice shows a price after all");
  await dialog.getByRole("button", { name: "Save fix" }).click();
  await expect(page.locator("[data-toast-id]").filter({ hasText: `${tag}: fixed the money details` })).toBeVisible();
  await expect.poll(async () => (await db.asset.findUniqueOrThrow({ where: { id } })).financeConfirmedAt).toBeNull();
}

/** Opens a menu (retried until its island has hydrated) and returns the open menu. */
async function openMenu(page: Page, trigger: Locator) {
  const menu = page.getByRole("menu");
  await expect(async () => {
    if ((await trigger.getAttribute("aria-expanded")) !== "true") await trigger.click();
    await expect(menu).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
  return menu;
}

const SNAP = {
  cost: true, itVerifiedAt: true, itVerifiedById: true,
  financeConfirmedAt: true, financeConfirmedById: true, financeReturnedAt: true, financeReturnedById: true,
  financeReturnReason: true, financeReturnFields: true, financeResubmitNote: true, financeNotCapitalised: true,
  depreciationLifeMonths: true, depreciationSalvage: true, depreciationNote: true,
} as const;

async function snap(tag: string) {
  return db.asset.findUniqueOrThrow({ where: { tag }, select: { id: true, ...SNAP } });
}
async function restore(tag: string, s: Awaited<ReturnType<typeof snap>>) {
  const { id: _id, ...data } = s;
  void _id;
  await db.asset.update({ where: { tag }, data });
}
/** Back to "IT-checked, with Finance, nothing flagged, no override" — plus any extras. */
async function reset(tag: string, extra: Record<string, unknown> = {}) {
  await db.asset.update({
    where: { tag },
    data: {
      financeConfirmedAt: null, financeConfirmedById: null, financeReturnedAt: null, financeReturnedById: null,
      financeReturnReason: null, financeReturnFields: [], financeResubmitNote: null, financeNotCapitalised: false,
      depreciationLifeMonths: null, depreciationSalvage: null, depreciationNote: null,
      ...extra,
    },
  });
}

async function laptopCategory() {
  return db.assetCategory.findFirstOrThrow({ where: { name: "Laptop", cls: "IT" } });
}
async function setLaptopPolicy(life: number | null, salvage: number | null) {
  const cat = await laptopCategory();
  await db.assetCategory.update({ where: { id: cat.id }, data: { depreciationLifeMonths: life, depreciationSalvagePercent: salvage } });
}

/**
 * Approves the laptop and returns the month it starts depreciating. Phase 38: that is the PURCHASE month (the seeded
 * BR-LT-0148 was bought about 720 days ago), not the month after approval — so the expectation reads the asset's own
 * purchasedAt rather than assuming approval-date arithmetic.
 */
async function approvedLaptop(tag: string): Promise<MonthIndex> {
  const finance = await db.user.findUniqueOrThrow({ where: { email: FINANCE } });
  const confirmedAt = new Date(Date.now() - 100 * DAY);
  await reset(tag, { financeConfirmedAt: confirmedAt, financeConfirmedById: finance.id });
  await setLaptopPolicy(CATEGORY_LIFE, CATEGORY_SALVAGE);
  const { purchasedAt } = await db.asset.findUniqueOrThrow({ where: { tag }, select: { purchasedAt: true } });
  return depStartMonth({ purchasedAt, financeConfirmedAt: confirmedAt })!;
}

async function auditCount(entityId: string, action: string) {
  return db.auditEntry.count({ where: { entityId, action } });
}

function expectedBook(costPesos: number, start: MonthIndex, life = CATEGORY_LIFE, salvagePercent: number | null = CATEGORY_SALVAGE, salvageC: number | null = null) {
  const costC = Math.round(costPesos * 100);
  const policy = resolvePolicy(
    { cost: costC, lifeMonths: salvageC === null ? null : life, salvage: salvageC },
    { lifeMonths: life, salvagePercent },
  );
  return fmtMoneyExact(depreciate(costC, start, policy, asOfMonth(new Date())).bookValue / 100);
}

/** An exact tag in the search box opens the record (scanner contract); the tag minus its last digit lists. */
const listQ = (tag: string) => tag.slice(0, -1);
const row = (page: Page, tag: string) => page.getByRole("row", { name: new RegExp(tag) });
const thisYear = () => Math.floor(manilaMonth(new Date()) / 12);

test.describe("Phase 35 — registration review, the Finance register, depreciation", () => {
  test("1. registration round trip: send back with a checklist, Edit flags, Mark corrected with a reply, Approve", async ({ page }) => {
    test.setTimeout(90_000); // several sign-ins on a cold dev server
    const tag = "BR-HS-0502";
    const before = await snap(tag);
    try {
      await reset(tag);
      const id = before.id;
      const [returns0, resubmits0, confirms0] = await Promise.all([
        auditCount(id, "finance.return"), auditCount(id, "finance.resubmit"), auditCount(id, "finance.confirm"),
      ]);

      await login(page, IT);
      await page.goto(`/inventory?q=${listQ(tag)}`);
      await expect(row(page, tag)).toContainText("With Finance");

      await login(page, FINANCE);
      await page.goto(`/finance/assets/${id}`);
      const review = page.getByRole("region", { name: "Review" });
      await expect(review).toBeVisible();
      const sendBack = review.getByRole("button", { name: "Send back…" });
      await waitForHydration(sendBack);
      await sendBack.click();
      const dialog = page.getByRole("dialog", { name: `Send ${tag} back` });
      await expect(dialog).toBeVisible();
      await dialog.getByLabel("Cost", { exact: true }).check();
      await dialog.getByLabel("Sales invoice").check();
      // Task 6 (purchase-orders spec §5): Finance picks the team; money on a direct registration goes to IT here.
      await dialog.getByLabel("Send to").selectOption("IT");
      await dialog.getByLabel("Note for IT").fill("Invoice is for another PO");
      await expect(dialog).toContainText("2 ticked");
      await dialog.getByRole("button", { name: "Send back to IT", exact: true }).click();
      await expect(page.locator("[data-toast-id]").filter({ hasText: `Sent ${tag} back to IT` })).toBeVisible();

      await login(page, IT);
      await page.goto(`/inventory?q=${listQ(tag)}`);
      const cell = row(page, tag);
      await expect(cell).toContainText("Needs correction");
      await expect(cell).toContainText("Finance flagged:");
      await expect(cell).toContainText("Cost");
      await expect(cell).toContainText("Sales invoice");
      await expect(cell).toContainText("Invoice is for another PO");

      await page.goto(`/inventory/${id}/edit`);
      await expect(page.getByText("Finance sent this back")).toBeVisible();
      await expect(page.locator("[data-flagged]").filter({ has: page.getByLabel(/^Cost/) })).toHaveCount(1);

      await page.goto(`/inventory?q=${listQ(tag)}`);
      const mark = row(page, tag).getByRole("button", { name: "Mark corrected…" });
      await waitForHydration(mark);
      await mark.click();
      const resubmit = page.getByRole("dialog", { name: `Mark ${tag} corrected?` });
      await expect(resubmit).toBeVisible();
      await resubmit.getByLabel("Reply to Finance").fill("Uploaded the right invoice");
      await resubmit.getByRole("button", { name: "Send to Finance" }).click();
      await expect(page.getByText(`${tag} sent back to Finance`)).toBeVisible();

      await login(page, FINANCE);
      await page.goto(`/finance/assets/${id}`);
      await expect(page.getByText("IT replied: “Uploaded the right invoice”")).toBeVisible();
      const approve = page.getByRole("button", { name: "Approve", exact: true });
      await waitForHydration(approve);
      await approve.click();
      await expect.poll(async () => (await db.asset.findUniqueOrThrow({ where: { id } })).financeConfirmedAt !== null).toBe(true);

      await login(page, IT);
      await page.goto(`/inventory?q=${listQ(tag)}`);
      await expect(row(page, tag)).toContainText("Fully registered");

      expect(await auditCount(id, "finance.return")).toBe(returns0 + 1);
      expect(await auditCount(id, "finance.resubmit")).toBe(resubmits0 + 1);
      expect(await auditCount(id, "finance.confirm")).toBe(confirms0 + 1);
    } finally {
      await restore(tag, before);
    }
  });

  // Purchase orders (spec §5): once approved, money locks for IT and Purchasing — the "a cost reopens a not-capitalised
  // approval" path is now Finance's own fix, with a reason.
  test("2. no cost: Approve as not capitalised, the chip, then Finance's cost fix reopens the review", async ({ page }) => {
    test.setTimeout(90_000); // several sign-ins on a cold dev server
    const tag = "BR-MN-0911";
    const before = await snap(tag);
    try {
      await reset(tag, { cost: null });
      const id = before.id;
      const reopened0 = await auditCount(id, "finance.reopened");

      await login(page, FINANCE);
      await page.goto(`/finance/assets/${id}`);
      const review = page.getByRole("region", { name: "Review" });
      await expect(review.getByRole("button", { name: "Approve as not capitalised" })).toBeVisible();
      await expect(review.getByRole("button", { name: "Approve", exact: true })).toHaveCount(0);
      await waitForHydration(review.getByRole("button", { name: "Approve as not capitalised" }));
      await review.getByRole("button", { name: "Approve as not capitalised" }).click();
      await expect(page.locator("[data-toast-id]").filter({ hasText: `Approved ${tag} as not capitalised` })).toBeVisible();
      await expect.poll(async () => (await db.asset.findUniqueOrThrow({ where: { id } })).financeNotCapitalised).toBe(true);

      await page.goto(`/finance/assets?fin=not-capitalised&q=${tag}`);
      await expect(page.getByRole("navigation", { name: "Finance state" }).getByRole("link", { name: /^Not capitalised/ })).toHaveAttribute("aria-current", "page");
      await expect(row(page, tag)).toBeVisible();

      await fixCostOnFinancePage(page, id, tag, "500");

      await login(page, IT);
      await page.goto(`/inventory?q=${listQ(tag)}`);
      await expect(row(page, tag)).toContainText("With Finance");
      const after = await db.asset.findUniqueOrThrow({ where: { id } });
      expect(after.financeNotCapitalised).toBe(false);
      expect(after.financeConfirmedAt).toBeNull();
      expect(await auditCount(id, "finance.reopened")).toBe(reopened0 + 1);
    } finally {
      await restore(tag, before);
    }
  });

  test("3. the register: state chips, search, and the tag opens the asset page", async ({ page }) => {
    const noCost = "BR-MN-0910";
    const waiting = "BR-MN-0731";
    const a = await snap(noCost);
    const b = await snap(waiting);
    try {
      await reset(noCost, { cost: null });
      await db.asset.update({ where: { tag: waiting }, data: { itVerifiedAt: null, itVerifiedById: null } });

      await login(page, FINANCE);
      await page.goto("/finance/assets");
      await expect(page.getByRole("heading", { name: "Assets", level: 1 })).toBeVisible();
      const chips = page.getByRole("navigation", { name: "Finance state" });
      await expect(chips.getByRole("link", { name: /^All \d+/ })).toBeVisible();
      await expect(chips.getByRole("link", { name: /^To review \d+/ })).toBeVisible();
      // Phase 47 (spec §3 item 4): the status chip row is now the Phase 45 status tiles (count, caption, book value)
      await expect(page.getByRole("navigation", { name: "Filter by status" }).getByRole("link", { name: /^In stock\b/ })).toBeVisible();

      await page.goto("/finance/assets?fin=no-cost");
      await expect(row(page, noCost)).toBeVisible();
      await expect(row(page, waiting)).toHaveCount(0);
      // Phase 47 (spec §3 item 6): Asset, Category, Status, Finance, Cost, … — Cost is the fifth cell
      const costCells = await page.locator("tbody tr").evaluateAll((trs) => trs.map((tr) => tr.querySelectorAll("td")[4]?.textContent?.trim()));
      expect(costCells.length).toBeGreaterThan(0);
      expect(costCells.every((c) => c === "—")).toBe(true);

      await page.goto("/finance/assets?fin=awaiting-it");
      await expect(row(page, waiting)).toContainText("Waiting for IT");

      await page.goto("/finance/assets?q=UL500");
      await expect(row(page, noCost)).toBeVisible();
      await expect(row(page, "BR-MN-0911")).toBeVisible();
      await expect(row(page, "BR-LT-0148")).toHaveCount(0);

      await page.getByRole("link", { name: noCost, exact: true }).click();
      await page.waitForURL((u) => u.pathname.startsWith("/finance/assets/"));
      // Phase 47 (spec §4.1, Option B): the tag is the h1 of the left panel, the Documents card sits in it, and the
      // main column's tabs include the Financial history
      await expect(page.getByRole("heading", { name: noCost, level: 1 })).toBeVisible();
      await expect(page.getByRole("complementary", { name: "Asset summary" }).getByRole("heading", { name: "Documents" })).toBeVisible();
      await expect(page.getByRole("navigation", { name: "Asset sections" }).getByRole("link", { name: /^Financial history/ })).toBeVisible();
    } finally {
      await restore(noCost, a);
      await restore(waiting, b);
    }
  });

  test("4. Policies tab: notice, change warning, Saved toast, DB and audit row, axe", async ({ page }) => {
    const cat = await laptopCategory();
    try {
      await setLaptopPolicy(null, null);
      const policies0 = await auditCount(cat.id, "depreciation.policy");
      const missing = await db.assetCategory.count({ where: { depreciationLifeMonths: null } });

      await login(page, FINANCE);
      await page.goto("/finance/depreciation?tab=policies");
      await expect(page.getByText(new RegExp(`^${missing} categories have no useful life yet`))).toBeVisible();

      const years = page.getByLabel("Years for Laptop", { exact: true });
      await waitForHydration(years);
      await years.fill("3");
      await page.getByLabel("Months for Laptop", { exact: true }).fill("0");
      await page.getByLabel("Salvage percent for Laptop", { exact: true }).fill("10");
      await expect(page.getByText(/This updates the book value of \d+ assets?, including past months on the schedule\./)).toBeVisible();
      await page.locator("tr").filter({ has: years }).getByRole("button", { name: "Save" }).click();
      await expect(page.getByText("Saved — Laptop")).toBeVisible();

      const saved = await laptopCategory();
      expect(saved.depreciationLifeMonths).toBe(36);
      expect(Number(saved.depreciationSalvagePercent)).toBe(10);
      expect(await auditCount(cat.id, "depreciation.policy")).toBe(policies0 + 1);
      await expectNoSeriousAxe(page);
    } finally {
      await db.assetCategory.update({
        where: { id: cat.id },
        data: { depreciationLifeMonths: cat.depreciationLifeMonths, depreciationSalvagePercent: cat.depreciationSalvagePercent },
      });
    }
  });

  test("5. book value: a confirmed laptop's figure equals depreciate(); the footer totals", async ({ page }) => {
    const tag = "BR-LT-0148";
    const before = await snap(tag);
    const cat = await laptopCategory();
    try {
      const start = await approvedLaptop(tag);
      await login(page, FINANCE);
      await page.goto(`/finance/assets?fin=approved&q=${tag}`);
      const r = row(page, tag);
      await expect(r).toBeVisible();
      await expect(r).toContainText("Approved");
      await expect(r).toContainText(expectedBook(55000, start));
      // Phase 47 (spec §3 item 5): the toolbar's "N assets shown" and their combined book value (the old footer's line)
      await expect(page.locator('p[aria-live="polite"]').filter({ hasText: /^1 asset shown\b/ })).toContainText(expectedBook(55000, start));
      await expect(page.locator("tfoot")).toContainText("Total · 1 asset shown");
      await expect(page.getByText(/As of today \(.+ counted\)/)).toBeVisible();
    } finally {
      await restore(tag, before);
      await db.assetCategory.update({ where: { id: cat.id }, data: { depreciationLifeMonths: cat.depreciationLifeMonths, depreciationSalvagePercent: cat.depreciationSalvagePercent } });
    }
  });

  test("6. per-asset override: 2 years and ₱5,000 salvage changes the book value; Clear override reverts it", async ({ page }) => {
    const tag = "BR-LT-0148";
    const before = await snap(tag);
    const cat = await laptopCategory();
    try {
      const start = await approvedLaptop(tag);
      const id = before.id;
      const [set0, cleared0] = await Promise.all([auditCount(id, "depreciation.override"), auditCount(id, "depreciation.override.cleared")]);

      await login(page, FINANCE);
      await page.goto(`/finance/assets?fin=approved&q=${tag}`);
      const categoryBook = expectedBook(55000, start);
      await expect(row(page, tag)).toContainText(categoryBook);

      const trigger = page.getByRole("button", { name: `Actions for ${tag}` });
      await waitForHydration(trigger);
      let menu = await openMenu(page, trigger);
      await menu.getByRole("menuitem", { name: "Depreciation for this asset…" }).click();
      let dialog = page.getByRole("dialog", { name: `Depreciation for ${tag}` });
      await expect(dialog).toBeVisible();
      await dialog.getByLabel("Years", { exact: true }).fill("2");
      await dialog.getByLabel("Months", { exact: true }).fill("0");
      await dialog.getByLabel("Salvage (₱)").fill("5000");
      await dialog.getByLabel("Reason").fill("refurbished unit");
      await dialog.getByRole("button", { name: "Save", exact: true }).click();
      await expect(page.locator("[data-toast-id]").filter({ hasText: `Saved ${tag}'s depreciation settings` })).toBeVisible();

      const customBook = expectedBook(55000, start, 24, null, 500_000);
      expect(customBook).not.toBe(categoryBook);
      await expect(row(page, tag)).toContainText("custom");
      await expect(row(page, tag)).toContainText(customBook);

      menu = await openMenu(page, page.getByRole("button", { name: `Actions for ${tag}` }));
      await menu.getByRole("menuitem", { name: "Depreciation for this asset…" }).click();
      dialog = page.getByRole("dialog", { name: `Depreciation for ${tag}` });
      await dialog.getByRole("button", { name: "Clear override" }).click();
      await expect(page.locator("[data-toast-id]").filter({ hasText: `Cleared ${tag}'s depreciation settings` })).toBeVisible();
      await expect(row(page, tag)).toContainText(categoryBook);
      await expect(row(page, tag)).not.toContainText("custom");

      expect(await auditCount(id, "depreciation.override")).toBe(set0 + 1);
      expect(await auditCount(id, "depreciation.override.cleared")).toBe(cleared0 + 1);
    } finally {
      await restore(tag, before);
      await db.assetCategory.update({ where: { id: cat.id }, data: { depreciationLifeMonths: cat.depreciationLifeMonths, depreciationSalvagePercent: cat.depreciationSalvagePercent } });
    }
  });

  test("7. asset page schedule: a year opens to its months, future months read projected", async ({ page }) => {
    const tag = "BR-LT-0148";
    const before = await snap(tag);
    const cat = await laptopCategory();
    try {
      await approvedLaptop(tag);
      await login(page, FINANCE);
      // Phase 47 (spec §4.2): the Depreciation ledger's All years view is one summary row per year, whose year is a
      // link that opens that year's months (`?year=`).
      await page.goto(`/finance/assets/${before.id}?year=all`);
      const table = page.getByRole("table", { name: "Depreciation by year" });
      await expect(table).toBeVisible();
      // Phase 38: BR-LT-0148 is purchased ~720 days ago, so its life starts about two years back and the EARLIEST year
      // has no projected months. Open the CURRENT year, which holds the current (actual) month and later (projected) ones.
      const now = new Date();
      const thisMonth = asOfMonth(now);
      const yearNo = Math.floor(thisMonth / 12);
      await table.getByRole("link", { name: String(yearNo), exact: true }).click();
      await page.waitForURL((u) => u.searchParams.get("year") === String(yearNo));
      const months = page.getByRole("table", { name: `Depreciation by month, ${yearNo}` });
      await expect(months).toBeVisible();
      const monthRow = (m: number) => months.getByRole("row", { name: new RegExp(`^${monthLabel(m)}`) });
      await expect(monthRow(thisMonth)).toContainText("This month");
      await expect(monthRow(thisMonth)).toHaveAttribute("aria-current", "date");
      if (thisMonth % 12 > 0) await expect(monthRow(thisMonth - 1)).toContainText("Counted");
      // a later month of the same year reads projected (skipped in December, when the current year has no later month)
      if (thisMonth % 12 < 11) await expect(monthRow(thisMonth + 1)).toContainText("Projected");
    } finally {
      await restore(tag, before);
      await db.assetCategory.update({ where: { id: cat.id }, data: { depreciationLifeMonths: cat.depreciationLifeMonths, depreciationSalvagePercent: cat.depreciationSalvagePercent } });
    }
  });

  test("8. Finance's home: Book value as of today, and registrations to review", async ({ page }) => {
    await login(page, FINANCE);
    await page.goto("/");
    // Phase 46 (spec §3.2): the Finance Overview's Book value tile (a plain card) and Needs you's registrations to
    // confirm, one item per class, each linked to its class's view.
    const book = page.locator('[data-kpis] > [data-kpi="fin.bookC"]');
    await expect(book).toContainText("Book value");
    await expect(book).toContainText("as of today");
    await expect(page.locator('a[data-kpi="fin.bookC"]')).toHaveCount(0);
    // The action names its item in visually hidden text; Chromium's accessible name puts a space before that
    // (absolutely positioned) span, so the name reads "Review : 25 IT registrations to confirm".
    await expect(page.locator("[data-needs-you]").getByRole("link", { name: /^Review\s*: \d+ (IT|Purchasing) registrations? to confirm$/ }).first())
      .toHaveAttribute("href", /^\/finance\/assets\?(cls=PURCHASING&)?fin=with-finance$/);
  });

  test("9. the year schedule: category subtotals, a Total, projected headers, and an empty year", async ({ page }) => {
    const tag = "BR-LT-0148";
    const before = await snap(tag);
    const cat = await laptopCategory();
    try {
      await approvedLaptop(tag);
      const year = thisYear();
      await login(page, FINANCE);
      await page.goto("/finance/depreciation");
      const table = page.getByRole("table", { name: `Depreciation schedule ${year}` });
      await expect(table).toBeVisible();
      // Phase 36: the default view is the category summary; a category link drills into its assets.
      await expect(table.getByRole("link", { name: "Laptop", exact: true })).toBeVisible();
      await expect(table.getByRole("cell", { name: "Total", exact: true })).toBeVisible();
      await table.getByRole("link", { name: "Laptop", exact: true }).click();
      await expect(page.getByRole("cell", { name: "Subtotal — Laptop" })).toBeVisible();
      await page.getByRole("link", { name: "← All categories" }).click();
      await expect(table.locator('th[title="projected"]').first()).toBeVisible();
      await expectNoSeriousAxe(page);

      await page.goto("/finance/depreciation?year=2020");
      await expect(page.getByText("No asset depreciates in 2020.")).toBeVisible();
      await expectNoSeriousAxe(page);
    } finally {
      await restore(tag, before);
      await db.assetCategory.update({ where: { id: cat.id }, data: { depreciationLifeMonths: cat.depreciationLifeMonths, depreciationSalvagePercent: cat.depreciationSalvagePercent } });
    }
  });

  test("10. the three exports: the register, the year schedule, one asset's schedule", async ({ page }) => {
    const tag = "BR-LT-0148";
    const before = await snap(tag);
    const cat = await laptopCategory();
    try {
      await approvedLaptop(tag);
      const year = thisYear();
      const today = new Date().toISOString().slice(0, 10);
      await login(page, FINANCE);

      const reg = await page.request.get("/finance/assets/export");
      expect(reg.status()).toBe(200);
      expect(reg.headers()["content-disposition"]).toMatch(/finance-assets-\d{4}-\d{2}-\d{2}\.xlsx/);
      const regGrid = (await readSheet(Buffer.from(await reg.body()))) as unknown[][];
      expect(regGrid[0]).toEqual([
        "Tag", "Model", "Category", "Class", "Status", "Holder", "Registration", "Cost", "Confirmed on", "Starts",
        "Life (months)", "Salvage", "Monthly amount", "Depreciation to date", "Book value", "Basis", "Note",
      ]);
      expect(regGrid.some((r) => r[0] === tag)).toBe(true);

      const sched = await page.request.get(`/finance/depreciation/export?year=${year}&cls=IT`);
      expect(sched.status()).toBe(200);
      expect(sched.headers()["content-disposition"]).toContain(`depreciation-it-${year}.xlsx`);
      const schedGrid = (await readSheet(Buffer.from(await sched.body()))) as unknown[][];
      expect(schedGrid.some((r) => r.includes("Total"))).toBe(true);

      const one = await page.request.get(`/finance/assets/${before.id}/export`);
      expect(one.status()).toBe(200);
      expect(one.headers()["content-disposition"]).toContain(`asset-${tag}-${today}`);
      const oneGrid = (await readSheet(Buffer.from(await one.body()))) as unknown[][];
      expect(oneGrid[0][0]).toBe("Month");
      expect(oneGrid[1][0]).toBe("Cost");
    } finally {
      await restore(tag, before);
      await db.assetCategory.update({ where: { id: cat.id }, data: { depreciationLifeMonths: cat.depreciationLifeMonths, depreciationSalvagePercent: cat.depreciationSalvagePercent } });
    }
  });

  test("11. access: IT and Purchasing are redirected away from the depreciation and asset pages", async ({ page }) => {
    const asset = await db.asset.findUniqueOrThrow({ where: { tag: "BR-LT-0148" } });
    for (const email of [IT, PURCHASING]) {
      await login(page, email);
      await page.goto("/finance/depreciation");
      expect(new URL(page.url()).pathname.startsWith("/finance")).toBe(false);
      await page.goto(`/finance/assets/${asset.id}`);
      expect(new URL(page.url()).pathname.startsWith("/finance")).toBe(false);
    }
  });

  test("12. axe: IT's list with Registration, the register, and the asset page with the send-back dialog open", async ({ page }) => {
    const tag = "BR-HS-0510";
    const before = await snap(tag);
    const itUser = await db.user.findUniqueOrThrow({ where: { email: IT } });
    const prefsBefore = await db.userPreference.findMany({ where: { userId: itUser.id, key: { in: COLUMN_KEYS } } });
    try {
      await reset(tag);
      // Phase 45 (spec §2.3): from the default columns, Registration is off until it is chosen in Columns.
      await db.userPreference.deleteMany({ where: { userId: itUser.id, key: { in: COLUMN_KEYS } } });
      await login(page, IT);
      await page.goto("/inventory");
      await expect(page.getByRole("columnheader", { name: "Serial number" })).toBeVisible();
      await expect(page.getByRole("columnheader", { name: "Registration" })).toHaveCount(0);
      const columns = page.getByRole("button", { name: "Columns", exact: true });
      await waitForHydration(columns);
      await columns.click();
      const chooser = page.getByRole("dialog", { name: "Choose columns" });
      await chooser.getByRole("checkbox", { name: "Registration", exact: true }).check();
      await chooser.getByRole("button", { name: "Apply", exact: true }).click();
      await expect(chooser).toBeHidden({ timeout: 15_000 });
      await expect(page.getByRole("columnheader", { name: "Registration" })).toBeVisible({ timeout: 15_000 });
      await expectNoSeriousAxe(page);

      await login(page, FINANCE);
      await page.goto("/finance/assets");
      await expect(page.getByRole("heading", { name: "Assets", level: 1 })).toBeVisible();
      await expectNoSeriousAxe(page);

      await page.goto(`/finance/assets/${before.id}`);
      const sendBack = page.getByRole("region", { name: "Review" }).getByRole("button", { name: "Send back…" });
      await waitForHydration(sendBack);
      await sendBack.click();
      await expect(page.getByRole("dialog", { name: `Send ${tag} back` })).toBeVisible();
      await expectNoSeriousAxe(page);
    } finally {
      // Put IT's column choice back exactly as it was (the file's starting choice, with Registration).
      await db.userPreference.deleteMany({ where: { userId: itUser.id, key: { in: COLUMN_KEYS } } });
      for (const p of prefsBefore) {
        await db.userPreference.create({ data: { userId: p.userId, key: p.key, value: p.value as never } });
      }
      await restore(tag, before);
    }
  });
  test("13. legacy approval with no cost (confirmed, flag off): Finance adding a cost reopens the review", async ({ page }) => {
    const tag = "BR-MN-0910";
    const before = await snap(tag);
    try {
      const finance = await db.user.findUniqueOrThrow({ where: { email: FINANCE } });
      await reset(tag, { cost: null, financeConfirmedAt: new Date(Date.now() - 30 * DAY), financeConfirmedById: finance.id });
      const id = before.id;
      const reopened0 = await auditCount(id, "finance.reopened");

      await login(page, FINANCE);
      await fixCostOnFinancePage(page, id, tag, "750");

      const after = await db.asset.findUniqueOrThrow({ where: { id } });
      expect(after.financeConfirmedAt).toBeNull();
      expect(after.financeConfirmedById).toBeNull();
      expect(after.financeNotCapitalised).toBe(false);
      expect(await auditCount(id, "finance.reopened")).toBe(reopened0 + 1);
      await login(page, IT);
      await page.goto(`/inventory?q=${listQ(tag)}`);
      await expect(row(page, tag)).toContainText("With Finance");
    } finally {
      await restore(tag, before);
    }
  });

  test("14. a saved column preference without Registration still shows it under the reg filter (Show them)", async ({ page }) => {
    const tag = "BR-HS-0502";
    const before = await snap(tag);
    const user = await db.user.findUniqueOrThrow({ where: { email: IT } });
    const key = { userId_key: { userId: user.id, key: "columns:inventory" } };
    const prefBefore = await db.userPreference.findUnique({ where: key });
    try {
      await reset(tag, { financeReturnedAt: new Date(), financeReturnedById: (await db.user.findUniqueOrThrow({ where: { email: FINANCE } })).id, financeReturnFields: ["cost"], financeReturnReason: "e2e: pref" });
      await db.userPreference.upsert({
        where: key,
        create: { userId: user.id, key: "columns:inventory", value: ["category"] },
        update: { value: ["category"] },
      });
      await login(page, IT);
      await page.goto("/inventory");
      await expect(page.getByRole("columnheader", { name: "Registration" })).toHaveCount(0);
      await page.goto("/inventory?reg=needs-correction");
      await expect(page.getByRole("columnheader", { name: "Registration" })).toBeVisible();
      await expect(row(page, tag)).toContainText("Finance flagged");
    } finally {
      if (prefBefore) await db.userPreference.update({ where: key, data: { value: prefBefore.value as never } });
      else await db.userPreference.deleteMany({ where: { userId: user.id, key: "columns:inventory" } });
      await restore(tag, before);
    }
  });
});
