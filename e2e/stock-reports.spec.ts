import { test, expect, type Locator, type Page } from "@playwright/test";
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
  await page.getByLabel(/Email/).fill(email);
  await page.getByLabel(/Password/).fill(SEED_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
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
 * `expiry-table.tsx` wraps each block (Expired / Expiring within N days) in
 * its own `<section>` with a plain `<h2>{title}</h2>` sibling to the table —
 * one level up from the heading is that section, which is as far as this
 * needs to go (contrast `stock-lots.spec.ts`'s `cardSection`, which goes up
 * two levels because `Card` wraps its `<h2>` in a `CardHeader` div).
 */
function reportSection(page: Page, name: string | RegExp, exact = false): Locator {
  return page.getByRole("heading", { level: 2, name, exact }).locator("xpath=..");
}

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

    const grandRow = page.getByRole("row", { name: /Grand total/ });
    await expect(grandRow).toBeVisible();
    const grandCells = grandRow.getByRole("cell");
    // Column order (on-hand-table.tsx): Grand total (colSpan 3), Balance,
    // blank (colSpan 2), Uncosted units, Value on hand, blank (colSpan 2).
    await expect(grandCells.nth(3)).toHaveText(String(grandUncosted));
    await expect(grandCells.nth(4)).toHaveText(fmtMoneyExact(grandValue));

    await page.getByRole("link", { name: "Uncosted only" }).click();
    await expect(page.getByRole("link", { name: "Show all" })).toBeVisible({ timeout: 10_000 });
    if (uncostedCodes.size === 0) {
      await expect(page.getByText("No stock items yet.", { exact: true })).toBeVisible();
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

  test("3. Expiry: Expired lists PN-0003 and Expiring within 30 lists PN-0002; the 7-day chip empties Expiring while Expired is unaffected; the 90-day chip keeps both; aria-current moves", async ({
    page,
  }) => {
    test.setTimeout(60_000); // first hit of /stock/reports/expiry in this file — cold JIT
    await login(page, PURCHASING);
    await page.goto("/stock/reports/expiry");
    await expect(page.getByRole("heading", { name: "Expiring and expired lots", level: 1 })).toBeVisible({
      timeout: 10_000,
    });

    const chips = page.getByRole("group", { name: "Expiry window" });
    const expiredSection = reportSection(page, "Expired", true);
    const expiringSection = reportSection(page, /^Expiring within/);

    // Default window is 30 days (DEFAULT_EXPIRY_WINDOW).
    await expect(chips.getByRole("link", { name: "30 days" })).toHaveAttribute("aria-current", "true");
    await expect(expiredSection.getByRole("row", { name: /PN-0003/ })).toBeVisible();
    await expect(expiringSection.getByRole("row", { name: /PN-0002/ })).toBeVisible();

    // 7 days: PN-0002's lot is 20 days out, so nothing qualifies — but the
    // Expired block (never window-bounded) is unaffected.
    await chips.getByRole("link", { name: "7 days" }).click();
    await expect(page.getByRole("heading", { name: "Expiring within 7 days", level: 2 })).toBeVisible({
      timeout: 10_000,
    });
    await expect(chips.getByRole("link", { name: "7 days" })).toHaveAttribute("aria-current", "true");
    await expect(chips.getByRole("link", { name: "30 days" })).not.toHaveAttribute("aria-current", "true");
    await expect(page.getByText("Nothing expires within 7 days.", { exact: true })).toBeVisible();
    await expect(expiredSection.getByRole("row", { name: /PN-0003/ })).toBeVisible();

    // 90 days: keeps both blocks exactly as the 30-day window did — CM-0001's
    // own lot (+200 days) never qualifies for any window.
    await chips.getByRole("link", { name: "90 days" }).click();
    await expect(page.getByRole("heading", { name: "Expiring within 90 days", level: 2 })).toBeVisible({
      timeout: 10_000,
    });
    await expect(chips.getByRole("link", { name: "90 days" })).toHaveAttribute("aria-current", "true");
    await expect(chips.getByRole("link", { name: "7 days" })).not.toHaveAttribute("aria-current", "true");
    await expect(expiredSection.getByRole("row", { name: /PN-0003/ })).toBeVisible();
    await expect(expiringSection.getByRole("row", { name: /PN-0002/ })).toBeVisible();
    await expect(expiringSection.getByRole("row", { name: /CM-0001/ })).toHaveCount(0);
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
    await expect(page.getByRole("heading", { name: "Your requests", level: 2 })).toBeVisible({ timeout: 10_000 });

    const lowTile = page.getByText("Below reorder level", { exact: true }).locator("xpath=..");
    await expect(lowTile).toContainText(String(expectedLow));
    await expect(lowTile.getByRole("link")).toHaveAttribute("href", "/stock?low=1");

    const expiringTile = page.getByText("Expiring within 30 days", { exact: true }).locator("xpath=..");
    await expect(expiringTile).toContainText(String(expectedExpiring));
    await expect(expiringTile.getByRole("link")).toHaveAttribute("href", "/stock/reports/expiry");
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
