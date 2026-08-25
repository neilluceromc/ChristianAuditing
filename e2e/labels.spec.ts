import { test, expect, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { BULK_MAX } from "@/lib/inventory-list";
import { CALIBRATION_MM, PAGE_MM } from "@/lib/label-geometry";
import { ROLE_LANDING } from "@/lib/workspaces";
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

/** 96 CSS dpi — the only unowned number in this file. CALIBRATION_MM and
 * PAGE_MM are the owned mm figures (rules 26/37/38); every pixel assertion
 * below multiplies one of THEM by this constant rather than retyping a
 * derived pixel figure (377.95, 793.7, 1122.5, …) as a literal. */
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
    // grid template silently breaking the die-cut fit.
    const box = await page.locator(".label-page").boundingBox();
    expect(box?.width).toBeCloseTo(PAGE_MM.width * MM_TO_PX, 1);
    expect(box?.height).toBeCloseTo(PAGE_MM.height * MM_TO_PX, 1);
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
    // toBeCloseTo(…, 1) accepts up to 0.05px of slack. That's not a loose
    // tolerance chosen to avoid flakiness — measured actuals sit ~0.015px off
    // the exact figure, well inside it — it's simply precise enough: the bug
    // this guards was a 72px shrink (10.6% of 100mm), roughly 1000x this
    // tolerance, so there is no realistic regression this precision misses.
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
      expect(box.width).toBeCloseTo(PAGE_MM.width * MM_TO_PX, 1);
      expect(box.height).toBeCloseTo(PAGE_MM.height * MM_TO_PX, 1);
    }

    // Two calibration bars — one per sheet — each still measuring 100mm
    // (0.05px slack; see the dedicated test above for why that's precise
    // enough rather than merely loose).
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

  // Rule 10: a stale selection (an id that no longer/never existed mixed in
  // with a real one) is the fourth outcome, and the one an operator hits most
  // realistically — not "everything's gone" but "most of it's still there".
  test("a partially stale selection prints what it can, and says what it skipped", async ({ page }) => {
    const asset = await db.asset.findUniqueOrThrow({ where: { tag: "BR-LT-0148" } });
    await login(page, "it@thebackroomop.com");
    await page.goto(`/inventory/labels?ids=${asset.id},nope1`);
    await expect(page.getByRole("heading", { name: "Print labels", level: 1 })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("1 selected asset was not found and skipped.")).toBeVisible();
    await expect(page.getByRole("img", { name: "Barcode BR-LT-0148" })).toBeVisible();
  });

  // This assertion is a real guard — it would catch labels/page.tsx's own
  // requireRole("admin", "it_staff") being deleted — but it CANNOT attribute
  // a refusal to either layer: that page-level guard redirects
  // finance/viewer to the identical ROLE_LANDING destination that PATH_RULES's
  // own rejection would, which is why the test is named for what it proves
  // rather than for the rule this task added. Confirmed by mutation: moving
  // the /inventory/labels PATH_RULES entry after the general /inventory rule
  // left THIS test green (see the mutation table). The probe below is the one
  // e2e that actually observes the PATH_RULES layer on its own.
  test("finance and viewer never see a label sheet (either layer may be the one that refuses)", async ({ page }) => {
    await login(page, "finance@thebackroomop.com");
    await page.goto("/inventory/labels?ids=whatever");
    await expect(page).not.toHaveURL(/\/inventory\/labels/, { timeout: 30_000 });

    await login(page, "viewer@thebackroomop.com");
    await page.goto("/inventory/labels?ids=whatever");
    await expect(page).toHaveURL(/\/inventory$/, { timeout: 30_000 });
  });

  // The actual PATH_RULES probe. No page file exists at
  // /inventory/labels/no-such-page — the rule's `(\/|$)` still matches the
  // path, but there is nothing for labels/page.tsx's requireRole to run FROM,
  // so only middleware can answer here. A misordered or deleted rule shows up
  // as a 200 with no redirect at all, which this test caught when the rule
  // was moved after the general /inventory rule (see the mutation table).
  // Non-retrying assertions on the RESPONSE, not a polling assertion on the
  // page: middleware's redirect is a real 307 before anything renders, and a
  // negated `toHaveURL` would politely wait out a client-side settle that
  // never actually happens on this path, hiding the very layer it's meant to
  // isolate.
  test("PATH_RULES itself refuses /inventory/labels/* before any page renders", async ({ page }) => {
    for (const [email, landing] of [
      ["finance@thebackroomop.com", ROLE_LANDING.finance_staff],
      ["viewer@thebackroomop.com", ROLE_LANDING.viewer],
    ] as const) {
      await login(page, email);
      const res = await page.goto("/inventory/labels/no-such-page");
      expect(res?.request().redirectedFrom()?.url()).toContain("/inventory/labels/no-such-page");
      expect(new URL(res!.url()).pathname).toBe(landing);
    }
  });

  test("the bulk drawer offers Print labels for an explicit, non-empty selection", async ({ page }) => {
    await login(page, "it@thebackroomop.com");
    await page.goto("/inventory");
    // A named anchor, not a position: page.getByRole("row").nth(1) would
    // silently retarget if a header or filter row were ever added above the
    // body.
    await page.getByRole("row", { name: /BR-LT-0148/ }).getByRole("checkbox").check();
    await page.getByRole("button", { name: /^Bulk actions/ }).click();
    await expect(page.getByRole("link", { name: /^Print labels for 1 selected$/ })).toBeVisible();
    await expect(page.getByRole("link", { name: "Export this selection as a spreadsheet" })).toBeVisible();
    // The route has served xlsx since Phase 9 — the drawer must not still
    // call it CSV.
    await expect(page.getByRole("link", { name: /Export this selection as CSV/ })).toHaveCount(0);
    // NOT covered here, and worth saying rather than leaving silent: neither
    // of BulkDrawer's two negative branches is reachable through this UI in
    // the seeded environment. "Bulk actions…" only renders once
    // selected.size > 0 (inventory-table.tsx:123), so the drawer can't be
    // open with an empty, non-allMatching selection; and "Select all N
    // matching" needs total > rows.length (:130), which the seed's 25 assets
    // on a single 25-row page never satisfies. The allMatching branch ("Labels
    // need an explicit selection") is the one that actually matters — it's
    // the guard against turning one click into a 17-sheet print job — and it
    // has no e2e coverage right now for exactly that reason.
  });
});
