import { test, expect, type Locator, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import AxeBuilder from "@axe-core/playwright";
import { PrismaClient } from "@prisma/client";
import { SEED_PASSWORD } from "../prisma/fixtures";

/**
 * Phase 16 — registration. Seven cases per spec §9.2 rows 1–6 plus one added
 * in the final-review fix wave (ruling R14): category-driven tag prefill on
 * the single-asset form, vendor/brand/a document landing on the record, a
 * live duplicate-serial check before submit, the batch page's Purchasing
 * fields with one invoice document shared across every unit in the batch,
 * duplicate-serial refusal (both in-batch and against the fleet), IT's nav
 * link to the batch page, and — case 7 — Purchasing attaching an invoice to
 * an IT-class batch it registers, which `canManageClass` alone could not do
 * (D-19). Case 4 also axe-checks the batch success panel (D-20).
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

// Copied from e2e/it-core.spec.ts:24 — house rule: never import across spec
// files. Adapted with the same pointer-settle step e2e/axe-sweep.spec.ts's
// scanRoute already uses: unlike it-core.spec.ts's callers (every one a fresh
// page.goto), every call here follows a click that opens a panel, and a
// freshly-mounted Button variant="primary" reports a phantom SERIOUS
// contrast violation when axe samples it mid-transition or with the pointer
// resting on it — measured here on the batch success panel, it passes at
// rest. Settling first, not weakening the assertion.
async function expectNoSeriousAxe(page: Page) {
  await page.mouse.move(0, 0);
  await page.waitForTimeout(700);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
}

// Copied from e2e/purchasing-ext.spec.ts (house rule: never import across spec
// files). A control is live once React has attached its fiber; a selectOption
// that lands before that is thrown away by hydration.
async function waitForHydration(target: Locator) {
  const el = target.first();
  await el.waitFor({ state: "attached", timeout: 20_000 });
  await expect(async () => {
    expect(await el.evaluate((node) => Object.keys(node).some((k) => k.startsWith("__reactFiber$")))).toBe(
      true,
    );
  }).toPass({ timeout: 20_000 });
}

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
    // Phase 30 (spec §5.1): /inventory/new is a redirect to the one Register
    // flow, whose quantity-1 row IS the single tag field (plan P-12).
    await page.goto("/inventory/new");
    await expect(page).toHaveURL(/\/inventory\/register$/);
    // The redirect streams (inventory/loading.tsx), so the form can still be
    // hydrating when the URL has already changed.
    await waitForHydration(page.getByLabel("Category"));
    await page.getByLabel("Category").selectOption({ label: "Laptop" });
    await expect(page.getByLabel("Tag 1")).toHaveValue(next);
    await expect(page.getByText("The label is printed after you register.")).toBeVisible();
    // Still editable — a hand-typed tag survives the suggestion.
    await page.getByLabel("Tag 1").fill(tagOf("LT", 9000));
    await expect(page.getByLabel("Tag 1")).toHaveValue("BR-LT-9000");
  });

  test("2. vendor, brand and a document chosen at creation land on the record", async ({ page }) => {
    const tag = tagOf("LT", (await highestNumber("LT")) + 1);
    await login(page, IT);
    await page.goto("/inventory/register");
    await page.getByLabel("Category").selectOption({ label: "Laptop" });
    await page.getByLabel("Model").fill("ThinkPad E14 (e2e reg)");
    await page.getByLabel("Brand").fill("Lenovo");
    // Phase 23 turned this Vendor `<select>` into an `EntityCombobox`: type to
    // filter, then click the option, scoped to this combobox's own
    // `<ul role="listbox">` (the input's following sibling) so the assign
    // combobox further down the form can never be matched instead. Idiom
    // copied from e2e/quick-forms.spec.ts:110-120 — house rule: never import
    // across spec files.
    const vendor = page.getByLabel("Vendor");
    await vendor.fill("TechServe");
    await vendor.locator("xpath=following-sibling::ul").getByRole("option", { name: /TechServe PH/ }).first().click();
    await expect(vendor).toHaveValue("TechServe PH");
    // Phase 30 (spec §5.4): quantity 1 takes several documents, each with a kind, in the styled drop zone.
    await page.getByLabel(/Documents/).setInputFiles({
      name: "quote.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 e2e"),
    });
    await expect(page.getByLabel("Kind for quote.pdf")).toHaveValue("receipt");
    await page.getByRole("button", { name: "Register 1 asset" }).click();
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
    await page.goto("/inventory/register");
    // Phase 20 (spec §6.2): checkIdentifiers is class-scoped now, and the
    // live check is skipped entirely until a category names the class — a
    // category-less guess could flag a collision that only exists in the
    // OTHER class. BR-LT-0201 is a Laptop, so choose that class first.
    await page.getByLabel("Category").selectOption({ label: "Laptop" });
    // Phase 30 (spec §5.5): checked while typing, and the message names the
    // record the serial is already on, linked to it.
    await page.getByLabel("Serial 1").fill(serial);
    const hint = page.getByText(`Serial ${serial} is already on BR-LT-0201`);
    await expect(hint).toBeVisible({ timeout: 10_000 });
    await expect(hint.getByRole("link", { name: "BR-LT-0201" })).toHaveAttribute("href", `/inventory/${target.id}`);
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
    await expectNoSeriousAxe(page); // D-20: the batch success panel

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
    // seeded asset first (a different one than case 3 used). Phase 20 (spec
    // §6.2) scopes checkIdentifiers by class, so the stamped asset must be a
    // Vehicle (Purchasing class) like the batch being registered below —
    // BR-LT-0166 (IT class) would no longer collide, which is the very leak
    // this phase closed.
    const target = await db.asset.findUniqueOrThrow({ where: { tag: "BR-VH-0002" } }); // STORED, unassigned
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
    // Phase 30 (spec §5.5): the row is named, in registerAssets' own words.
    await expect(page.getByText("Row 2 · serial SAME-1 appears twice in this batch")).toBeVisible();

    await page.getByLabel("Serial 2").fill(seededSerial);
    await page.getByLabel("Model").click(); // blur
    const onRecord = page.getByText(`Serial ${seededSerial} is already on BR-VH-0002`);
    await expect(onRecord).toBeVisible({ timeout: 10_000 });

    // The server refuses with the same words (one line, not two); the refused
    // submit hands focus back to the invalid cell, and nothing is written.
    const before = await db.asset.count();
    await page.getByRole("button", { name: "Register 2 assets" }).click();
    await expect(page.getByLabel("Serial 2")).toBeFocused({ timeout: 10_000 });
    await expect(onRecord).toHaveCount(1);
    expect(await db.asset.count()).toBe(before);
  });

  test("6. IT's navigation reaches the batch page", async ({ page }) => {
    await login(page, IT);
    await page.goto("/inventory");
    // Phase 30 (spec §6.1): one Register assets primary in the list header (the nav's entry of the same name is scoped out).
    await page.getByRole("main").getByRole("link", { name: "Register assets" }).click();
    // The header's Register assets names the viewed class, so the form opens narrowed to it.
    await expect(page).toHaveURL(/\/inventory\/register\?cls=IT$/);
    await expect(page.getByRole("heading", { name: "Register assets" })).toBeVisible();
  });

  // Final-review fix wave, ruling R14: `REGISTRABLE_CLASSES.purchasing_staff`
  // includes IT (Phase 14), but the batch invoice upload used to gate on
  // `canManageClass`, so a Purchasing-registered IT batch always ended
  // "Registered — the invoice did not attach." `canAttachDocuments` fixes it.
  test("7. Purchasing attaches an invoice to an IT batch it registers", async ({ page }) => {
    await login(page, P);
    await page.goto("/inventory/register");
    await page.getByLabel("Category").selectOption({ label: "Laptop" });
    await page.getByLabel("Model").fill("ThinkPad E14 (e2e R14)");
    await page.getByLabel("Quantity").fill("2");
    await page.getByLabel("Invoice document").setInputFiles({
      name: "it-inv.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 it-inv"),
    });
    const tags = await Promise.all([1, 2].map((i) => page.getByLabel(`Tag ${i}`).inputValue()));
    await page.getByRole("button", { name: "Register 2 assets" }).click();
    await expect(page.getByText(/2 assets registered/)).toBeVisible({ timeout: 30_000 });
    // No attention banner: the invoice attached, so the "did not attach"
    // banner registration.spec.ts's docError path renders never appears here.
    await expect(page.getByText(/did not attach/)).toHaveCount(0);

    const rows = await db.asset.findMany({ where: { tag: { in: tags } }, include: { documents: true } });
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.cls).toBe("IT");
      // Purchasing does not manage IT, so the asset is never self-checked —
      // it still awaits IT's check even though its invoice is attached.
      expect(r.itVerifiedAt).toBeNull();
      expect(r.documents.map((d) => d.kind)).toEqual(["invoice"]);
    }
  });

  // Phase 30 review R11: a file staged at quantity 1 is not lost when the
  // quantity grows — it becomes the batch's invoice, on every unit.
  test("8. a document staged at quantity 1 becomes the invoice of the batch it grows into", async ({ page }) => {
    await login(page, IT);
    await page.goto("/inventory/register");
    await waitForHydration(page.getByLabel("Category"));
    await page.getByLabel("Category").selectOption({ label: "Laptop" });
    await page.getByLabel("Model").fill("ThinkPad E14 (e2e carry)");
    await page.getByLabel(/Documents/).setInputFiles({
      name: "carry.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 carry"),
    });
    await expect(page.getByLabel("Kind for carry.pdf")).toBeVisible();
    await page.getByLabel("Quantity").fill("3");
    await expect(page.getByText("carry.pdf will be attached to every unit as the invoice.")).toBeVisible();
    const tags = await Promise.all([1, 2, 3].map((i) => page.getByLabel(`Tag ${i}`).inputValue()));
    await page.getByRole("button", { name: "Register 3 assets" }).click();
    await expect(page.getByText(/3 assets registered/)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/did not attach/)).toHaveCount(0);

    const rows = await db.asset.findMany({ where: { tag: { in: tags } }, include: { documents: true } });
    expect(rows).toHaveLength(3);
    for (const r of rows) expect(r.documents.map((d) => [d.fileName, d.kind])).toEqual([["carry.pdf", "invoice"]]);
  });

  // Review R11 the other way, and R10: a batch's invoice comes back as the one
  // asset's Invoice document, and a single registration (audited `create`)
  // shows the record's Last change line.
  test("9. a batch invoice returns to quantity 1 as an Invoice, and the record says what last happened", async ({ page }) => {
    await login(page, IT);
    await page.goto("/inventory/register");
    await waitForHydration(page.getByLabel("Category"));
    await page.getByLabel("Category").selectOption({ label: "Laptop" });
    await page.getByLabel("Model").fill("ThinkPad E14 (e2e return)");
    await page.getByLabel("Quantity").fill("3");
    await page.getByLabel("Invoice document").setInputFiles({
      name: "back.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 back"),
    });
    await page.getByLabel("Quantity").fill("1");
    await expect(page.getByLabel("Kind for back.pdf")).toHaveValue("invoice");
    const tag = await page.getByLabel("Tag 1").inputValue();
    await page.getByRole("button", { name: "Register 1 asset" }).click();
    await expect(page).toHaveURL(/\/inventory\/[^/?]+\?created=1$/, { timeout: 30_000 });
    await expect(page.locator("p", { hasText: "Last change:" })).toContainText("Last change: created");

    const asset = await db.asset.findUniqueOrThrow({ where: { tag }, include: { documents: true } });
    expect(asset.documents.map((d) => [d.fileName, d.kind])).toEqual([["back.pdf", "invoice"]]);
  });
});
