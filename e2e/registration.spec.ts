import { test, expect, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { SEED_PASSWORD } from "../prisma/fixtures";

/**
 * Phase 16 — registration. Six cases per spec §9.2 rows 1–6: category-driven
 * tag prefill on the single-asset form, vendor/brand/a document landing on
 * the record, a live duplicate-serial check before submit, the batch page's
 * Purchasing fields with one invoice document shared across every unit in
 * the batch, duplicate-serial refusal (both in-batch and against the fleet),
 * and IT's nav link to the batch page.
 *
 * Cases run serial but each registers its own fresh assets — none of them
 * shares or depends on state another case wrote, so the ordering only
 * matters in that later cases must not collide with tags/serials earlier
 * ones created (highestNumber() always looks up the current max instead of
 * hardcoding one).
 *
 * Note: prisma/seed.ts never sets a `serial` on any asset (verified against
 * the seeded DB), so the brief's `db.asset.findFirstOrThrow({ where: {
 * serial: { not: null } } })` throws against the real fixture. Cases 3 and 5
 * instead stamp a serial onto an existing, otherwise-untouched seeded asset
 * via Prisma first, then prove the exact same spec row (a real fleet-wide
 * serial is flagged) against that.
 */

const db = new PrismaClient();

test.beforeAll(() => {
  execSync("npm run db:seed", { timeout: 120_000 });
});
test.afterAll(async () => {
  await db.$disconnect();
});

// Copied from e2e/direct-lifecycle.spec.ts:24-51 — house rule: never import
// helpers across spec files, since each file reseeds independently.
async function login(page: Page, email: string) {
  await page.goto("/logout");
  await page.getByLabel(/Email/).fill(email);
  await page.getByLabel(/Password/).fill(SEED_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

// idOf (also part of the shared helper block at e2e/direct-lifecycle.spec.ts:24-51)
// is not needed here — every case below looks assets up by tag directly — so
// it is left out rather than copied unused.

/** Highest number in use under a prefix — never hardcode a literal; an earlier test may have registered more. */
async function highestNumber(prefix: string): Promise<number> {
  const rows = await db.asset.findMany({ where: { tag: { startsWith: `BR-${prefix}-` } }, select: { tag: true } });
  return rows.reduce((max, r) => Math.max(max, Number(r.tag.slice(6))), 0);
}
const tagOf = (prefix: string, n: number) => `BR-${prefix}-${String(n).padStart(4, "0")}`;

const IT = "it@thebackroomop.com";
const P = "purchasing@thebackroomop.com";

test.describe.serial("registration", () => {
  test("1. picking a category prefills the next free tag for its most-used prefix", async ({ page }) => {
    const next = tagOf("LT", (await highestNumber("LT")) + 1);
    await login(page, IT);
    await page.goto("/inventory/new");
    await page.getByLabel("Category").selectOption({ label: "Laptop" });
    await expect(page.getByLabel("Asset tag")).toHaveValue(next);
    await expect(page.getByText("Suggested — next free number for BR-LT. Edit if you need another.")).toBeVisible();
    // Still editable — a hand-typed tag survives the suggestion.
    await page.getByLabel("Asset tag").fill(tagOf("LT", 9000));
    await expect(page.getByLabel("Asset tag")).toHaveValue("BR-LT-9000");
  });

  test("2. vendor, brand and a document chosen at creation land on the record", async ({ page }) => {
    const tag = tagOf("LT", (await highestNumber("LT")) + 1);
    await login(page, IT);
    await page.goto("/inventory/new");
    await page.getByLabel("Category").selectOption({ label: "Laptop" });
    await page.getByLabel("Model").fill("ThinkPad E14 (e2e reg)");
    await page.getByLabel("Brand").fill("Lenovo");
    await page.getByLabel("Vendor").selectOption({ label: "TechServe PH" });
    await page.getByLabel(/Documents/).setInputFiles({
      name: "quote.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 e2e"),
    });
    await page.getByRole("button", { name: "Register asset" }).click();
    await expect(page).toHaveURL(/\/inventory\/[^/?]+\?created=1$/, { timeout: 30_000 });
    await expect(page.getByText(`${tag} registered`)).toBeVisible();
    await expect(page.getByRole("link", { name: "Print label" })).toHaveAttribute("href", /\/inventory\/labels\?ids=/);
    await expect(page.getByText("Lenovo")).toBeVisible();
    await expect(page.getByText("TechServe PH")).toBeVisible();

    const asset = await db.asset.findUniqueOrThrow({ where: { tag }, include: { documents: true } });
    expect(asset.brand).toBe("Lenovo");
    expect(asset.documents.map((d) => d.fileName)).toEqual(["quote.pdf"]);
    expect(await db.auditEntry.count({ where: { entityType: "asset", entityId: asset.id, action: "document.uploaded" } })).toBe(1);
  });

  test("3. a seeded serial is flagged as already registered before submit", async ({ page }) => {
    // No seeded asset carries a serial — stamp a real, fleet-wide one onto an
    // existing, otherwise-untouched IT asset so there is something genuine
    // for the live check to collide with.
    const target = await db.asset.findUniqueOrThrow({ where: { tag: "BR-LT-0201" } });
    const serial = "SN-E2E-0201";
    await db.asset.update({ where: { id: target.id }, data: { serial } });

    await login(page, IT);
    await page.goto("/inventory/new");
    await page.getByLabel("Serial").fill(serial);
    await page.getByLabel("Model").click(); // blur
    await expect(page.getByText("Already registered")).toBeVisible({ timeout: 10_000 });
  });

  test("4. the batch page registers 3 units with the Purchasing fields and one invoice on each", async ({ page }) => {
    await login(page, P);
    await page.goto("/inventory/register");
    await page.getByLabel("Category").selectOption({ label: "Vehicle" });
    await page.getByLabel("Model").fill("Toyota Vios (e2e batch)");
    await page.getByLabel("Quantity").fill("3");
    await page.getByLabel("Purchased").fill("2026-09-01");
    await expect(page.getByLabel("Warranty until")).toHaveValue("2027-09-01");
    await page.getByLabel("Brand").fill("Toyota");
    await page.getByLabel("Invoice / receipt no.").fill("INV-2026-0912");
    await page.getByLabel("Notes").fill("fleet renewal");
    await page.getByLabel("Invoice document").setInputFiles({
      name: "inv.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 inv"),
    });
    const tags = await Promise.all([1, 2, 3].map((i) => page.getByLabel(`Tag ${i}`).inputValue()));
    await page.getByRole("button", { name: "Register 3 assets" }).click();
    await expect(page.getByText(/3 assets registered/)).toBeVisible({ timeout: 30_000 });

    // Ordered by tag ascending, same order registerAssets pushed its ids in
    // (it walks d.tags, which the client submitted in the same ascending
    // sequence nextTags produced) — so this exactly reproduces the ids the
    // success panel's own href was built from.
    const rows = await db.asset.findMany({ where: { tag: { in: tags } }, orderBy: { tag: "asc" }, include: { documents: true } });
    const ids = rows.map((a) => a.id);
    await expect(page.getByRole("link", { name: "Print labels" })).toHaveAttribute("href", `/inventory/labels?ids=${ids.join(",")}`);

    for (const r of rows) {
      expect(r.brand).toBe("Toyota");
      expect(r.invoiceRef).toBe("INV-2026-0912");
      expect(r.notes).toBe("fleet renewal");
      expect(r.warrantyUntil?.toISOString().slice(0, 10)).toBe("2027-09-01");
      expect(r.documents.map((d) => d.kind)).toEqual(["invoice"]);
    }
    expect(new Set(rows.flatMap((r) => r.documents.map((d) => d.path))).size).toBe(1); // stored once
  });

  test("5. duplicate serials are refused by name, and a seeded serial as a serial", async ({ page }) => {
    // Same adaptation as case 3 — stamp a real serial onto an untouched
    // seeded asset first (a different one than case 3 used).
    const target = await db.asset.findUniqueOrThrow({ where: { tag: "BR-LT-0166" } });
    const seededSerial = "SN-E2E-0166";
    await db.asset.update({ where: { id: target.id }, data: { serial: seededSerial } });

    await login(page, P);
    await page.goto("/inventory/register");
    await page.getByLabel("Category").selectOption({ label: "Vehicle" });
    await page.getByLabel("Model").fill("Dup test");
    await page.getByLabel("Quantity").fill("2");
    await page.getByLabel("Serial 1").fill("SAME-1");
    await page.getByLabel("Serial 2").fill("SAME-1");
    await page.getByLabel("Model").click(); // blur
    await expect(page.getByText("Serial SAME-1 appears twice in this batch.")).toBeVisible();

    await page.getByLabel("Serial 2").fill(seededSerial);
    await page.getByLabel("Model").click(); // blur
    await expect(page.getByText(`Already registered: ${seededSerial}`)).toBeVisible({ timeout: 10_000 });

    await page.getByRole("button", { name: "Register 2 assets" }).click();
    await expect(page.getByText(`Serial ${seededSerial} is already registered`)).toBeVisible({ timeout: 10_000 });
  });

  test("6. IT's navigation reaches the batch page", async ({ page }) => {
    await login(page, IT);
    await page.goto("/inventory");
    await page.getByRole("link", { name: "Register several" }).first().click();
    await expect(page).toHaveURL(/\/inventory\/register$/);
    await expect(page.getByRole("heading", { name: "Register assets" })).toBeVisible();
  });
});
