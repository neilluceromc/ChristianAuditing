import { test, expect, type Locator, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import AxeBuilder from "@axe-core/playwright";
import { PrismaClient } from "@prisma/client";
import { readSheet } from "read-excel-file/node";
import { PROVENANCE_LABEL } from "@/lib/provenance";
import { login } from "./fixtures/login";

/**
 * Phase 18, Task 9 — purchasing extensions (spec §8.2, 8 cases), carried over to purchase orders (migration 38,
 * docs/superpowers/specs/2026-10-21-purchase-orders-intake-design.md). Covers a PO's optional department with its own
 * list filter, its supplier (set on Purchasing's edit form, archived suppliers kept but never offered), documents, and
 * asset provenance (the derived badge/facet/export column, and the money a PO registration copies from the PO).
 *
 * Cases run serial and share state: case 1 saves one new PO (its id/refNo are read once and reused by case 2), and
 * cases 3-5 act on the seed's PO-0198. Every id is looked up fresh via Prisma, never hardcoded, since the seed produces
 * new cuids on every reseed.
 *
 * Seeded fixtures this file depends on (prisma/seed.ts), all @thebackroomop.com / SEED_PASSWORD:
 *   admin, it, purchasing (A. Reyes), finance (L. Domingo), viewer.
 *   Departments: IT, Finance, Sales, HR, Operations.
 *   PO-0201 SENT_BACK/IT, PO-0198 WITH_IT/HR (no supplier), PO-0195 WITH_IT/Sales,
 *   PO-0188 READY (legacy, completed)/IT with supplier TechServe PH, SI-30188, OR-30188, one Dell Latitude 5420 of two
 *   linked; PO-0183 CANCELLED with NO department.
 *   Suppliers: TechServe PH, Octagon Repairs, Metro Office Supply, Quezon Furniture Works (all active), Old Line
 *   Trading (already archived).
 *   e2e/fixtures/assets-clean.xlsx (shared with import-export.spec.ts) yields 3 new IT-class assets: BR-LT-9001,
 *   BR-MN-9002, BR-HS-9003.
 */

const db = new PrismaClient();

test.beforeAll(() => {
  execSync("npm run db:seed", { timeout: 120_000 });
});
test.afterAll(async () => {
  await db.$disconnect();
});

// Copied from e2e/suppliers.spec.ts:56-61 — the mouse-move-then-settle step
// guards against a phantom SERIOUS contrast violation measured on a
// freshly-mounted Button variant="primary" (this file's pages render several:
// "Save supplier", "Archive", "Upload"...).
async function expectNoSeriousAxe(page: Page) {
  await page.mouse.move(0, 0);
  await page.waitForTimeout(700);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
}

// Copied from e2e/suppliers.spec.ts:74-82 (itself copied from
// e2e/it-core.spec.ts) — house rule: never import across spec files. Guards
// the hydration race: filling a field right after `page.goto` can set the DOM
// value before React attaches, which then rebinds the input from the
// server-rendered initial value a beat later and silently drops what was
// typed/selected. Probed on the element about to be interacted with.
async function waitForHydration(target: Locator) {
  const el = target.first();
  await el.waitFor({ state: "attached", timeout: 20_000 });
  await expect(async () => {
    expect(await el.evaluate((node) => Object.keys(node).some((k) => k.startsWith("__reactFiber$")))).toBe(
      true,
    );
  }).toPass({ timeout: 20_000 });
}

const ADMIN = "admin@thebackroomop.com";
const PURCHASING = "purchasing@thebackroomop.com";
const FINANCE = "finance@thebackroomop.com";
const VIEWER = "viewer@thebackroomop.com";

// Phase 34 register helpers, copied from e2e/register-labels.spec.ts (house rule: never import across spec files).
/** A card is named "{name} {N} in stock" or "{name} None yet" — anchored at both ends, since "Laptop" prefixes "Laptop Bag". */
async function pickLaptop(page: Page) {
  const card = page.getByRole("button", { name: /^Laptop (\d+ in stock|None yet)$/ });
  await waitForHydration(card);
  await card.click();
}

/** A new Laptop model, typed High-performance, with a unique serial (every IT unit needs one) and its own tag (Phase 36); returns the tag. */
async function newLaptop(page: Page, model: string, serial: string): Promise<string> {
  await page.getByRole("combobox", { name: "Model", exact: true }).fill(model);
  await page.getByRole("option", { name: /^\+ Add .* as a new model$/ }).click();
  await page.getByRole("combobox", { name: "Type", exact: true }).selectOption({ label: "High-performance" });
  const tag = `PX${Date.now().toString(36).slice(-6).toUpperCase()}-${Math.floor(Math.random() * 90 + 10)}`;
  await page.getByRole("textbox", { name: "Tag", exact: true }).fill(tag);
  await page.getByRole("textbox", { name: "Serial number", exact: true }).fill(serial);
  return tag;
}

const reqByRef = (refNo: string) => db.purchaseOrder.findUniqueOrThrow({ where: { refNo } });
const vendorByName = (name: string) => db.vendor.findUniqueOrThrow({ where: { name } });
const deptByName = (name: string) => db.department.findUniqueOrThrow({ where: { name } });

/** Saves the open PO form (new or edit) and waits for its page; returns the PO's id. */
async function savePo(page: Page): Promise<string> {
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.waitForURL(/\/purchases\/(?!new)[^/]+$/, { timeout: 30_000 });
  return new URL(page.url()).pathname.split("/").pop()!;
}

// Set by case 1, read by case 2 — module scope because each is its own test.
let newReqRef: string;

test.describe.serial("purchasing extensions", () => {
  test("1. a PO's department is optional; one saved for HR shows FOR HR and its list row says HR", async ({ page }) => {
    test.setTimeout(90_000); // first hit of /purchases/new and /purchases/[id] in this file
    await login(page, PURCHASING);
    await page.goto("/purchases/new");
    const main = page.getByRole("main");
    const save = main.getByRole("button", { name: "Save", exact: true });
    await waitForHydration(save);

    // Purchase orders (migration 38): the department is optional ("No department"); a non-IT line skips IT.
    await expect(main.getByLabel("Department")).toHaveValue("");
    await main.getByLabel("Vendor").selectOption({ label: "Metro Office Supply" });
    await main.getByLabel("SI number").fill("SI-18001");
    await main.getByLabel("Purchase date").fill("2026-10-18");
    await main.getByLabel("Department").selectOption({ label: "HR" });
    await main.getByLabel("Line 1 description").fill("Ergonomic task chairs");
    await main.getByLabel("Line 1 category").selectOption({ label: "Furniture" });
    await main.getByLabel("Line 1 quantity").fill("2");
    await main.getByLabel("Line 1 unit price").fill("9500");
    await savePo(page);
    newReqRef = (await page.getByRole("heading", { level: 1 }).textContent())!.trim();
    expect(newReqRef).toMatch(/^PO-\d{4}$/);

    // exact: the meta line below the badge also reads "· for HR" (lowercase "for").
    await expect(page.getByText("FOR HR", { exact: true })).toBeVisible();
    await expect(page.locator("main header").first()).toContainText("Ready to register");

    await page.goto("/purchases");
    await expect(page.getByRole("row", { name: new RegExp(newReqRef) })).toContainText("HR");
  });

  test("2. the department filter narrows the list; ?department=none isolates the untagged seed row", async ({ page }) => {
    await login(page, PURCHASING);
    const hr = await deptByName("HR");

    await page.goto(`/purchases?department=${hr.id}`);
    await expect(page.getByRole("row", { name: new RegExp(newReqRef) })).toBeVisible();
    await expect(page.getByRole("row", { name: /PO-0195/ })).toHaveCount(0);

    await page.goto("/purchases?department=none");
    await expect(page.getByRole("row", { name: /PO-0183/ })).toBeVisible();
    await expect(page.getByRole("row", { name: /PO-0198/ })).toHaveCount(0);
  });

  test("3. Purchasing sets PO-0198's vendor on its edit form; the PO, the list row, the audit log and the vendor profile agree", async ({ page }) => {
    test.setTimeout(60_000); // first hit of /purchases/suppliers/[id] in this file
    await login(page, PURCHASING);
    const po0198 = await reqByRef("PO-0198");

    // Purchase orders: the supplier is one of the PO's money fields, edited on Purchasing's own form (no reason while
    // the PO is with IT, spec §2).
    await page.goto(`/purchases/${po0198.id}/edit`);
    const supplierSelect = page.getByRole("main").getByLabel("Vendor");
    await waitForHydration(supplierSelect);
    await supplierSelect.selectOption({ label: "Quezon Furniture Works" });
    await savePo(page);
    await expect(page.getByRole("main")).toContainText("Quezon Furniture Works");

    await page.goto("/purchases");
    await expect(page.getByRole("row", { name: /PO-0198/ })).toContainText("Quezon Furniture Works");

    expect(await db.auditEntry.findFirst({ where: { entityType: "purchase-order", entityId: po0198.id, action: "po.save" } })).not.toBeNull();

    const quezon = await vendorByName("Quezon Furniture Works");
    await page.goto(`/purchases/suppliers/${quezon.id}`);
    await expect(page.getByRole("row", { name: /PO-0198/ })).toBeVisible({ timeout: 10_000 });
  });

  test("4. an archived vendor is never offered, but a PO that already names one keeps showing it", async ({ page }) => {
    await login(page, PURCHASING);
    const po0198 = await reqByRef("PO-0198");
    const quezon = await vendorByName("Quezon Furniture Works");
    // Re-affirm Quezon (case 3 already set it) so this case does not depend on case 3 having run first.
    await db.purchaseOrder.update({ where: { id: po0198.id }, data: { vendorId: quezon.id } });

    // Old Line Trading is archived in the seed itself and is not this PO's supplier — it must not appear at all.
    await page.goto(`/purchases/${po0198.id}/edit`);
    await expect(
      page.getByRole("main").getByLabel("Vendor").locator("option", { hasText: "Old Line Trading" }),
    ).toHaveCount(0);

    await page.goto(`/purchases/suppliers/${quezon.id}`);
    const archiveBtn = page.getByRole("button", { name: "Archive vendor" });
    await waitForHydration(archiveBtn);
    await archiveBtn.click();
    await page.getByRole("dialog").getByRole("button", { name: "Archive" }).click();
    // exact: the "Success: Vendor archived" toast also contains "archived".
    await expect(page.getByText("ARCHIVED", { exact: true })).toBeVisible({ timeout: 10_000 });

    // The PO page names it, marked archived; its edit form keeps it selected.
    await page.goto(`/purchases/${po0198.id}`);
    await expect(page.getByRole("main")).toContainText("Quezon Furniture Works");
    await expect(page.getByRole("main").getByText("ARCHIVED", { exact: true })).toBeVisible();
    await page.goto(`/purchases/${po0198.id}/edit`);
    const reopenedSelect = page.getByRole("main").getByLabel("Vendor");
    await expect(reopenedSelect).toBeVisible({ timeout: 10_000 });
    const selectedText = await reopenedSelect.evaluate((el: HTMLSelectElement) => el.options[el.selectedIndex]?.text);
    expect(selectedText).toBe("Quezon Furniture Works");

    await page.goto(`/purchases/suppliers/${quezon.id}`);
    const restoreBtn = page.getByRole("button", { name: "Restore vendor" });
    await waitForHydration(restoreBtn);
    await restoreBtn.click();
    await expect(page.getByText("ARCHIVED", { exact: true })).toHaveCount(0, { timeout: 10_000 });
  });

  test("5. documents show by role, survive on a cancelled PO, and download with real headers", async ({ page }) => {
    await login(page, PURCHASING);
    const po0198 = await reqByRef("PO-0198");
    await page.goto(`/purchases/${po0198.id}`);

    const kindSelect = page.getByLabel("Document kind");
    await waitForHydration(kindSelect);
    await kindSelect.selectOption("quotation");
    await page.getByLabel("Document file").setInputFiles({
      name: "quotation.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%quotation"),
    });
    await expect(page.getByRole("row", { name: /Quotation/ })).toBeVisible({ timeout: 10_000 });

    // Spec §2: Purchasing, IT and Finance can all upload.
    await login(page, FINANCE);
    await page.goto(`/purchases/${po0198.id}`);
    const kindSelectFinance = page.getByLabel("Document kind");
    await waitForHydration(kindSelectFinance);
    await kindSelectFinance.selectOption("invoice");
    await page.getByLabel("Document file").setInputFiles({
      name: "invoice.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%invoice"),
    });
    await expect(page.getByRole("row", { name: /Sales invoice/ })).toBeVisible({ timeout: 10_000 });

    await login(page, VIEWER);
    await page.goto(`/purchases/${po0198.id}`);
    await expect(page.getByRole("row", { name: /Quotation/ })).toBeVisible();
    await expect(page.getByRole("row", { name: /Sales invoice/ })).toBeVisible();
    await expect(page.getByLabel("Document file")).toHaveCount(0);
    const downloadLinks = page.getByRole("link", { name: "Download" });
    await expect(downloadLinks.first()).toBeVisible();
    const href = await downloadLinks.first().getAttribute("href");
    const res = await page.request.get(href!);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toBe("application/pdf");
    expect(res.headers()["content-disposition"]).toMatch(/\.pdf/);

    // A cancelled PO keeps its files — and shows them; it takes no new ones (nothing more happens to it).
    await login(page, PURCHASING);
    const po0183 = await reqByRef("PO-0183");
    await db.requestDocument.create({
      data: {
        orderId: po0183.id, kind: "other", fileName: "kept.pdf", path: "e2e/kept.pdf", checksum: "e2e",
        uploadedById: (await db.user.findUniqueOrThrow({ where: { email: PURCHASING } })).id,
      },
    });
    await page.goto(`/purchases/${po0183.id}`);
    await expect(page.getByRole("row", { name: /kept\.pdf/ })).toBeVisible();
    await expect(page.getByLabel("Document file")).toHaveCount(0);
  });

  test("6. import gives an asset Historical provenance; register gives Direct or From a PO; the export names the column", async ({ page }) => {
    test.setTimeout(180_000); // cold JIT on /inventory/import and /inventory/register, plus the wizard's own Apply budget
    await login(page, ADMIN);

    // Wizard steps copied from e2e/import-export.spec.ts's "a clean file reports 3 creates" / "applying it creates 3
    // assets" cases.
    await page.goto("/inventory/import");
    const spreadsheet = page.getByLabel(/Spreadsheet/);
    await waitForHydration(spreadsheet);
    await spreadsheet.setInputFiles("e2e/fixtures/assets-clean.xlsx");
    await page.getByRole("button", { name: /^Validate/ }).click();
    await expect(page.getByText("3 new · 0 updates · 0 blocked")).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: "Import 3 rows" }).click();
    await expect(page.getByText("3 new · 0 updated · 0 already matched · 0 blocked · 0 failed")).toBeVisible({
      timeout: 30_000,
    });

    // The scanner contract redirects an exact tag match straight to the record.
    await page.goto("/inventory?q=BR-LT-9001&go=1");
    await expect(page).toHaveURL(/\/inventory\/[a-z0-9]+$/i, { timeout: 20_000 });
    await expect(page.getByText("Historical import")).toBeVisible();

    await page.goto("/inventory?provenance=HISTORICAL");
    await expect(page.getByText("BR-LT-9001")).toBeVisible({ timeout: 10_000 });

    // Register one laptop with no PO — Direct provenance.
    await page.goto("/inventory/register");
    await pickLaptop(page);
    const directTag = await newLaptop(page, "e2e provenance -- direct", `E2E-PEXT-6A-${Date.now()}`);
    // Plan P-5: quantity 1 is one asset and lands on Labels.
    await page.getByRole("button", { name: "Register 1 laptop", exact: true }).click();
    await page.waitForURL(/\/inventory\/labels\?just=/, { timeout: 30_000 });
    expect(await db.asset.count({ where: { tag: directTag } })).toBe(1);

    await page.goto(`/inventory?q=${directTag}&go=1`);
    await expect(page).toHaveURL(/\/inventory\/[a-z0-9]+$/i, { timeout: 20_000 });
    await expect(page.getByText("Registered directly")).toBeVisible();

    // Register one laptop from PO-0188 (a legacy completed order: Register stays open on it, spec §3) — From a PO.
    const po0188 = await reqByRef("PO-0188");
    await page.goto(`/purchases/${po0188.id}/register`);
    const card = page.getByRole("region", { name: /^Line 01 · Dell Latitude 5420/ });
    const count = card.getByLabel("How many arrived now");
    await waitForHydration(count);
    await count.fill("1");
    const type = card.getByRole("combobox", { name: "Type", exact: true });
    if (await type.count()) await type.selectOption({ label: "Standard" });
    await card.getByRole("combobox", { name: "Model", exact: true }).fill("Latitude 5420 (e2e from PO-0188)");
    const fromPoTag = `PX${Date.now().toString(36).slice(-6).toUpperCase()}-PO`;
    await card.getByLabel("Tag 1", { exact: true }).fill(fromPoTag);
    await card.getByLabel("Serial 1", { exact: true }).fill(`E2E-PEXT-6B-${Date.now()}`);
    await page.getByRole("button", { name: "Register 1 asset" }).click();
    await page.waitForURL(/\/inventory\/labels\?just=/, { timeout: 30_000 });
    expect(await db.asset.count({ where: { tag: fromPoTag } })).toBe(1);

    await page.goto(`/inventory?q=${fromPoTag}&go=1`);
    await expect(page).toHaveURL(/\/inventory\/[a-z0-9]+$/i, { timeout: 20_000 });
    await expect(page.getByRole("link", { name: "From PO-0188" })).toBeVisible();

    // The export sheet's header carries the derived column, and by now the run has every provenance (BR-LT-9001
    // historical, directTag direct, fromPoTag and the seeded BR-LT-0148 from a PO).
    const res = await page.request.get("/inventory/export");
    expect(res.status()).toBe(200);
    const grid = (await readSheet(Buffer.from(await res.body()))) as unknown[][];
    expect(grid[0]).toContain("Provenance");
    const provenanceCol = (grid[0] as string[]).indexOf("Provenance");
    const seen = new Set(grid.slice(1).map((row) => row[provenanceCol]));
    for (const label of Object.values(PROVENANCE_LABEL)) expect(seen).toContain(label);
  });

  test("7. a PO registration takes its money from the PO: vendor, SI and OR numbers, date and the line's price", async () => {
    // Spec §4/§5: money lives on the PO and is copied onto each asset at Register (case 6 registered one from PO-0188).
    const po0188 = await db.purchaseOrder.findUniqueOrThrow({ where: { refNo: "PO-0188" }, include: { lines: true } });
    const asset = await db.asset.findFirstOrThrow({
      where: { purchaseOrderId: po0188.id, model: "Latitude 5420 (e2e from PO-0188)" },
    });
    const techServe = await vendorByName("TechServe PH");
    expect(asset.vendorId).toBe(techServe.id);
    expect(asset.invoiceRef).toBe("SI-30188");
    expect(asset.receiptRef).toBe("OR-30188");
    expect(asset.purchasedAt?.toISOString().slice(0, 10)).toBe(po0188.purchasedAt?.toISOString().slice(0, 10));
    expect(Number(asset.cost)).toBe(Number(po0188.lines[0].unitPrice));
    expect(asset.purchaseOrderLineId).toBe(po0188.lines[0].id);
  });

  test("8. no serious or critical axe violations on PO-0198's page (Purchase + Documents) or the historical-provenance inventory view", async ({ page }) => {
    test.setTimeout(60_000); // two full-page axe scans, each with its own settle wait
    await login(page, PURCHASING);
    const po0198 = await reqByRef("PO-0198");
    await page.goto(`/purchases/${po0198.id}`);
    await expect(page.getByRole("heading", { name: "Purchase", exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("heading", { name: "Documents" })).toBeVisible();
    await expectNoSeriousAxe(page);

    await page.goto("/inventory?provenance=HISTORICAL");
    await expectNoSeriousAxe(page);
  });
});
