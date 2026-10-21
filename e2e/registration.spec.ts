import { test, expect, type Locator, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import AxeBuilder from "@axe-core/playwright";
import { PrismaClient } from "@prisma/client";
import { login } from "./fixtures/login";

/**
 * Phase 16 — registration. Seven cases per spec §9.2 rows 1–6 plus one added
 * in the final-review fix wave (ruling R14): category-driven tag prefill on
 * the single-asset form, vendor/brand/a document landing on the record, a
 * live duplicate-serial check before submit, the batch page's Purchasing
 * fields with one invoice document shared across every unit in the batch,
 * duplicate-serial refusal (both in-batch and against the fleet), IT's nav
 * link to the batch page, and — case 7 — Purchasing turned away from the
 * direct Register (purchase orders, spec §4 way 3: it registers from a PO).
 * Case 4 also axe-checks the batch success panel (D-20).
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

const tagOf = (prefix: string, n: number) => `BR-${prefix}-${String(n).padStart(4, "0")}`;

// Phase 34 register helpers, copied from e2e/register-labels.spec.ts (house rule: never import across spec files).
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A card is named "{name} {N} in stock" or "{name} None yet" — anchored at both ends, since "Laptop" prefixes "Laptop Bag". */
async function pickCategory(page: Page, name: string) {
  const card = page.getByRole("button", { name: new RegExp(`^${escapeRe(name)} (\\d+ in stock|None yet)$`) });
  await waitForHydration(card);
  await card.click();
}

/** Ruling R11: getByLabel("Model") also hits the "Model and quantity" region. */
const modelBox = (page: Page) => page.getByRole("combobox", { name: "Model", exact: true });

/** Picks a known model from the list, else adds it as new — then a new model in a category with several types takes `type`. */
async function pickModel(page: Page, model: string, type?: string) {
  await modelBox(page).fill(model);
  await expect(page.getByRole("option").first()).toBeVisible();
  const known = page.getByRole("option", { name: model, exact: true });
  if (await known.count()) await known.first().click();
  else await page.getByRole("option", { name: new RegExp(`^\\+ Add .${escapeRe(model)}. as a new model$`) }).click();
  if (type) await page.getByRole("combobox", { name: "Type", exact: true }).selectOption({ label: type });
}

/** The first type a category offers, read from the DB — never assumed. */
async function firstType(category: string): Promise<string> {
  const c = await db.assetCategory.findFirstOrThrow({ where: { name: category }, include: { types: { orderBy: { name: "asc" } } } });
  return c.types[0].name;
}

const serialBox = (page: Page) => page.getByRole("textbox", { name: "Serial number", exact: true });

async function setQuantity(page: Page, n: number) {
  const box = page.getByRole("textbox", { name: "How many", exact: true });
  await box.fill(String(n));
  await box.blur();
  if (n > 1) await expect(page.getByRole("textbox", { name: `Serial ${n}`, exact: true })).toBeVisible();
  else await expect(serialBox(page)).toBeVisible();
}

async function openPurchase(page: Page) {
  const header = page.getByRole("button", { name: /^Purchase and warranty/ });
  if ((await header.getAttribute("aria-expanded")) !== "true") await header.click();
  await expect(header).toHaveAttribute("aria-expanded", "true");
}

/** Phase 36: staff type their own tags — unique per run, 20 characters at most. One unit has the Tag box; a batch has Tag 1…n. */
async function fillTags(page: Page, n: number): Promise<string[]> {
  const stamp = Date.now().toString(36).slice(-6).toUpperCase();
  const tags = Array.from({ length: n }, (_, i) => `REG${stamp}-${i + 1}`);
  for (const [i, t] of tags.entries()) {
    await (n === 1 ? page.getByRole("textbox", { name: "Tag", exact: true }) : page.getByLabel(`Tag ${i + 1}`, { exact: true })).fill(t);
  }
  return tags;
}

/** Brand and Notes sit in the "Notes" fold-out inside Purchase and warranty. */
async function openFold(page: Page) {
  await openPurchase(page);
  const summary = page.locator("summary", { hasText: /^Notes$/ });
  if (!(await page.getByRole("textbox", { name: "Notes", exact: true }).isVisible())) await summary.click();
  await expect(page.getByRole("textbox", { name: "Notes", exact: true })).toBeVisible();
}

/** Register's landing (plan P-5): `/inventory/labels?just=<purchaseRecordId>`; returns the record id. */
async function landedRecord(page: Page): Promise<string> {
  await page.waitForURL(/\/inventory\/labels\?just=/, { timeout: 30_000 });
  const just = new URL(page.url()).searchParams.get("just");
  expect(just).toBeTruthy();
  return just!;
}

const IT = "it@thebackroomop.com";
const P = "purchasing@thebackroomop.com";
// Purchase orders (spec §4 way 3): the direct Register is IT's and an admin's — Purchasing registers only from a PO.
// The Purchasing-class batches below (Vehicles) are registered directly by an admin, who keeps everything.
const ADMIN = "admin@thebackroomop.com";

test.describe.serial("registration", () => {
  test("1. picking a category suggests no tag; a typed tag in a batch row survives", async ({ page }) => {
    await login(page, IT);
    // Phase 30 (spec §5.1): /inventory/new is a redirect to the one Register
    // flow, whose quantity-1 row IS the single tag field (plan P-12).
    await page.goto("/inventory/new");
    await expect(page).toHaveURL(/\/inventory\/register$/);
    // The redirect streams (inventory/loading.tsx), so the form can still be
    // hydrating when the URL has already changed.
    // Phase 36: the category is a card, and no tag is suggested — the Tag box starts empty.
    await pickCategory(page, "Laptop");
    await expect(page.getByRole("textbox", { name: "Tag", exact: true })).toHaveValue("");
    await expect(page.getByText(/^tag BR-/)).toHaveCount(0);
    // A tag typed in a batch row stays as typed.
    await setQuantity(page, 2);
    await expect(page.getByLabel("Tag 1", { exact: true })).toHaveValue("");
    await page.getByLabel("Tag 1", { exact: true }).fill(tagOf("LT", 9000));
    await page.getByLabel("Serial 1", { exact: true }).click();
    await expect(page.getByLabel("Tag 1", { exact: true })).toHaveValue("BR-LT-9000");
  });

  test("2. vendor, brand and a document chosen at creation land on the record", async ({ page }) => {
    const serial = `E2E-REG-2-${Date.now()}`;
    await login(page, IT);
    await page.goto("/inventory/register");
    await pickCategory(page, "Laptop");
    await pickModel(page, "ThinkPad E14 (e2e reg)", await firstType("Laptop"));
    const [tag] = await fillTags(page, 1);
    await serialBox(page).fill(serial);
    await openFold(page);
    await page.getByRole("textbox", { name: "Brand", exact: true }).fill("Lenovo");
    // Phase 23 turned this Vendor `<select>` into an `EntityCombobox`: type to
    // filter, then click the option, scoped to this combobox's own
    // `<ul role="listbox">` (the input's following sibling) so the assign
    // combobox further down the form can never be matched instead. Idiom
    // copied from e2e/quick-forms.spec.ts:110-120 — house rule: never import
    // across spec files.
    const vendor = page.getByRole("combobox", { name: "Vendor", exact: true });
    await vendor.fill("TechServe");
    await vendor.locator("xpath=following-sibling::ul").getByRole("option", { name: /TechServe PH/ }).first().click();
    await expect(vendor).toHaveValue("TechServe PH");
    // Phase 34 (spec §4.5): one unit's documents go in named slots; the Sales invoice slot files it as an invoice.
    await page.getByLabel("Sales invoice", { exact: true }).setInputFiles({
      name: "quote.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 e2e"),
    });
    await expect(page.getByText("quote.pdf")).toBeVisible();
    await page.getByRole("button", { name: "Register 1 laptop", exact: true }).click();
    // Plan P-5: Register lands on Labels; the record itself still shows what was chosen.
    await landedRecord(page);

    const asset = await db.asset.findUniqueOrThrow({ where: { tag }, include: { documents: true } });
    expect(asset.serial).toBe(serial);
    expect(asset.brand).toBe("Lenovo");
    expect(asset.documents.map((d) => [d.fileName, d.kind])).toEqual([["quote.pdf", "invoice"]]);
    await page.goto(`/inventory/${asset.id}`);
    await expect(page.getByText("Lenovo")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("TechServe PH")).toBeVisible();
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
    await pickCategory(page, "Laptop");
    // Phase 30 (spec §5.5): checked while typing, and the message names the
    // record the serial is already on, linked to it. Phase 34: one unit's serial is the big scan box.
    await serialBox(page).fill(serial);
    const hint = page.getByText(`Serial ${serial} is already on BR-LT-0201`);
    await expect(hint).toBeVisible({ timeout: 10_000 });
    await expect(hint.getByRole("link", { name: "BR-LT-0201" })).toHaveAttribute("href", `/inventory/${target.id}`);
  });

  test("4. the batch page registers 3 units with the Purchasing fields and one invoice on each", async ({ page }) => {
    await login(page, ADMIN);
    await page.goto("/inventory/register?cls=PURCHASING");
    await pickCategory(page, "Vehicle");
    await pickModel(page, "Toyota Vios (e2e batch)", await firstType("Vehicle"));
    await setQuantity(page, 3);
    await openFold(page);
    await page.getByLabel("Purchase date", { exact: true }).fill("2026-09-01");
    await expect(page.getByLabel("Warranty until", { exact: true })).toHaveValue("2027-09-01");
    await page.getByRole("textbox", { name: "Brand", exact: true }).fill("Toyota");
    await page.getByRole("textbox", { name: "Invoice no.", exact: true }).fill("INV-2026-0912");
    await page.getByRole("textbox", { name: "Notes", exact: true }).fill("fleet renewal");
    await page.getByLabel("Sales invoice", { exact: true }).setInputFiles({
      name: "inv.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 inv"),
    });
    const tags = await fillTags(page, 3);
    await page.getByRole("button", { name: "Register 3 vehicles", exact: true }).click();
    // Plan P-5: the batch lands on Labels, ticked and ready to print; a Purchasing batch carries its class (Phase 33 I-1).
    const recordId = await landedRecord(page);
    expect(new URL(page.url()).searchParams.get("cls")).toBe("PURCHASING");
    await expect(page.getByRole("checkbox", { name: new RegExp(escapeRe(tags[0])) })).toBeChecked();
    await expect(page.getByRole("button", { name: "Print 3 labels", exact: true })).toBeVisible();
    await expectNoSeriousAxe(page); // D-20: where the batch lands

    const rows = await db.asset.findMany({ where: { tag: { in: tags } }, orderBy: { tag: "asc" }, include: { documents: true } });
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((r) => r.purchaseRecordId))).toEqual(new Set([recordId]));

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

    await login(page, ADMIN);
    await page.goto("/inventory/register?cls=PURCHASING");
    await pickCategory(page, "Vehicle");
    await pickModel(page, "Dup test", await firstType("Vehicle"));
    await setQuantity(page, 2);
    await fillTags(page, 2);
    await page.getByLabel("Serial 1", { exact: true }).fill("SAME-1");
    await page.getByLabel("Serial 2", { exact: true }).fill("SAME-1");
    await modelBox(page).click(); // blur
    // Phase 30 (spec §5.5): the row is named, in registerAssets' own words.
    await expect(page.getByText("Row 2 · serial SAME-1 appears twice in this batch")).toBeVisible();

    await page.getByLabel("Serial 2", { exact: true }).fill(seededSerial);
    await modelBox(page).click(); // blur
    const onRecord = page.getByText(`Serial ${seededSerial} is already on BR-VH-0002`);
    await expect(onRecord).toBeVisible({ timeout: 10_000 });

    // The server refuses with the same words (one line, not two); the refused
    // submit hands focus back to the invalid cell, and nothing is written.
    const before = await db.asset.count();
    await page.getByRole("button", { name: "Register 2 vehicles", exact: true }).click();
    await expect(page.getByLabel("Serial 2", { exact: true })).toBeFocused({ timeout: 10_000 });
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
    // Phase 34 (plan P-9): the page is "New equipment"; the links keep the name "Register assets".
    await expect(page.getByRole("heading", { name: "New equipment", level: 1 })).toBeVisible();
  });

  // Final-review fix wave, ruling R14 (Purchasing attaching an invoice to an IT batch it registered directly) is gone
  // with purchase orders: Purchasing no longer registers directly at all (spec §4 way 3). What it registers from a PO —
  // documents on the PO — is e2e/po-intake.spec.ts.
  test("7. Purchasing can't open the direct Register: it registers from a purchase order", async ({ page }) => {
    await login(page, P);
    await page.goto("/inventory/register");
    await expect(page).toHaveURL(/\/purchases$/);
    await page.goto("/inventory");
    await expect(page.getByRole("main").getByRole("link", { name: "Register assets" })).toHaveCount(0);
  });

  // Phase 30 review R11: a file staged at quantity 1 is not lost when the
  // quantity grows — it becomes the batch's invoice, on every unit.
  test("8. a document staged at quantity 1 becomes the invoice of the batch it grows into", async ({ page }) => {
    await login(page, IT);
    await page.goto("/inventory/register");
    await pickCategory(page, "Laptop");
    await pickModel(page, "ThinkPad E14 (e2e carry)", await firstType("Laptop"));
    await openPurchase(page);
    // Phase 34: the slots no longer change with the quantity — the Sales invoice staged at 1 stays the invoice at 3.
    await page.getByLabel("Sales invoice", { exact: true }).setInputFiles({
      name: "carry.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 carry"),
    });
    await expect(page.getByText("carry.pdf")).toBeVisible();
    await setQuantity(page, 3);
    await expect(page.getByText("carry.pdf")).toBeVisible();
    const stamp = `E2E-REG-8-${Date.now()}`;
    for (const i of [1, 2, 3]) await page.getByLabel(`Serial ${i}`, { exact: true }).fill(`${stamp}-${i}`);
    const tags = await fillTags(page, 3);
    await page.getByRole("button", { name: "Register 3 laptops", exact: true }).click();
    await landedRecord(page);
    expect(new URL(page.url()).searchParams.get("docsFailed")).toBeNull();

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
    await pickCategory(page, "Laptop");
    await pickModel(page, "ThinkPad E14 (e2e return)", await firstType("Laptop"));
    await setQuantity(page, 3);
    await openPurchase(page);
    await page.getByLabel("Sales invoice", { exact: true }).setInputFiles({
      name: "back.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 back"),
    });
    await setQuantity(page, 1);
    await expect(page.getByText("back.pdf")).toBeVisible();
    const serial = `E2E-REG-9-${Date.now()}`;
    await fillTags(page, 1);
    await serialBox(page).fill(serial);
    await page.getByRole("button", { name: "Register 1 laptop", exact: true }).click();
    // Plan P-5: Register lands on Labels; the record (opened from there) says what last happened.
    await landedRecord(page);
    const asset = await db.asset.findFirstOrThrow({ where: { serial }, include: { documents: true } });
    expect(asset.documents.map((d) => [d.fileName, d.kind])).toEqual([["back.pdf", "invoice"]]);
    await page.goto(`/inventory/${asset.id}`);
    await expect(page.locator("p", { hasText: "Last change:" })).toContainText("Last change: created", { timeout: 20_000 });
  });
});
