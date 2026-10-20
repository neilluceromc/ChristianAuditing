import { test, expect, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import AxeBuilder from "@axe-core/playwright";
import { readSheet } from "read-excel-file/node";
import { PrismaClient } from "@prisma/client";
import { SEED_PASSWORD } from "../prisma/fixtures";
import { localDateISO, fmtMoneyExact } from "@/lib/format";
import { monthKey } from "@/lib/stock-reports";
import { isExpired, lotRemaining, DEFAULT_EXPIRY_WINDOW } from "@/lib/stock-allocation";
import { isLow } from "@/lib/stock-balance";
import { ON_HAND_EXPORT_COLUMNS, CONSUMPTION_EXPORT_COLUMNS } from "@/lib/export-columns";

/**
 * Phase 22, Task 9 — Stock control D2 reports (spec §9.2, 6 cases). Tasks
 * 1-8 built the three report pages, the two Home tiles and the item/list
 * pills this file reads; every case here is READ-ONLY (no receipt, issue,
 * write-off or adjustment is posted), so — unlike `stock-lots.spec.ts` —
 * cases share no state and this suite does not run `serial`. Every number
 * asserted against the screen is computed fresh from the ledger via Prisma
 * in the test itself (never copied from the facts file below, which is for
 * orientation only), the same "balances are derived, never hardcoded" rule
 * `stock.spec.ts` and `stock-lots.spec.ts` follow.
 *
 * Seeded stock this file leans on (prisma/seed.ts, spec §2.8's D2
 * additions): `PN-0003` (Sugar sachet) carries a RECEIPT lot of 100 @₱0.90
 * that arrived already expired (5 days ago); `PN-0002` (Creamer sachet)
 * carries a RECEIPT lot of 100 @₱3.10 expiring in 20 days; `CM-0001`
 * (Dishwashing liquid) carries a lot expiring in 200 days — never inside any
 * of the 7/30/90-day windows. `PN-0001` was issued 110 units to Operations
 * 6 days ago (leaving it LOW); `CM-0002` was issued 8 units to Operations 9
 * days ago; `OS-0001`/`OS-0002`/`PN-0004` were issued to Finance/Sales/HR
 * respectively, all from uncosted opening lots.
 */

const db = new PrismaClient();

test.beforeAll(() => {
  execSync("npm run db:seed", { timeout: 120_000 });
});
test.afterAll(async () => {
  execSync("npm run db:seed", { timeout: 120_000 });
  await db.$disconnect();
});

// Copied from e2e/stock.spec.ts:45-51 — house rule: never import helpers
// across spec files, since each file reseeds independently.
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

// Copied from e2e/stock.spec.ts:56-61 — the mouse-move-then-settle step
// guards against a phantom SERIOUS contrast violation measured there on a
// freshly-mounted Button variant="primary" mid-transition.
async function expectNoSeriousAxe(page: Page) {
  await page.mouse.move(0, 0);
  await page.waitForTimeout(700);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
}

const PURCHASING = "purchasing@thebackroomop.com";

/**
 * Phase 39 (spec §4.3): the Expiry report is two tabs — "Expired ({n})" and "Expiring ({n})", `?tab=` — each paged 50
 * at a time, and the window chips show on the Expiring tab only. This is the tab row's name (`expiry/page.tsx`).
 */
const EXPIRY_TABS = "Expiry status";

/** `consumption-grid.tsx`'s own month-label formatting, mirrored here only to find the right column — never used to compute an expected VALUE. */
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function monthLabel(key: string): string {
  const [y, m] = key.split("-");
  return `${MONTH_NAMES[Number(m) - 1]} ${y}`;
}

test.describe("stock reports", () => {
  test("1. On hand: grand total value/uncosted units match a Prisma-computed FIFO value; Uncosted only narrows to items with uncosted stock; the export header matches ON_HAND_EXPORT_COLUMNS", async ({
    page,
  }) => {
    test.setTimeout(60_000); // first hit of /stock/reports/* in this file — cold JIT
    const items = await db.stockItem.findMany({ where: { archivedAt: null }, select: { id: true, code: true } });
    const codeById = new Map(items.map((i) => [i.id, i.code]));
    const lots = await db.stockLot.findMany({
      where: { itemId: { in: items.map((i) => i.id) } },
      select: { id: true, itemId: true, quantity: true, unitCost: true, allocations: { select: { quantity: true } } },
    });

    // Spec §2.5's onHand(): Σ over open lots (remaining > 0) — costed lots
    // contribute remaining × cost to the value, uncosted lots contribute
    // their remaining to the uncosted count. The item that owns an uncosted
    // lot is what the "Uncosted only" toggle is expected to keep.
    let grandValue = 0;
    let grandUncosted = 0;
    const uncostedCodes = new Set<string>();
    for (const l of lots) {
      const remaining = lotRemaining(l.quantity, l.allocations.reduce((s, a) => s + a.quantity, 0));
      if (remaining <= 0) continue;
      if (l.unitCost !== null) grandValue += remaining * Number(l.unitCost);
      else {
        grandUncosted += remaining;
        uncostedCodes.add(codeById.get(l.itemId)!);
      }
    }

    await login(page, PURCHASING);
    await page.goto("/stock/reports/on-hand");
    await expect(page.getByRole("heading", { name: "On hand and value", level: 1 })).toBeVisible({ timeout: 10_000 });

    // Phase 39 (spec §4.2): the grand total is the totals card above the table (over everything matching the
    // filters, never just the page); the table has no subtotal or grand-total rows any more.
    const totals = page.getByRole("region", { name: "Totals", exact: true });
    await expect(totals).toBeVisible();
    const stat = (label: string) => totals.getByText(label, { exact: true }).locator("xpath=following-sibling::dd");
    await expect(stat("Uncosted units")).toHaveText(String(grandUncosted));
    await expect(stat("Value on hand")).toHaveText(fmtMoneyExact(grandValue));
    await expect(page.getByRole("row", { name: /Grand total/ })).toHaveCount(0);

    await page.getByRole("link", { name: "Uncosted only" }).click();
    await expect(page.getByRole("link", { name: "Show all" })).toBeVisible({ timeout: 10_000 });
    if (uncostedCodes.size === 0) {
      await expect(page.getByText("No item matches.", { exact: true })).toBeVisible();
    } else {
      const codeLinks = page.getByRole("table").getByRole("link", { name: /^[A-Z]{2}-\d{4}$/ });
      const visibleCodes = (await codeLinks.allTextContents()).map((t) => t.trim()).sort();
      expect(visibleCodes).toEqual([...uncostedCodes].sort());
    }

    const res = await page.request.get("/stock/reports/on-hand/export");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-disposition"]).toMatch(/filename="stock-on-hand-\d{4}-\d{2}-\d{2}\.xlsx"/);
    const grid = (await readSheet(Buffer.from(await res.body()))) as unknown[][];
    expect(grid[0]).toEqual(ON_HAND_EXPORT_COLUMNS.map((c) => c.label));
  });

  test("2. Consumption: a seeded department/month cell equals the DB sum of its ISSUE units and cost; the flat export has the eight columns", async ({
    page,
  }) => {
    test.setTimeout(60_000); // first hit of /stock/reports/consumption in this file — cold JIT
    // The seed's own "6 days ago" issue names the month this case checks —
    // computed from the real occurredAt, never assumed to be "this month".
    const pn0001Issue = await db.stockMovement.findFirstOrThrow({
      where: { kind: "ISSUE", quantity: -110, item: { code: "PN-0001" } },
    });
    const targetMonth = monthKey(pn0001Issue.occurredAt);

    const opsIssues = await db.stockMovement.findMany({
      where: { kind: "ISSUE", department: { name: "Operations" } },
      select: { id: true, quantity: true, occurredAt: true },
    });
    const inMonth = opsIssues.filter((m) => monthKey(m.occurredAt) === targetMonth);
    const expectedUnits = inMonth.reduce((s, m) => s + Math.abs(m.quantity), 0);
    const allocs = inMonth.length
      ? await db.stockAllocation.findMany({
          where: { movementId: { in: inMonth.map((m) => m.id) } },
          select: { quantity: true, lot: { select: { unitCost: true } } },
        })
      : [];
    let cost = 0;
    let costedUnits = 0;
    for (const a of allocs) {
      if (a.lot.unitCost !== null) {
        cost += a.quantity * Number(a.lot.unitCost);
        costedUnits += a.quantity;
      }
    }
    const expectedCost = costedUnits > 0 ? cost : null;

    await login(page, PURCHASING);
    await page.goto("/stock/reports/consumption");
    await expect(page.getByRole("heading", { name: "Consumption by department", level: 1 })).toBeVisible({
      timeout: 10_000,
    });

    const headerTexts = (await page.getByRole("columnheader").allTextContents()).map((t) => t.trim());
    const colIndex = headerTexts.indexOf(monthLabel(targetMonth));
    expect(colIndex, `month column for ${targetMonth} (${monthLabel(targetMonth)}) among ${headerTexts.join(", ")}`).toBeGreaterThan(0);

    const row = page.getByRole("row", { name: /^Operations/ });
    await expect(row).toBeVisible({ timeout: 10_000 });
    const cell = row.getByRole("cell").nth(colIndex);
    await expect(cell).toContainText(String(expectedUnits));
    await expect(cell).toContainText(expectedCost === null ? "—" : fmtMoneyExact(expectedCost));

    const res = await page.request.get("/stock/reports/consumption/export");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-disposition"]).toMatch(/filename="stock-consumption-\d{4}-\d{2}-\d{2}\.xlsx"/);
    const grid = (await readSheet(Buffer.from(await res.body()))) as unknown[][];
    expect(grid[0]).toEqual(CONSUMPTION_EXPORT_COLUMNS.map((c) => c.label));
  });

  test("3. Expiry: the Expired tab lists PN-0003 and the Expiring tab PN-0002, with counts in the tab names; the window chips show on Expiring only — 7 days empties it while Expired is unaffected, 90 days keeps PN-0002; aria-current moves", async ({
    page,
  }) => {
    test.setTimeout(60_000); // first hit of /stock/reports/expiry in this file — cold JIT
    const today = localDateISO();
    // The tab counts, computed from the ledger the way expiryReport does: open, dated lots of active items — Expired
    // once the day has passed, Expiring while it is within the window.
    const lots = await db.stockLot.findMany({
      where: { expiresAt: { not: null }, item: { archivedAt: null } },
      select: { expiresAt: true, quantity: true, allocations: { select: { quantity: true } } },
    });
    const open = lots.filter((l) => lotRemaining(l.quantity, l.allocations.reduce((s, a) => s + a.quantity, 0)) > 0);
    const expiredCount = open.filter((l) => isExpired(l.expiresAt, today)).length;
    const expiringCount = (days: number) => {
      const endMs = Date.parse(`${today}T00:00:00.000Z`) + days * 86_400_000;
      return open.filter((l) => !isExpired(l.expiresAt, today) && l.expiresAt!.getTime() <= endMs).length;
    };

    await login(page, PURCHASING);
    await page.goto("/stock/reports/expiry");
    await expect(page.getByRole("heading", { name: "Expiring and expired lots", level: 1 })).toBeVisible({
      timeout: 10_000,
    });

    const tabs = page.getByRole("navigation", { name: EXPIRY_TABS });
    const chips = page.getByRole("group", { name: "Expiry window" });
    const expiredTab = (n = expiredCount) => tabs.getByRole("link", { name: `Expired (${n})`, exact: true });
    const expiringTab = (days: number) => tabs.getByRole("link", { name: `Expiring (${expiringCount(days)})`, exact: true });

    // Default: the Expired tab (no window chips there); PN-0003's lot arrived already expired.
    await expect(expiredTab()).toHaveAttribute("aria-current", "page");
    await expect(expiringTab(DEFAULT_EXPIRY_WINDOW)).not.toHaveAttribute("aria-current", "page");
    await expect(chips).toHaveCount(0);
    await expect(page.getByRole("row", { name: /PN-0003/ })).toBeVisible();
    await expect(page.getByRole("row", { name: /PN-0002/ })).toHaveCount(0);

    // Expiring tab, default window of 30 days: PN-0002's lot is 20 days out.
    await expiringTab(DEFAULT_EXPIRY_WINDOW).click();
    await expect(page).toHaveURL(/[?&]tab=expiring(&|$)/);
    await expect(expiringTab(DEFAULT_EXPIRY_WINDOW)).toHaveAttribute("aria-current", "page");
    await expect(chips.getByRole("link", { name: "30 days" })).toHaveAttribute("aria-current", "true");
    await expect(page.getByRole("row", { name: /PN-0002/ })).toBeVisible();
    await expect(page.getByRole("row", { name: /PN-0003/ })).toHaveCount(0);

    // 7 days: nothing qualifies — but the Expired tab (never window-bounded) is unaffected.
    await chips.getByRole("link", { name: "7 days" }).click();
    await expect(page).toHaveURL(/[?&]days=7(&|$)/);
    await expect(chips.getByRole("link", { name: "7 days" })).toHaveAttribute("aria-current", "true");
    await expect(chips.getByRole("link", { name: "30 days" })).not.toHaveAttribute("aria-current", "true");
    await expect(expiringTab(7)).toHaveAttribute("aria-current", "page");
    await expect(page.getByText("Nothing expires within 7 days.", { exact: true })).toBeVisible();
    await expiredTab().click();
    await expect(expiredTab()).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("row", { name: /PN-0003/ })).toBeVisible();
    await expect(chips).toHaveCount(0);

    // 90 days: keeps PN-0002 — CM-0001's own lot (+200 days) never qualifies for any window.
    await expiringTab(7).click();
    await chips.getByRole("link", { name: "90 days" }).click();
    await expect(chips.getByRole("link", { name: "90 days" })).toHaveAttribute("aria-current", "true");
    await expect(chips.getByRole("link", { name: "7 days" })).not.toHaveAttribute("aria-current", "true");
    await expect(expiringTab(90)).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("row", { name: /PN-0002/ })).toBeVisible();
    await expect(page.getByRole("row", { name: /CM-0001/ })).toHaveCount(0);
  });

  test("4. /stock: PN-0002 and PN-0003 carry EXPIRING/EXPIRED pills, and 'Show expiring only' lists exactly the items with such lots", async ({
    page,
  }) => {
    const today = localDateISO();
    const items = await db.stockItem.findMany({ where: { archivedAt: null }, select: { id: true, code: true } });
    const codeById = new Map(items.map((i) => [i.id, i.code]));
    const lots = await db.stockLot.findMany({
      where: { itemId: { in: items.map((i) => i.id) }, expiresAt: { not: null } },
      select: { itemId: true, expiresAt: true, quantity: true, allocations: { select: { quantity: true } } },
    });

    // queries.ts's expiringStatusByItem: expired outranks expiring, and only
    // OPEN lots (remaining > 0) within DEFAULT_EXPIRY_WINDOW count at all.
    const windowEndMs = Date.parse(`${today}T00:00:00.000Z`) + DEFAULT_EXPIRY_WINDOW * 86_400_000;
    const statusByItem = new Map<string, "expired" | "expiring">();
    for (const l of lots) {
      const remaining = lotRemaining(l.quantity, l.allocations.reduce((s, a) => s + a.quantity, 0));
      if (remaining <= 0) continue;
      if (isExpired(l.expiresAt, today)) statusByItem.set(l.itemId, "expired");
      else if (statusByItem.get(l.itemId) !== "expired" && l.expiresAt!.getTime() <= windowEndMs) {
        statusByItem.set(l.itemId, "expiring");
      }
    }
    const expectedCodes = [...statusByItem.keys()].map((id) => codeById.get(id)!).sort();

    await login(page, PURCHASING);
    await page.goto("/stock");
    await expect(page.getByRole("heading", { name: "Stock items", level: 1 })).toBeVisible({ timeout: 10_000 });

    for (const [itemId, status] of statusByItem) {
      const code = codeById.get(itemId)!;
      const row = page.getByRole("row", { name: new RegExp(code) });
      await expect(row.getByText(status.toUpperCase(), { exact: true })).toBeVisible();
    }

    await page.getByRole("link", { name: "Show expiring only" }).click();
    await expect(page.getByRole("link", { name: "Show all" })).toBeVisible({ timeout: 10_000 });
    if (expectedCodes.length === 0) {
      await expect(page.getByText("No items match", { exact: true })).toBeVisible();
    } else {
      const codeLinks = page.getByRole("table").getByRole("link", { name: /^[A-Z]{2}-\d{4}$/ });
      const visibleCodes = (await codeLinks.allTextContents()).map((t) => t.trim()).sort();
      expect(visibleCodes).toEqual(expectedCodes);
    }
  });

  test("5. Purchasing Home: the two tiles equal the DB counts and link to /stock?low=1 and /stock/reports/expiry", async ({
    page,
  }) => {
    const today = localDateISO();
    // Mirrors stockHomeSignals (queries.ts): low is the ordinary is-low
    // candidate pass; expiringLots counts LOTS (not items) still open and
    // expiring within DEFAULT_EXPIRY_WINDOW, excluding already-expired ones.
    const candidates = await db.stockItem.findMany({
      where: { archivedAt: null },
      select: { id: true, reorderLevel: true },
    });
    const balanceSums = candidates.length
      ? await db.stockMovement.groupBy({
          by: ["itemId"],
          where: { itemId: { in: candidates.map((c) => c.id) } },
          _sum: { quantity: true },
        })
      : [];
    const balanceById = new Map(balanceSums.map((s) => [s.itemId, s._sum.quantity ?? 0]));
    const expectedLow = candidates.filter((c) => isLow(balanceById.get(c.id) ?? 0, c.reorderLevel)).length;

    const expiryLots = await db.stockLot.findMany({
      where: { expiresAt: { not: null }, item: { archivedAt: null } },
      select: { id: true, expiresAt: true, quantity: true, allocations: { select: { quantity: true } } },
    });
    const windowEndMs = Date.parse(`${today}T00:00:00.000Z`) + DEFAULT_EXPIRY_WINDOW * 86_400_000;
    const expectedExpiring = expiryLots.filter((l) => {
      const remaining = lotRemaining(l.quantity, l.allocations.reduce((s, a) => s + a.quantity, 0));
      return remaining > 0 && !isExpired(l.expiresAt, today) && l.expiresAt!.getTime() <= windowEndMs;
    }).length;

    await login(page, PURCHASING);
    await page.goto("/");

    // Phase 46 (spec §3.2): the Purchasing Overview's tiles — each one link whose value is its page's count.
    const lowTile = page.locator('a[data-kpi="stock.low"]');
    await expect(lowTile.locator("[data-kpi-value]")).toHaveText(String(expectedLow), { timeout: 10_000 });
    await expect(lowTile).toHaveAttribute("href", "/stock?low=1");

    // The tile opens the report's Expiring tab at the default window, whose count it is.
    const expiringTile = page.locator('a[data-kpi="stock.expiringLots"]');
    await expect(expiringTile.locator("[data-kpi-value]")).toHaveText(String(expectedExpiring));
    await expect(expiringTile).toHaveAttribute("href", new RegExp(`^/stock/reports/expiry\\?(?=.*\\btab=expiring\\b)(?=.*\\bdays=${DEFAULT_EXPIRY_WINDOW}\\b)`));
    await expiringTile.click();
    await expect(page).toHaveURL(/\/stock\/reports\/expiry\?.*tab=expiring/);
    await expect(page.getByRole("navigation", { name: EXPIRY_TABS }).locator('[aria-current="page"]'))
      .toHaveText(`Expiring (${expectedExpiring})`);
  });

  test("6. No serious or critical axe violations on the three reports and PN-0003's item page", async ({ page }) => {
    test.setTimeout(60_000); // four full-page axe scans, each with its own settle wait
    const pn0003 = await db.stockItem.findUniqueOrThrow({ where: { code: "PN-0003" } });

    await login(page, PURCHASING);
    await page.goto("/stock/reports/on-hand");
    await expectNoSeriousAxe(page);

    await page.goto("/stock/reports/consumption");
    await expectNoSeriousAxe(page);

    await page.goto("/stock/reports/expiry");
    await expectNoSeriousAxe(page);

    await page.goto(`/stock/items/${pn0003.id}`);
    await expectNoSeriousAxe(page);
  });
});
