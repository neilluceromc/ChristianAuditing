import { test, expect, type Locator, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { SEED_PASSWORD } from "../prisma/fixtures";
import { localDateISO, fmtMoneyExact } from "@/lib/format";
import { unitsLabel } from "@/lib/stock-balance";

/**
 * Phase 22, Task 8 — Stock control D2 lots/reports actions (spec §9.2, 8
 * cases). Tasks 1-7 built the D2 surface this file drives: expiry on
 * receive, FEFO issue consumption, the expired-units issue refusal, write-off
 * from the expiry report, set-cost-once, a positive adjustment's own lot,
 * lot document upload/download, and the ledger's own Σ remaining = balance
 * invariant.
 *
 * Cases run `serial` and share state the same one-fixture-through-the-file
 * way `stock.spec.ts` does: case 3's failed issue leaves PN-0003's expired
 * receipt lot in place for case 4 to write off from the expiry report; case
 * 1's own OS-0004 receipt (referenced "DR-9004") is the lot case 7 attaches a
 * document to. Every id/lot is looked up fresh via Prisma, never hardcoded.
 *
 * Seeded stock this file leans on (prisma/seed.ts, spec §2.8's D2 additions):
 * `PN-0003` (Sugar sachet) has an opening lot of 300 (uncosted, unexpired)
 * plus a RECEIPT lot of 100 @₱0.90 that already arrived expired — balance
 * 400, available (unexpired) 300. `PN-0002` (Creamer sachet) has an opening
 * lot of 150 (uncosted, no expiry) plus a RECEIPT lot of 100 @₱3.10 expiring
 * in 20 days — balance 250, nothing issued from it yet, so an issue must
 * choose between the two. `OS-0003` (Sticky notes) has an opening lot of 36
 * and an uncosted RECEIPT lot of 24 (reference "DR-1105") — the Set unit
 * cost case. `CM-0001` (Dishwashing liquid) has an opening lot of 24 and a
 * RECEIPT lot left at 10 remaining (12 - the seed's own stocktake -2) — the
 * positive-adjustment case. `OS-0004` (Stapler wire) has only its opening
 * lot of 18 until case 1 receives more of it.
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

// Copied from e2e/stock.spec.ts:67-75.
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
const VIEWER = "viewer@thebackroomop.com";

/**
 * A lot's own reference (or a lot-only quantity shape like "12 of 12") also
 * shows up in the item page's History table (a RECEIPT row's detail column
 * repeats the lot's reference), so a bare `getByRole("row", { name })` is
 * ambiguous across the two tables. Scope to the Card whose own `<h2>` reads
 * `title` — its DOM parent's parent is the Card's own wrapping div, which
 * holds both `CardHeader` and `CardBody` (`card.tsx`).
 */
function cardSection(page: Page, title: string): Locator {
  return page.getByRole("heading", { name: title, exact: true, level: 2 }).locator("xpath=../..");
}

/** Balances are DERIVED — never a stored column — so every assertion recomputes from the ledger, same as the app does. */
async function balanceOf(itemId: string): Promise<number> {
  const agg = await db.stockMovement.aggregate({ where: { itemId }, _sum: { quantity: true } });
  return agg._sum.quantity ?? 0;
}

/** Plain `YYYY-MM-DD` arithmetic — the same shape `todayStr()`/`localDateISO()` produce. */
function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const TODAY = localDateISO();

test.describe.serial("stock lots", () => {
  test("1. Receiving with Expires puts the lot on the item's Lots card, labelled by days left", async ({ page }) => {
    // First hit of /stock/receive and an item page in this file — cold JIT.
    test.setTimeout(60_000);
    const os0004 = await db.stockItem.findUniqueOrThrow({ where: { code: "OS-0004" } });
    const balanceBefore = await balanceOf(os0004.id);
    const expiresAt = addDays(TODAY, 5);

    await login(page, PURCHASING);
    await page.goto(`/stock/receive?item=${os0004.id}`);
    const quantityField = page.getByLabel(/^Quantity\b/);
    await waitForHydration(quantityField);
    await quantityField.fill("12");
    await page.getByLabel("Supplier").selectOption({ label: "TechServe PH" });
    await page.getByLabel("Reference").fill("DR-9004");
    await page.getByLabel("Expires").fill(expiresAt);
    await page.getByRole("button", { name: "Record receipt" }).click();

    await expect(
      page.getByText(`Received ${unitsLabel(12, "box")} of OS-0004`, { exact: true }),
    ).toBeVisible({ timeout: 10_000 });
    await page.getByRole("link", { name: "View item" }).click();
    await expect(page.getByRole("heading", { name: "OS-0004 · Stapler wire no. 35", level: 1 })).toBeVisible({
      timeout: 10_000,
    });

    // The header pill: not expired, expiring within the default 30-day window.
    await expect(page.getByText("EXPIRING", { exact: true })).toBeVisible();

    // The Lots card row: reference identifies it, the label reads "expires in 5 days".
    const lotRow = cardSection(page, "Lots").getByRole("row", { name: /DR-9004/ });
    await expect(lotRow).toBeVisible();
    await expect(lotRow).toContainText("expires in 5 days");
    await expect(lotRow).toContainText("12 of 12");

    const lot = await db.stockLot.findFirstOrThrow({ where: { itemId: os0004.id, reference: "DR-9004" } });
    expect(lot.quantity).toBe(12);
    expect(localDateISO(lot.expiresAt!)).toBe(expiresAt);
    expect(await balanceOf(os0004.id)).toBe(balanceBefore + 12);
  });

  test("2. Issuing PN-0002 draws from its earliest-expiring lot first, and History shows the cost", async ({ page }) => {
    const pn0002 = await db.stockItem.findUniqueOrThrow({ where: { code: "PN-0002" } });
    const balanceBefore = await balanceOf(pn0002.id);
    const expiringLot = await db.stockLot.findFirstOrThrow({ where: { itemId: pn0002.id, expiresAt: { not: null } } });
    const openingLot = await db.stockLot.findFirstOrThrow({ where: { itemId: pn0002.id, expiresAt: null } });

    await login(page, PURCHASING);
    // First hit of /stock/issue in this file — cold JIT.
    test.setTimeout(60_000);
    await page.goto(`/stock/issue?item=${pn0002.id}`);
    const quantityField = page.getByLabel(/^Quantity\b/);
    await waitForHydration(quantityField);
    await quantityField.fill("30");
    await page.getByLabel(/^Department\b/).selectOption({ label: "Finance" });
    await page.getByRole("button", { name: "Record issue" }).click();

    await expect(
      page.getByText("Success: Issued 30 sachets of PN-0002 to Finance", { exact: true }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(quantityField).toHaveValue("", { timeout: 10_000 });

    expect(await balanceOf(pn0002.id)).toBe(balanceBefore - 30);

    // The undated opening lot (older by lotDate) is left untouched — the
    // expiring lot, even though it arrived later, is drawn from first.
    const movement = await db.stockMovement.findFirstOrThrow({
      where: { itemId: pn0002.id, kind: "ISSUE", quantity: -30 },
      orderBy: { occurredAt: "desc" },
      include: { allocations: true },
    });
    expect(movement.allocations).toHaveLength(1);
    expect(movement.allocations[0].lotId).toBe(expiringLot.id);
    expect(movement.allocations[0].quantity).toBe(30);
    const openingAllocated = await db.stockAllocation.count({ where: { lotId: openingLot.id } });
    expect(openingAllocated).toBe(0);

    await page.goto(`/stock/items/${pn0002.id}`);
    const historyRow = page.getByRole("row", { name: /Issue/ });
    await expect(historyRow).toBeVisible({ timeout: 10_000 });
    await expect(historyRow).toContainText(fmtMoneyExact(30 * 3.1)); // ₱93.00
  });

  test("3. Issuing more of PN-0003 than the unexpired stock covers is refused, naming the expired lot", async ({ page }) => {
    const pn0003 = await db.stockItem.findUniqueOrThrow({ where: { code: "PN-0003" } });
    const balanceBefore = await balanceOf(pn0003.id);
    expect(balanceBefore).toBe(400); // 300 unexpired (opening) + 100 expired (receipt)

    await login(page, PURCHASING);
    await page.goto(`/stock/issue?item=${pn0003.id}`);
    const quantityField = page.getByLabel(/^Quantity\b/);
    await waitForHydration(quantityField);
    await quantityField.fill("350"); // <= balance (400) but > unexpired (300)
    await page.getByLabel(/^Department\b/).selectOption({ label: "HR" });
    await page.getByRole("button", { name: "Record issue" }).click();

    await expect(
      page.getByText("Only 300 unexpired sachets of PN-0003 — write off the expired lot first"),
    ).toBeVisible({ timeout: 10_000 });
    // The failed submit never clears the field.
    await expect(quantityField).toHaveValue("350");

    expect(await balanceOf(pn0003.id)).toBe(balanceBefore);
  });

  test("4. Writing off the expired lot from the expiry report empties it, posts a negative adjustment, and the row disappears", async ({ page }) => {
    const pn0003 = await db.stockItem.findUniqueOrThrow({ where: { code: "PN-0003" } });
    const expiredLot = await db.stockLot.findFirstOrThrow({
      where: { itemId: pn0003.id, expiresAt: { not: null } },
    });
    const balanceBefore = await balanceOf(pn0003.id);

    await login(page, PURCHASING);
    // First hit of /stock/reports/expiry in this file — cold JIT.
    test.setTimeout(60_000);
    await page.goto("/stock/reports/expiry");
    await expect(page.getByRole("heading", { name: "Expiring and expired lots", level: 1 })).toBeVisible({
      timeout: 10_000,
    });

    const reportRow = page.getByRole("row", { name: /PN-0003/ });
    await expect(reportRow).toBeVisible();
    const writeOffBtn = reportRow.getByRole("button", { name: "Write off" });
    await waitForHydration(writeOffBtn);
    await writeOffBtn.click();

    const dialog = page.getByRole("dialog", { name: "Write off lot" });
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    // Quantity defaults to the lot's own remaining (100); Reason is prefilled "Expired".
    await expect(dialog.getByLabel("Quantity")).toHaveValue("100");
    await expect(dialog.getByLabel("Reason")).toHaveValue("Expired");
    await dialog.getByRole("button", { name: "Confirm" }).click();

    await expect(
      page.getByText("Success: Wrote off 100 sachets of PN-0003", { exact: true }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 10_000 });

    // The report row disappears and the Expired block reads empty.
    await expect(page.getByRole("row", { name: /PN-0003/ })).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByText("Nothing has expired.", { exact: true })).toBeVisible();

    // DB: the lot is fully drawn down, and the movement is a negative ADJUSTMENT.
    const refreshedLot = await db.stockLot.findUniqueOrThrow({
      where: { id: expiredLot.id },
      include: { allocations: true },
    });
    const remaining = refreshedLot.quantity - refreshedLot.allocations.reduce((s, a) => s + a.quantity, 0);
    expect(remaining).toBe(0);
    const movement = await db.stockMovement.findFirstOrThrow({
      where: { itemId: pn0003.id, kind: "ADJUSTMENT", quantity: -100 },
    });
    expect(movement.reason).toBe("Expired");
    expect(await balanceOf(pn0003.id)).toBe(balanceBefore - 100);

    // The item page's own History shows the same posting, with its cost.
    await page.goto(`/stock/items/${pn0003.id}`);
    const historyRow = page.getByRole("row", { name: /Adjustment/ });
    await expect(historyRow).toBeVisible({ timeout: 10_000 });
    await expect(historyRow).toContainText("Expired");
    await expect(historyRow).toContainText(fmtMoneyExact(100 * 0.9)); // ₱90.00
    // No more expired units to report on the balance card.
    await expect(page.getByText(/expired\)/)).toHaveCount(0);
  });

  test("5. Setting OS-0003's uncosted lot's cost once makes the trigger disappear for good", async ({ page }) => {
    const os0003 = await db.stockItem.findUniqueOrThrow({ where: { code: "OS-0003" } });

    await login(page, PURCHASING);
    await page.goto(`/stock/items/${os0003.id}`);
    // Two uncosted lots exist (the opening lot and this one) — the reference
    // is what picks out the receipt lot the spec means.
    const lotRow = cardSection(page, "Lots").getByRole("row", { name: /DR-1105/ });
    const setCostBtn = lotRow.getByRole("button", { name: "Set unit cost" });
    await waitForHydration(setCostBtn);
    await setCostBtn.click();

    const dialog = page.getByRole("dialog", { name: "Set unit cost" });
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await dialog.getByLabel("Unit cost").fill("9");
    await dialog.getByRole("button", { name: "Save" }).click();

    await expect(page.getByText("Success: Lot priced at ₱9.00", { exact: true })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 10_000 });

    // The trigger is gone from this lot's own row — the only way `setLotCost`
    // is reachable a second time is by calling the server action directly,
    // which the UI no longer offers; a DB read proves exactly one write.
    const pricedRow = cardSection(page, "Lots").getByRole("row", { name: /DR-1105/ });
    await expect(pricedRow.getByRole("button", { name: "Set unit cost" })).toHaveCount(0);
    await expect(pricedRow).toContainText("₱9.00");
    // The item's OTHER uncosted lot (the opening one) still offers it —
    // proving the trigger's disappearance is per-lot, not a page-wide fluke.
    const openingRow = cardSection(page, "Lots").getByRole("row", { name: /36 of 36/ });
    await expect(openingRow.getByRole("button", { name: "Set unit cost" })).toBeVisible();

    // Persisted, not just optimistic client state: reload and re-check.
    await page.reload();
    await expect(
      cardSection(page, "Lots").getByRole("row", { name: /DR-1105/ }).getByRole("button", { name: "Set unit cost" }),
    ).toHaveCount(0);

    const lot = await db.stockLot.findFirstOrThrow({ where: { itemId: os0003.id, reference: "DR-1105" } });
    expect(Number(lot.unitCost)).toBe(9);
  });

  test("6. A positive adjustment on CM-0001 opens its own uncosted lot in the Lots card", async ({ page }) => {
    const cm0001 = await db.stockItem.findUniqueOrThrow({ where: { code: "CM-0001" } });
    const balanceBefore = await balanceOf(cm0001.id);

    await login(page, PURCHASING);
    await page.goto(`/stock/items/${cm0001.id}`);
    const adjustBtn = page.getByRole("button", { name: "Adjust" });
    await waitForHydration(adjustBtn);
    await adjustBtn.click();

    const dialog = page.getByRole("dialog", { name: "Adjust CM-0001" });
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await dialog.getByLabel("Adjustment mode").selectOption({ label: "Change by" });
    await dialog.getByLabel("Quantity").fill("8");
    await dialog.getByLabel("Reason").fill("Found extra stock");
    await dialog.getByRole("button", { name: "Post adjustment" }).click();

    await expect(page.getByText("Success: Adjustment posted", { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 10_000 });

    expect(await balanceOf(cm0001.id)).toBe(balanceBefore + 8);

    const newLot = await db.stockLot.findFirstOrThrow({
      where: { itemId: cm0001.id, origin: "ADJUSTMENT", quantity: 8 },
      include: { allocations: true },
    });
    expect(newLot.unitCost).toBeNull();
    expect(newLot.allocations).toHaveLength(0);

    await expect(page.getByRole("row", { name: /8 of 8/ })).toBeVisible({ timeout: 10_000 });
  });

  test("7. Attaching a document to a lot lets a viewer download it", async ({ page }) => {
    const os0004 = await db.stockItem.findUniqueOrThrow({ where: { code: "OS-0004" } });

    await login(page, PURCHASING);
    await page.goto(`/stock/items/${os0004.id}`);
    const lotRow = cardSection(page, "Lots").getByRole("row", { name: /DR-9004/ });
    const attachBtn = lotRow.getByRole("button", { name: "Attach document" });
    await waitForHydration(attachBtn);
    await attachBtn.click();

    const dialog = page.getByRole("dialog", { name: "Attach document" });
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await dialog.getByLabel("Kind").selectOption({ label: "Delivery receipt" });
    await dialog.getByLabel("File").setInputFiles("e2e/fixtures/delivery-receipt.pdf");
    await dialog.getByRole("button", { name: "Upload" }).click();

    await expect(page.getByText("Success: Document attached", { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 10_000 });

    // lots-card.tsx renders a lot's documents as a SEPARATE row beneath the
    // lot's own row (never nested inside it), so the link is found within
    // the Lots card as a whole, not the lot's own `getByRole("row")`.
    const link = cardSection(page, "Lots").getByRole("link", { name: /delivery-receipt\.pdf/ });
    await expect(link).toBeVisible({ timeout: 10_000 });
    const href = await link.getAttribute("href");
    expect(href).toMatch(/^\/stock\/lots\/[^/]+\/documents\/[^/]+\/download$/);

    const lot = await db.stockLot.findFirstOrThrow({ where: { itemId: os0004.id, reference: "DR-9004" } });
    const doc = await db.stockLotDocument.findFirstOrThrow({ where: { lotId: lot.id } });
    expect(doc.kind).toBe("delivery-receipt");
    expect(doc.fileName).toBe("delivery-receipt.pdf");

    // Any authenticated user may download it — a viewer, not just a manager.
    await login(page, VIEWER);
    const res = await page.request.get(href!);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-disposition"]).toContain("delivery-receipt.pdf");
  });

  test("8. Invariant: every item's lots sum to exactly its own balance", async () => {
    const items = await db.stockItem.findMany({ select: { id: true, code: true } });
    const [movementSums, lots] = await Promise.all([
      db.stockMovement.groupBy({ by: ["itemId"], _sum: { quantity: true } }),
      db.stockLot.findMany({
        select: { id: true, itemId: true, quantity: true, allocations: { select: { quantity: true } } },
      }),
    ]);
    const balanceById = new Map(movementSums.map((m) => [m.itemId, m._sum.quantity ?? 0]));
    const remainingById = new Map<string, number>();
    for (const lot of lots) {
      const allocated = lot.allocations.reduce((s, a) => s + a.quantity, 0);
      const remaining = lot.quantity - allocated;
      remainingById.set(lot.itemId, (remainingById.get(lot.itemId) ?? 0) + remaining);
    }
    for (const item of items) {
      const balance = balanceById.get(item.id) ?? 0;
      const sumRemaining = remainingById.get(item.id) ?? 0;
      expect(sumRemaining, `${item.code}: Σ remaining (${sumRemaining}) should equal balance (${balance})`).toBe(
        balance,
      );
    }
  });
});
