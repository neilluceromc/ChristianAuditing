import { test, expect, type Locator, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import AxeBuilder from "@axe-core/playwright";
import { PrismaClient } from "@prisma/client";
import { SEED_PASSWORD } from "../prisma/fixtures";

/**
 * Phase 19, Task 8 — Stock control, stocktakes (spec §9.2, 6 cases). Drives
 * the whole stocktake flow Task 5 shipped: opening (a blind count screen —
 * book quantities are never rendered there — and one scope locked to a
 * single OPEN stocktake at a time), counting a line (per-row save on blur),
 * the variance review (book vs the live current balance vs what got
 * counted, with a MOVED flag for anything the ledger moved on since the
 * stocktake opened — decoupled from whether that movement actually created
 * a difference), posting (adjustments are computed against the CURRENT
 * balance, never the stale book snapshot, so a legitimate movement recorded
 * mid-count is never double-counted, and uncounted lines are skipped rather
 * than zeroed), cancelling, and an axe sweep.
 *
 * Cases run serial and share one stocktake, opened on Pantry in case 1 and
 * carried through cases 2-4 (case 2 tries and fails to open a second one on
 * the same scope while it's open; cases 3-4 count it, move a line via a real
 * issue, review, then post it). Cases 5-6 each open their own short-lived
 * stocktake. Every id is looked up fresh via Prisma, never hardcoded, since
 * the seed produces new cuids on every reseed — PN1_COUNT/PN2_COUNT are OUR
 * chosen count-screen inputs, not seed facts, so those are the only bare
 * numeric literals describing a Pantry item in the file; every book/current
 * balance is read back from the DB.
 *
 * Seeded stock (prisma/seed.ts): Pantry (PN) has four active items,
 * PN-0001..0004; Cleaning materials (CM) has three, with one already-POSTED
 * stocktake from the seed itself, ST-0001 (Pantry has none open or posted).
 * The `stocktake_ref_seq` sequence is reset so the first ref this file
 * creates is ST-0002. Departments include "HR". Accounts, all
 * @thebackroomop.com / SEED_PASSWORD: admin, it, purchasing, finance,
 * viewer — this file only needs purchasing_staff (canManageStock).
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

// Copied from e2e/stock.spec.ts:56-61 — the mouse-move-then-settle step
// guards against a phantom SERIOUS contrast violation measured there on a
// freshly-mounted Button variant="primary" mid-transition.
async function expectNoSeriousAxe(page: Page) {
  await page.mouse.move(0, 0);
  await page.waitForTimeout(700);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
}

// Copied from e2e/stock.spec.ts:67-75 (itself copied from e2e/suppliers.spec.ts,
// originally e2e/it-core.spec.ts) — house rule: never import across spec
// files. Probed on the element about to be interacted with, since hydration
// walks parent-to-child and a hydrated <form> does not yet imply a hydrated
// <input> inside it.
async function waitForHydration(target: Locator) {
  const el = target.first();
  await el.waitFor({ state: "attached", timeout: 20_000 });
  await expect(async () => {
    expect(await el.evaluate((node) => Object.keys(node).some((k) => k.startsWith("__reactFiber$")))).toBe(
      true,
    );
  }).toPass({ timeout: 20_000 });
}

// Copied from e2e/stock.spec.ts:90-93 — balances are DERIVED, never a stored
// column, so every assertion recomputes from the ledger, same as the app does.
async function balanceOf(itemId: string): Promise<number> {
  const agg = await db.stockMovement.aggregate({ where: { itemId }, _sum: { quantity: true } });
  return agg._sum.quantity ?? 0;
}

const PURCHASING = "purchasing@thebackroomop.com";

// A real minus sign (U+2212), the same character stocktake-review.tsx's own
// fmtVariance writes for a negative — a hyphen-minus in the test would never
// match it. Reimplemented independently below (never imported), so the
// expected text isn't derived from the code under test.
const MINUS = "−";
function fmtSigned(n: number): string {
  return n >= 0 ? `+${n}` : `${MINUS}${Math.abs(n)}`;
}

const pantry = (code: string) => db.stockItem.findUniqueOrThrow({ where: { code } });
const PANTRY_CODES = ["PN-0001", "PN-0002", "PN-0003", "PN-0004"] as const;

// Our own count-screen inputs for case 3/4 — not seed facts. PN1_COUNT is
// deliberately chosen to differ from PN-0001's post-issue CURRENT balance
// (book 40, minus the 2 issued later in case 3, leaves 38), so the row
// demonstrates both a real MOVED flag (the ledger moved) AND a genuine
// variance (35 − 38 = −3) reconciled against the CURRENT balance, never the
// stale book snapshot — proving planStocktakePost actually writes an
// ADJUSTMENT rather than the double-count case its own comment
// (src/lib/stocktake.ts) describes avoiding.
const PN1_COUNT = 35;
const PN2_COUNT = 250;

let stocktakeId = "";
let stocktakeRefNo = "";

test.describe.serial("stocktake", () => {
  test("1. Opening a Pantry stocktake lands on a blind count — no book quantities anywhere in the table", async ({
    page,
  }) => {
    test.setTimeout(60_000); // first hit of /stock/stocktakes/new and /stock/stocktakes/[id]
    await login(page, PURCHASING);

    const balancesBefore = new Map<string, number>();
    for (const code of PANTRY_CODES) {
      const item = await pantry(code);
      balancesBefore.set(code, await balanceOf(item.id));
    }

    await page.goto("/stock/stocktakes/new");
    const scopeField = page.getByLabel("Scope");
    await waitForHydration(scopeField);
    await scopeField.selectOption({ label: "Pantry" });
    await page.getByLabel("Note").fill("Test count");
    await page.getByRole("button", { name: "Open stocktake" }).click();

    const countedPN1 = page.getByLabel("Counted PN-0001");
    await waitForHydration(countedPN1);

    // R4: the blind-count assertion is scoped to the count TABLE only — never
    // the whole page. Neither the "Book" column nor any of the seed's own
    // Pantry balances (read live from the DB, above) may appear as a cell
    // inside it.
    const table = page.getByRole("table");
    await expect(table.getByRole("columnheader", { name: "Book" })).toHaveCount(0);
    for (const code of PANTRY_CODES) {
      const input = page.getByLabel(`Counted ${code}`);
      await expect(input).toBeVisible();
      await expect(input).toHaveValue("");
    }
    for (const balance of balancesBefore.values()) {
      await expect(table.getByText(String(balance), { exact: true })).toHaveCount(0);
    }

    const st = await db.stocktake.findFirstOrThrow({
      where: { category: { name: "Pantry" } },
      orderBy: { openedAt: "desc" },
    });
    stocktakeId = st.id;
    stocktakeRefNo = st.refNo;
    expect(page.url()).toContain(stocktakeId);
    expect(page.url()).not.toContain("view=review");
    expect(st.note).toBe("Test count");

    const lines = await db.stocktakeLine.findMany({
      where: { stocktakeId },
      include: { item: { select: { code: true } } },
    });
    expect(lines).toHaveLength(4);
    for (const l of lines) {
      expect(l.bookQty).toBe(balancesBefore.get(l.item.code));
    }
  });

  test("2. A second Pantry stocktake is refused while the first is still open", async ({ page }) => {
    await login(page, PURCHASING);
    await page.goto("/stock/stocktakes/new");
    const scopeField = page.getByLabel("Scope");
    await waitForHydration(scopeField);
    await scopeField.selectOption({ label: "Pantry" });
    await page.getByRole("button", { name: "Open stocktake" }).click();

    await expect(
      page.getByText(`${stocktakeRefNo} is still open for Pantry — post or cancel it first`, { exact: true }),
    ).toBeVisible({ timeout: 10_000 });

    expect(await db.stocktake.count({ where: { state: "OPEN" } })).toBe(1);
  });

  test("3. A movement recorded mid-count flags MOVED without inventing a variance it already explains", async ({
    page,
  }) => {
    test.setTimeout(60_000); // first hit of /stock/issue in this spec file
    await login(page, PURCHASING);

    await page.goto(`/stock/stocktakes/${stocktakeId}`);
    const countedPN1 = page.getByLabel("Counted PN-0001");
    await waitForHydration(countedPN1);
    await countedPN1.fill(String(PN1_COUNT));
    await countedPN1.blur();
    await expect(async () => {
      const line = await db.stocktakeLine.findFirstOrThrow({ where: { stocktakeId, item: { code: "PN-0001" } } });
      expect(line.countedQty).toBe(PN1_COUNT);
    }).toPass({ timeout: 10_000 });

    const countedPN2 = page.getByLabel("Counted PN-0002");
    await countedPN2.fill(String(PN2_COUNT));
    await countedPN2.blur();
    await expect(async () => {
      const line = await db.stocktakeLine.findFirstOrThrow({ where: { stocktakeId, item: { code: "PN-0002" } } });
      expect(line.countedQty).toBe(PN2_COUNT);
    }).toPass({ timeout: 10_000 });

    // PN-0003 and PN-0004 stay uncounted.

    const pn1 = await pantry("PN-0001");
    await page.goto(`/stock/issue?item=${pn1.id}`);
    const quantityField = page.getByLabel(/^Quantity\b/);
    await waitForHydration(quantityField);
    await quantityField.fill("2");
    await page.getByLabel(/^Department\b/).selectOption({ label: "HR" });
    await page.getByRole("button", { name: "Record issue" }).click();
    await expect(quantityField).toHaveValue("", { timeout: 10_000 });

    await page.goto(`/stock/stocktakes/${stocktakeId}?view=review`);
    const summaryLine = page.getByText(/items counted/);
    await expect(summaryLine).toBeVisible({ timeout: 10_000 });

    // Everything below is computed from the DB, never hardcoded — the
    // review's own "Now" column is a live aggregate, not the bookQty
    // snapshot taken when the stocktake opened.
    const lines = await db.stocktakeLine.findMany({
      where: { stocktakeId },
      include: { item: { select: { id: true, code: true } } },
    });
    const rows = await Promise.all(
      lines.map(async (l) => {
        const now = await balanceOf(l.itemId);
        return {
          code: l.item.code,
          bookQty: l.bookQty,
          now,
          countedQty: l.countedQty,
          drift: now - l.bookQty,
          variance: l.countedQty === null ? null : l.countedQty - now,
        };
      }),
    );
    const byCode = new Map(rows.map((r) => [r.code, r]));
    const pn1Row = byCode.get("PN-0001")!;

    // The issue of 2 is the only thing that touched PN-0001's ledger since
    // the stocktake opened.
    expect(pn1Row.now).toBe(pn1Row.bookQty - 2);
    expect(pn1Row.drift).not.toBe(0);

    const reviewRow1 = page.getByRole("row", { name: /PN-0001/ });
    await expect(reviewRow1).toContainText(String(pn1Row.now));
    await expect(reviewRow1.getByText("MOVED", { exact: true })).toBeVisible();
    await expect(reviewRow1).toContainText(fmtSigned(pn1Row.variance!));

    const reviewRow2 = page.getByRole("row", { name: /PN-0002/ });
    await expect(reviewRow2.getByText("MOVED")).toHaveCount(0);

    const reviewRow3 = page.getByRole("row", { name: /PN-0003/ });
    await expect(reviewRow3).toContainText("not counted");

    const counted = rows.filter((r) => r.countedQty !== null).length;
    const withDiff = rows.filter((r) => r.variance !== null && r.variance !== 0).length;
    const notCounted = rows.filter((r) => r.countedQty === null).length;
    const moved = rows.filter((r) => r.drift !== 0).length;
    expect(counted).toBe(2);
    expect(notCounted).toBe(2);
    expect(moved).toBe(1);

    const summaryText = (await summaryLine.innerText()).replace(/\s+/g, " ").trim();
    expect(summaryText).toBe(
      `${counted} items counted · ${withDiff} with a difference · ${notCounted} not counted · ${moved} moved since opening`,
    );
  });

  test("4. Posting adjusts against the current balance and skips what nobody counted", async ({ page }) => {
    await login(page, PURCHASING);
    await page.goto(`/stock/stocktakes/${stocktakeId}?view=review`);
    const postBtn = page.getByRole("button", { name: "Post stocktake" });
    await waitForHydration(postBtn);

    // Reimplemented independently of planStocktakePost (never imported): the
    // same current-balance-vs-counted comparison, from fresh DB reads.
    const lines = await db.stocktakeLine.findMany({
      where: { stocktakeId },
      include: { item: { select: { id: true, code: true } } },
    });
    const plan = await Promise.all(lines.map(async (l) => ({ ...l, now: await balanceOf(l.itemId) })));
    const differing = plan.filter((l) => l.countedQty !== null && l.countedQty - l.now !== 0);
    const skipped = plan.filter((l) => l.countedQty === null);

    await postBtn.click();
    const dialog = page.getByRole("dialog", { name: "Post this stocktake?" });
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await expect(dialog).toContainText(
      `Post ${differing.length} adjustments? ${skipped.length} uncounted items are left as they are.`,
    );
    await dialog.getByRole("button", { name: "Post" }).click();

    await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByText("POSTED", { exact: true })).toBeVisible({ timeout: 10_000 });

    // Ruling R12 (plan D-24): a POSTED review is a frozen record — an Adjustment
    // column in place of Variance, no live Now column, no MOVED pill, and each
    // adjusted item's code links to its page.
    const review = page.getByRole("table");
    await expect(review.getByRole("columnheader", { name: "Adjustment" })).toBeVisible();
    await expect(review.getByRole("columnheader", { name: "Now" })).toHaveCount(0);
    await expect(review.getByText("MOVED", { exact: true })).toHaveCount(0);
    await expect(review.getByRole("link", { name: "PN-0001", exact: true })).toHaveAttribute("href", /\/stock\/items\//);

    const stAfter = await db.stocktake.findUniqueOrThrow({ where: { id: stocktakeId } });
    expect(stAfter.state).toBe("POSTED");

    const movements = await db.stockMovement.findMany({ where: { stocktakeId } });
    expect(movements).toHaveLength(differing.length);
    for (const l of differing) {
      const m = movements.find((mv) => mv.itemId === l.itemId);
      expect(m).toBeTruthy();
      expect(m!.kind).toBe("ADJUSTMENT");
      expect(m!.reason).toBe(`Stocktake ${stAfter.refNo}`);
      expect(m!.quantity).toBe(l.countedQty! - l.now);
    }
    for (const l of skipped) {
      expect(movements.some((mv) => mv.itemId === l.itemId)).toBe(false);
    }

    // PN-0001 was counted at 35 against a post-issue current balance of 38
    // (case 3), so the reconciliation-against-CURRENT design
    // (src/lib/stocktake.ts) writes a real ADJUSTMENT of 35 − 38 = −3 there;
    // it's present in `differing`, and its item history gains a
    // stocktake-linked row. Its balance lands on what was counted either way.
    const pn1 = await pantry("PN-0001");
    const pn1Line = plan.find((l) => l.item.code === "PN-0001")!;

    await page.goto(`/stock/items/${pn1.id}`);
    const adjustmentRow = page.getByRole("row", { name: /Adjustment/ });
    await expect(adjustmentRow).toBeVisible();
    await expect(adjustmentRow.getByRole("link", { name: stAfter.refNo })).toHaveAttribute(
      "href",
      `/stock/stocktakes/${stocktakeId}`,
    );
    expect(await balanceOf(pn1.id)).toBe(PN1_COUNT);
    expect(pn1Line.countedQty).toBe(PN1_COUNT);
  });

  test("5. Cancelling a stocktake from review discards it without writing any adjustments", async ({ page }) => {
    await login(page, PURCHASING);
    await page.goto("/stock/stocktakes/new");
    const scopeField = page.getByLabel("Scope");
    await waitForHydration(scopeField);
    await scopeField.selectOption({ label: "Cleaning materials" });
    await page.getByRole("button", { name: "Open stocktake" }).click();

    const countedCM1 = page.getByLabel("Counted CM-0001");
    await waitForHydration(countedCM1);

    const st = await db.stocktake.findFirstOrThrow({
      where: { category: { name: "Cleaning materials" }, state: "OPEN" },
      orderBy: { openedAt: "desc" },
    });

    await page.goto(`/stock/stocktakes/${st.id}?view=review`);
    const cancelBtn = page.getByRole("button", { name: "Cancel stocktake" });
    await waitForHydration(cancelBtn);
    await cancelBtn.click();

    const dialog = page.getByRole("dialog", { name: "Cancel this stocktake?" });
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await dialog.getByRole("button", { name: "Cancel stocktake" }).click();

    await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByText("CANCELLED", { exact: true })).toBeVisible({ timeout: 10_000 });

    const stAfter = await db.stocktake.findUniqueOrThrow({ where: { id: st.id } });
    expect(stAfter.state).toBe("CANCELLED");
    expect(await db.stockMovement.count({ where: { stocktakeId: st.id } })).toBe(0);
  });

  test("6. No serious or critical axe violations on the count screen or the review", async ({ page }) => {
    test.setTimeout(45_000); // two page loads, each with its own settle wait
    await login(page, PURCHASING);
    await page.goto("/stock/stocktakes/new");
    const scopeField = page.getByLabel("Scope");
    await waitForHydration(scopeField);
    await scopeField.selectOption({ label: "Pantry" });
    await page.getByRole("button", { name: "Open stocktake" }).click();

    const countedPN1 = page.getByLabel("Counted PN-0001");
    await waitForHydration(countedPN1);
    await expectNoSeriousAxe(page);

    const st = await db.stocktake.findFirstOrThrow({
      where: { category: { name: "Pantry" }, state: "OPEN" },
      orderBy: { openedAt: "desc" },
    });
    await page.goto(`/stock/stocktakes/${st.id}?view=review`);
    await expect(page.getByText(/items counted/)).toBeVisible({ timeout: 10_000 });
    await expectNoSeriousAxe(page);
  });
});
