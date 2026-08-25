import { test, expect, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { BULK_MAX } from "@/lib/inventory-list";
import { CALIBRATION_MM } from "@/lib/label-geometry";
import { SEED_PASSWORD } from "../prisma/fixtures";

/**
 * Phase 10, Task 4. The label sheet's role gate and its geometry.
 *
 * The geometry assertions exist because Task 3 shipped the calibration bar
 * measuring 89.38mm against a declared 100mm — a flex-shrink bug found only
 * by rendering the page and measuring it in a browser. Nothing static could
 * see it, so this file measures the printed page rather than trusting its
 * text. See the individual tests below for what each one guards.
 *
 * Never reference a raw cuid — the DB is reseeded and ids change every time.
 */
const db = new PrismaClient();

test.beforeAll(() => {
  execSync("npm run db:seed", { timeout: 120_000 });
});

test.afterAll(async () => {
  await db.$disconnect();
});

async function login(page: Page, email: string) {
  await page.goto("/logout");
  await page.getByLabel(/Email/).fill(email);
  await page.getByLabel(/Password/).fill(SEED_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

/** 96 CSS dpi. Used only to sanity-check the derivation in the comments below
 * — the assertions themselves compare against measured px, not this constant,
 * because CALIBRATION_MM and PAGE_MM are the owned mm figures (rules 26/37/38)
 * and everything else is derived. */
const MM_TO_PX = 96 / 25.4;

test.describe("label sheet", () => {
  test("renders one barcode per selected asset, with the calibration bar", async ({ page }) => {
    const asset = await db.asset.findUniqueOrThrow({ where: { tag: "BR-LT-0148" } });
    await login(page, "it@thebackroomop.com");
    await page.goto(`/inventory/labels?ids=${asset.id}`);
    await expect(page.getByRole("heading", { name: "Print labels", level: 1 })).toBeVisible({ timeout: 30_000 });
    // The barcode is a real <svg role="img"> named after its tag — asserted by
    // ROLE, so a sticker that renders no code fails rather than passing on the
    // tag text alone.
    await expect(page.getByRole("img", { name: "Barcode BR-LT-0148" })).toBeVisible();
    await expect(page.getByText("1 label · 1 sheet")).toBeVisible();
    await expect(page.getByText(/exactly 100mm — measure it/)).toBeVisible();

    // A-17, since it's free on a page we've already loaded: the page box
    // itself, which catches a future change to PAGE_MM, PAGE_MARGIN_MM or the
    // grid template silently breaking the die-cut fit. A4 is 210x297mm.
    const box = await page.locator(".label-page").boundingBox();
    expect(box?.width).toBeCloseTo(210 * MM_TO_PX, 1);
    expect(box?.height).toBeCloseTo(297 * MM_TO_PX, 1);
  });

  // A-16. Fixed once already (flexShrink: 0) after shipping at 89.38mm against
  // a declared 100mm — a ruler that lies is worse than none, because it makes
  // an operator "correct" a scaling problem that doesn't exist. This is the
  // permanent guard: measure the bar, don't just read the sentence beside it.
  test("the calibration bar really is 100mm, because a ruler that lies is worse than none", async ({ page }) => {
    const asset = await db.asset.findUniqueOrThrow({ where: { tag: "BR-LT-0148" } });
    await login(page, "it@thebackroomop.com");
    await page.goto(`/inventory/labels?ids=${asset.id}`);
    await expect(page.getByRole("heading", { name: "Print labels", level: 1 })).toBeVisible({ timeout: 30_000 });
    // The bar is the only 1.5mm-tall span with a background on the sheet.
    const widths = await page.evaluate(() =>
      [...document.querySelectorAll("span[style*='background']")]
        .filter((s) => (s as HTMLElement).style.height === "1.5mm")
        .map((s) => s.getBoundingClientRect().width));
    expect(widths.length).toBeGreaterThan(0);
    // toBeCloseTo(…, 1) is deliberate: sub-pixel layout rounding is real, a
    // 10% shrink is not subtle, and a tighter tolerance would be flaky for no
    // gain.
    for (const w of widths) expect(w).toBeCloseTo((CALIBRATION_MM * 96) / 25.4, 1);
  });

  // A-18. 13 ids cross the 12-per-page grid, so this is the only place the
  // second sheet's own calibration bar is exercised at all — it is
  // absolutely positioned PER PAGE rather than rendered once specifically so
  // a ruler on the first sheet says nothing about the second, and a test that
  // only ever renders one page could never catch a regression there.
  test("13 ids paginate into two sheets, each with its own accurate calibration bar", async ({ page }) => {
    const assets = await db.asset.findMany({ orderBy: { tag: "asc" }, take: 13, select: { id: true } });
    expect(assets.length).toBe(13); // the seed must still carry at least 13 assets for this to mean anything
    await login(page, "it@thebackroomop.com");
    await page.goto(`/inventory/labels?ids=${assets.map((a) => a.id).join(",")}`);
    await expect(page.getByRole("heading", { name: "Print labels", level: 1 })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("13 labels · 2 sheets")).toBeVisible();

    const pages = page.locator(".label-page");
    await expect(pages).toHaveCount(2);
    // 12 on the first sheet, 1 on the second — not just "13 barcodes somewhere".
    await expect(pages.nth(0).getByRole("img", { name: /^Barcode /i })).toHaveCount(12);
    await expect(pages.nth(1).getByRole("img", { name: /^Barcode /i })).toHaveCount(1);
    await expect(page.getByRole("img", { name: /^Barcode /i })).toHaveCount(13);

    // A-17 again, for both sheets this time: the page box holds at A4 on
    // every page, not just the first.
    for (const box of await pages.evaluateAll((els) => els.map((el) => el.getBoundingClientRect()))) {
      expect(box.width).toBeCloseTo(210 * MM_TO_PX, 1);
      expect(box.height).toBeCloseTo(297 * MM_TO_PX, 1);
    }

    // Two calibration bars — one per sheet — each still measuring 100mm.
    const widths = await page.evaluate(() =>
      [...document.querySelectorAll("span[style*='background']")]
        .filter((s) => (s as HTMLElement).style.height === "1.5mm")
        .map((s) => s.getBoundingClientRect().width));
    expect(widths.length).toBe(2);
    for (const w of widths) expect(w).toBeCloseTo((CALIBRATION_MM * 96) / 25.4, 1);
  });

  test("an oversized selection is refused, and prints nothing", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    // Distinct ids: the route dedupes with a Set before it counts, so
    // BULK_MAX+1 REPEATED ids would collapse below the cap and never reach
    // this refusal. id0..id{BULK_MAX} are already pairwise distinct.
    const ids = Array.from({ length: BULK_MAX + 1 }, (_, i) => `id${i}`).join(",");
    await page.goto(`/inventory/labels?ids=${ids}`);
    // No shared helper owns this sentence (unlike rowCapRefusal/idsRefusalText
    // elsewhere in this app) — it is inlined once in
    // src/app/(app)/inventory/labels/page.tsx, so BULK_MAX is the only piece
    // worth deriving rather than retyping.
    await expect(page.getByText(new RegExp(`over the ${BULK_MAX}-asset label cap`))).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("img", { name: /^Barcode /i })).toHaveCount(0);
  });

  test("ids that match nothing say so instead of printing a blank sheet", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await page.goto("/inventory/labels?ids=nope1,nope2");
    await expect(page.getByText("Nothing to print")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("link", { name: "Back to inventory" })).toBeVisible();
  });

  // The E-7/W-1 trap, asserted rather than assumed: the general /inventory
  // rule admits both of these workspaces, so without the dedicated
  // /inventory/labels rule ahead of it in PATH_RULES, both would reach this
  // page.
  test("finance and viewer cannot reach the label sheet at all", async ({ page }) => {
    await login(page, "finance@thebackroomop.com");
    await page.goto("/inventory/labels?ids=whatever");
    await expect(page).not.toHaveURL(/\/inventory\/labels/, { timeout: 30_000 });

    await login(page, "viewer@thebackroomop.com");
    await page.goto("/inventory/labels?ids=whatever");
    await expect(page).toHaveURL(/\/inventory$/, { timeout: 30_000 });
  });

  // The entry point Step 3 adds. The banner above tells an operator to "select
  // rows, then choose Print labels from Bulk actions" — so that sentence is
  // only true if the drawer really offers it, and only for an explicit
  // selection (never "all matching": one click must not become a 17-sheet
  // print job).
  test("the bulk drawer offers Print labels only for an explicit, non-empty selection", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await page.goto("/inventory");
    const firstRow = page.getByRole("row").nth(1);
    await firstRow.getByRole("checkbox").check();
    await page.getByRole("button", { name: /^Bulk actions/ }).click();
    await expect(page.getByRole("link", { name: /^Print labels for 1 selected$/ })).toBeVisible();
    await expect(page.getByRole("link", { name: "Export this selection as a spreadsheet" })).toBeVisible();
    // The route has served xlsx since Phase 9 — the drawer must not still
    // call it CSV.
    await expect(page.getByRole("link", { name: /Export this selection as CSV/ })).toHaveCount(0);
  });
});
